"""
Cliente para interactuar con Google Sheets API v4.
Maneja autenticación, lectura de Ruteos y escritura en SEGURIDA VIAL.
"""
from pathlib import Path
from typing import List, Dict, Any, Tuple
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

from config import (
    SERVICE_ACCOUNT_FILE,
    DEFAULT_SPREADSHEET_ID,
    SOURCE_SHEET_NAME,
    TARGET_SHEET_NAME,
    CONF_SOURCE_SHEET_NAME,
    CONF_TARGET_SHEET_NAME,
    CONF_START_ROW
)

from credentials_helper import get_google_credentials, resolve_credentials_file

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

class GoogleSheetsClient:
    def __init__(self, credentials_path: str = None, spreadsheet_id: str = DEFAULT_SPREADSHEET_ID):
        self.spreadsheet_id = spreadsheet_id
        if credentials_path and Path(credentials_path).exists():
            self._creds = Credentials.from_service_account_file(credentials_path, scopes=SCOPES)
        else:
            self._creds = get_google_credentials(scopes=SCOPES)
        self._service = build("sheets", "v4", credentials=self._creds)

    def get_spreadsheet_metadata(self) -> Dict[str, Any]:
        """Obtiene los metadatos de la planilla (título, hojas, etc.)."""
        return self._service.spreadsheets().get(spreadsheetId=self.spreadsheet_id).execute()

    def get_sheet_names(self) -> List[str]:
        """Devuelve la lista de títulos de pestañas en la planilla."""
        meta = self.get_spreadsheet_metadata()
        return [sheet["properties"]["title"] for sheet in meta.get("sheets", [])]

    def ensure_target_sheet_exists(self, sheet_title: str = TARGET_SHEET_NAME) -> int:
        """
        Asegura que la pestaña de destino exista. Si no existe, la crea.
        Retorna el sheetId de la pestaña.
        """
        meta = self.get_spreadsheet_metadata()
        for sheet in meta.get("sheets", []):
            if sheet["properties"]["title"] == sheet_title:
                return sheet["properties"]["sheetId"]
        
        # Si no existe, crearla
        req = {
            "requests": [{
                "addSheet": {
                    "properties": {
                        "title": sheet_title,
                        "gridProperties": {
                            "rowCount": 1000,
                            "columnCount": 26
                        }
                    }
                }
            }]
        }
        res = self._service.spreadsheets().batchUpdate(
            spreadsheetId=self.spreadsheet_id,
            body=req
        ).execute()
        return res["replies"][0]["addSheet"]["properties"]["sheetId"]

    def read_ruteos_rows(self, range_name: str = f"'{SOURCE_SHEET_NAME}'!A1:AP") -> List[List[str]]:
        """
        Lee todos los valores formateados de la pestaña de origen (Ruteos).
        """
        result = self._service.spreadsheets().values().get(
            spreadsheetId=self.spreadsheet_id,
            range=range_name,
            valueRenderOption="FORMATTED_VALUE"
        ).execute()
        return result.get("values", [])

    def write_seguridad_vial(
        self,
        headers: List[str],
        data_rows: List[List[str]],
        target_sheet: str = TARGET_SHEET_NAME
    ) -> Dict[str, Any]:
        """
        Limpia el contenido anterior de la pestaña de destino y escribe la cabecera
        seguida de todas las filas de datos. Formatea la primera fila con negrita.
        """
        sheet_id = self.ensure_target_sheet_exists(target_sheet)

        # 1. Limpiar todo el rango existente en la hoja destino
        self._service.spreadsheets().values().clear(
            spreadsheetId=self.spreadsheet_id,
            range=f"{target_sheet}!A1:Z"
        ).execute()

        # Preparar datos combinados: Fila 1 = Encabezados, Filas 2+ = Datos
        all_values = [headers] + data_rows

        # 2. Escribir los datos en un solo llamado por lotes
        write_range = f"{target_sheet}!A1"
        body = {
            "values": all_values
        }
        update_result = self._service.spreadsheets().values().update(
            spreadsheetId=self.spreadsheet_id,
            range=write_range,
            valueInputOption="USER_ENTERED",
            body=body
        ).execute()

        # 3. Aplicar formato visual (Fila 1 en negrita y congelar fila 1)
        format_requests = [
            # Congelar la primera fila
            {
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": sheet_id,
                        "gridProperties": {
                            "frozenRowCount": 1
                        }
                    },
                    "fields": "gridProperties.frozenRowCount"
                }
            },
            # Poner fila 1 en negrita con fondo suave
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                        "startColumnIndex": 0,
                        "endColumnIndex": len(headers)
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "textFormat": {
                                "bold": True
                            },
                            "backgroundColor": {
                                "red": 0.93,
                                "green": 0.95,
                                "blue": 0.98
                            }
                        }
                    },
                    "fields": "userEnteredFormat(textFormat,backgroundColor)"
                }
            }
        ]

        try:
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self.spreadsheet_id,
                body={"requests": format_requests}
            ).execute()
        except Exception as e:
            # Si falla el formato cosmético, no interrumpir la sincronización de datos
            print(f"[Aviso] No se pudo aplicar el formato estético: {e}")

        return {
            "updated_range": update_result.get("updatedRange"),
            "updated_rows": update_result.get("updatedRows", 0),
            "updated_columns": update_result.get("updatedColumns", 0),
            "updated_cells": update_result.get("updatedCells", 0),
            "total_data_rows": len(data_rows)
        }

    def read_ute_cordillera_rows(self, range_name: str = None, source_sheet: str = None) -> List[List[str]]:
        """
        Lee los datos de la pestaña de origen (UTE Cordillera) hasta la columna Z inclusive.
        """
        sheet = source_sheet or CONF_SOURCE_SHEET_NAME
        if range_name is None:
            range_name = f"'{sheet}'!A1:Z"
        result = self._service.spreadsheets().values().get(
            spreadsheetId=self.spreadsheet_id,
            range=range_name,
            valueRenderOption="FORMATTED_VALUE"
        ).execute()
        return result.get("values", [])

    def write_conf_de_viaje(
        self,
        data_rows: List[List[str]],
        start_row: int = CONF_START_ROW,
        target_sheet: str = None
    ) -> Dict[str, Any]:
        """
        Escribe los registros filtrados en CONF. DE VIAJE a partir de la fila especificada (fila 5).
        - Limpia previamente el rango desde start_row en las columnas A a J (A5:J) para preservar
          filas superiores de títulos (1 a 4) y columnas adicionales como K y L (Auditorías).
        - Escribe los datos en A5:J...
        """
        dest_sheet = target_sheet or CONF_TARGET_SHEET_NAME
        self.ensure_target_sheet_exists(dest_sheet)

        # 1. Limpiar rango anterior de datos en columnas A a J desde fila start_row
        clear_range = f"'{dest_sheet}'!A{start_row}:J"
        self._service.spreadsheets().values().clear(
            spreadsheetId=self.spreadsheet_id,
            range=clear_range
        ).execute()

        if not data_rows:
            return {
                "updated_range": clear_range,
                "updated_rows": 0,
                "updated_columns": 0,
                "updated_cells": 0,
                "total_data_rows": 0
            }

        # 2. Escribir datos a partir de la fila start_row
        write_range = f"'{dest_sheet}'!A{start_row}"
        body = {
            "values": data_rows
        }
        update_result = self._service.spreadsheets().values().update(
            spreadsheetId=self.spreadsheet_id,
            range=write_range,
            valueInputOption="USER_ENTERED",
            body=body
        ).execute()

        return {
            "updated_range": update_result.get("updatedRange"),
            "updated_rows": update_result.get("updatedRows", 0),
            "updated_columns": update_result.get("updatedColumns", 0),
            "updated_cells": update_result.get("updatedCells", 0),
            "total_data_rows": len(data_rows)
        }

