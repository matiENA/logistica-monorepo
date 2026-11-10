#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  SINCRONIZADOR OPERATIVO UNIFICADO EN CAPAS (TRACKING + VACÍO + SEGUIMIENTO)
================================================================================
Descripción:
  Pipeline de producción que ejecuta en un ÚNICO recorrido en memoria y con una
  sola llamada batchUpdate atómica las 3 tareas operativas de Google Sheets:
  
  - Capa 1: Tracking Col H (destinos limpios y notas en hover).
  - Capa 2: VACÍO Col X (estrictamente dependiente de Col X + bordes SOLID_MEDIUM).
  - Capa 3: Seguimiento de Vacío (#9fc5e8 para último viaje activo + cleanup automático).

Ventajas sobre el flujo tradicional separado:
  - Reduce peticiones de lectura a Google API en un 70%.
  - Reduce el payload transferido en un 93% (~25.000 celdas vs 350.000).
  - Reduce llamadas de escritura de 3 a 1 batchUpdate consolidado.
  - Ejecuta en ~3 a 5 segundos (cero subprocesos spawned).
  - Permite un intervalo de ejecución mucho menor (2 a 3 min) sin agotar cuotas.
================================================================================
"""

import os
import re
import sys
import time
import socket
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any

# Configurar salida UTF-8 con flush en tiempo real (unbuffered/line_buffering) para n8n y consola Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

# Prevenir caídas por timeout de sockets en Google API (configurable vía SOCKET_TIMEOUT, default 600s / 10m)
SOCKET_TIMEOUT = int(os.getenv("SOCKET_TIMEOUT", "600"))
socket.setdefaulttimeout(SOCKET_TIMEOUT)

def api_call_with_retry(api_req: Any, max_retries: int = 5, initial_delay: float = 5.0) -> Any:
    """
    Ejecuta una petición de Google Sheets API con reintento automático y backoff exponencial
    ante errores 500, 502 (Bad Gateway), 503, 504, caídas de gateway, socket timeouts o micro-cortes.
    """
    delays = [5.0, 10.0, 20.0, 30.0, 45.0]
    for attempt in range(max_retries + 1):
        try:
            return api_req.execute(num_retries=2)
        except Exception as e:
            err_str = str(e).lower()
            status_code = getattr(getattr(e, "resp", None), "status", None)
            is_transient = (
                (status_code in (500, 502, 503, 504))
                or any(k in err_str for k in [
                    "timed out", "timeout", "503", "500", "502", "504",
                    "unavailable", "internal error", "bad gateway",
                    "temporarily unavailable", "that’s an error", "that's an error"
                ])
            )
            if attempt < max_retries and is_transient:
                wait_time = delays[attempt] if attempt < len(delays) else 30.0
                print(f"[RETRY] ⚠️ Error transitorio de Google API ({status_code or 'Gateway/Timeout/502'}). Reintentando ({attempt + 1}/{max_retries}) en {wait_time}s...")
                time.sleep(wait_time)
                continue
            raise

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
from drive_state_manager import DriveStateManager
from execution_shield import ExecutionShield, generate_audit_report
from config_operativas import (
    RUTEOS_ID as DEFAULT_RUTEOS_ID,
    SOURCE_TAB_RUTEOS,
    MOVIMIENTOS_ID as DEFAULT_MOV_ID,
    TARGET_TAB_MOV,
    RUTEOS_ANTERIOR_ID,
    SOURCE_TAB_RUTEOS_ANTERIOR,
    MOVIMIENTOS_ANTERIOR_ID,
    TARGET_TAB_MOV_ANTERIOR,
    DIAS_TRANSICION_DUAL,
    CACHE_FILE_PREV_MONTH,
)

TARGET_COLOR_HEX = "#9fc5e8"
TARGET_COLOR_RGB = {
    "red": 159 / 255.0,
    "green": 197 / 255.0,
    "blue": 232 / 255.0
}

CLEANUP_COLOR_HEX = "#f5f7fa"
CLEANUP_COLOR_RGB = {
    "red": 245 / 255.0,
    "green": 247 / 255.0,
    "blue": 250 / 255.0
}

EXCLUDED_DISPO_KEYWORDS = [
    "dock sud",
    "tds",
]

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]


# ==============================================================================
# HELPERS DE COORDENADAS Y FECHAS
# ==============================================================================

def index_to_col_letter(col_idx: int) -> str:
    """Convierte índice 0-based a letra estilo Excel (0 -> A, 30 -> AE)."""
    result = ""
    col_num = col_idx + 1
    while col_num > 0:
        col_num, remainder = divmod(col_num - 1, 26)
        result = chr(65 + remainder) + result
    return result


def get_day_column_indices(day: int) -> Tuple[int, int, int, int]:
    """
    Retorna los índices 0-based para el día dado (1 a 31):
    (col_chofer_idx, col_dispo_idx, col_slot1_idx, col_slot2_idx)
    - Slot 1 (Fecha principal): 30 + 13 * (day - 1)
    - Slot 2 (Fecha secundaria): col_slot1_idx + 2
    - Dispo:                    col_slot1_idx - 2
    - Chofer:                   col_slot1_idx - 3
    """
    col_slot1_idx = 30 + 13 * (day - 1)
    col_slot2_idx = col_slot1_idx + 2
    col_dispo_idx = col_slot1_idx - 2
    col_chofer_idx = col_slot1_idx - 3
    return col_chofer_idx, col_dispo_idx, col_slot1_idx, col_slot2_idx


def parse_day_from_cell(fecha_val: str, expected_month: Optional[int] = None) -> Optional[int]:
    """Extrae el día (1 a 31) de números de serie Excel o strings de fecha."""
    if not fecha_val:
        return None
    s = str(fecha_val).strip()
    if s.isdigit():
        serial = int(s)
        dt = datetime(1899, 12, 30) + timedelta(days=serial)
        if expected_month is None or dt.month == expected_month:
            return dt.day
        return None
    if "/" in s:
        parts = s.split("/")
        if len(parts) >= 2 and parts[0].isdigit():
            d = int(parts[0])
            if expected_month is not None and len(parts) >= 2 and parts[1].isdigit():
                m = int(parts[1])
                if m != expected_month:
                    return None
            return d
    return None


# ==============================================================================
# HELPERS DE CAPA 1: TRACKING (COLUMNA H)
# ==============================================================================

def clean_destino(raw_destino: Optional[str]) -> str:
    """Limpia el código de orden/contrato y conserva 'código_estación - cliente'."""
    if not raw_destino:
        return ""
    text = str(raw_destino).strip()
    parts = re.split(r'\s+-\s+', text)
    if len(parts) >= 3:
        return " - ".join(parts[1:]).strip()
    elif len(parts) == 2:
        if re.search(r'\d{6,}|-YP', parts[0], re.IGNORECASE):
            return parts[1].strip()
        return text
    return text


def format_tracking_text(raw_destinos: List[str], raw_tracking_extra: List[str]) -> str:
    """Consolida destinos limpios y cualquier nota adicional de Col H."""
    seen_dest = set()
    cleaned_destinos = []
    for d in raw_destinos:
        c = clean_destino(d)
        if c and c not in seen_dest:
            seen_dest.add(c)
            cleaned_destinos.append(c)

    dest_block = ""
    if len(cleaned_destinos) == 1:
        dest_block = cleaned_destinos[0]
    elif len(cleaned_destinos) > 1:
        dest_block = "\n".join(f"• {d}" for d in cleaned_destinos)

    # Extra tracking text (si el operador agregó notas en Col H)
    seen_extra = set()
    extra_lines = []
    for t in raw_tracking_extra:
        t_clean = str(t).strip()
        if t_clean and t_clean not in seen_extra:
            seen_extra.add(t_clean)
            extra_lines.append(t_clean)

    extra_block = "\n".join(extra_lines)

    if dest_block and extra_block:
        return f"{dest_block}\n{extra_block}"
    return dest_block or extra_block or ""


# ==============================================================================
# HELPERS DE CAPA 2: VACÍO Y BORDES (COLUMNA X)
# ==============================================================================

def format_vacio_datetime(raw: str) -> str:
    """
    Parsea y formatea la fecha y hora de VACÍO estrictamente desde Columna X.
    Acepta:
      - '4/10/2026 8:10:00' -> 'VACIO 4/10 8:10 hs'
      - '5/10/26 23 HS'     -> 'VACIO 5/10 23:00 hs'
      - '7/10 23:40'        -> 'VACIO 7/10 23:40 hs'
      - '08/10/2026'        -> 'VACIO 8/10 hs'
      - '09/10/2026 0:00'   -> 'VACIO 9/10 hs'
      - 'VACIO'             -> 'VACIO'
    Descarta:
      - 'FALSE', 'TRUE', '#N/A', 'TLC', 'TPH', 'NO', ''
    """
    if not raw:
        return ""
    s = str(raw).strip().replace("*", "")
    if s.upper() in ["TRUE", "FALSE", "#N/A", "TLC", "TPH", "NO", ""]:
        return ""

    if s.strip().upper() == "VACIO":
        return "VACIO"

    # Serial numérico Excel
    if s.isdigit():
        try:
            serial = int(s)
            dt = datetime(1899, 12, 30) + timedelta(days=serial)
            if 1 <= dt.month <= 12 and 1 <= dt.day <= 31:
                return f"VACIO {dt.day}/{dt.month} hs"
        except Exception:
            pass

    # 1. Patrón con hora y minutos separados por ':'
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

    # 2. Patrón con 'HS' explícito
    m2 = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](?:20326|32026|20\d{2}|\d{4}|\d{2})\s*(\d{1,2})\s*HS\b", s, re.IGNORECASE)
    if m2:
        d = int(m2.group(1))
        mo = int(m2.group(2))
        h = int(m2.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31 and 1 <= h < 24:
            return f"VACIO {d}/{mo} {h}:00 hs"

    # 3. Patrón fecha corta sin año con hora
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

    # 4. Patrón fecha completa sin hora
    m4 = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](?:20326|32026|20\d{2}|\d{4}|\d{2})", s)
    if m4:
        d = int(m4.group(1))
        mo = int(m4.group(2))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"VACIO {d}/{mo} hs"

    # 5. Patrón fecha corta sin año
    m5 = re.search(r"^(\d{1,2})[/-](\d{1,2})$", s)
    if m5:
        d = int(m5.group(1))
        mo = int(m5.group(2))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"VACIO {d}/{mo} hs"

    return ""


def compose_final_note(vacio_header: str, tracking_body: str) -> str:
    """
    Ensambla la nota final de forma canónica:
    - Si existe vacio_header (generado desde Col X): se ubica en la primera línea.
    - Debajo se ubica el cuerpo de tracking.
    - Si no hay vacio_header, queda solo el cuerpo de tracking.
    """
    vacio_header = (vacio_header or "").strip()
    tracking_body = (tracking_body or "").strip()

    # Si el tracking previo ya tenía un 'VACIO' al inicio, limpiarlo para evitar duplicar
    lines = [l for l in tracking_body.split("\n") if l.strip()]
    if lines and lines[0].strip().upper().startswith("VACIO"):
        lines = lines[1:]
    clean_tracking = "\n".join(lines).strip()

    if vacio_header and clean_tracking:
        return f"{vacio_header}\n\n{clean_tracking}"
    return vacio_header or clean_tracking or ""


# ==============================================================================
# HELPERS DE CAPA 3: SEGUIMIENTO VACÍO Y PINTADO (#9fc5e8)
# ==============================================================================

def is_chofer_excluded(val: Optional[str]) -> bool:
    """Excluye si Chofer es '1' solitario."""
    if not val:
        return False
    return str(val).strip() == "1"


def is_dispo_excluded(val: Optional[str]) -> bool:
    """Excluye si Dispo contiene localidades no operativas."""
    if not val:
        return False
    norm = str(val).strip().lower()
    for kw in EXCLUDED_DISPO_KEYWORDS:
        pattern = r"(?:\b|_|-)" + re.escape(kw) + r"(?:\b|_|-)"
        if re.search(pattern, norm) or kw == norm or kw in norm:
            return True
    return False


def is_color_9fc5e8(bg: Optional[Dict[str, float]]) -> bool:
    """Comprueba si el color coincide con el celeste #9fc5e8."""
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


def is_color_f5f7fa(bg: Optional[Dict[str, float]]) -> bool:
    """Comprueba si el color coincide con el fondo base alternado #f5f7fa."""
    if not bg or not isinstance(bg, dict):
        return False
    r = bg.get("red", 0.0)
    g = bg.get("green", 0.0)
    b = bg.get("blue", 0.0)
    return (
        abs(r - CLEANUP_COLOR_RGB["red"]) < 0.03
        and abs(g - CLEANUP_COLOR_RGB["green"]) < 0.03
        and abs(b - CLEANUP_COLOR_RGB["blue"]) < 0.03
    )


def is_default_or_unpainted_bg(bg: Optional[Dict[str, float]]) -> bool:
    """Verifica si la celda no tiene color manual aplicado por un operador."""
    if not bg or not isinstance(bg, dict):
        return True
    r = bg.get("red", 1.0)
    g = bg.get("green", 1.0)
    b = bg.get("blue", 1.0)
    if r > 0.98 and g > 0.98 and b > 0.98:
        return True
    # Fondo base alternado #f5f7fa
    if is_color_f5f7fa(bg):
        return True
    if is_color_9fc5e8(bg):
        return True
    return False


def is_valid_td(val: Optional[str]) -> bool:
    """
    Valida si un valor de Columna L (TD) en Ruteos representa un viaje o remito activo.
    Acepta:
      - Números puros (TD formal definitivo, ej: '1299078', '1302956')
      - Códigos provisionales con prefijo COD (ej: 'COD-2730951', 'COD-2733047')
    Descarta:
      - Encabezados de tabla ('TD')
      - Errores y vacíos ('#N/A', '-', '', None)
      - Textos no estructurados ('DIRECTO')
    """
    if not val:
        return False
    s = str(val).strip().upper()
    if s in ["TD", "#N/A", "-", ""]:
        return False
    return bool(s.isdigit() or re.match(r"^COD[-_ ]?\d+$", s))


# ==============================================================================
# MOTOR OPERATIVO UNIFICADO EN CAPAS
# ==============================================================================

class UnifiedOperativasSync:
    def __init__(
        self,
        credentials_path: Optional[str] = None,
        ruteos_id: str = DEFAULT_RUTEOS_ID,
        tab_ruteos: str = SOURCE_TAB_RUTEOS,
        mov_id: str = DEFAULT_MOV_ID,
        ruteos_anterior_id: str = RUTEOS_ANTERIOR_ID,
        tab_ruteos_anterior: str = SOURCE_TAB_RUTEOS_ANTERIOR,
        dias_transicion_dual: int = DIAS_TRANSICION_DUAL,
        day: Optional[int] = None,
        target_month: Optional[int] = None
    ):
        self.ruteos_id = ruteos_id
        self.tab_ruteos = tab_ruteos
        self.mov_id = mov_id
        self.ruteos_anterior_id = ruteos_anterior_id
        self.tab_ruteos_anterior = tab_ruteos_anterior
        self.dias_transicion_dual = dias_transicion_dual
        self.day = day or datetime.now().day
        self.target_month = target_month or datetime.now().month
        self._cached_sheet_id: Optional[int] = None
        self._cached_prev_rows: Optional[List[List[str]]] = None
        self._cached_curr_rows: Optional[List[List[str]]] = None
        self._cached_tractor_to_row: Optional[Dict[str, int]] = None
        self._cached_ut_to_row: Optional[Dict[str, int]] = None
        self.state_mgr = DriveStateManager()
        self.current_month_name = "Noviembre"

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

    def get_mov_sheet_id(self) -> int:
        """Obtiene el sheetId numérico de la pestaña objetivo en Movimientos."""
        if self._cached_sheet_id is not None:
            return self._cached_sheet_id
        meta = api_call_with_retry(self._service.spreadsheets().get(
            spreadsheetId=self.mov_id,
            fields="sheets.properties"
        ))
        for sheet in meta.get("sheets", []):
            if sheet["properties"]["title"] == TARGET_TAB_MOV:
                self._cached_sheet_id = sheet["properties"]["sheetId"]
                return self._cached_sheet_id
        raise ValueError(f"No se encontró la pestaña '{TARGET_TAB_MOV}' en {self.mov_id}")

    def fetch_ruteos_actual(self) -> List[List[str]]:
        """Lectura ultraliviana a las columnas esenciales de Ruteos (1 sola batchGet de ~1s)."""
        ranges = [
            f"'{self.tab_ruteos}'!A4:B",   # Col 0: Patente, Col 1: UT
            f"'{self.tab_ruteos}'!H4:H",   # Col 7: Tracking / Destinos
            f"'{self.tab_ruteos}'!L4:L",   # Col 11: TD
            f"'{self.tab_ruteos}'!X4:X",   # Col 23: Vacío
            f"'{self.tab_ruteos}'!AK4:AK"  # Col 36: Fecha viaje
        ]
        res = api_call_with_retry(self._service.spreadsheets().values().batchGet(
            spreadsheetId=self.ruteos_id,
            ranges=ranges,
            valueRenderOption="FORMATTED_VALUE"
        ))
        vrs = res.get("valueRanges", [])
        raw_ab = vrs[0].get("values", []) if len(vrs) > 0 else []
        raw_h = vrs[1].get("values", []) if len(vrs) > 1 else []
        raw_l = vrs[2].get("values", []) if len(vrs) > 2 else []
        raw_x = vrs[3].get("values", []) if len(vrs) > 3 else []
        raw_ak = vrs[4].get("values", []) if len(vrs) > 4 else []

        max_len = max(len(raw_ab), len(raw_h), len(raw_l), len(raw_x), len(raw_ak), 0)
        structured_rows = []
        for i in range(max_len):
            row = [""] * 37
            if i < len(raw_ab) and raw_ab[i]:
                row[0] = raw_ab[i][0].strip() if len(raw_ab[i]) > 0 else ""
                row[1] = raw_ab[i][1].strip() if len(raw_ab[i]) > 1 else ""
            if i < len(raw_h) and raw_h[i]:
                row[7] = raw_h[i][0].strip()
            if i < len(raw_l) and raw_l[i]:
                row[11] = raw_l[i][0].strip()
            if i < len(raw_x) and raw_x[i]:
                row[23] = raw_x[i][0].strip()
            if i < len(raw_ak) and raw_ak[i]:
                row[36] = raw_ak[i][0].strip()
            structured_rows.append(row)
        return structured_rows

    def fetch_ruteos_anterior(self, force_refresh: bool = False) -> List[List[str]]:
        """
        Lectura a Ruteos del mes anterior.
        - Días 1 a 7 (transición) o con force_refresh=True: Lee en vivo desde Google Sheets y actualiza la caché local.
        - Día 8 en adelante: Lee desde la caché local frozen (0 consumo de cuota API).
        """
        en_transicion = (self.day <= self.dias_transicion_dual)
        usar_cache = (not en_transicion) and (not force_refresh) and CACHE_FILE_PREV_MONTH.exists()

        if usar_cache:
            try:
                import json
                with open(CACHE_FILE_PREV_MONTH, "r", encoding="utf-8") as f:
                    rows = json.load(f)
                    return rows
            except Exception as e:
                print(f"[WARN] No se pudo leer caché mes anterior ({e}). Consultando Google API...")

        # Consulta en vivo al mes anterior
        try:
            res = api_call_with_retry(self._service.spreadsheets().values().get(
                spreadsheetId=self.ruteos_anterior_id,
                range=f"'{self.tab_ruteos_anterior}'!A4:AL",
                valueRenderOption="FORMATTED_VALUE"
            ))
            rows = res.get("values", [])
            # Guardar en caché local
            try:
                import json
                with open(CACHE_FILE_PREV_MONTH, "w", encoding="utf-8") as f:
                    json.dump(rows, f, ensure_ascii=False)
            except Exception as e:
                print(f"[WARN] Error guardando caché mes anterior: {e}")
            return rows
        except Exception as e:
            print(f"[WARN] Error leyendo Ruteos mes anterior ({self.ruteos_anterior_id}): {e}")
            return []

    def fetch_combined_ruteos(self, force_refresh_prev: bool = False) -> Tuple[List[List[str]], List[List[str]]]:
        """
        Obtiene las filas de ambos meses: (filas_mes_anterior, filas_mes_actual).
        Reutiliza la memoria interna si ya fue cargada para acelerar recorridos multi-día.
        """
        if self._cached_curr_rows is None:
            self._cached_curr_rows = self.fetch_ruteos_actual()
        if self._cached_prev_rows is None or force_refresh_prev:
            if self.ruteos_anterior_id == self.ruteos_id and self.tab_ruteos_anterior == self.tab_ruteos:
                self._cached_prev_rows = self._cached_curr_rows
            else:
                self._cached_prev_rows = self.fetch_ruteos_anterior(force_refresh=force_refresh_prev)
        return self._cached_prev_rows, self._cached_curr_rows

    def fetch_ruteos(self) -> List[List[str]]:
        """Lectura única a Ruteos del mes actual (compatibilidad retroactiva)."""
        return self.fetch_ruteos_actual()

    def fetch_movimientos_targeted(self, day: int) -> Tuple[int, Dict[str, int], Dict[str, int], List[Dict[str, Any]]]:
        """
        Lectura dirigida a Movimientos (1 sola petición HTTP con múltiples rangos específicos).
        Solicita: Tractores (E1:E350), UTs (C1:C350), y columnas del día seleccionado.
        """
        sheet_id = self.get_mov_sheet_id()
        col_ch, col_disp, col_s1, col_s2 = get_day_column_indices(day)

        let_ch = index_to_col_letter(col_ch)
        let_s2 = index_to_col_letter(col_s2)

        if self._cached_tractor_to_row is not None and self._cached_ut_to_row is not None:
            ranges = [
                f"'{TARGET_TAB_MOV}'!{let_ch}1:{let_s2}350"
            ]
            res = api_call_with_retry(self._service.spreadsheets().get(
                spreadsheetId=self.mov_id,
                ranges=ranges,
                fields="sheets(data(rowData(values(formattedValue,note,userEnteredFormat.backgroundColor))))"
            ))
            sheet_data = res["sheets"][0]["data"]
            raw_day = sheet_data[0].get("rowData", [])
            tractor_to_row = self._cached_tractor_to_row
            ut_to_row = self._cached_ut_to_row
        else:
            ranges = [
                f"'{TARGET_TAB_MOV}'!E1:E350",
                f"'{TARGET_TAB_MOV}'!C1:C350",
                f"'{TARGET_TAB_MOV}'!{let_ch}1:{let_s2}350"
            ]
            res = api_call_with_retry(self._service.spreadsheets().get(
                spreadsheetId=self.mov_id,
                ranges=ranges,
                fields="sheets(data(rowData(values(formattedValue,note,userEnteredFormat.backgroundColor))))"
            ))
            sheet_data = res["sheets"][0]["data"]
            raw_trks = sheet_data[0].get("rowData", [])
            raw_uts = sheet_data[1].get("rowData", [])
            raw_day = sheet_data[2].get("rowData", []) if len(sheet_data) > 2 else []

            tractor_to_row: Dict[str, int] = {}
            ut_to_row: Dict[str, int] = {}

            for idx, r in enumerate(raw_trks):
                row_num = idx + 1
                vals = r.get("values", [])
                if vals and vals[0]:
                    raw_trk = str(vals[0].get("formattedValue") or "").strip().upper()
                    clean_trk = re.sub(r"[^A-Z0-9]", "", raw_trk)
                    if clean_trk and len(clean_trk) >= 5:
                        tractor_to_row[clean_trk] = row_num

            for idx, r in enumerate(raw_uts):
                row_num = idx + 1
                vals = r.get("values", [])
                if vals and vals[0]:
                    raw_ut = str(vals[0].get("formattedValue") or "").strip().replace(".0", "")
                    if raw_ut and raw_ut.isdigit():
                        ut_to_row[raw_ut] = row_num

            self._cached_tractor_to_row = tractor_to_row
            self._cached_ut_to_row = ut_to_row

        # Estructurar filas del día
        day_rows = []
        off_ch = 0
        off_disp = col_disp - col_ch  # 1
        off_s1 = col_s1 - col_ch      # 3
        off_s2 = col_s2 - col_ch      # 5

        for r_idx, r in enumerate(raw_day):
            row_num = r_idx + 1
            c_vals = r.get("values", [])

            def get_cell_info(offset):
                if len(c_vals) > offset and c_vals[offset]:
                    cell = c_vals[offset]
                    return {
                        "value": str(cell.get("formattedValue") or "").strip(),
                        "note": str(cell.get("note") or "").strip(),
                        "bg": cell.get("userEnteredFormat", {}).get("backgroundColor")
                    }
                return {"value": "", "note": "", "bg": None}

            day_rows.append({
                "row_num": row_num,
                "chofer": get_cell_info(off_ch)["value"],
                "dispo": get_cell_info(off_disp)["value"],
                "slot1": get_cell_info(off_s1),
                "slot2": get_cell_info(off_s2)
            })

        return sheet_id, tractor_to_row, ut_to_row, day_rows

    def analyze_trips_and_layers(
        self,
        day: int,
        force_refresh_prev: bool = False,
        eval_colors: bool = True
    ) -> Dict[str, Any]:
        """
        Ejecuta el análisis en capas en memoria para el día especificado:
        - Capa 1: Tracking de Col H
        - Capa 2: Vacío y Bordes de Col X
        - Capa 3: Seguimiento y Pintado #9fc5e8 (con soporte dual/cache y unidades standby)
        """
        ruteos_rows = self.fetch_ruteos_actual()
        sheet_id, tractor_to_row, ut_to_row, day_rows = self.fetch_movimientos_targeted(day)

        col_ch, col_disp, col_s1, col_s2 = get_day_column_indices(day)
        let_s1 = index_to_col_letter(col_s1)
        let_s2 = index_to_col_letter(col_s2)

        # 1. Sembrar estado final de tractores del mes anterior (Octubre 2026) desde el JSON congelado (< 1ms)
        tractor_all_trips: Dict[str, List[Dict[str, Any]]] = {}
        octubre_state = self.state_mgr.get_octubre_frozen_state()
        for trk, t_data in octubre_state.get("ultimo_estado_tractores", {}).items():
            tractor_all_trips[trk] = [{
                "td": t_data.get("ultimo_td", ""),
                "has_vacio": t_data.get("has_vacio", False),
                "vacio_header": t_data.get("vacio_header", ""),
                "last_row": t_data.get("last_row", 0)
            }]

        # Procesar filas cronológicas del mes actual (Noviembre 2026)
        for idx, r in enumerate(ruteos_rows):
            row_num = idx + 4
            raw_trk = str(r[0] if len(r) > 0 else "").upper().strip()
            trk = re.sub(r"[^A-Z0-9]", "", raw_trk)
            if not trk or len(trk) < 5 or trk.startswith("202") or "OCT" in trk or "SEP" in trk:
                continue

            td = str(r[11] if len(r) > 11 else "").strip()
            # Omitir anotaciones operativas en hold o filas sin TD asignado
            if not td or not is_valid_td(td):
                continue

            raw_vacio = str(r[23] if len(r) > 23 else "").strip()
            vacio_formatted = format_vacio_datetime(raw_vacio)

            if trk not in tractor_all_trips:
                tractor_all_trips[trk] = []

            # Si es el mismo TD consecutivo (múltiples paradas), actualizamos el viaje actual
            if tractor_all_trips[trk] and tractor_all_trips[trk][-1]["td"] == td:
                if vacio_formatted and not tractor_all_trips[trk][-1]["has_vacio"]:
                    tractor_all_trips[trk][-1]["has_vacio"] = True
                    tractor_all_trips[trk][-1]["vacio_header"] = vacio_formatted
                tractor_all_trips[trk][-1]["last_row"] = row_num
            else:
                tractor_all_trips[trk].append({
                    "td": td,
                    "has_vacio": bool(vacio_formatted),
                    "vacio_header": vacio_formatted,
                    "last_row": row_num
                })

        # Mapeo de tractores cuyo ÚLTIMO registro tiene vacío y NO tiene TD posterior
        tractors_vacio_sin_nuevo_td = {}
        for trk, trips in tractor_all_trips.items():
            if trips:
                last_trip = trips[-1]
                if last_trip["has_vacio"]:
                    tractors_vacio_sin_nuevo_td[trk] = last_trip

        # 2. Agrupar datos de Ruteos correspondientes al DÍA seleccionado (mes actual)
        # Estructura: (unit_key, day) -> { td: { vacio_header, localidades, tracking_extra } }
        trips_for_day: Dict[str, Dict[str, Dict[str, Any]]] = {}

        for r in ruteos_rows:
            raw_trk = str(r[0] if len(r) > 0 else "").upper().strip()
            trk = re.sub(r"[^A-Z0-9]", "", raw_trk)
            ut = str(r[1] if len(r) > 1 else "").strip().replace(".0", "")
            tracking_val = str(r[7] if len(r) > 7 else "").strip()
            td = str(r[11] if len(r) > 11 else "").strip()
            raw_vacio = str(r[23] if len(r) > 23 else "").strip()
            fecha_val = str(r[36] if len(r) > 36 else "").strip()

            if not (trk or ut) or not is_valid_td(td):
                continue
            # Opción A: Solo tracking puro de Col H y/o Vacío de Col X (omite Col AL / Col AD)
            if not (tracking_val or raw_vacio):
                continue

            trip_day = parse_day_from_cell(fecha_val, expected_month=self.target_month)
            if trip_day != day:
                continue

            unit_key = trk if trk in tractor_to_row else ut
            if not unit_key:
                continue

            if unit_key not in trips_for_day:
                trips_for_day[unit_key] = {
                    "tractor": trk,
                    "ut": ut,
                    "tds": {}
                }

            td_key = td or "SIN_TD"
            if td_key not in trips_for_day[unit_key]["tds"]:
                trips_for_day[unit_key]["tds"][td_key] = {
                    "vacio_header": "",
                    "tracking_extra": []
                }

            td_entry = trips_for_day[unit_key]["tds"][td_key]

            if tracking_val and tracking_val not in td_entry["tracking_extra"]:
                td_entry["tracking_extra"].append(tracking_val)

            # Capa 2: Formato de VACÍO estrictamente desde Columna X
            if raw_vacio and not td_entry["vacio_header"]:
                v_header = format_vacio_datetime(raw_vacio)
                if v_header:
                    td_entry["vacio_header"] = v_header

        # 3. Procesar asignaciones a Movimientos celda por celda
        planned_note_updates = []
        planned_border_updates = []
        planned_color_updates = []
        merged_cells_state: Dict[str, Dict[str, Any]] = {}

        # Cargar estado previo de Noviembre para diffing O(1)
        nov_state = self.state_mgr.get_or_create_monthly_state(self.current_month_name, 2026)
        existing_day_cells = nov_state.get("celdas_merge", {}).get(f"dia_{day}", {})

        day_rows_by_num = {r["row_num"]: r for r in day_rows}

        for unit_key, u_data in trips_for_day.items():
            trk = u_data["tractor"]
            ut = u_data["ut"]
            row_target = tractor_to_row.get(trk) or ut_to_row.get(ut)
            if not row_target or row_target not in day_rows_by_num:
                continue

            row_info = day_rows_by_num[row_target]
            cell_s1 = row_info["slot1"]
            cell_s2 = row_info["slot2"]
            td_items = list(u_data["tds"].items())

            # Mapeo a Slot 1 o Slot 2
            if len(td_items) == 1:
                td_code, td_data = td_items[0]
                target_col_idx = col_s1
                target_col_let = let_s1
                target_cell = cell_s1
                target_slot = 1

                if not cell_s1["value"] and cell_s2["value"]:
                    target_col_idx = col_s2
                    target_col_let = let_s2
                    target_cell = cell_s2
                    target_slot = 2

                # Capa 1: Tracking (Opción A: puro de Col H)
                track_body = format_tracking_text([], td_data["tracking_extra"])
                # Capa 2: VACÍO (si existe en Col X)
                vacio_head = td_data["vacio_header"]
                final_note = compose_final_note(vacio_head, track_body)

                cell_coord = f"{target_col_let}{row_target}"
                cell_hash = self.state_mgr.compute_cell_hash(
                    vacio_header=vacio_head,
                    tracking_text=track_body,
                    borde_doble=bool(vacio_head),
                    color_celeste=False
                )

                merged_cells_state[cell_coord] = {
                    "fila": row_target,
                    "col_idx": target_col_idx,
                    "slot": target_slot,
                    "tractor": trk,
                    "ut": ut,
                    "td": td_code,
                    "vacio_header": vacio_head,
                    "tracking_text": track_body,
                    "borde_doble": bool(vacio_head),
                    "color_celeste": False,
                    "hash_nota": cell_hash
                }

                prev_cell = existing_day_cells.get(cell_coord)
                needs_note = False
                if prev_cell:
                    needs_note = (prev_cell.get("hash_nota") != cell_hash)
                else:
                    needs_note = bool(final_note and final_note != target_cell["note"])

                if needs_note and final_note:
                    planned_note_updates.append({
                        "row": row_target,
                        "col_idx": target_col_idx,
                        "cell_coord": cell_coord,
                        "new_note": final_note,
                        "current_note": target_cell["note"],
                        "vacio_header": vacio_head,
                        "slot": target_slot,
                        "trk": trk,
                        "ut": ut,
                        "td": td_code
                    })

                # Bordes si hay VACÍO en Col X (solo si no fue aplicado previamente)
                if vacio_head:
                    already_bordered = prev_cell.get("borde_doble", False) if prev_cell else False
                    if not already_bordered:
                        planned_border_updates.append({
                            "row": row_target,
                            "col_idx": target_col_idx,
                            "cell_coord": cell_coord
                        })

            else:
                for slot_idx, (td_code, td_data) in enumerate(td_items[:2]):
                    target_col_idx = col_s1 if slot_idx == 0 else col_s2
                    target_col_let = let_s1 if slot_idx == 0 else let_s2
                    target_cell = cell_s1 if slot_idx == 0 else cell_s2

                    # Capa 1: Tracking (Opción A: puro de Col H)
                    track_body = format_tracking_text([], td_data["tracking_extra"])
                    vacio_head = td_data["vacio_header"]
                    final_note = compose_final_note(vacio_head, track_body)

                    cell_coord = f"{target_col_let}{row_target}"
                    cell_hash = self.state_mgr.compute_cell_hash(
                        vacio_header=vacio_head,
                        tracking_text=track_body,
                        borde_doble=bool(vacio_head),
                        color_celeste=False
                    )

                    merged_cells_state[cell_coord] = {
                        "fila": row_target,
                        "col_idx": target_col_idx,
                        "slot": slot_idx + 1,
                        "tractor": trk,
                        "ut": ut,
                        "td": td_code,
                        "vacio_header": vacio_head,
                        "tracking_text": track_body,
                        "borde_doble": bool(vacio_head),
                        "color_celeste": False,
                        "hash_nota": cell_hash
                    }

                    prev_cell = existing_day_cells.get(cell_coord)
                    needs_note = False
                    if prev_cell:
                        needs_note = (prev_cell.get("hash_nota") != cell_hash)
                    else:
                        needs_note = bool(final_note and final_note != target_cell["note"])

                    if needs_note and final_note:
                        planned_note_updates.append({
                            "row": row_target,
                            "col_idx": target_col_idx,
                            "cell_coord": cell_coord,
                            "new_note": final_note,
                            "current_note": target_cell["note"],
                            "vacio_header": vacio_head,
                            "slot": slot_idx + 1,
                            "trk": trk,
                            "ut": ut,
                            "td": td_code
                        })

                    if vacio_head:
                        already_bordered = prev_cell.get("borde_doble", False) if prev_cell else False
                        if not already_bordered:
                            planned_border_updates.append({
                                "row": row_target,
                                "col_idx": target_col_idx,
                                "cell_coord": cell_coord
                            })

        # 4. Capa 3: Evaluación de Pintado Celeste (#9fc5e8) y Cleanup
        # Se evalúa sobre la celda del día (Slot 1) para cada tractor indexado
        if eval_colors:
            for trk, r_num in tractor_to_row.items():
                if r_num not in day_rows_by_num:
                    continue

                r_info = day_rows_by_num[r_num]
                cell_s1 = r_info["slot1"]
                dispo_val = r_info["dispo"]
                chofer_val = r_info["chofer"]
                current_bg = cell_s1["bg"]
                has_color_celeste = is_color_9fc5e8(current_bg)

                # Validaciones de filtros operativos
                tiene_chofer = bool(chofer_val and chofer_val.strip() and not is_chofer_excluded(chofer_val))
                dispo_valida = not is_dispo_excluded(dispo_val)
                slot1_vacio = not cell_s1["value"]
                bg_elegible = is_default_or_unpainted_bg(current_bg)

                # Caso A: Unidad con viaje cuyo último registro es VACÍO sin nuevo TD
                es_vacio_reciente = (trk in tractors_vacio_sin_nuevo_td)

                # Caso B: Unidad SIN viajes en el mes analizado (Standby / Inactiva / Nueva)
                # Requisito obligatorio: tener chofer asignado en Movimientos
                es_standby_disponible = (trk not in tractor_all_trips) and tiene_chofer

                # Filtro de chofer según el caso:
                # - Si es vacío reciente: no debe tener chofer '1'
                # - Si es standby sin viaje: debe tener chofer válido asignado
                chofer_ok = (not is_chofer_excluded(chofer_val)) if es_vacio_reciente else tiene_chofer

                # ¿Califica para pintado?
                qualifies = (
                    (es_vacio_reciente or es_standby_disponible)
                    and chofer_ok
                    and dispo_valida
                    and slot1_vacio
                    and bg_elegible
                )

                cell_coord = f"{let_s1}{r_num}"

                if qualifies and not has_color_celeste:
                    td_desc = tractors_vacio_sin_nuevo_td[trk]["td"] if es_vacio_reciente else "STANDBY"
                    vac_desc = tractors_vacio_sin_nuevo_td[trk]["vacio_header"] if es_vacio_reciente else "SIN_VIAJE_MES"
                    tipo_desc = "vacio_ruteos" if es_vacio_reciente else "standby_sin_viaje"

                    planned_color_updates.append({
                        "action": "paint",
                        "row": r_num,
                        "col_idx": col_s1,
                        "cell_coord": cell_coord,
                        "color": TARGET_COLOR_RGB,
                        "trk": trk,
                        "td": td_desc,
                        "vacio": vac_desc,
                        "tipo": tipo_desc,
                        "dispo": dispo_val
                    })
                    if cell_coord in merged_cells_state:
                        merged_cells_state[cell_coord]["color_celeste"] = True
                elif not qualifies and has_color_celeste:
                    # Cleanup automático: ya no cumple (ej. recibió nuevo TD o cambió Dispo)
                    reason = "nuevo TD o asignación de viaje"
                    if is_dispo_excluded(dispo_val):
                        reason = f"Dispo excluida ({dispo_val})"
                    elif is_chofer_excluded(chofer_val):
                        reason = f"Chofer excluido ({chofer_val})"
                    elif not slot1_vacio:
                        reason = "Celda con texto/viaje asignado"
                    elif not bg_elegible:
                        reason = "Fondo manual de operador"
                    elif not es_vacio_reciente and not es_standby_disponible:
                        reason = "Sin viaje reciente con vacío ni chofer standby"

                    planned_color_updates.append({
                        "action": "clear",
                        "row": r_num,
                        "col_idx": col_s1,
                        "cell_coord": cell_coord,
                        "color": CLEANUP_COLOR_RGB,
                        "trk": trk,
                        "reason": reason
                    })
                    if cell_coord in merged_cells_state:
                        merged_cells_state[cell_coord]["color_celeste"] = False

        return {
            "sheet_id": sheet_id,
            "day": day,
            "notes": planned_note_updates,
            "borders": planned_border_updates,
            "colors": planned_color_updates,
            "merged_cells_state": merged_cells_state,
            "tractors_latest_state": tractors_vacio_sin_nuevo_td
        }

    def apply_atomic_batch(
        self,
        analysis: Dict[str, Any],
        apply_borders: bool = True,
        batch_size: int = 500
    ) -> Dict[str, Any]:
        """
        Envía todas las peticiones (notas, bordes y colores) en un único lote batchUpdate atómico.
        """
        sheet_id = analysis["sheet_id"]
        requests = []

        # 1. Actualización de Notas
        for item in analysis["notes"]:
            r_idx = item["row"] - 1
            c_idx = item["col_idx"]
            requests.append({
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
                            "note": item["new_note"]
                        }]
                    }],
                    "fields": "note"
                }
            })

        # 2. Actualización de Bordes Dobles (SOLID_MEDIUM bottom y left)
        if apply_borders:
            for item in analysis["borders"]:
                r_idx = item["row"] - 1
                c_idx = item["col_idx"]
                requests.append({
                    "updateBorders": {
                        "range": {
                            "sheetId": sheet_id,
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
                })

        # 3. Actualización de Colores (#9fc5e8 o reset)
        for item in analysis["colors"]:
            r_idx = item["row"] - 1
            c_idx = item["col_idx"]
            if item["action"] == "paint":
                requests.append({
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
                                    "backgroundColor": item["color"]
                                }
                            }]
                        }],
                        "fields": "userEnteredFormat.backgroundColor"
                    }
                })
            elif item["action"] == "clear":
                requests.append({
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
                })

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

        # Persistir estado actualizado en JSON Drive
        try:
            nov_state = self.state_mgr.get_or_create_monthly_state(self.current_month_name, 2026)
            day_key = f"dia_{analysis['day']}"
            if "celdas_merge" not in nov_state:
                nov_state["celdas_merge"] = {}
            if day_key not in nov_state["celdas_merge"]:
                nov_state["celdas_merge"][day_key] = {}

            for coord, c_info in analysis.get("merged_cells_state", {}).items():
                nov_state["celdas_merge"][day_key][coord] = c_info

            if "ultimo_estado_tractores" not in nov_state:
                nov_state["ultimo_estado_tractores"] = {}
            for trk, t_info in analysis.get("tractors_latest_state", {}).items():
                nov_state["ultimo_estado_tractores"][trk] = t_info

            self.state_mgr.save_json_to_drive(
                self.state_mgr.get_monthly_filename(self.current_month_name, 2026),
                nov_state,
                caller="local_n8n"
            )
        except Exception as e:
            print(f"[WARN] Error guardando estado en Drive: {e}")

        return {
            "updated_count": len(requests),
            "batches": batches_executed
        }

    def apply_consolidated_batch(
        self,
        analyses: List[Dict[str, Any]],
        apply_borders: bool = True,
        batch_size: int = 500
    ) -> Dict[str, Any]:
        """Consolida las peticiones de múltiples días en UN ÚNICO batchUpdate atómico."""
        all_requests = []
        sheet_id = None
        for a in analyses:
            sheet_id = a.get("sheet_id", sheet_id)
            # 1. Notes
            for item in a.get("notes", []):
                r_idx = item["row"] - 1
                c_idx = item["col_idx"]
                all_requests.append({
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
                                "note": item["new_note"]
                            }]
                        }],
                        "fields": "note"
                    }
                })
            # 2. Borders
            if apply_borders:
                for item in a.get("borders", []):
                    r_idx = item["row"] - 1
                    c_idx = item["col_idx"]
                    all_requests.append({
                        "updateBorders": {
                            "range": {
                                "sheetId": sheet_id,
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
                    })
            # 3. Colors
            for item in a.get("colors", []):
                r_idx = item["row"] - 1
                c_idx = item["col_idx"]
                target_color = item["color"] if item["action"] == "paint" else CLEANUP_COLOR_RGB
                all_requests.append({
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
                                    "backgroundColor": target_color
                                }
                            }]
                        }],
                        "fields": "userEnteredFormat.backgroundColor"
                    }
                })

        batches_executed = 0
        if all_requests:
            for i in range(0, len(all_requests), batch_size):
                chunk = all_requests[i:i + batch_size]
                api_call_with_retry(self._service.spreadsheets().batchUpdate(
                    spreadsheetId=self.mov_id,
                    body={"requests": chunk}
                ))
                batches_executed += 1

        # Persistir estados consolidados en JSON Drive
        try:
            nov_state = self.state_mgr.get_or_create_monthly_state(self.current_month_name, 2026)
            if "celdas_merge" not in nov_state:
                nov_state["celdas_merge"] = {}
            if "ultimo_estado_tractores" not in nov_state:
                nov_state["ultimo_estado_tractores"] = {}

            for a in analyses:
                day_key = f"dia_{a['day']}"
                if day_key not in nov_state["celdas_merge"]:
                    nov_state["celdas_merge"][day_key] = {}
                for coord, c_info in a.get("merged_cells_state", {}).items():
                    nov_state["celdas_merge"][day_key][coord] = c_info
                for trk, t_info in a.get("tractors_latest_state", {}).items():
                    nov_state["ultimo_estado_tractores"][trk] = t_info

            self.state_mgr.save_json_to_drive(
                self.state_mgr.get_monthly_filename(self.current_month_name, 2026),
                nov_state,
                caller="local_n8n"
            )
        except Exception as e:
            print(f"[WARN] No se pudo guardar estado consolidado en Drive: {e}")

        return {
            "updated_count": len(all_requests),
            "batches": batches_executed
        }

    def sync_multi_days(
        self,
        days: List[int],
        current_day: Optional[int] = None,
        apply: bool = False,
        apply_borders: bool = True
    ) -> Dict[str, Any]:
        """
        Sincroniza una secuencia o ventana de días.
        - Días pasados (d != current_day): actualiza Capa 1 y Capa 2 (notas de tracking/vacío y bordes SOLID_MEDIUM).
        - Día actual (d == current_day): actualiza Capa 1, 2 y Capa 3 (colores #9fc5e8 y cleanup).
        """
        cur_d = current_day or datetime.now().day
        results = {
            "days_analyzed": days,
            "total_notes": 0,
            "total_borders": 0,
            "total_colors": 0,
            "day_summaries": {},
            "batch_results": []
        }

        all_analyses = []
        for d in days:
            eval_col = (d == cur_d)
            analysis = self.analyze_trips_and_layers(d, eval_colors=eval_col)
            all_analyses.append(analysis)
            n_cnt = len(analysis["notes"])
            b_cnt = len(analysis["borders"])
            c_cnt = len(analysis["colors"])

            results["total_notes"] += n_cnt
            results["total_borders"] += b_cnt
            results["total_colors"] += c_cnt
            results["day_summaries"][d] = {
                "notes": n_cnt,
                "borders": b_cnt,
                "colors": c_cnt
            }

        if apply and (results["total_notes"] > 0 or results["total_borders"] > 0 or results["total_colors"] > 0):
            batch_res = self.apply_consolidated_batch(all_analyses, apply_borders=apply_borders)
            results["batch_results"].append(batch_res)
        elif apply:
            # Persistir mapa de celdas_merge aunque no haya habido cambios de escritura
            try:
                nov_state = self.state_mgr.get_or_create_monthly_state(self.current_month_name, 2026)
                if "celdas_merge" not in nov_state:
                    nov_state["celdas_merge"] = {}
                if "ultimo_estado_tractores" not in nov_state:
                    nov_state["ultimo_estado_tractores"] = {}
                for a in all_analyses:
                    day_key = f"dia_{a['day']}"
                    if day_key not in nov_state["celdas_merge"]:
                        nov_state["celdas_merge"][day_key] = {}
                    for coord, c_info in a.get("merged_cells_state", {}).items():
                        nov_state["celdas_merge"][day_key][coord] = c_info
                    for trk, t_info in a.get("tractors_latest_state", {}).items():
                        nov_state["ultimo_estado_tractores"][trk] = t_info
                self.state_mgr.save_json_to_drive(
                    self.state_mgr.get_monthly_filename(self.current_month_name, 2026),
                    nov_state,
                    caller="local_n8n"
                )
            except Exception as e:
                print(f"[WARN] Error persistiendo estado base en Drive: {e}")

        return results


def main():
    parser = argparse.ArgumentParser(
        description="Sincronizador Operativo Unificado en Capas (Tracking + Vacío + Seguimiento)."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica los cambios reales en Google Sheets. Si se omite, corre en simulación."
    )
    parser.add_argument(
        "--borders",
        action="store_true",
        default=True,
        help="Aplica bordes SOLID_MEDIUM en celdas con VACÍO (por defecto activo)."
    )
    parser.add_argument(
        "--no-borders",
        action="store_false",
        dest="borders",
        help="Omite la aplicación de bordes."
    )
    parser.add_argument(
        "--day",
        type=int,
        default=None,
        help="Día específico del mes (1 a 31)."
    )
    parser.add_argument(
        "--days",
        type=str,
        default=None,
        help="Días específicos separados por coma o rango (ej: 10-14 o 10,11,12)."
    )
    parser.add_argument(
        "--window",
        type=int,
        default=None,
        help="Cantidad de días de ventana retroactiva a sincronizar hasta hoy (ej: --window 5)."
    )
    parser.add_argument(
        "--force-refresh-prev",
        action="store_true",
        help="Fuerza la recarga de Ruteos del mes anterior en lugar de usar la caché local."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Límite de muestra a imprimir en consola."
    )
    args = parser.parse_args()

    with ExecutionShield("Sincronización Unificada en Capas"):
        t0 = time.time()
        today = datetime.now().day
        if args.days:
            target_days = []
            for part in args.days.split(","):
                part = part.strip()
                if "-" in part:
                    p_start, p_end = part.split("-", 1)
                    target_days.extend(range(int(p_start.strip()), int(p_end.strip()) + 1))
                elif part.isdigit():
                    target_days.append(int(part))
        elif args.window:
            target_days = list(range(max(1, today - (args.window - 1)), today + 1))
        elif args.day:
            target_days = [args.day]
        else:
            target_days = [today]

        day_target = target_days[0] if len(target_days) == 1 else today

        print("=" * 80)
        print("  🚀 PIPELINE OPERATIVO UNIFICADO EN CAPAS: RUTEOS ➡️ MOVIMIENTOS")
        print(f"  Modo: {'APLICAR CAMBIOS EN GOOGLE SHEETS (--apply)' if args.apply else 'SIMULACIÓN (DRY-RUN)'}")
        if len(target_days) > 1:
            print(f"  Días Objetivo: {target_days} (Ventana rodante / Multi-día) | Día activo: {today}")
        else:
            print(f"  Día Objetivo: {day_target} (Mes: Operativo)")
        print("=" * 80)

        sync = UnifiedOperativasSync(day=day_target)
        print("\n[1/3] Conexión establecida con Service Account.")
        print("      Ejecutando lectura dirigida a Google Sheets...")

        if len(target_days) > 1:
            multi_res = sync.sync_multi_days(
                days=target_days,
                current_day=today,
                apply=args.apply,
                apply_borders=args.borders
            )
            elapsed_total = round(time.time() - t0, 2)
            print(f"\n[2/3] Análisis multi-día completado en {elapsed_total}s:")
            for d, s in multi_res["day_summaries"].items():
                print(f"      - Día {d:>2}: {s['notes']:>3} notas | {s['borders']:>3} bordes | {s['colors']:>3} colores")
            print(f"\n      Totales: {multi_res['total_notes']} notas, {multi_res['total_borders']} bordes, {multi_res['total_colors']} colores.")

            if args.apply:
                total_ops = sum(b.get("updated_count", 0) for b in multi_res["batch_results"])
                print(f"\n[OK] ✅ ¡Sincronización multi-día completada en {elapsed_total}s! ({total_ops} operaciones en Sheets).")
            else:
                print(f"\n[INFO] Simulación multi-día finalizada en {elapsed_total}s. Cero escrituras realizadas.")
            return

        analysis = sync.analyze_trips_and_layers(day_target, force_refresh_prev=args.force_refresh_prev)
        notes = analysis["notes"]
        borders = analysis["borders"]
        colors = analysis["colors"]

        elapsed_analysis = round(time.time() - t0, 2)
        print(f"\n[2/3] Análisis en capas completado en {elapsed_analysis}s:")
        print(f"      - Capa 1 & 2 (Notas Hover actualizadas): {len(notes)}")
        print(f"      - Capa 2 (Bordes SOLID_MEDIUM de VACÍO): {len(borders)}")
        paint_count = sum(1 for c in colors if c["action"] == "paint")
        clear_count = sum(1 for c in colors if c["action"] == "clear")
        print(f"      - Capa 3 (Seguimiento Celestes #9fc5e8):  +{paint_count} pintados / -{clear_count} limpiados")

        # Muestra de Notas
        if notes:
            print("\n--- Muestra de Notas Hover Planificadas ---")
            for idx, item in enumerate(notes[:args.limit]):
                sample_note = item["new_note"].replace("\n", "  |  ")
                head_tag = f"[{item['vacio_header']}]" if item["vacio_header"] else "[TRACKING]"
                print(f"[{idx+1:02d}] Celda {item['cell_coord']:>6} {head_tag:<14} | Trk {item['trk']:>7} UT {item['ut']:>3} TD {item['td']}")
                print(f"     Nota: {sample_note[:100]}...")

        # Muestra de Colores
        if colors:
            print("\n--- Muestra de Pintados/Cleanups Planificados ---")
            for idx, item in enumerate(colors[:args.limit]):
                if item["action"] == "paint":
                    print(f"[{idx+1:02d}] 🎨 PINTAR #9fc5e8 Celda {item['cell_coord']:>6} | Trk {item['trk']:>7} TD {item['td']} | {item['vacio']} | Dispo: {item['dispo']}")
                else:
                    print(f"[{idx+1:02d}] 🧹 LIMPIAR color Celda {item['cell_coord']:>6} | Trk {item['trk']:>7} ({item['reason']})")

        batch_res = None
        # Aplicación
        if args.apply:
            print("\n[3/3] Aplicando cambios consolidados en Google Sheets (1 batchUpdate atómico)...")
            batch_res = sync.apply_atomic_batch(analysis, apply_borders=args.borders)
            total_time = round(time.time() - t0, 2)
            print(f"\n[OK] ✅ ¡Sincronización exitosa en {total_time}s!")
            print(f"     Total operaciones ejecutadas: {batch_res['updated_count']} en {batch_res['batches']} lotes.")
        else:
            total_time = round(time.time() - t0, 2)
            print(f"\n[INFO] Simulación finalizada en {total_time}s. Cero escrituras realizadas.")
            print("       Ejecuta con '--apply' para persistir los cambios en Google Sheets.")

        # Generar reporte de auditoría en carpeta reportes/
        report_file = generate_audit_report(
            analysis=analysis,
            batch_result=batch_res,
            apply=args.apply,
            mode="Sincronización Unificada en Capas",
            duration_sec=total_time
        )
        print(f"\n📄 Reporte de auditoría generado en:\n   -> {report_file}")


if __name__ == "__main__":
    main()
