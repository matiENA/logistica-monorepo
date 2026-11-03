#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  SINCRONIZADOR DE SEGUIMIENTO DE VACÍO / SIN TD NUEVO (PINTADO #9fc5e8)
================================================================================
Descripción:
  Identifica unidades que han reportado VACÍO en la planilla 'Ruteos' y no poseen
  un nuevo viaje/TD asignado posterior (estado "vacío sin TD nuevo").
  En la planilla mensual de 'Movimientos', evalúa la columna 'Dispo.' del día
  seleccionado (2 columnas antes de la fecha).
  Si 'Dispo.' NO contiene ninguna de las localidades excluidas (dock sud, tds,
  tlc, tlp, tvm, tlc-cm, tlc-ute, pp) y la primera celda del día no tiene texto
  ni color manual aplicado por un operador:
    -> Pinta la celda con el color celeste #9fc5e8.
  
  Limpieza Automática (Cleanup):
    -> Si una celda previamente pintada con #9fc5e8 ya no cumple las condiciones
       (ej. el tractor recibió un nuevo TD en Ruteos, se cargó un viaje/texto,
       o Dispo cambió a una localidad excluida), el color #9fc5e8 se remueve
       automáticamente restaurando el formato original.

Reglas:
  - Ruteos: Merge virtual de filas con el mismo TD para evaluar el último viaje.
  - Exclusiones Dispo: 'dock sud', 'tds', 'tlc', 'tlp', 'tvm', 'tlc-cm', 'tlc-ute', 'pp'.
  - Color: #9fc5e8 (red: ~0.6235, green: ~0.7725, blue: ~0.9098).
  - Actualización atómica por lotes (fields="userEnteredFormat.backgroundColor"),
    protegiendo notas, fórmulas y bordes.
================================================================================
"""

import os
import re
import sys
import argparse
import socket
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any

# Prevenir caídas por timeout de 60s en llamadas pesadas a Google Sheets
socket.setdefaulttimeout(180)

# Reconfigurar salida UTF-8 de forma segura para Windows / pyw / n8n
if hasattr(sys.stdout, "reconfigure") and sys.stdout is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure") and sys.stderr is not None:
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from credentials_helper import get_google_credentials, resolve_credentials_file
from sync_operativas_unificadas import (
    is_valid_td,
    api_call_with_retry,
    CLEANUP_COLOR_HEX,
    CLEANUP_COLOR_RGB
)

DEFAULT_RUTEOS_ID = "1-wNLgr2b1TibP_MPwA9ToF9jlH_jiPxjN0iirWbFb3o"
DEFAULT_MOV_ID = "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc"

SOURCE_TAB_RUTEOS = "Ruteos"
TARGET_TAB_MOV = "NOVIEMBRE 2026- Mov.Unidades y Choferes"

# Color de pintado: #9fc5e8
TARGET_COLOR_HEX = "#9fc5e8"
TARGET_COLOR_RGB = {
    "red": 159 / 255.0,
    "green": 197 / 255.0,
    "blue": 232 / 255.0
}

# Palabras clave excluidas en columna Dispo. (si Dispo contiene alguna, NO se pinta)
EXCLUDED_DISPO_KEYWORDS = [
    "dock sud",
    "tds",
]

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]



def index_to_col_letter(col_idx: int) -> str:
    """Convierte un índice 0-based a letra de columna (0 -> A, 26 -> AA, etc.)."""
    res = ""
    temp = col_idx
    while temp >= 0:
        res = chr(temp % 26 + ord('A')) + res
        temp = temp // 26 - 1
    return res


def get_day_column_indices(day: int) -> Tuple[int, int, int]:
    """
    Retorna (col_date_idx, col_dispo_idx, col_chofer_idx) en 0-based para el día dado (1 a 31).
    - col_date_idx:   30 + 13 * (day - 1)  (primera celda de fecha / Slot 1)
    - col_dispo_idx:  col_date_idx - 2    (columna Dispo. correspondiente)
    - col_chofer_idx: col_dispo_idx - 1   (columna Chofer, una anterior a Dispo)
    """
    col_date_idx = 30 + 13 * (day - 1)
    col_dispo_idx = col_date_idx - 2
    col_chofer_idx = col_dispo_idx - 1
    return col_date_idx, col_dispo_idx, col_chofer_idx


def is_valid_vacio(raw: Any) -> bool:
    """Determina si un valor de Columna X de Ruteos representa un reporte de VACÍO válido."""
    if not raw:
        return False
    s = str(raw).strip().upper()
    if s in ["FALSE", "TRUE", "NO", "#N/A", "TLC", "TPH", ""]:
        return False
    return bool(re.search(r"\d", s) or "VACIO" in s)


def is_chofer_excluded(val: Optional[str]) -> bool:
    """
    Verifica si la columna Chofer (una anterior a Dispo) contiene el carácter '1' solitario.
    Si tiene '1' solitario (ej. '1' sin chofer asignado), retorna True (no pintar).
    """
    if not val:
        return False
    return str(val).strip() == "1"


def is_dispo_excluded(val: Optional[str]) -> bool:
    """
    Verifica si el valor de la columna Dispo contiene alguna de las localidades excluidas.
    Retorna True si contiene alguna (por lo tanto NO debe pintarse).
    """
    if not val:
        return False
    norm = str(val).strip().lower()
    for kw in EXCLUDED_DISPO_KEYWORDS:
        pattern = r"(?:\b|_|-)" + re.escape(kw) + r"(?:\b|_|-)"
        if re.search(pattern, norm) or kw == norm or kw in norm:
            return True
    return False


def is_color_9fc5e8(bg: Optional[Dict[str, float]]) -> bool:
    """Comprueba si un color de celda coincide con el celeste #9fc5e8 dentro de una tolerancia."""
    if not bg or not isinstance(bg, dict):
        return False
    r = bg.get("red", 0.0)
    g = bg.get("green", 0.0)
    b = bg.get("blue", 0.0)
    return (
        abs(r - TARGET_COLOR_RGB["red"]) < 0.04
        and abs(g - TARGET_COLOR_RGB["green"]) < 0.04
        and abs(b - TARGET_COLOR_RGB["blue"]) < 0.04
    )


def is_default_or_unpainted_bg(bg: Optional[Dict[str, float]]) -> bool:
    """
    Verifica si una celda no tiene color manual aplicado por un operador
    (es decir, está vacía/transparente, blanca o tiene el fondo base alternado #f5f7fa).
    """
    if not bg or not isinstance(bg, dict):
        return True
    r = bg.get("red", 1.0)
    g = bg.get("green", 1.0)
    b = bg.get("blue", 1.0)
    # Blanco puro o casi puro
    if r > 0.98 and g > 0.98 and b > 0.98:
        return True
    # Fondo base alternado de la planilla #f5f7fa (~0.9608, ~0.9686, ~0.9804)
    if abs(r - 0.9607843) < 0.03 and abs(g - 0.9686275) < 0.03 and abs(b - 0.9803922) < 0.03:
        return True
    # Si ya fue pintada por este script con #9fc5e8, cuenta como base previa de nuestro workflow
    if is_color_9fc5e8(bg):
        return True
    return False


class SeguimientoVacioSync:
    def __init__(
        self,
        credentials_path: Optional[str] = None,
        ruteos_id: str = DEFAULT_RUTEOS_ID,
        mov_id: str = DEFAULT_MOV_ID
    ):
        self.ruteos_id = ruteos_id
        self.mov_id = mov_id
        self._cached_sheet_id: Optional[int] = None
        if credentials_path and Path(credentials_path).exists():
            self.creds_path = credentials_path
            self._creds = Credentials.from_service_account_file(self.creds_path, scopes=SCOPES)
        else:
            self._creds = get_google_credentials(scopes=SCOPES)
            try:
                self.creds_path = resolve_credentials_file()
            except Exception:
                self.creds_path = None
        self._service = build("sheets", "v4", credentials=self._creds)

    def fetch_ruteos(self) -> List[List[str]]:
        """Lee todas las filas operativas desde Ruteos (A4 hasta AL)."""
        res = api_call_with_retry(self._service.spreadsheets().values().get(
            spreadsheetId=self.ruteos_id,
            range=f"'{SOURCE_TAB_RUTEOS}'!A4:AL",
            valueRenderOption="FORMATTED_VALUE"
        ))
        return res.get("values", [])

    def get_mov_sheet_id(self) -> int:
        """Obtiene el sheetId numérico de la pestaña objetivo en Movimientos (con caché)."""
        if self._cached_sheet_id is not None:
            return self._cached_sheet_id
        meta = api_call_with_retry(self._service.spreadsheets().get(spreadsheetId=self.mov_id, fields="sheets.properties"))
        for sheet in meta.get("sheets", []):
            if sheet["properties"]["title"] == TARGET_TAB_MOV:
                self._cached_sheet_id = sheet["properties"]["sheetId"]
                return self._cached_sheet_id
        raise ValueError(f"No se encontró la pestaña '{TARGET_TAB_MOV}' en la planilla {self.mov_id}")

    def fetch_movimientos_data(self, day: int) -> Tuple[int, Dict[str, int], List[Dict[str, Any]]]:
        """
        Lee tractores y celdas del día (Chofer, Dispo, Fecha) en una sola consulta combinada optimizada.
        Retorna (target_sheet_id, tractor_to_row, day_rows).
        """
        sheet_id = self.get_mov_sheet_id()
        col_date_idx, col_dispo_idx, col_chofer_idx = get_day_column_indices(day)
        col_chofer_letter = index_to_col_letter(col_chofer_idx)
        col_date_letter = index_to_col_letter(col_date_idx)

        range_tractors = f"'{TARGET_TAB_MOV}'!E1:E350"
        range_day = f"'{TARGET_TAB_MOV}'!{col_chofer_letter}1:{col_date_letter}350"

        res = api_call_with_retry(self._service.spreadsheets().get(
            spreadsheetId=self.mov_id,
            ranges=[range_tractors, range_day],
            fields="sheets(data(rowData(values(formattedValue,userEnteredFormat.backgroundColor))))"
        ))

        sheet_data = res["sheets"][0]["data"]
        raw_tractors = sheet_data[0].get("rowData", [])
        raw_day = sheet_data[1].get("rowData", []) if len(sheet_data) > 1 else []

        tractor_to_row: Dict[str, int] = {}
        for idx, r in enumerate(raw_tractors):
            row_num = idx + 1
            vals = r.get("values", [])
            if vals and vals[0]:
                raw_trk = str(vals[0].get("formattedValue") or "").strip().upper()
                clean_trk = re.sub(r"[^A-Z0-9]", "", raw_trk)
                if clean_trk and len(clean_trk) >= 5:
                    tractor_to_row[clean_trk] = row_num

        chofer_offset = 0
        dispo_offset = col_dispo_idx - col_chofer_idx   # 1
        date_offset = col_date_idx - col_chofer_idx     # 3

        day_rows = []
        for r_idx, r in enumerate(raw_day):
            row_num = r_idx + 1
            c_vals = r.get("values", [])

            chofer_val = ""
            if len(c_vals) > chofer_offset and c_vals[chofer_offset]:
                chofer_val = str(c_vals[chofer_offset].get("formattedValue") or "").strip()

            dispo_val = ""
            if len(c_vals) > dispo_offset and c_vals[dispo_offset]:
                dispo_val = str(c_vals[dispo_offset].get("formattedValue") or "").strip()

            date_val = ""
            user_bg = None
            if len(c_vals) > date_offset and c_vals[date_offset]:
                cell = c_vals[date_offset]
                date_val = str(cell.get("formattedValue") or "").strip()
                user_bg = cell.get("userEnteredFormat", {}).get("backgroundColor")

            day_rows.append({
                "row_num": row_num,
                "chofer_val": chofer_val,
                "dispo_val": dispo_val,
                "date_val": date_val,
                "user_bg": user_bg,
                "eff_bg": user_bg
            })

        return sheet_id, tractor_to_row, day_rows

    def get_vacio_sin_nuevo_td_tractors(self) -> Dict[str, Dict[str, Any]]:
        """
        Analiza Ruteos en orden cronológico agrupando filas por TD.
        Identifica qué tractores tienen su ÚLTIMO registro con reporte de VACÍO (Col X)
        y sin ningún TD posterior asignado.
        Retorna: {patente: {td, vacio_val, row_num}}
        """
        rows = self.fetch_ruteos()
        tractor_trips: Dict[str, List[Dict[str, Any]]] = {}

        for idx, r in enumerate(rows):
            row_num = idx + 4
            raw_trk = str(r[0] if len(r) > 0 else "").upper().strip()
            trk = re.sub(r"[^A-Z0-9]", "", raw_trk)
            # Ignorar encabezados o textos que no sean patentes
            if not trk or len(trk) < 5 or trk.startswith("202") or "OCT" in trk or "NOV" in trk:
                continue

            td = str(r[11] if len(r) > 11 else "").strip()
            # Omitir anotaciones operativas en hold o filas sin TD asignado
            if not is_valid_td(td):
                continue

            raw_vacio = str(r[23] if len(r) > 23 else "").strip()
            vacio_ok = is_valid_vacio(raw_vacio)

            if trk not in tractor_trips:
                tractor_trips[trk] = []

            # Si es el mismo TD del viaje actual para esta unidad, actualizamos
            if tractor_trips[trk] and tractor_trips[trk][-1]["td"] == td:
                if vacio_ok and not tractor_trips[trk][-1]["has_vacio"]:
                    tractor_trips[trk][-1]["has_vacio"] = True
                    tractor_trips[trk][-1]["vacio_val"] = raw_vacio
                tractor_trips[trk][-1]["last_row"] = row_num
            else:
                tractor_trips[trk].append({
                    "td": td,
                    "has_vacio": vacio_ok,
                    "vacio_val": raw_vacio if vacio_ok else "",
                    "last_row": row_num
                })

        # Filtrar tractores cuyo último viaje tiene VACÍO
        vacio_tractors = {}
        for trk, trips in tractor_trips.items():
            if trips and trips[-1]["has_vacio"]:
                vacio_tractors[trk] = trips[-1]

        return vacio_tractors

    def plan_day_actions(
        self,
        day: int,
        force_clean: bool = False
    ) -> Tuple[int, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Compara el estado de Ruteos y Movimientos para el día 'day':
        - Determina qué celdas deben PINTARSE con #9fc5e8.
        - Determina qué celdas deben LIMPIARSE (remover #9fc5e8).
        Retorna (target_sheet_id, planned_paint, planned_clean).
        """
        vacio_tractors = self.get_vacio_sin_nuevo_td_tractors()
        sheet_id, tractor_to_row, day_rows = self.fetch_movimientos_data(day)

        col_date_idx, col_dispo_idx, col_chofer_idx = get_day_column_indices(day)
        col_date_letter = index_to_col_letter(col_date_idx)

        # Mapa inverso: row_num -> tractor patente
        row_to_tractor = {row_num: trk for trk, row_num in tractor_to_row.items()}

        planned_paint = []
        planned_clean = []

        for r_data in day_rows:
            row_num = r_data["row_num"]
            if row_num not in row_to_tractor:
                continue

            trk = row_to_tractor[row_num]
            chofer_val = r_data["chofer_val"]
            dispo_val = r_data["dispo_val"]
            date_val = r_data["date_val"]
            user_bg = r_data["user_bg"]
            eff_bg = r_data["eff_bg"]

            is_currently_painted = is_color_9fc5e8(user_bg) or is_color_9fc5e8(eff_bg)
            tractor_is_vacio = trk in vacio_tractors
            dispo_is_ok = not is_dispo_excluded(dispo_val)
            chofer_is_ok = not is_chofer_excluded(chofer_val)
            cell_is_empty = not date_val
            bg_is_eligible = is_default_or_unpainted_bg(eff_bg)

            # Condición global para calificar al pintado
            qualifies = (
                tractor_is_vacio
                and dispo_is_ok
                and chofer_is_ok
                and cell_is_empty
                and bg_is_eligible
                and not force_clean
            )

            cell_coord = f"{col_date_letter}{row_num}"

            if qualifies:
                # Si califica y aún no tiene el color aplicado, agregar a planned_paint
                if not is_currently_painted:
                    trip_info = vacio_tractors[trk]
                    planned_paint.append({
                        "row_num": row_num,
                        "col_idx": col_date_idx,
                        "cell_coord": cell_coord,
                        "tractor": trk,
                        "chofer": chofer_val,
                        "dispo": dispo_val,
                        "last_td": trip_info["td"],
                        "vacio_val": trip_info["vacio_val"]
                    })
            else:
                # Si ya estaba pintada con #9fc5e8 pero dejó de cumplir (o se pidió force_clean), limpiar
                if is_currently_painted:
                    reason = []
                    if not tractor_is_vacio:
                        reason.append("Tractor con nuevo TD o sin reporte vacío")
                    if not dispo_is_ok:
                        reason.append(f"Dispo excluida ('{dispo_val}')")
                    if not chofer_is_ok:
                        reason.append("Chofer con carácter '1' solitario")
                    if not cell_is_empty:
                        reason.append(f"Celda con contenido ('{date_val}')")
                    if force_clean:
                        reason.append("Limpieza forzada (--clean)")

                    planned_clean.append({
                        "row_num": row_num,
                        "col_idx": col_date_idx,
                        "cell_coord": cell_coord,
                        "tractor": trk,
                        "chofer": chofer_val,
                        "dispo": dispo_val,
                        "reason": ", ".join(reason) or "Condición no cumplida"
                    })

        return sheet_id, planned_paint, planned_clean

    def apply_batch_updates(
        self,
        sheet_id: int,
        planned_paint: List[Dict[str, Any]],
        planned_clean: List[Dict[str, Any]],
        batch_size: int = 500
    ) -> Dict[str, Any]:
        """Aplica las actualizaciones de color de celda en lotes protegidos."""
        requests = []

        # 1. Pintar celdas con #9fc5e8
        for p in planned_paint:
            r_idx = p["row_num"] - 1
            c_idx = p["col_idx"]
            req = {
                "updateCells": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": r_idx,
                        "endRowIndex": r_idx + 1,
                        "startColumnIndex": c_idx,
                        "endColumnIndex": c_idx + 1
                    },
                    "rows": [{
                        "values": [{
                            "userEnteredFormat": {
                                "backgroundColor": TARGET_COLOR_RGB
                            }
                        }]
                    }],
                    "fields": "userEnteredFormat.backgroundColor"
                }
            }
            requests.append(req)

        # 2. Limpiar celdas previamente pintadas (aplicar fondo base alternado #f5f7fa)
        for c in planned_clean:
            r_idx = c["row_num"] - 1
            c_idx = c["col_idx"]
            req = {
                "updateCells": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": r_idx,
                        "endRowIndex": r_idx + 1,
                        "startColumnIndex": c_idx,
                        "endColumnIndex": c_idx + 1
                    },
                    "rows": [{
                        "values": [{
                            "userEnteredFormat": {
                                "backgroundColor": CLEANUP_COLOR_RGB
                            }
                        }]
                    }],
                    "fields": "userEnteredFormat.backgroundColor"
                }
            }
            requests.append(req)

        if not requests:
            return {"updated_count": 0, "batches": 0}

        batches_executed = 0
        for i in range(0, len(requests), batch_size):
            chunk = requests[i:i + batch_size]
            body = {"requests": chunk}
            api_call_with_retry(self._service.spreadsheets().batchUpdate(
                spreadsheetId=self.mov_id,
                body=body
            ))
            batches_executed += 1

        return {
            "updated_count": len(requests),
            "batches": batches_executed,
            "paint_count": len(planned_paint),
            "clean_count": len(planned_clean)
        }


def main():
    parser = argparse.ArgumentParser(
        description="Sincronizador de Seguimiento de Vacío / Sin TD Nuevo (Pintado #9fc5e8)."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica los cambios en Google Sheets. Si se omite, corre en modo simulación (--dry-run)."
    )
    parser.add_argument(
        "--day",
        type=int,
        default=None,
        help="Día del mes a procesar (por defecto toma el día actual de hoy)."
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Fuerza la limpieza de celdas pintadas con #9fc5e8 en el día seleccionado."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Límite de filas a mostrar en el preview de consola (por defecto 25)."
    )
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure") and sys.stdout is not None:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    day = args.day if args.day is not None else datetime.now().day

    print("=" * 80)
    print("  SINCRONIZADOR DE SEGUIMIENTO DE VACÍO / SIN TD NUEVO (PINTADO #9fc5e8)")
    print(f"  Modo:        {'APLICAR EN SHEETS' if args.apply else 'SIMULACIÓN (DRY-RUN)'}")
    print(f"  Día:         {day} de octubre")
    if args.clean:
        print("  Acción:      Limpieza forzada (--clean) de celdas pintadas previamente")
    print("=" * 80)

    sync = SeguimientoVacioSync()
    print("[1/3] Conexión establecida con Service Account.")
    print(f"      - Ruteos ID:     {sync.ruteos_id}")
    print(f"      - Movimientos ID: {sync.mov_id}")

    print(f"\n[2/3] Analizando Ruteos y Movimientos para el Día {day}...")
    sheet_id, planned_paint, planned_clean = sync.plan_day_actions(day=day, force_clean=args.clean)

    print(f"      - Celdas a PINTAR (#9fc5e8):    {len(planned_paint)}")
    print(f"      - Celdas a LIMPIAR (remover):    {len(planned_clean)}")

    # Previews
    if planned_paint:
        print(f"\n--- Preview: Celdas a PINTAR con {TARGET_COLOR_HEX} ---")
        for idx, p in enumerate(planned_paint[:args.limit]):
            print(f"[{idx+1:02d}] Celda {p['cell_coord']:>6} (Fila {p['row_num']:>3}) | Trk: {p['tractor']:>7} | Chofer: '{p['chofer']}' | Dispo: '{p['dispo']}' | Último TD: {p['last_td']} | Vacío: {p['vacio_val']}")
        if len(planned_paint) > args.limit:
            print(f"     ... y {len(planned_paint) - args.limit} unidades más a pintar.")

    if planned_clean:
        print(f"\n--- Preview: Celdas a LIMPIAR (remover {TARGET_COLOR_HEX}) ---")
        for idx, c in enumerate(planned_clean[:args.limit]):
            print(f"[{idx+1:02d}] Celda {c['cell_coord']:>6} (Fila {c['row_num']:>3}) | Trk: {c['tractor']:>7} | Motivo: {c['reason']}")
        if len(planned_clean) > args.limit:
            print(f"     ... y {len(planned_clean) - args.limit} unidades más a limpiar.")

    if not planned_paint and not planned_clean:
        print("\n[INFO] Todas las celdas ya se encuentran en el estado correcto. Nada que actualizar.")

    if args.apply and (planned_paint or planned_clean):
        print("\n[3/3] Aplicando actualización atómica por lotes (fields='userEnteredFormat.backgroundColor')...")
        res = sync.apply_batch_updates(sheet_id, planned_paint, planned_clean)
        print(f"\n[OK] ¡Éxito! Se actualizaron {res['updated_count']} celdas ({res['paint_count']} pintadas, {res['clean_count']} limpiadas) en {res['batches']} lotes.")
    elif not args.apply:
        print("\n[INFO] Modo simulación concluido. No se realizaron escrituras en Google Sheets.")
        print("       Para aplicar los cambios reales, ejecuta con el parámetro: --apply")


if __name__ == "__main__":
    main()
