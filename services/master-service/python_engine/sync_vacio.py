#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  SINCRONIZADOR DE VACÍO (COL X) EN HOVER: RUTEOS ➡️ MOVIMIENTOS
================================================================================
Descripción:
  Lee el dato de VACÍO (Columna X / índice 23) desde la pestaña 'Ruteos' y lo inyecta
  al INICIO de las notas en hover de la hoja 'NOVIEMBRE 2026- Mov.Unidades y Choferes',
  separado de la información de tracking de la Columna H.

Reglas:
  - Formato raw: '4/10/2026 8:10:00'
  - Formato requerido: 'VACIO 4/10 8:10 hs'
  - Condición de impresión: solo si el dato existe en Columna X.
  - Ubicación: al inicio de la nota, conservando cualquier tracking existente de Col H.
  - Actualización atómica con Google Sheets API v4 (fields="note"), protegiendo fórmulas y formatos.
================================================================================
"""

import os
import re
import sys
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any

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
from sync_operativas_unificadas import is_valid_td

DEFAULT_RUTEOS_ID = "1-wNLgr2b1TibP_MPwA9ToF9jlH_jiPxjN0iirWbFb3o"
DEFAULT_MOV_ID = "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc"

SOURCE_TAB_RUTEOS = "Ruteos"
TARGET_TAB_MOV = "NOVIEMBRE 2026- Mov.Unidades y Choferes"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]



def index_to_col_letter(col_idx: int) -> str:
    """Convierte un índice de columna 0-based en letras estilo Excel (0 -> A, 30 -> AE)."""
    result = ""
    col_num = col_idx + 1
    while col_num > 0:
        col_num, remainder = divmod(col_num - 1, 26)
        result = chr(65 + remainder) + result
    return result


def get_day_columns(day: int) -> Tuple[Tuple[int, str], Tuple[int, str]]:
    """Calcula las columnas 1 (Slot 1) y 2 (Slot 2) para el día de octubre dado (1 a 31)."""
    col1_idx = 30 + 13 * (day - 1)
    col2_idx = 32 + 13 * (day - 1)
    return (col1_idx, index_to_col_letter(col1_idx)), (col2_idx, index_to_col_letter(col2_idx))


def parse_day_from_cell(fecha_val: str) -> Optional[int]:
    """Interpreta el día del mes a partir de números de serie Excel o fechas formato d/m/y."""
    if not fecha_val:
        return None
    s = str(fecha_val).strip()
    if s.isdigit():
        serial = int(s)
        dt = datetime(1899, 12, 30) + timedelta(days=serial)
        if 1 <= dt.month <= 12 and 1 <= dt.day <= 31:
            return dt.day
    if "/" in s:
        parts = s.split("/")
        if len(parts) >= 2 and parts[0].isdigit():
            return int(parts[0])
    return None


def format_vacio_datetime(raw: str) -> str:
    """
    Parsea y formatea la fecha y hora de VACÍO (Columna X).
    Ejemplos válidos:
      '4/10/2026 8:10:00'   -> 'VACIO 4/10 8:10 hs'
      '01/10/2026 12:15'    -> 'VACIO 1/10 12:15 hs'
      '3/10/202617:54'      -> 'VACIO 3/10 17:54 hs'
      '4*/10/2026 10:10'    -> 'VACIO 4/10 10:10 hs'
      '01-10-202612:20'     -> 'VACIO 1/10 12:20 hs'
      '5/10/26 23 HS'       -> 'VACIO 5/10 23:00 hs'
      '7/10 23:40'          -> 'VACIO 7/10 23:40 hs'
      '08/10/2026'          -> 'VACIO 8/10 hs'
      '09/10/2026 0:00'     -> 'VACIO 9/10 hs'
      'VACIO'               -> 'VACIO'
    Casos descartados (falsos vacíos):
      'FALSE', 'TRUE', '#N/A', 'TLC', 'TPH', 'NO', ''
    """
    if not raw:
        return ""
    s = str(raw).strip().replace("*", "")
    if s.upper() in ["TRUE", "FALSE", "#N/A", "TLC", "TPH", "NO", ""]:
        return ""

    if s.strip().upper() == "VACIO":
        return "VACIO"

    # Serial numérico Excel (ej. 46295 = 2026-10-01)
    if s.isdigit():
        try:
            serial = int(s)
            dt = datetime(1899, 12, 30) + timedelta(days=serial)
            if 1 <= dt.month <= 12 and 1 <= dt.day <= 31:
                return f"VACIO {dt.day}/{dt.month} hs"
        except Exception:
            pass

    # 1. Patrón con hora y minutos separados por ':' (ej: 04/10/2026 8:10:00 o 08/10/2026 0:00)
    m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](?:20326|32026|20\d{2}|\d{4}|\d{2})\s*(\d{1,2}):(\d{2})(?::\d{2})?", s)
    if m:
        d = int(m.group(1))
        mo = int(m.group(2))
        h = int(m.group(3))
        mi = int(m.group(4))
        if 1 <= mo <= 12 and 1 <= d <= 31 and h < 24 and mi < 60:
            if h == 0 and mi == 0:
                return f"VACIO {d}/{mo} hs"
            return f"VACIO {d}/{mo} {h}:{mi:02d} hs"

    # 2. Patrón con 'HS' explícito (ej. '5/10/26 23 HS')
    m2 = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](?:20326|32026|20\d{2}|\d{4}|\d{2})\s*(\d{1,2})\s*HS\b", s, re.IGNORECASE)
    if m2:
        d = int(m2.group(1))
        mo = int(m2.group(2))
        h = int(m2.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31 and 1 <= h < 24:
            return f"VACIO {d}/{mo} {h}:00 hs"

    # 3. Patrón fecha corta sin año con hora (ej. '7/10 23:40')
    m3 = re.search(r"(\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})", s)
    if m3:
        d = int(m3.group(1))
        mo = int(m3.group(2))
        h = int(m3.group(3))
        mi = int(m3.group(4))
        if 1 <= mo <= 12 and 1 <= d <= 31 and h < 24 and mi < 60:
            if h == 0 and mi == 0:
                return f"VACIO {d}/{mo} hs"
            return f"VACIO {d}/{mo} {h}:{mi:02d} hs"

    # 4. Patrón fecha completa sin hora (ej. '08/10/2026', '09/10/2026', '8/10/26')
    m4 = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](?:20326|32026|20\d{2}|\d{4}|\d{2})", s)
    if m4:
        d = int(m4.group(1))
        mo = int(m4.group(2))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"VACIO {d}/{mo} hs"

    # 5. Patrón fecha corta sin año (ej. '8/10')
    m5 = re.search(r"^(\d{1,2})[/-](\d{1,2})$", s)
    if m5:
        d = int(m5.group(1))
        mo = int(m5.group(2))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"VACIO {d}/{mo} hs"

    return ""


def combine_vacio_with_existing_note(vacio_text: str, existing_note: str) -> str:
    """
    Ubica el texto de VACÍO al inicio de la nota.
    Si ya existía una nota previa:
      - Si la primera línea era un 'VACIO ...' anterior, se reemplaza.
      - Se conserva intacto el resto de la nota (ej. tracking de Col H).
    Si no había nota previa, queda solo 'VACIO ...'.
    """
    if not vacio_text:
        return existing_note

    clean_existing = (existing_note or "").strip()
    if not clean_existing:
        return vacio_text

    lines = clean_existing.split("\n")
    # Si la primera línea ya es un VACIO anterior, descartarla
    if lines and lines[0].strip().upper().startswith("VACIO"):
        lines = lines[1:]

    rest = "\n".join(l for l in lines if l.strip()).strip()
    if rest:
        return f"{vacio_text}\n{rest}"
    return vacio_text


class VacioSync:
    def __init__(
        self,
        credentials_path: Optional[str] = None,
        ruteos_id: str = DEFAULT_RUTEOS_ID,
        mov_id: str = DEFAULT_MOV_ID
    ):
        self.ruteos_id = ruteos_id
        self.mov_id = mov_id
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
        res = self._service.spreadsheets().values().get(
            spreadsheetId=self.ruteos_id,
            range=f"'{SOURCE_TAB_RUTEOS}'!A4:AL",
            valueRenderOption="FORMATTED_VALUE"
        ).execute()
        return res.get("values", [])

    def fetch_movimientos_grid(self) -> Tuple[int, List[List[Dict[str, str]]]]:
        """
        Lee la matriz completa de Movimientos incluyendo 'formattedValue' y 'note'.
        Retorna (target_sheet_id, grid_data).
        """
        meta = self._service.spreadsheets().get(spreadsheetId=self.mov_id, fields="sheets.properties").execute()
        target_sheet_id = None
        for sheet in meta.get("sheets", []):
            if sheet["properties"]["title"] == TARGET_TAB_MOV:
                target_sheet_id = sheet["properties"]["sheetId"]
                break
        if target_sheet_id is None:
            raise ValueError(f"No se encontró la pestaña '{TARGET_TAB_MOV}' en la planilla {self.mov_id}")

        res = self._service.spreadsheets().get(
            spreadsheetId=self.mov_id,
            ranges=[f"'{TARGET_TAB_MOV}'!A1:ZZ350"],
            fields="sheets(data(rowData(values(formattedValue,note))))"
        ).execute()

        grid_rows = []
        if res.get("sheets") and res["sheets"][0].get("data"):
            raw_rows = res["sheets"][0]["data"][0].get("rowData", [])
            for r in raw_rows:
                cells = []
                for c in r.get("values", []):
                    cells.append({
                        "value": str(c.get("formattedValue") or "").strip(),
                        "note": str(c.get("note") or "").strip()
                    })
                grid_rows.append(cells)

        return target_sheet_id, grid_rows

    def process_assignments(
        self,
        filter_day: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Procesa Ruteos y empareja datos de Columna X (VACÍO) con Movimientos:
        - Asigna por Tractor y UT.
        - Mapea a Ranura 1 (Turno 1) y Ranura 2 (Turno 2).
        - Solo procesa si existe dato en Columna X.
        - Ubica 'VACIO ...' al inicio de la nota, conservando cualquier nota previa.
        """
        ruteos_rows = self.fetch_ruteos()
        _, mov_rows = self.fetch_movimientos_grid()

        # 1. Indexar unidades en Movimientos
        tractor_to_row = {}
        ut_to_row = {}

        for idx in range(2, len(mov_rows)):
            row_num = idx + 1  # 1-based
            r = mov_rows[idx]
            ut = r[2]["value"].replace(".0", "") if len(r) > 2 else ""
            trk = re.sub(r"[^A-Z0-9]", "", r[4]["value"].upper()) if len(r) > 4 else ""
            if trk:
                tractor_to_row[trk] = row_num
            if ut:
                ut_to_row[ut] = row_num

        # 2. Agrupar Ruteos por (Unidad, Día) -> { td: { vacio, localidades } }
        trips_by_unit_day: Dict[Tuple[str, int], Dict[str, Dict[str, Any]]] = {}

        for r in ruteos_rows:
            raw_trk = str(r[0] if len(r) > 0 else "").upper()
            trk = re.sub(r"[^A-Z0-9]", "", raw_trk)
            ut = str(r[1] if len(r) > 1 else "").strip().replace(".0", "")
            td = str(r[11] if len(r) > 11 else "").strip()
            raw_vacio = str(r[23] if len(r) > 23 else "").strip()
            fecha_val = str(r[36] if len(r) > 36 else "").strip()
            localidad = str(r[37] if len(r) > 37 else "").strip()

            # Fila canónica de Ruteos: debe tener tractor o UT y TD válido (Col L / índice 11)
            # Esto descarta tablas secundarias/resúmenes pegados (ej. filas 3360-3372)
            if not (trk or ut) or not is_valid_td(td):
                continue
            if not (localidad or raw_vacio):
                continue

            dia = parse_day_from_cell(fecha_val)
            if not dia or dia < 1 or dia > 31:
                continue
            if filter_day is not None and dia != filter_day:
                continue

            unit_key = trk if trk in tractor_to_row else ut
            if not unit_key:
                continue

            row_target = tractor_to_row.get(trk) or ut_to_row.get(ut)
            if not row_target:
                continue

            key = (unit_key, dia)
            if key not in trips_by_unit_day:
                trips_by_unit_day[key] = {
                    "row": row_target,
                    "dia": dia,
                    "tractor": trk,
                    "ut": ut,
                    "tds": {}
                }

            td_key = td if td else "SIN_TD"
            if td_key not in trips_by_unit_day[key]["tds"]:
                trips_by_unit_day[key]["tds"][td_key] = {
                    "vacio": "",
                    "localidades": []
                }

            if localidad and localidad not in trips_by_unit_day[key]["tds"][td_key]["localidades"]:
                trips_by_unit_day[key]["tds"][td_key]["localidades"].append(localidad)

            if raw_vacio and not trips_by_unit_day[key]["tds"][td_key]["vacio"]:
                formatted_vacio = format_vacio_datetime(raw_vacio)
                if formatted_vacio:
                    trips_by_unit_day[key]["tds"][td_key]["vacio"] = formatted_vacio

        # 3. Mapear cada viaje a Columna 1 o Columna 2
        planned_updates = []

        for (unit_key, dia), data in trips_by_unit_day.items():
            row_num = data["row"]
            row_idx_0based = row_num - 1
            (col1_idx, col1_letter), (col2_idx, col2_letter) = get_day_columns(dia)

            current_row_cells = mov_rows[row_idx_0based] if row_idx_0based < len(mov_rows) else []

            cell1 = current_row_cells[col1_idx] if col1_idx < len(current_row_cells) else {"value": "", "note": ""}
            cell2 = current_row_cells[col2_idx] if col2_idx < len(current_row_cells) else {"value": "", "note": ""}

            td_list = list(data["tds"].items())

            if len(td_list) == 1:
                td_code, td_data = td_list[0]
                vacio_str = td_data["vacio"]
                if not vacio_str:
                    # Condición de impresión: solo si el dato existe
                    continue

                chosen_col_idx = col1_idx
                chosen_col_letter = col1_letter
                chosen_cell = cell1
                if not cell1["value"] and cell2["value"]:
                    chosen_col_idx = col2_idx
                    chosen_col_letter = col2_letter
                    chosen_cell = cell2

                new_note = combine_vacio_with_existing_note(vacio_str, chosen_cell["note"])

                planned_updates.append({
                    "row": row_num,
                    "col_idx": chosen_col_idx,
                    "col_letter": chosen_col_letter,
                    "cell_coord": f"{chosen_col_letter}{row_num}",
                    "dia": dia,
                    "slot": 1 if chosen_col_idx == col1_idx else 2,
                    "tractor": data["tractor"],
                    "ut": data["ut"],
                    "td": td_code,
                    "vacio_raw": vacio_str,
                    "current_val": chosen_cell["value"],
                    "current_note": chosen_cell["note"],
                    "new_note": new_note
                })
            else:
                for slot_idx, (td_code, td_data) in enumerate(td_list[:2]):
                    vacio_str = td_data["vacio"]
                    if not vacio_str:
                        # Condición de impresión: solo si el dato existe
                        continue

                    target_c_idx = col1_idx if slot_idx == 0 else col2_idx
                    target_c_letter = col1_letter if slot_idx == 0 else col2_letter
                    target_cell = cell1 if slot_idx == 0 else cell2

                    new_note = combine_vacio_with_existing_note(vacio_str, target_cell["note"])

                    planned_updates.append({
                        "row": row_num,
                        "col_idx": target_c_idx,
                        "col_letter": target_c_letter,
                        "cell_coord": f"{target_c_letter}{row_num}",
                        "dia": dia,
                        "slot": slot_idx + 1,
                        "tractor": data["tractor"],
                        "ut": data["ut"],
                        "td": td_code,
                        "vacio_raw": vacio_str,
                        "current_val": target_cell["value"],
                        "current_note": target_cell["note"],
                        "new_note": new_note
                    })

        return planned_updates

    def apply_vacio_batch(
        self,
        planned_updates: List[Dict[str, Any]],
        apply_borders: bool = False,
        batch_size: int = 500
    ) -> Dict[str, Any]:
        """Aplica las notas y opcionalmente el borde inferior doble mediante batchUpdate."""
        target_sheet_id, _ = self.fetch_movimientos_grid()
        requests = []

        for item in planned_updates:
            r_idx = item["row"] - 1
            c_idx = item["col_idx"]

            # Actualización de nota si difiere
            if item["new_note"] != item["current_note"]:
                req = {
                    "updateCells": {
                        "range": {
                            "sheetId": target_sheet_id,
                            "startRowIndex": r_idx,
                            "endRowIndex": r_idx + 1,
                            "startColumnIndex": c_idx,
                            "endColumnIndex": c_idx + 1
                        },
                        "rows": [{
                            "values": [{
                                "note": item["new_note"]
                            }]
                        }],
                        "fields": "note"
                    }
                }
                requests.append(req)

            # Bordes nítidos inferior e izquierdo (SOLID_MEDIUM) para reconocimiento visual sin hover
            if apply_borders:
                req_border = {
                    "updateBorders": {
                        "range": {
                            "sheetId": target_sheet_id,
                            "startRowIndex": r_idx,
                            "endRowIndex": r_idx + 1,
                            "startColumnIndex": c_idx,
                            "endColumnIndex": c_idx + 1
                        },
                        "bottom": {
                            "style": "SOLID_MEDIUM",
                            "color": {"red": 0.0, "green": 0.0, "blue": 0.0}
                        },
                        "left": {
                            "style": "SOLID_MEDIUM",
                            "color": {"red": 0.0, "green": 0.0, "blue": 0.0}
                        }
                    }
                }
                requests.append(req_border)

        if not requests:
            return {"updated_count": 0, "batches": 0}

        batches_executed = 0
        for i in range(0, len(requests), batch_size):
            chunk = requests[i:i + batch_size]
            body = {"requests": chunk}
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self.mov_id,
                body=body
            ).execute()
            batches_executed += 1

        return {
            "updated_count": len(requests),
            "batches": batches_executed
        }


def main():
    parser = argparse.ArgumentParser(
        description="Sincronizador de VACÍO (Columna X) al inicio de las notas en Movimientos."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica las notas en Google Sheets. Si se omite, corre en modo simulación (--dry-run)."
    )
    parser.add_argument(
        "--borders",
        action="store_true",
        help="Aplica borde inferior doble (DOUBLE) en las celdas con VACÍO para reconocimiento visual sin hover."
    )
    parser.add_argument(
        "--day",
        type=int,
        default=None,
        help="Filtra por día específico de octubre (ej. --day 1)."
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

    print("=" * 80)
    print("  SINCRONIZADOR DE VACIO (COL X) AL INICIO DE NOTAS: RUTEOS -> MOVIMIENTOS")
    print(f"  Modo: {'APLICAR EN SHEETS' if args.apply else 'SIMULACION (DRY-RUN)'}")
    if args.day:
        print(f"  Filtro por dia: {args.day} de octubre")
    print("=" * 80)

    sync = VacioSync()
    print("[1/3] Conexión establecida con Service Account.")
    print(f"      - Ruteos ID:     {sync.ruteos_id}")
    print(f"      - Movimientos ID: {sync.mov_id}")

    print("\n[2/3] Procesando y emparejando asignaciones con datos de Columna X (VACÍO)...")
    updates = sync.process_assignments(filter_day=args.day)
    print(f"      - Total celdas con datos de VACÍO a inyectar: {len(updates)}")

    # Preview
    print("\n--- Muestra de Asignaciones (VACÍO al Inicio de la Nota) ---")
    for idx, u in enumerate(updates[:args.limit]):
        preview_note = u["new_note"].replace("\n", "  |  ")
        print(f"[{idx+1:02d}] Celda {u['cell_coord']:>6} (Fila {u['row']:>3}, Día {u['dia']:>2}, Slot {u['slot']}) | UT {u['ut']:>3} | Trk {u['tractor']:>7} | TD {u['td']}")
        print(f"     -> Celda Valor: {u['current_val']}")
        print(f"     -> Nota Final:  {preview_note[:120]}...")

    if len(updates) > args.limit:
        print(f"     ... y {len(updates) - args.limit} asignaciones más.")

    if args.apply:
        print("\n[3/3] Aplicando actualización atómica por lotes (fields='note')...")
        if args.borders:
            print("      -> Incluyendo bordes inferior e izquierdo (SOLID_MEDIUM) en las celdas con VACÍO.")
        res = sync.apply_vacio_batch(updates, apply_borders=args.borders)
        print(f"\n[OK] ¡Éxito! Se actualizaron {res['updated_count']} operaciones en {res['batches']} lotes.")
    else:
        print("\n[INFO] Modo simulación concluido. No se realizaron escrituras en Google Sheets.")
        print("       Para aplicar los cambios reales, ejecuta con el parámetro: --apply")


if __name__ == "__main__":
    main()
