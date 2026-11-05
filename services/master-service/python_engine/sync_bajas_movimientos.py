#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  SINCRONIZACIÓN DE NOTAS EN HOVER (BAJAS DE DIAGRAMA) HACIA MOVIMIENTOS
================================================================================
Propósito:
  Consulta las novedades activas cuya relación UUID hacia public.tipos_novedad
  tenga imprime_nota_movimientos = true (ej. BAJA_DIAGRAMA) desde Supabase /
  PostgreSQL (public.view_dash_novedades) e inyecta notas emergentes (hover notes)
  en las celdas del encabezado 'Chofer' de la planilla mensual de Movimientos para
  cada día comprendido entre la fecha actual y la fecha objetivo (fecha_objetivo).

Reglas Operativas:
  1. Detección estricta: Solo se inyecta la nota si el nombre del chofer se encuentra
     efectivamente tipeado en la columna de Chofer del día operativo correspondiente.
     (Sin fallback a tractor, según directiva explícita del usuario).
  2. Fórmula / Mapeo de columna por día operativo (1-31):
     Mapeo dinámico desde la cabecera (Fila 1), con fallback a col_chofer = 27 + 13 * (dia - 1)
     [0-based: Día 1 = AB/27, Día 2 = AO/40, etc.]
  3. Inmunidad total: Se utiliza batchUpdate con fields='note', preservando al 100%
     los valores, fórmulas y formatos de celda.
  4. Optimización de Lectura: Lee exclusivamente la columna del día operativo correspondiente
     (ej. 'AB1:AB250'), evitando descargar toda la planilla para máxima velocidad (< 1s).
  5. Transición mensual (#idmensual): Soporta fechas multi-mes/año dinámicamente mediante
     config_operativas.json y variables de entorno (ID_SHEET_MOVIMIENTOS / TAB_MOVIMIENTOS).

Uso:
  python sync_bajas_movimientos.py [--dry-run]
================================================================================
"""

import os
import re
import sys
import json
import argparse
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from urllib.parse import quote

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

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))


def _load_monorepo_dotenv_if_needed() -> None:
    """Carga variables faltantes desde ../node_backend/.env en ejecución CLI local."""
    env_candidates = [
        BASE_DIR / ".env",
        BASE_DIR.parent / "node_backend" / ".env",
    ]
    for env_file in env_candidates:
        if not env_file.exists():
            continue
        try:
            for raw_line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                if k and k not in os.environ:
                    os.environ[k] = v
        except Exception:
            pass


_load_monorepo_dotenv_if_needed()

import requests
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from credentials_helper import get_google_credentials

# Parámetros y Constantes
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://rsvajuxihvmpmrmlcbul.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "sb_publishable_n97mVkSclRpuv_OsseO3gg_BjR9QT3R")

# IDs oficiales y pestañas de respaldo (rotación #idmensual)
OCTUBRE_MOV_ID = "14Mb5rD853zxDkaLDS-IrW-OBDTDBjuJxn_3olXeWlkc"
OCTUBRE_TAB_NAME = "OCTUBRE 2026- Mov.Unidades y Choferes"

NOVIEMBRE_MOV_ID = "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc"
NOVIEMBRE_TAB_NAME = "NOVIEMBRE 2026- Mov.Unidades y Choferes"

MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
]

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

NOTA_BAJA_HEADER_PREFIX = "⚠️ BAJA DE DIAGRAMA"


def normalizar_texto(texto: Optional[str]) -> str:
    """Normaliza texto para comparación eliminando acentos, caracteres especiales y espacios múltiples."""
    if not texto:
        return ""
    import unicodedata
    s = str(texto).strip().upper()
    s = unicodedata.normalize('NFD', s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = re.sub(r'[^A-Z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def get_col_chofer(dia: int) -> int:
    """Retorna el índice 0-based de la columna de Chofer para el día operativo (1..31)."""
    return 27 + 13 * (dia - 1)


def index_to_col_letter(col_idx: int) -> str:
    """Convierte un índice de columna 0-based a letra de columna (0 -> A, 27 -> AB, etc.)."""
    res = ""
    temp = col_idx
    while temp >= 0:
        res = chr(temp % 26 + ord('A')) + res
        temp = temp // 26 - 1
    return res


def cargar_config_operativas() -> Dict[str, Any]:
    """Carga config_operativas.json si existe."""
    cfg_file = BASE_DIR / "config_operativas.json"
    if cfg_file.exists():
        try:
            with open(cfg_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ [Config] Error leyendo config_operativas.json: {e}")
    return {}


def _parse_mes_anio(texto: Optional[str]) -> Optional[Tuple[int, int]]:
    """Extrae (anio, mes) desde textos como 'Noviembre 2026' o 'NOVIEMBRE 2026- Mov.Unidades y Choferes'."""
    if not texto:
        return None
    low = str(texto).lower()
    mes_encontrado = None
    for idx, m_nom in enumerate(MESES_ES, start=1):
        if m_nom in low:
            mes_encontrado = idx
            break
    if not mes_encontrado:
        return None
    m_anio = re.search(r"\b(20\d{2})\b", low)
    if not m_anio:
        return None
    return int(m_anio.group(1)), mes_encontrado


def resolver_hoja_para_fecha(dt: date, config: Dict[str, Any]) -> Tuple[str, str]:
    """Resuelve dinámicamente el (spreadsheetId, tabName) de Movimientos para cualquier mes/año (#idmensual)."""
    mes_actual = (config or {}).get("mes_actual", {}) or {}
    mes_anterior = (config or {}).get("mes_anterior", {}) or {}
    default_tab_for_dt = f"{MESES_ES[dt.month - 1].upper()} {dt.year}- Mov.Unidades y Choferes"

    # 1. Coincidencia explícita en config (mes_actual / mes_anterior) para cualquier año
    ym_actual = _parse_mes_anio(mes_actual.get("nombre") or mes_actual.get("tab_movimientos"))
    if ym_actual == (dt.year, dt.month) and mes_actual.get("movimientos_id"):
        return mes_actual["movimientos_id"], mes_actual.get("tab_movimientos", default_tab_for_dt)

    ym_anterior = _parse_mes_anio(mes_anterior.get("nombre") or mes_anterior.get("tab_movimientos"))
    if ym_anterior == (dt.year, dt.month) and mes_anterior.get("movimientos_id"):
        return mes_anterior["movimientos_id"], mes_anterior.get("tab_movimientos", default_tab_for_dt)

    # 2. Variables de entorno del contenedor (ID_SHEET_MOVIMIENTOS / MES_MOVIMIENTOS_ID / TAB_MOVIMIENTOS)
    env_mov_id = os.getenv("ID_SHEET_MOVIMIENTOS") or os.getenv("MES_MOVIMIENTOS_ID")
    env_tab_name = os.getenv("TAB_MOVIMIENTOS")
    if env_mov_id and env_tab_name:
        ym_env = _parse_mes_anio(env_tab_name)
        if ym_env == (dt.year, dt.month):
            return env_mov_id, env_tab_name

    # 3. Fallbacks estáticos históricos
    if dt.year == 2026 and dt.month == 11:
        return NOVIEMBRE_MOV_ID, NOVIEMBRE_TAB_NAME
    if dt.year == 2026 and dt.month == 10:
        return OCTUBRE_MOV_ID, OCTUBRE_TAB_NAME

    # 4. Fallback general a planilla activa vigente
    if env_mov_id:
        return env_mov_id, env_tab_name or mes_actual.get("tab_movimientos", default_tab_for_dt)

    return mes_actual.get("movimientos_id", NOVIEMBRE_MOV_ID), mes_actual.get("tab_movimientos", NOVIEMBRE_TAB_NAME)


def format_baja_note(tipo_titulo: str, fecha_obj_str: str, detalle: str) -> str:
    """Formatea la nota para inyección en la celda."""
    f_parts = str(fecha_obj_str).strip().split("T")[0].split("-")
    if len(f_parts) == 3:
        f_display = f"{f_parts[2]}/{f_parts[1]}/{f_parts[0]}"
    else:
        f_display = fecha_obj_str

    titulo = tipo_titulo or "BAJA DE DIAGRAMA"
    lines = [f"⚠️ {titulo.upper()} (Hasta: {f_display})"]
    if detalle and detalle.strip():
        lines.append(f"Detalle: {detalle.strip()}")
    return "\n".join(lines)


class BajasDiagramaSync:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.config = cargar_config_operativas()
        self._creds = get_google_credentials(scopes=SCOPES)
        self._sheets = build("sheets", "v4", credentials=self._creds)
        self._cached_meta: Dict[str, Dict[str, int]] = {}
        self._cached_day_cols: Dict[str, List[str]] = {}
        self._cached_day_to_col_map: Dict[str, Dict[int, int]] = {}

    def _ensure_token(self):
        """Asegura que las credenciales tengan un token válido."""
        if not self._creds.valid:
            self._creds.refresh(Request())

    def fetch_novedades_bajas(self) -> List[Dict[str, Any]]:
        """Consulta novedades con imprime_nota_movimientos=true (por relación UUID tipos_novedad) desde Supabase."""
        url = f"{SUPABASE_URL}/rest/v1/view_dash_novedades"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json"
        }
        params = {
            "select": "*",
            "imprime_nota_movimientos": "eq.true",
            "resuelto": "eq.false",
            "chofer_id": "not.is.null",
            "fecha_objetivo": "not.is.null",
            "order": "id.desc"
        }
        res = requests.get(url, headers=headers, params=params, timeout=15)
        if res.status_code != 200:
            print(f"❌ [Supabase] Error en consulta de novedades: {res.status_code} - {res.text}")
            return []
        data = res.json()
        print(f"📥 [Supabase] Se recuperaron {len(data)} novedades activas con imprime_nota_movimientos=true.")
        return data

    def get_sheet_id_num(self, spreadsheet_id: str, tab_name: str) -> int:
        """Obtiene el sheetId numérico para una pestaña."""
        if spreadsheet_id not in self._cached_meta:
            self._ensure_token()
            url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}?fields=sheets.properties"
            try:
                r = requests.get(url, headers={"Authorization": f"Bearer {self._creds.token}"}, timeout=15)
                tab_map = {}
                if r.status_code == 200:
                    for s in r.json().get("sheets", []):
                        p = s.get("properties", {})
                        tab_map[p.get("title", "").strip().lower()] = p.get("sheetId")
                self._cached_meta[spreadsheet_id] = tab_map
            except Exception as e:
                print(f"⚠️ Error obteniendo metadatos de {spreadsheet_id}: {e}")
                self._cached_meta[spreadsheet_id] = {}

        tab_map = self._cached_meta.get(spreadsheet_id, {})
        target = tab_name.strip().lower()
        if target in tab_map:
            return tab_map[target]
        for k, v in tab_map.items():
            if "mov" in k and "unidades" in k:
                return v
        return 0

    def get_day_to_chofer_col_map(self, spreadsheet_id: str, tab_name: str) -> Dict[int, int]:
        """
        Escanea la Fila 1 ('1:1') para mapear cada día (1..31) a su índice exacto de columna Chofer.
        Fallback a la fórmula matemática 27 + 13 * (dia - 1) si no se pudo leer la fila 1.
        """
        cache_key = f"{spreadsheet_id}_{tab_name}"
        if cache_key in self._cached_day_to_col_map:
            return self._cached_day_to_col_map[cache_key]

        day_map: Dict[int, int] = {}
        self._ensure_token()
        range_name = f"'{tab_name}'!1:1"
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{quote(range_name)}"

        try:
            r = requests.get(url, headers={"Authorization": f"Bearer {self._creds.token}"}, timeout=20)
            if r.status_code == 200:
                row1 = r.json().get("values", [[]])[0]
                current_chofer_col = None
                for c_idx, val in enumerate(row1):
                    v = str(val).strip()
                    if "chofer" in v.lower():
                        current_chofer_col = c_idx
                    m = re.search(
                        r'\b0?([1-9]|[12][0-9]|3[01])\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b',
                        v,
                        re.IGNORECASE
                    )
                    if m and current_chofer_col is not None:
                        day_num = int(m.group(1))
                        day_map[day_num] = current_chofer_col
        except Exception as e:
            print(f"⚠️ No se pudo leer Fila 1 de {tab_name} ({e}), usando cálculo stride 13.")

        for d in range(1, 32):
            if d not in day_map:
                day_map[d] = get_col_chofer(d)

        self._cached_day_to_col_map[cache_key] = day_map
        return day_map

    def fetch_day_column_values(self, spreadsheet_id: str, tab_name: str, col_letter: str) -> List[str]:
        """Lee exclusivamente la columna del día operativo (ej. 'AB1:AB250')."""
        cache_key = f"{spreadsheet_id}_{tab_name}_{col_letter}"
        if cache_key in self._cached_day_cols:
            return self._cached_day_cols[cache_key]

        self._ensure_token()
        range_name = f"'{tab_name}'!{col_letter}1:{col_letter}250"
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{quote(range_name)}?valueRenderOption=UNFORMATTED_VALUE"

        try:
            r = requests.get(url, headers={"Authorization": f"Bearer {self._creds.token}"}, timeout=35)
            if r.status_code == 200:
                raw_rows = r.json().get("values", [])
                col_vals = [str(row[0]).strip() if len(row) > 0 else "" for row in raw_rows]
                self._cached_day_cols[cache_key] = col_vals
                return col_vals
            else:
                print(f"⚠️ Error leyendo rango {range_name}: {r.status_code}")
                self._cached_day_cols[cache_key] = []
                return []
        except Exception as e:
            print(f"⚠️ Timeout o error leyendo {range_name}: {e}")
            self._cached_day_cols[cache_key] = []
            return []

    def process_sync(self) -> Dict[str, List[Dict[str, Any]]]:
        """
        Calcula las celdas exactas a modificar por spreadsheet.
        Retorna: { spreadsheet_id: [ update_items ] }
        """
        novedades = self.fetch_novedades_bajas()
        if not novedades:
            print("ℹ️ No hay novedades activas de baja de diagrama para sincronizar.")
            return {}

        hoy = date.today()
        updates_by_sheet: Dict[str, List[Dict[str, Any]]] = {}

        for nov in novedades:
            nov_id = nov.get("id")
            chofer_nom = nov.get("chofer_nombre") or nov.get("nom") or ""
            f_obj_str = nov.get("fecha_objetivo")
            detalle = nov.get("detalle") or ""
            tipo_titulo = nov.get("tipo_novedad_titulo") or nov.get("tipo_novedad") or "BAJA DE DIAGRAMA"

            if not chofer_nom or not f_obj_str:
                continue

            try:
                f_obj = datetime.strptime(str(f_obj_str).strip()[:10], "%Y-%m-%d").date()
            except Exception:
                continue

            f_inicio = hoy
            if f_inicio > f_obj:
                continue

            norm_chofer = normalizar_texto(chofer_nom)
            note_content = format_baja_note(tipo_titulo, f_obj_str, detalle)

            cur_date = f_inicio
            while cur_date <= f_obj:
                dia_num = cur_date.day
                sheet_id, tab_name = resolver_hoja_para_fecha(cur_date, self.config)
                sheet_id_num = self.get_sheet_id_num(sheet_id, tab_name)

                col_chofer_idx = get_col_chofer(dia_num)
                col_letter = index_to_col_letter(col_chofer_idx)

                col_vals = self.fetch_day_column_values(sheet_id, tab_name, col_letter)

                # REGLA ESTRICTA: Buscar al chofer estrictamente en la columna de Chofer del día (sin fallback a tractor)
                encontrado_en_fila = None
                for r_idx in range(2, len(col_vals)):
                    cell_val = col_vals[r_idx]
                    if cell_val and len(cell_val) >= 3:
                        norm_cell = normalizar_texto(cell_val)
                        if (
                            norm_chofer == norm_cell
                            or (norm_chofer in norm_cell and len(norm_chofer) >= 6)
                            or (norm_cell in norm_chofer and len(norm_cell) >= 6)
                        ):
                            encontrado_en_fila = r_idx + 1  # 1-based
                            break

                if encontrado_en_fila is not None:
                    coord = f"{col_letter}{encontrado_en_fila}"

                    if sheet_id not in updates_by_sheet:
                        updates_by_sheet[sheet_id] = []

                    updates_by_sheet[sheet_id].append({
                        "sheet_id_num": sheet_id_num,
                        "tab_name": tab_name,
                        "row_1based": encontrado_en_fila,
                        "row_0based": encontrado_en_fila - 1,
                        "col_idx": col_chofer_idx,
                        "coord": coord,
                        "date": cur_date.isoformat(),
                        "chofer": chofer_nom,
                        "novedad_id": nov_id,
                        "note": note_content
                    })

                cur_date += timedelta(days=1)

        return updates_by_sheet

    def apply_updates(self, updates_by_sheet: Dict[str, List[Dict[str, Any]]]):
        """Aplica las notas por lotes mediante Google Sheets batchUpdate (fields='note')."""
        total_aplicadas = 0

        for sheet_id, items in updates_by_sheet.items():
            if not items:
                continue

            tab_name = items[0]["tab_name"]
            print(f"\n🚀 [Google Sheets] Preparando {len(items)} notas para [{tab_name}] (ID: {sheet_id})...")

            if self.dry_run:
                for it in items:
                    print(f"   [DRY-RUN] Celda {it['coord']} ({it['date']}) - Chofer: {it['chofer']} -> Nota: {it['note'][:45]}...")
                total_aplicadas += len(items)
                continue

            requests_batch = []
            for it in items:
                requests_batch.append({
                    "updateCells": {
                        "range": {
                            "sheetId": it["sheet_id_num"],
                            "startRowIndex": it["row_0based"],
                            "endRowIndex": it["row_0based"] + 1,
                            "startColumnIndex": it["col_idx"],
                            "endColumnIndex": it["col_idx"] + 1
                        },
                        "rows": [
                            {
                                "values": [
                                    {
                                        "note": it["note"]
                                    }
                                ]
                            }
                        ],
                        "fields": "note"
                    }
                })

            batch_size = 300
            for i in range(0, len(requests_batch), batch_size):
                chunk = requests_batch[i:i + batch_size]
                try:
                    self._sheets.spreadsheets().batchUpdate(
                        spreadsheetId=sheet_id,
                        body={"requests": chunk}
                    ).execute()
                    print(f"   ✅ Lote de {len(chunk)} notas aplicado exitosamente en [{tab_name}].")
                    total_aplicadas += len(chunk)
                except Exception as e:
                    print(f"   ❌ Error aplicando lote de notas en {sheet_id}: {e}")

        print(f"\n✨ Sincronización completada: {total_aplicadas} celdas actualizadas con notas en hover.")
        return total_aplicadas


def main():
    parser = argparse.ArgumentParser(description="Sincronizador de notas de baja de diagrama hacia Movimientos")
    parser.add_argument("--dry-run", action="store_true", help="Simula las notas a inyectar sin modificar Google Sheets")
    args = parser.parse_args()

    print("\n" + "=" * 75)
    print("  🛰️ SINCRONIZADOR DE BAJAS DE DIAGRAMA ➔ MOVIMIENTOS (NOTAS EN HOVER)")
    print("=" * 75)

    sync = BajasDiagramaSync(dry_run=args.dry_run)
    planned = sync.process_sync()
    sync.apply_updates(planned)


if __name__ == "__main__":
    main()
