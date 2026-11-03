"""
sync_ruteos_movimientos.py
Sincronización y enriquecimiento de notas en hover (Destinos limpios) desde Ruteos hacia
la planilla mensual 'NOVIEMBRE 2026- Mov.Unidades y Choferes'.
"""
import os
import re
import sys
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

# Configurar salida UTF-8 para consola de Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from credentials_helper import get_google_credentials, resolve_credentials_file
from sync_operativas_unificadas import is_valid_td

# IDs de Google Spreadsheet
DEFAULT_RUTEOS_ID = "1-wNLgr2b1TibP_MPwA9ToF9jlH_jiPxjN0iirWbFb3o"
DEFAULT_MOV_ID = "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc"

SOURCE_TAB_RUTEOS = "Ruteos"
TARGET_TAB_MOV = "NOVIEMBRE 2026- Mov.Unidades y Choferes"

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


def get_day_columns(day: int) -> Tuple[Tuple[int, str], Tuple[int, str]]:
    """
    Calcula las dos columnas de destino/localidad para el día operativo 'day' (1 a 31).
    - Columna 1 (Principal): 30 + 13 * (day - 1) -> Día 1: AE (30), Día 2: AR (43), etc.
    - Columna 2 (Secundaria): 32 + 13 * (day - 1) -> Día 1: AG (32), Día 2: AT (45), etc.
    Retorna: ((col1_idx, col1_letra), (col2_idx, col2_letra))
    """
    col1_idx = 30 + 13 * (day - 1)
    col2_idx = 32 + 13 * (day - 1)
    return (col1_idx, index_to_col_letter(col1_idx)), (col2_idx, index_to_col_letter(col2_idx))


def clean_destino(raw_destino: Optional[str]) -> str:
    """
    Limpia el código de orden/contrato y conserva 'código_estación - nombre_cliente'.
    Ejemplo: '2000146470-YP01-01-24 - 31349 - RIO NEUQUEN COMBUSTIBLES S.A.' -> '31349 - RIO NEUQUEN COMBUSTIBLES S.A.'
    Ejemplo: 'SRL2000111782-YP01-01-24 - 01578 - PETROZAPALA SACI' -> '01578 - PETROZAPALA SACI'
    """
    if not raw_destino:
        return ""
    text = str(raw_destino).strip()
    parts = re.split(r'\s+-\s+', text)
    if len(parts) >= 3:
        # Se elimina parts[0] (contrato) y se une el resto (estación + cliente)
        return " - ".join(parts[1:]).strip()
    elif len(parts) == 2:
        # Si la primera parte parece un contrato (código largo o con -YP), descartarla
        if re.search(r'\d{6,}|-YP', parts[0], re.IGNORECASE):
            return parts[1].strip()
        # Si la primera parte es código de estación (ej. 01578 o 31349), ya está limpio
        return text
    return text


def format_note_destinos(raw_destinos_list: List[str]) -> str:
    """
    Limpia y deduplica destinos idénticos.
    - Si un destino se repite, solo se incluye una vez.
    - Si hay un único destino: '31349 - RIO NEUQUEN COMBUSTIBLES S.A.'
    - Si hay múltiples destinos distintos: lista multilínea con viñetas '• ...'
    """
    seen = set()
    cleaned_unique = []
    for raw in raw_destinos_list:
        clean = clean_destino(raw)
        if clean and clean not in seen:
            seen.add(clean)
            cleaned_unique.append(clean)

    if not cleaned_unique:
        return ""
    if len(cleaned_unique) == 1:
        return cleaned_unique[0]
    return "\n".join(f"• {d}" for d in cleaned_unique)


def parse_day_from_cell(fecha_val: str) -> Optional[int]:
    """Interpreta el día del mes de octubre a partir de números de serie Excel o fechas formato d/m/y."""
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


class RuteosMovimientosSync:
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
        self._cached_sheet_id: Optional[int] = None
        self._cached_grid: Optional[List[List[str]]] = None

    def fetch_ruteos(self) -> List[List[str]]:
        """Lee todas las filas operativas desde Ruteos (A4 hasta AL)."""
        res = self._service.spreadsheets().values().get(
            spreadsheetId=self.ruteos_id,
            range=f"'{SOURCE_TAB_RUTEOS}'!A4:AL",
            valueRenderOption="FORMATTED_VALUE"
        ).execute()
        return res.get("values", [])

    def fetch_movimientos_grid(self, force_reload: bool = False) -> Tuple[int, List[List[str]]]:
        """
        Lee la matriz de Movimientos y obtiene el sheetId de la pestaña objetivo (con caché).
        Retorna (sheetId, rows).
        """
        if not force_reload and self._cached_sheet_id is not None and self._cached_grid is not None:
            return self._cached_sheet_id, self._cached_grid

        if self._cached_sheet_id is None:
            meta = self._service.spreadsheets().get(
                spreadsheetId=self.mov_id,
                fields="sheets.properties"
            ).execute()
            target_sheet_id = None
            for sheet in meta.get("sheets", []):
                if sheet["properties"]["title"] == TARGET_TAB_MOV:
                    target_sheet_id = sheet["properties"]["sheetId"]
                    break
            if target_sheet_id is None:
                raise ValueError(f"No se encontró la pestaña '{TARGET_TAB_MOV}' en la planilla {self.mov_id}")
            self._cached_sheet_id = target_sheet_id

        res = self._service.spreadsheets().values().get(
            spreadsheetId=self.mov_id,
            range=f"'{TARGET_TAB_MOV}'!A1:ZZ400",
            valueRenderOption="FORMATTED_VALUE"
        ).execute()
        self._cached_grid = res.get("values", [])
        return self._cached_sheet_id, self._cached_grid

    def process_assignments(
        self,
        filter_day: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Procesa y empareja Ruteos contra Movimientos.
        Resuelve:
        - Asignación por Tractor y N° UT
        - Agrupación por Despacho (TD)
        - Asignación a Columna 1 (AE/AR/...) y Columna 2 (AG/AT/...)
        - Deduplicación estricta de destinos para la nota
        """
        ruteos_rows = self.fetch_ruteos()
        _, mov_rows = self.fetch_movimientos_grid()

        # 1. Indexar unidades en Movimientos (filas 3 a N)
        # Diccionarios: tractor_norm -> row_1based, ut -> row_1based
        tractor_to_row = {}
        ut_to_row = {}

        for idx in range(2, len(mov_rows)):
            row_num = idx + 1  # 1-based
            r = mov_rows[idx]
            ut = str(r[2] if len(r) > 2 else "").strip().replace(".0", "")
            trk = re.sub(r'[^A-Z0-9]', '', str(r[4] if len(r) > 4 else "").upper())
            if trk:
                tractor_to_row[trk] = row_num
            if ut:
                ut_to_row[ut] = row_num

        # 2. Agrupar Ruteos por (Tractor, Día) -> { td: { localidades, destinos } }
        trips_by_unit_day: Dict[Tuple[str, int], Dict[str, Dict[str, Any]]] = {}

        for r in ruteos_rows:
            raw_trk = str(r[0] if len(r) > 0 else "").upper()
            trk = re.sub(r'[^A-Z0-9]', '', raw_trk)
            ut = str(r[1] if len(r) > 1 else "").strip().replace(".0", "")
            td = str(r[11] if len(r) > 11 else "").strip()
            raw_tracking = str(r[7] if len(r) > 7 else "").strip()
            fecha_val = str(r[36] if len(r) > 36 else "").strip()
            localidad = str(r[37] if len(r) > 37 else "").strip()

            # Fila canónica de Ruteos: debe tener tractor o UT y TD válido (Col L / índice 11)
            if not (trk or ut) or not is_valid_td(td):
                continue
            if not (localidad or raw_tracking):
                continue

            dia = parse_day_from_cell(fecha_val)
            if not dia or dia < 1 or dia > 31:
                continue
            if filter_day is not None and dia != filter_day:
                continue

            # Identificar clave de unidad
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
                    "localidades": [],
                    "tracking": ""
                }
            if localidad and localidad not in trips_by_unit_day[key]["tds"][td_key]["localidades"]:
                trips_by_unit_day[key]["tds"][td_key]["localidades"].append(localidad)
            if raw_tracking:
                current_tracking = trips_by_unit_day[key]["tds"][td_key]["tracking"]
                if not current_tracking:
                    trips_by_unit_day[key]["tds"][td_key]["tracking"] = raw_tracking
                elif raw_tracking != current_tracking and raw_tracking not in current_tracking:
                    trips_by_unit_day[key]["tds"][td_key]["tracking"] += f"\n{raw_tracking}"

        # 3. Leer notas existentes en Movimientos para preservar encabezados VACIO
        existing_notes_map = {}
        try:
            res_notes = self._service.spreadsheets().get(
                spreadsheetId=self.mov_id,
                ranges=[f"'{TARGET_TAB_MOV}'!AE1:ZZ350"],
                fields="sheets(data(rowData(values(note))))"
            ).execute()
            if res_notes.get("sheets") and res_notes["sheets"][0].get("data"):
                raw_rows = res_notes["sheets"][0]["data"][0].get("rowData", [])
                for r_i, r_data in enumerate(raw_rows):
                    for c_i, cell_data in enumerate(r_data.get("values", [])):
                        note_val = cell_data.get("note", "").strip()
                        if note_val:
                            col_letter = index_to_col_letter(30 + c_i)
                            existing_notes_map[f"{col_letter}{r_i + 1}"] = note_val
        except Exception:
            pass

        # 4. Mapear cada viaje a Columna 1 o Columna 2
        planned_updates = []

        for (unit_key, dia), data in trips_by_unit_day.items():
            row_num = data["row"]
            row_idx_0based = row_num - 1
            (col1_idx, col1_letter), (col2_idx, col2_letter) = get_day_columns(dia)

            # Leer contenido actual de la fila en Movimientos si existe
            current_row_vals = mov_rows[row_idx_0based] if row_idx_0based < len(mov_rows) else []
            val_col1 = str(current_row_vals[col1_idx] if col1_idx < len(current_row_vals) else "").strip()
            val_col2 = str(current_row_vals[col2_idx] if col2_idx < len(current_row_vals) else "").strip()

            td_list = list(data["tds"].items())

            if len(td_list) == 1:
                # Solo un viaje en el día para esta unidad
                td_code, td_data = td_list[0]
                note_text = td_data["tracking"]
                loc_text = " - ".join(td_data["localidades"])

                # Si por alguna razón la columna 2 tiene el valor pero la 1 está vacía
                chosen_col_idx = col1_idx
                chosen_col_letter = col1_letter
                if not val_col1 and val_col2:
                    chosen_col_idx = col2_idx
                    chosen_col_letter = col2_letter

                coord = f"{chosen_col_letter}{row_num}"
                curr_note = existing_notes_map.get(coord, "")
                if curr_note and curr_note.upper().startswith("VACIO"):
                    vacio_header = curr_note.split("\n")[0].strip()
                    # Ignorar encabezados anómalos (ej. 0:00 hs, 26:00 hs, o VACIO pelado)
                    if "0:00 hs" not in vacio_header and "26:00 hs" not in vacio_header and vacio_header != "VACIO":
                        if note_text:
                            note_text = f"{vacio_header}\n{note_text}"
                        else:
                            note_text = vacio_header

                planned_updates.append({
                    "row": row_num,
                    "col_idx": chosen_col_idx,
                    "col_letter": chosen_col_letter,
                    "cell_coord": coord,
                    "dia": dia,
                    "slot": 1 if chosen_col_idx == col1_idx else 2,
                    "tractor": data["tractor"],
                    "ut": data["ut"],
                    "td": td_code,
                    "localidades": loc_text,
                    "current_val": val_col1 if chosen_col_idx == col1_idx else val_col2,
                    "note": note_text
                })
            else:
                # Múltiples viajes en el día (Turno 1 y Turno 2)
                # Asignar viaje 1 a Columna 1, viaje 2 a Columna 2
                for slot_idx, (td_code, td_data) in enumerate(td_list[:2]):
                    target_c_idx = col1_idx if slot_idx == 0 else col2_idx
                    target_c_letter = col1_letter if slot_idx == 0 else col2_letter
                    curr_val = val_col1 if slot_idx == 0 else val_col2
                    note_text = td_data["tracking"]
                    loc_text = " - ".join(td_data["localidades"])

                    coord = f"{target_c_letter}{row_num}"
                    curr_note = existing_notes_map.get(coord, "")
                    if curr_note and curr_note.upper().startswith("VACIO"):
                        vacio_header = curr_note.split("\n")[0].strip()
                        # Ignorar encabezados anómalos (ej. 0:00 hs, 26:00 hs, o VACIO pelado)
                        if "0:00 hs" not in vacio_header and "26:00 hs" not in vacio_header and vacio_header != "VACIO":
                            if note_text:
                                note_text = f"{vacio_header}\n{note_text}"
                            else:
                                note_text = vacio_header

                    planned_updates.append({
                        "row": row_num,
                        "col_idx": target_c_idx,
                        "col_letter": target_c_letter,
                        "cell_coord": coord,
                        "dia": dia,
                        "slot": slot_idx + 1,
                        "tractor": data["tractor"],
                        "ut": data["ut"],
                        "td": td_code,
                        "localidades": loc_text,
                        "current_val": curr_val,
                        "note": note_text
                    })

        return planned_updates

    def apply_notes_batch(
        self,
        planned_updates: List[Dict[str, Any]],
        batch_size: int = 500
    ) -> Dict[str, Any]:
        """
        Aplica las notas por lotes mediante spreadsheets().batchUpdate.
        Usa la máscara fields='note' para garantizar inmunidad total sobre fórmulas y formatos.
        """
        target_sheet_id, _ = self.fetch_movimientos_grid()
        requests = []

        for item in planned_updates:
            if not item["note"]:
                continue
            r_idx = item["row"] - 1
            c_idx = item["col_idx"]

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
                            "note": item["note"]
                        }]
                    }],
                    "fields": "note"
                }
            }
            requests.append(req)

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

    def clean_leftover_ad_notes(self, dry_run: bool = True) -> List[str]:
        """
        Detecta y limpia las celdas en la hoja de Movimientos que hayan quedado con notas
        residuales provenientes de la Columna AD de Ruteos y que no contengan tracking de Columna H.
        """
        ruteos_rows = self.fetch_ruteos()
        all_ad_raw = set()
        all_ad_clean = set()
        for r in ruteos_rows:
            if len(r) > 29 and r[29]:
                raw = str(r[29]).strip()
                if raw:
                    all_ad_raw.add(raw)
                    c = clean_destino(raw)
                    if c:
                        all_ad_clean.add(c)

        target_sheet_id, _ = self.fetch_movimientos_grid()
        res = self._service.spreadsheets().get(
            spreadsheetId=self.mov_id,
            ranges=[f"'{TARGET_TAB_MOV}'!AE1:ZZ350"],
            fields="sheets(data(rowData(values(note))))"
        ).execute()

        requests = []
        cleaned_cells = []
        data = res["sheets"][0]["data"][0]
        for r_idx, row in enumerate(data.get("rowData", [])):
            for c_idx, cell in enumerate(row.get("values", [])):
                note = cell.get("note", "")
                if not note:
                    continue
                actual_c_idx = 30 + c_idx
                lines = [line.lstrip("• ").strip() for line in note.split("\n") if line.strip()]
                is_ad = all(line in all_ad_clean or line in all_ad_raw for line in lines)
                if is_ad:
                    coord = f"{index_to_col_letter(actual_c_idx)}{r_idx + 1}"
                    cleaned_cells.append(coord)
                    requests.append({
                        "updateCells": {
                            "range": {
                                "sheetId": target_sheet_id,
                                "startRowIndex": r_idx,
                                "endRowIndex": r_idx + 1,
                                "startColumnIndex": actual_c_idx,
                                "endColumnIndex": actual_c_idx + 1
                            },
                            "rows": [{"values": [{"note": ""}]}],
                            "fields": "note"
                        }
                    })

        if not dry_run and requests:
            for i in range(0, len(requests), 500):
                chunk = requests[i:i + 500]
                self._service.spreadsheets().batchUpdate(
                    spreadsheetId=self.mov_id,
                    body={"requests": chunk}
                ).execute()

        return cleaned_cells


def main():
    parser = argparse.ArgumentParser(
        description="Sincronizador de Destinos limpios como notas en hover desde Ruteos hacia Movimientos."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica las notas en Google Sheets. Si se omite, corre en modo simulación (--dry-run)."
    )
    parser.add_argument(
        "--clean-ad",
        action="store_true",
        help="Limpia notas residuales de la Columna AD que no fueron sobreescritas por Columna H."
    )
    parser.add_argument(
        "--day",
        type=int,
        default=None,
        help="Filtra el procesamiento para un día específico de octubre (ej. --day 1)."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Límite de filas a mostrar en el preview de consola (por defecto 25)."
    )
    args = parser.parse_args()

    print("=" * 80)
    print("  SINCRONIZADOR DE DESTINOS EN HOVER: RUTEOS ➡️ MOVIMIENTOS")
    print(f"  Modo: {'APLICAR EN SHEETS' if args.apply else 'SIMULACIÓN (DRY-RUN)'}")
    if args.day:
        print(f"  Filtro por día: {args.day} de octubre")
    print("=" * 80)

    sync = RuteosMovimientosSync()
    print(f"[1/3] Conexión establecida con Service Account.")
    print(f"      - Ruteos ID:     {sync.ruteos_id}")
    print(f"      - Movimientos ID: {sync.mov_id}")

    print("\n[2/3] Procesando y emparejando asignaciones (doble columna por día)...")
    updates = sync.process_assignments(filter_day=args.day)
    print(f"      - Total celdas a actualizar: {len(updates)}")

    # Preview de resultados
    print("\n--- Muestra de Asignaciones (Ranuras y Notas Limpias) ---")
    for idx, u in enumerate(updates[:args.limit]):
        note_display = u['note'].replace('\n', '  |  ')
        print(f"[{idx+1:02d}] Celda {u['cell_coord']:>6} (Fila {u['row']:>3}, Día {u['dia']:>2}, Slot {u['slot']}) | UT {u['ut']:>3} | Trk {u['tractor']:>7} | TD {u['td']}")
        print(f"     -> Localidad:  {u['localidades']}")
        print(f"     -> Nota Hover: {note_display}")

    if len(updates) > args.limit:
        print(f"     ... y {len(updates) - args.limit} asignaciones más.")

    if args.apply:
        print("\n[3/3] Aplicando actualización atómica por lotes (fields='note')...")
        res = sync.apply_notes_batch(updates)
        print(f"\n[OK] ¡Éxito! Se inyectaron notas en {res['updated_count']} celdas en {res['batches']} lotes.")
    else:
        print("\n[INFO] Modo simulación concluido. No se realizaron escrituras en Google Sheets.")
        print("       Para aplicar los cambios reales, ejecuta con el parámetro: --apply")

    if args.clean_ad:
        print("\n--- Limpieza de Notas Residuales de Columna AD ---")
        cleaned = sync.clean_leftover_ad_notes(dry_run=not args.apply)
        if args.apply:
            print(f"[OK] Se limpiaron {len(cleaned)} celdas con notas residuales de Columna AD.")
        else:
            print(f"[INFO] Se detectaron {len(cleaned)} celdas con notas residuales de Columna AD a limpiar (modo simulación).")


if __name__ == "__main__":
    main()
