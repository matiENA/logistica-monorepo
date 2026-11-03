#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  LIMPIADOR / RESETEADOR DE VACÍO Y BORDES EN MOVIMIENTOS
================================================================================
Descripción:
  Limpia los encabezados de 'VACIO ...' en hover notes y resetea los bordes
  'SOLID_MEDIUM' aplicados en la hoja 'OCTUBRE 2026- Mov.Unidades y Choferes'.

Modos de uso:
  1. Limpieza Inteligente (por defecto):
     py -3.13 limpiar_vacio.py --apply
     Detecta y elimina falsos vacíos (0:00 hs, 26:00 hs, o registros inexistentes
     en la estructura canónica de Ruteos), preservando intacto el tracking de Col H.

  2. Reseteo Total (--all / --reset-all):
     py -3.13 limpiar_vacio.py --all --apply
     Limpia TODOS los encabezados de VACÍO y bordes en toda la planilla (o en un
     día específico con --day N), dejando el tracking de Col H intacto para
     permitir una resincronización limpia desde cero tras arreglos de sheets.

  3. Modo Simulación (Dry-Run):
     Se ejecuta por defecto si no se pasa --apply. No modifica Google Sheets.
================================================================================
"""

import os
import re
import sys
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Set

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from credentials_helper import get_google_credentials, resolve_credentials_file

from config_operativas import load_config
from sync_operativas_unificadas import is_valid_td
from sync_operativas_unificadas import format_vacio_datetime

_cfg = load_config()
DEFAULT_RUTEOS_ID = _cfg["mes_actual"]["ruteos_id"]
DEFAULT_MOV_ID = _cfg["mes_actual"]["movimientos_id"]

SOURCE_TAB_RUTEOS = _cfg["mes_actual"]["tab_ruteos"]
TARGET_TAB_MOV = _cfg["mes_actual"]["tab_movimientos"]

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
        if dt.month == 10:
            return dt.day
    if "/" in s:
        parts = s.split("/")
        if len(parts) >= 2 and parts[0].isdigit():
            return int(parts[0])
    return None


def strip_vacio_header(note: str) -> str:
    """Elimina la cabecera de VACÍO conservando el tracking de Columna H intacto."""
    if not note:
        return ""
    lines = [l for l in note.split("\n") if l.strip()]
    if lines and lines[0].strip().upper().startswith("VACIO"):
        lines = lines[1:]
    return "\n".join(lines).strip()


def strip_bullets(note: str) -> str:
    """Elimina líneas que comienzan con viñetas '•' (localidades/destinos obsoletos), conservando el resto."""
    if not note:
        return ""
    lines = [l for l in note.split("\n") if not l.strip().startswith("•")]
    return "\n".join(lines).strip()


class VacioCleaner:
    def __init__(
        self,
        credentials_path: Optional[str] = None,
        ruteos_id: str = DEFAULT_RUTEOS_ID,
        mov_id: str = DEFAULT_MOV_ID
    ):
        self.ruteos_id = ruteos_id
        self.mov_id = mov_id
        if credentials_path:
            self.creds_path = credentials_path
            self._creds = Credentials.from_service_account_file(self.creds_path, scopes=SCOPES)
        else:
            self._creds = get_google_credentials(scopes=SCOPES)
            try:
                self.creds_path = resolve_credentials_file()
            except Exception:
                self.creds_path = None
        self._service = build("sheets", "v4", credentials=self._creds)

    def fetch_canonical_ruteos_vacios(self) -> Set[Tuple[str, int]]:
        """
        Obtiene el conjunto de pares (clave_unidad, dia) que tienen un VACÍO canónico válido.
        Filtra rigurosamente filas secundarias o datos no canónicos.
        """
        res = self._service.spreadsheets().values().get(
            spreadsheetId=self.ruteos_id,
            range=f"'{SOURCE_TAB_RUTEOS}'!A4:AL",
            valueRenderOption="FORMATTED_VALUE"
        ).execute()
        rows = res.get("values", [])

        valid_pairs = set()
        for r in rows:
            trk = re.sub(r"[^A-Z0-9]", "", str(r[0] if len(r) > 0 else "").upper())
            ut = str(r[1] if len(r) > 1 else "").strip().replace(".0", "")
            td = str(r[11] if len(r) > 11 else "").strip()
            raw_vacio = str(r[23] if len(r) > 23 else "").strip()
            fecha_val = str(r[36] if len(r) > 36 else "").strip()

            # Fila canónica: debe tener TD válido y tractor/UT
            if not (trk or ut) or not is_valid_td(td):
                continue

            vacio_fmt = format_vacio_datetime(raw_vacio)
            if not vacio_fmt:
                continue

            dia = parse_day_from_cell(fecha_val)
            if not dia or dia < 1 or dia > 31:
                continue

            if trk:
                valid_pairs.add((trk, dia))
            if ut:
                valid_pairs.add((ut, dia))

        return valid_pairs

    def fetch_movimientos_data(self) -> Tuple[int, List[List[Dict[str, Any]]]]:
        """Lee la grilla de Movimientos completa con valores, notas y formato de bordes."""
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
            fields="sheets(data(rowData(values(formattedValue,note,userEnteredFormat(borders)))))"
        ).execute()

        grid_rows = []
        if res.get("sheets") and res["sheets"][0].get("data"):
            raw_rows = res["sheets"][0]["data"][0].get("rowData", [])
            for r in raw_rows:
                cells = []
                for c in r.get("values", []):
                    cells.append({
                        "value": str(c.get("formattedValue") or "").strip(),
                        "note": str(c.get("note") or "").strip(),
                        "borders": c.get("userEnteredFormat", {}).get("borders", {})
                    })
                grid_rows.append(cells)

        return target_sheet_id, grid_rows

    def plan_cleanup(
        self,
        reset_all: bool = False,
        clean_bullets: bool = False,
        filter_day: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Determina las celdas a limpiar.
        - Si reset_all=True: limpia todos los VACÍO y bordes en los días seleccionados.
        - Si reset_all=False (Smart): limpia solo celdas con VACÍO anómalo o sin respaldo canónico.
        - Si clean_bullets=True: elimina viñetas obsoletas '•' de localidades/destinos.
        """
        canonical_vacios = self.fetch_canonical_ruteos_vacios() if not reset_all else set()
        _, mov_rows = self.fetch_movimientos_data()

        # Mapa de columnas operativas
        day_col_map: Dict[int, Tuple[int, int, str]] = {}
        target_days = [filter_day] if filter_day else list(range(1, 32))
        for d in target_days:
            (c1_idx, c1_letter), (c2_idx, c2_letter) = get_day_columns(d)
            day_col_map[c1_idx] = (d, 1, c1_letter)
            day_col_map[c2_idx] = (d, 2, c2_letter)

        # Mapa de unidades por fila en Movimientos
        row_units: Dict[int, Tuple[str, str]] = {}
        for idx in range(2, len(mov_rows)):
            row_num = idx + 1
            r = mov_rows[idx]
            ut = r[2]["value"].replace(".0", "") if len(r) > 2 else ""
            trk = re.sub(r"[^A-Z0-9]", "", r[4]["value"].upper()) if len(r) > 4 else ""
            row_units[row_num] = (ut, trk)

        planned = []

        for r_idx, row_cells in enumerate(mov_rows):
            row_num = r_idx + 1
            ut, trk = row_units.get(row_num, ("", ""))

            for c_idx in day_col_map:
                if c_idx >= len(row_cells):
                    continue

                cell = row_cells[c_idx]
                d, slot, c_letter = day_col_map[c_idx]
                coord = f"{c_letter}{row_num}"

                note = cell["note"]
                borders = cell["borders"]
                first_line = note.split("\n")[0].strip() if note else ""
                has_vacio_note = first_line.upper().startswith("VACIO")
                has_bullets = any(l.strip().startswith("•") for l in note.split("\n")) if note else False

                # Detectar bordes SOLID_MEDIUM
                b_bottom = borders.get("bottom", {}).get("style") == "SOLID_MEDIUM"
                b_left = borders.get("left", {}).get("style") == "SOLID_MEDIUM"
                has_vacio_borders = b_bottom or b_left

                if not (has_vacio_note or has_vacio_borders or (clean_bullets and has_bullets)):
                    continue

                should_clean_vacio = False
                reason_parts = []

                if reset_all:
                    should_clean_vacio = True
                    reason_parts.append("Reseteo total solicitado (--all)")
                else:
                    # Smart cleanup:
                    # 1. Header claramente anómalo (0:00 hs, 26:00 hs)
                    if has_vacio_note and ("0:00 hs" in first_line or "26:00 hs" in first_line):
                        should_clean_vacio = True
                        reason_parts.append(f"Header anómalo detectado: '{first_line}'")
                    # 2. Verificar contra Ruteos canónico
                    elif has_vacio_note or has_vacio_borders:
                        if (trk, d) not in canonical_vacios and (ut, d) not in canonical_vacios:
                            should_clean_vacio = True
                            reason_parts.append(f"Sin respaldo canónico en Ruteos para UT {ut}/Trk {trk} en Día {d}")

                cleaned_note = note
                if should_clean_vacio and has_vacio_note:
                    cleaned_note = strip_vacio_header(cleaned_note)
                if clean_bullets and has_bullets:
                    cleaned_note = strip_bullets(cleaned_note)
                    reason_parts.append("Limpieza de viñetas obsoletas (•)")

                needs_note_update = (cleaned_note != note)
                needs_border_reset = has_vacio_borders and should_clean_vacio

                if needs_note_update or needs_border_reset:
                    planned.append({
                        "row": row_num,
                        "col_idx": c_idx,
                        "col_letter": c_letter,
                        "coord": coord,
                        "day": d,
                        "slot": slot,
                        "ut": ut,
                        "tractor": trk,
                        "current_val": cell["value"],
                        "current_note": note,
                        "new_note": cleaned_note,
                        "needs_note_update": needs_note_update,
                        "needs_border_reset": needs_border_reset,
                        "reason": " | ".join(reason_parts)
                    })

        return planned

    def apply_cleanup_batch(
        self,
        planned_cleanups: List[Dict[str, Any]],
        batch_size: int = 500
    ) -> Dict[str, Any]:
        """Aplica la limpieza de notas y reseteo de bordes mediante batchUpdate atómico."""
        target_sheet_id, _ = self.fetch_movimientos_data()
        requests = []

        notes_updated = 0
        borders_reset = 0

        for item in planned_cleanups:
            r_idx = item["row"] - 1
            c_idx = item["col_idx"]

            # 1. Limpieza de nota (si tenía VACIO)
            if item["needs_note_update"]:
                req_note = {
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
                requests.append(req_note)
                notes_updated += 1

            # 2. Reseteo de bordes a NONE
            if item["needs_border_reset"]:
                req_border = {
                    "updateBorders": {
                        "range": {
                            "sheetId": target_sheet_id,
                            "startRowIndex": r_idx,
                            "endRowIndex": r_idx + 1,
                            "startColumnIndex": c_idx,
                            "endColumnIndex": c_idx + 1
                        },
                        "bottom": {"style": "NONE"},
                        "left": {"style": "NONE"}
                    }
                }
                requests.append(req_border)
                borders_reset += 1

        if not requests:
            return {"updated_count": 0, "batches": 0, "notes_updated": 0, "borders_reset": 0}

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
            "batches": batches_executed,
            "notes_updated": notes_updated,
            "borders_reset": borders_reset
        }


def main():
    parser = argparse.ArgumentParser(
        description="Limpiador / Reseteador de notas de VACÍO y bordes en Movimientos."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica los cambios reales en Google Sheets. Si se omite, opera en modo simulación (--dry-run)."
    )
    parser.add_argument(
        "--all", "--reset-all",
        action="store_true",
        dest="reset_all",
        help="Limpia TODOS los encabezados de VACÍO y bordes en toda la grilla mensual (conservando el tracking Col H)."
    )
    parser.add_argument(
        "--clean-bullets",
        action="store_true",
        help="Elimina viñetas '•' de localidades/destinos obsoletos en las notas, conservando el tracking puro de Col H."
    )
    parser.add_argument(
        "--day",
        type=int,
        default=None,
        help="Filtra por un día específico de octubre (ej. --day 7)."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=30,
        help="Límite de celdas a mostrar en el preview de consola (por defecto 30)."
    )
    args = parser.parse_args()

    if sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("=" * 80)
    print("  LIMPIADOR / RESETEADOR DE VACIO Y BORDES: MOVIMIENTOS")
    print(f"  Modo Operación: {'APLICAR EN GOOGLE SHEETS' if args.apply else 'SIMULACIÓN (DRY-RUN)'}")
    print(f"  Estrategia:     {'RESETEO TOTAL (--all)' if args.reset_all else 'LIMPIEZA INTELIGENTE (Falsos Vacíos / Sin Respaldo)'}")
    if args.clean_bullets:
        print("  Filtro Extra:   Limpieza de viñetas obsoletas ('•') activada")
    if args.day:
        print(f"  Filtro por día: {args.day} de octubre")
    print("=" * 80)

    cleaner = VacioCleaner()
    print("[1/3] Conexión establecida con Service Account.")
    print(f"      - Planilla Movimientos ID: {cleaner.mov_id}")
    if not args.reset_all:
        print(f"      - Planilla Ruteos ID:     {cleaner.ruteos_id}")

    print("\n[2/3] Analizando celdas operativas en Movimientos...")
    planned = cleaner.plan_cleanup(reset_all=args.reset_all, clean_bullets=args.clean_bullets, filter_day=args.day)
    print(f"      - Total celdas detectadas para limpieza: {len(planned)}")

    if not planned:
        print("\n[OK] No se detectaron celdas que requieran limpieza. Todo se encuentra sincronizado correctamente.")
        return

    # Preview
    print("\n--- Muestra de Celdas a Limpiar ---")
    for idx, item in enumerate(planned[:args.limit]):
        print(f"[{idx+1:02d}] Celda {item['coord']:>6} (Fila {item['row']:>3}, Día {item['day']:>2}, Slot {item['slot']}) | UT {item['ut']:>3} | Trk {item['tractor']:>7}")
        print(f"     -> Causa: {item['reason']}")
        print(f"     -> Valor: {item['current_val']}")
        curr_preview = item['current_note'].replace('\n', '  |  ')
        new_preview = item['new_note'].replace('\n', '  |  ')
        print(f"     -> Nota Anterior: {curr_preview[:90]}...")
        print(f"     -> Nota Resultante: {new_preview[:90] if new_preview else '[NOTA VACIA / ELIMINADA]'}")
        border_txt = "BORDES A RESETEAR" if item['needs_border_reset'] else "SIN BORDES"
        print(f"     -> Estado Bordes: {border_txt}")

    if len(planned) > args.limit:
        print(f"     ... y {len(planned) - args.limit} celdas más a limpiar.")

    if args.apply:
        print("\n[3/3] Aplicando limpieza atómica en Google Sheets...")
        res = cleaner.apply_cleanup_batch(planned)
        print(f"\n[OK] ¡Limpieza completada con éxito!")
        print(f"     - Notas actualizadas (encabezado VACÍO eliminado): {res['notes_updated']}")
        print(f"     - Bordes reseteados a normal (NONE):               {res['borders_reset']}")
        print(f"     - Total operaciones API ejecutadas:                 {res['updated_count']} en {res['batches']} lotes.")
    else:
        print("\n[INFO] Modo simulación concluido. No se realizaron escrituras en Google Sheets.")
        print("       Para aplicar la limpieza en vivo, ejecuta con el parámetro: --apply")


if __name__ == "__main__":
    main()
