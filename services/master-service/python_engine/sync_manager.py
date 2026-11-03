"""
Gestor de Sincronización entre Ruteos y SEGURIDA VIAL.
Coordina la lectura, procesamiento de filtros, escritura en Google Sheets y persistencia de estado.
"""
from typing import Dict, Any, Optional
import json
import time
from datetime import datetime
from pathlib import Path

from config import (
    SERVICE_ACCOUNT_FILE,
    DEFAULT_SPREADSHEET_ID,
    SEGURIDAD_VIAL_SPREADSHEET_ID,
    CONF_SPREADSHEET_ID,
    STATE_FILE,
    TARGET_COLUMNS_HEADERS,
    CONF_STATE_FILE,
    CONF_START_ROW
)
from sheets_client import GoogleSheetsClient
from filter_service import CordilleraFilterService
from conf_viaje_service import ConfViajeService

class SyncManager:
    def __init__(
        self,
        credentials_path: Optional[str] = None,
        spreadsheet_id: Optional[str] = None,
        seguridad_vial_spreadsheet_id: str = SEGURIDAD_VIAL_SPREADSHEET_ID,
        conf_spreadsheet_id: str = CONF_SPREADSHEET_ID,
        state_file: Path = STATE_FILE
    ):
        self.credentials_path = credentials_path or SERVICE_ACCOUNT_FILE
        self.seguridad_vial_spreadsheet_id = seguridad_vial_spreadsheet_id
        self.conf_spreadsheet_id = conf_spreadsheet_id
        self.spreadsheet_id = spreadsheet_id or self.seguridad_vial_spreadsheet_id
        self.state_file = state_file
        self.conf_state_file = CONF_STATE_FILE
        self._clients: Dict[str, GoogleSheetsClient] = {}
        self.filter_service = CordilleraFilterService()
        self.conf_viaje_service = ConfViajeService()

    def get_client(self, spreadsheet_id: str) -> GoogleSheetsClient:
        """Obtiene o reutiliza el cliente para una planilla específica."""
        if spreadsheet_id not in self._clients:
            self._clients[spreadsheet_id] = GoogleSheetsClient(
                credentials_path=self.credentials_path,
                spreadsheet_id=spreadsheet_id
            )
        return self._clients[spreadsheet_id]

    @property
    def client(self) -> GoogleSheetsClient:
        """Propiedad para compatibilidad con código existente."""
        return self.get_client(self.spreadsheet_id)

    def run_sync(self, write_to_sheet: bool = True, spreadsheet_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Ejecuta un ciclo completo de sincronización para SEGURIDA VIAL.
        1. Lee los datos vigentes de Ruteos de la planilla correspondiente.
        2. Procesa y filtra los viajes completos con paradas en Cordillera.
        3. Si write_to_sheet es True, escribe en SEGURIDA VIAL.
        4. Guarda el reporte detallado en el archivo de estado local.
        """
        target_id = spreadsheet_id or self.seguridad_vial_spreadsheet_id
        client = self.get_client(target_id)
        start_time = time.time()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            # 1. Leer Ruteos
            raw_rows = client.read_ruteos_rows()

            # 2. Filtrar viajes
            processed = self.filter_service.process_ruteos(raw_rows)

            write_result = None
            if write_to_sheet:
                # 3. Escribir en SEGURIDA VIAL
                write_result = client.write_seguridad_vial(
                    headers=processed["target_headers"],
                    data_rows=processed["rows_to_write"]
                )

            elapsed_seconds = round(time.time() - start_time, 2)

            sync_report = {
                "status": "SUCCESS",
                "timestamp": now_str,
                "elapsed_seconds": elapsed_seconds,
                "spreadsheet_id": target_id,
                "summary": processed["summary"],
                "viajes_copiados": processed["viajes_copiados"],
                "viajes_no_copiados": processed["viajes_no_copiados"],
                "write_result": write_result,
                "target_headers": processed["target_headers"]
            }

            # 4. Guardar estado localmente para la interfaz gráfica
            self._save_state(sync_report)
            return sync_report

        except Exception as e:
            elapsed_seconds = round(time.time() - start_time, 2)
            error_report = {
                "status": "ERROR",
                "timestamp": now_str,
                "elapsed_seconds": elapsed_seconds,
                "spreadsheet_id": target_id,
                "error_message": str(e)
            }
            self._save_state(error_report)
            raise e

    def _save_state(self, report_data: Dict[str, Any]) -> None:
        """Guarda el reporte en disco en formato JSON."""
        try:
            with open(self.state_file, "w", encoding="utf-8") as f:
                json.dump(report_data, f, ensure_ascii=False, indent=2)
        except Exception as err:
            print(f"[Aviso] No se pudo guardar el archivo de estado: {err}")

    def load_latest_state(self) -> Optional[Dict[str, Any]]:
        """Lee el último reporte guardado desde el archivo JSON de estado."""
        if not self.state_file.exists():
            return None
        try:
            with open(self.state_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as err:
            print(f"[Aviso] Error al leer archivo de estado: {err}")
            return None

    def run_sync_conf_viaje(self, write_to_sheet: bool = True, spreadsheet_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Ejecuta el ciclo de sincronización para CONF. DE VIAJE:
        1. Lee los datos vigentes de UTE Cordillera de la planilla correspondiente.
        2. Procesa y filtra los viajes con símbolo '⚠️' en Col F agrupados por TD (Col I).
        3. Si write_to_sheet es True, escribe en CONF. DE VIAJE a partir de la fila 5 (Cols A a J).
        4. Guarda el reporte en last_sync_conf_viaje.json.
        """
        target_id = spreadsheet_id or self.conf_spreadsheet_id
        client = self.get_client(target_id)
        start_time = time.time()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            # 1. Leer UTE Cordillera
            raw_rows = client.read_ute_cordillera_rows()
            if not raw_rows or len(raw_rows) <= 1:
                # Fallback de contingencia: si IMPORTRANGE en UTE Cordillera está pendiente de autorización web,
                # leer directamente de la pestaña SEGURIDA VIAL de la planilla de Ruteos
                from config import TARGET_SHEET_NAME
                sv_client = self.get_client(self.seguridad_vial_spreadsheet_id)
                sv_rows = sv_client.read_ruteos_rows(range_name=f"'{TARGET_SHEET_NAME}'!A1:V")
                if sv_rows and len(sv_rows) > 1:
                    raw_rows = sv_rows

            # 2. Filtrar y mapear filas
            processed = self.conf_viaje_service.process_rows(raw_rows)

            write_result = None
            if write_to_sheet:
                # 3. Escribir en CONF. DE VIAJE (desde fila 5)
                write_result = client.write_conf_de_viaje(
                    data_rows=processed["rows_to_write"],
                    start_row=CONF_START_ROW
                )

            elapsed_seconds = round(time.time() - start_time, 2)

            sync_report = {
                "status": "SUCCESS",
                "timestamp": now_str,
                "elapsed_seconds": elapsed_seconds,
                "spreadsheet_id": target_id,
                "summary": processed["summary"],
                "trips_alerta": processed.get("trips_alerta", []),
                "trips_seguimiento": processed.get("trips_seguimiento", []),
                "trips_otros": processed["trips_otros"],
                "rows_written_count": len(processed["rows_to_write"]),
                "headers": processed["headers"],
                "write_result": write_result
            }

            # 4. Guardar estado local
            try:
                with open(self.conf_state_file, "w", encoding="utf-8") as f:
                    json.dump(sync_report, f, ensure_ascii=False, indent=2)
            except Exception as err:
                print(f"[Aviso] No se pudo guardar estado CONF. DE VIAJE: {err}")

            return sync_report

        except Exception as e:
            elapsed_seconds = round(time.time() - start_time, 2)
            error_report = {
                "status": "ERROR",
                "timestamp": now_str,
                "elapsed_seconds": elapsed_seconds,
                "spreadsheet_id": target_id,
                "error_message": str(e)
            }
            try:
                with open(self.conf_state_file, "w", encoding="utf-8") as f:
                    json.dump(error_report, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
            raise e

    def load_latest_conf_viaje_state(self) -> Optional[Dict[str, Any]]:
        """Lee el último reporte guardado de CONF. DE VIAJE desde disco."""
        if not self.conf_state_file.exists():
            return None
        try:
            with open(self.conf_state_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as err:
            print(f"[Aviso] Error al leer archivo de estado CONF. DE VIAJE: {err}")
            return None

