#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  CONFIGURACIÓN CENTRALIZADA DE PLANILLAS OPERATIVAS (AUTO-CUTOVER & MERGE DUAL)
================================================================================
Descripción:
  Centraliza los IDs y pestañas de Ruteos, Movimientos y CONF. DE VIAJE con
  auto-resolución por calendario (Argentina UTC-3) desde el registro `meses`
  en `config_operativas.json`.

  Permite operar el cruce de mes (Noviembre <-> Diciembre 2026) SIN intervención
  manual ni ejecución de .bat:
    - Hasta el 30/11 23:59 AR: mes_actual = Noviembre 2026, mes_siguiente = Diciembre 2026.
    - Desde el 01/12 00:00 AR: mes_actual = Diciembre 2026, mes_anterior = Noviembre 2026.
    - Días 1 y 2 del mes entrante (`dias_dual_print_cruce = [1, 2]`): se imprimen
      en AMBAS planillas de Movimientos (hoja entrante + cola de hoja saliente).
================================================================================
"""

import os
import json
from pathlib import Path
from datetime import datetime, date, timedelta, timezone
from typing import Dict, Any, Optional, List, Tuple

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config_operativas.json"
CACHE_FILE_PREV_MONTH = BASE_DIR / "cache_ruteos_mes_anterior.json"

TZ_ARGENTINA = timezone(timedelta(hours=-3))

MESES_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
]

FALLBACK_CONFIG: Dict[str, Any] = {
    "mes_actual": {
        "nombre": "Noviembre 2026",
        "ruteos_id": "1oIadEZE1vXCOaTjj8USAOAYVwibY5XMfmCaJbp0bqZE",
        "tab_ruteos": "Ruteos",
        "movimientos_id": "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc",
        "tab_movimientos": "NOVIEMBRE 2026- Mov.Unidades y Choferes",
        "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
        "tab_conf_source": "UTE Cordillera Noviembre 26",
        "tab_conf_target": "CONF. DE VIAJE NOVIEMBRE 26",
        "diagrama_tab": "Nov-26"
    },
    "mes_anterior": {
        "nombre": "Octubre 2026",
        "ruteos_id": "1-wNLgr2b1TibP_MPwA9ToF9jlH_jiPxjN0iirWbFb3o",
        "tab_ruteos": "Ruteos",
        "movimientos_id": "14Mb5rD853zxDkaLDS-IrW-OBDTDBjuJxn_3olXeWlkc",
        "tab_movimientos": "OCTUBRE 2026- Mov.Unidades y Choferes",
        "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
        "tab_conf_source": "UTE Cordillera Octubre 26",
        "tab_conf_target": "CONF. DE VIAJE OCTUBRE 26",
        "diagrama_tab": "Oct-26"
    },
    "mes_siguiente": {
        "nombre": "Diciembre 2026",
        "ruteos_id": "1h-x0rFJLrZxyhzFhRi03BDPN3APSx0EwpkbJo7F15Ms",
        "tab_ruteos": "Ruteos",
        "movimientos_id": "14QpWY9KvOVj2Yinn5F1hOiSkTxASYwLc-Cd7F2rFO_k",
        "tab_movimientos": "DICIEMBRE 2026- Mov.Unidades y Choferes",
        "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
        "tab_conf_source": "UTE Cordillera Diciembre 26",
        "tab_conf_target": "CONF. DE VIAJE DICIEMBRE 26",
        "diagrama_tab": "Dic-26"
    },
    "meses": {
        "2026-10": {
            "nombre": "Octubre 2026",
            "ruteos_id": "1-wNLgr2b1TibP_MPwA9ToF9jlH_jiPxjN0iirWbFb3o",
            "tab_ruteos": "Ruteos",
            "movimientos_id": "14Mb5rD853zxDkaLDS-IrW-OBDTDBjuJxn_3olXeWlkc",
            "tab_movimientos": "OCTUBRE 2026- Mov.Unidades y Choferes",
            "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
            "tab_conf_source": "UTE Cordillera Octubre 26",
            "tab_conf_target": "CONF. DE VIAJE OCTUBRE 26",
            "diagrama_tab": "Oct-26"
        },
        "2026-11": {
            "nombre": "Noviembre 2026",
            "ruteos_id": "1oIadEZE1vXCOaTjj8USAOAYVwibY5XMfmCaJbp0bqZE",
            "tab_ruteos": "Ruteos",
            "movimientos_id": "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc",
            "tab_movimientos": "NOVIEMBRE 2026- Mov.Unidades y Choferes",
            "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
            "tab_conf_source": "UTE Cordillera Noviembre 26",
            "tab_conf_target": "CONF. DE VIAJE NOVIEMBRE 26",
            "diagrama_tab": "Nov-26"
        },
        "2026-12": {
            "nombre": "Diciembre 2026",
            "ruteos_id": "1h-x0rFJLrZxyhzFhRi03BDPN3APSx0EwpkbJo7F15Ms",
            "tab_ruteos": "Ruteos",
            "movimientos_id": "14QpWY9KvOVj2Yinn5F1hOiSkTxASYwLc-Cd7F2rFO_k",
            "tab_movimientos": "DICIEMBRE 2026- Mov.Unidades y Choferes",
            "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
            "tab_conf_source": "UTE Cordillera Diciembre 26",
            "tab_conf_target": "CONF. DE VIAJE DICIEMBRE 26",
            "diagrama_tab": "Dic-26"
        }
    },
    "dias_transicion_lectura_dual": 7,
    "dias_dual_print_cruce": [1, 2]
}


def get_argentina_now() -> datetime:
    """Retorna la fecha/hora actual en zona horaria Argentina (UTC-3)."""
    return datetime.now(TZ_ARGENTINA)


def _ym_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _prev_ym(year: int, month: int) -> Tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _next_ym(year: int, month: int) -> Tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def parse_month_year_name(nombre: str, fallback_year: int = 2026) -> Tuple[str, int, int]:
    """Extrae (MesNombreCapitalizado, anio, mes_num) desde 'Noviembre 2026'."""
    txt = (nombre or "").strip()
    parts = txt.split()
    mes_word = parts[0].capitalize() if parts else "Noviembre"
    anio = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else fallback_year
    mes_num = 11
    for i, m in enumerate(MESES_ES, start=1):
        if m.lower() == mes_word.lower():
            mes_num = i
            mes_word = m
            break
    return mes_word, anio, mes_num


def _load_raw_json() -> Dict[str, Any]:
    raw = json.loads(json.dumps(FALLBACK_CONFIG))
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                if isinstance(data.get("mes_actual"), dict):
                    raw["mes_actual"] = {**raw["mes_actual"], **data["mes_actual"]}
                if isinstance(data.get("mes_anterior"), dict):
                    raw["mes_anterior"] = {**raw["mes_anterior"], **data["mes_anterior"]}
                if isinstance(data.get("mes_siguiente"), dict):
                    raw["mes_siguiente"] = {**raw.get("mes_siguiente", {}), **data["mes_siguiente"]}
                if isinstance(data.get("meses"), dict):
                    merged_meses = dict(raw.get("meses", {}))
                    merged_meses.update(data["meses"])
                    raw["meses"] = merged_meses
                if "dias_transicion_lectura_dual" in data:
                    raw["dias_transicion_lectura_dual"] = int(data["dias_transicion_lectura_dual"])
                if isinstance(data.get("dias_dual_print_cruce"), list):
                    raw["dias_dual_print_cruce"] = [int(x) for x in data["dias_dual_print_cruce"]]
        except Exception as e:
            print(f"[WARN config_operativas] Error leyendo {CONFIG_FILE.name}: {e}. Usando fallback.")
    return raw


def _is_env_stale_for_month(env_val: Optional[str], field: str, prev_cfg: Optional[Dict[str, Any]], curr_cfg: Dict[str, Any]) -> bool:
    """Evita que una variable de entorno del mes saliente bloquee el auto-cutover por calendario."""
    if not env_val:
        return True
    v = env_val.strip()
    if not v:
        return True
    if prev_cfg and v == prev_cfg.get(field) and curr_cfg.get(field) and curr_cfg.get(field) != v:
        return True
    return False


def load_config(ref_date: Optional[date] = None) -> Dict[str, Any]:
    """
    Carga la configuración activa resolviendo automáticamente el mes vigente según
    la fecha calendario en Argentina (auto-cutover sin intervención manual).
    """
    config = _load_raw_json()
    meses_reg = config.get("meses", {})

    ref_dt = ref_date or get_argentina_now().date()
    curr_key = _ym_key(ref_dt.year, ref_dt.month)
    py, pm = _prev_ym(ref_dt.year, ref_dt.month)
    ny, nm = _next_ym(ref_dt.year, ref_dt.month)
    prev_key = _ym_key(py, pm)
    next_key = _ym_key(ny, nm)

    auto_resolved = False
    if curr_key in meses_reg:
        config["mes_actual"] = dict(meses_reg[curr_key])
        auto_resolved = True
        if prev_key in meses_reg:
            config["mes_anterior"] = dict(meses_reg[prev_key])
        if next_key in meses_reg:
            config["mes_siguiente"] = dict(meses_reg[next_key])
        else:
            config["mes_siguiente"] = None

    curr = config["mes_actual"]
    prev = config.get("mes_anterior")

    # Sobreescrituras por variables de entorno (aceptando alias de render.yaml),
    # ignorando valores heredados del mes anterior cuando el calendario ya rotó.
    env_ruteos = os.getenv("RUTEOS_ID") or os.getenv("DEFAULT_RUTEOS_ID")
    if env_ruteos and not (auto_resolved and _is_env_stale_for_month(env_ruteos, "ruteos_id", prev, curr)):
        curr["ruteos_id"] = env_ruteos.strip()

    if os.getenv("TAB_RUTEOS"):
        curr["tab_ruteos"] = os.getenv("TAB_RUTEOS").strip()

    env_mov = os.getenv("MOVIMIENTOS_ID") or os.getenv("ID_SHEET_MOVIMIENTOS") or os.getenv("MES_MOVIMIENTOS_ID")
    if env_mov and not (auto_resolved and _is_env_stale_for_month(env_mov, "movimientos_id", prev, curr)):
        curr["movimientos_id"] = env_mov.strip()

    env_tab_mov = os.getenv("TAB_MOVIMIENTOS")
    if env_tab_mov and not (auto_resolved and _is_env_stale_for_month(env_tab_mov, "tab_movimientos", prev, curr)):
        curr["tab_movimientos"] = env_tab_mov.strip()

    if os.getenv("CONF_SPREADSHEET_ID") or os.getenv("CONF_VIAJE_ID"):
        curr["conf_viaje_id"] = (os.getenv("CONF_SPREADSHEET_ID") or os.getenv("CONF_VIAJE_ID")).strip()

    env_conf_src = os.getenv("CONF_SOURCE_SHEET_NAME") or os.getenv("CONF_SOURCE_TAB")
    if env_conf_src and not (auto_resolved and _is_env_stale_for_month(env_conf_src, "tab_conf_source", prev, curr)):
        curr["tab_conf_source"] = env_conf_src.strip()

    env_conf_dst = os.getenv("CONF_TARGET_SHEET_NAME") or os.getenv("CONF_TARGET_TAB")
    if env_conf_dst and not (auto_resolved and _is_env_stale_for_month(env_conf_dst, "tab_conf_target", prev, curr)):
        curr["tab_conf_target"] = env_conf_dst.strip()

    # Mes anterior explícito
    if os.getenv("RUTEOS_ANTERIOR_ID"):
        config["mes_anterior"]["ruteos_id"] = os.getenv("RUTEOS_ANTERIOR_ID").strip()
    if os.getenv("TAB_RUTEOS_ANTERIOR"):
        config["mes_anterior"]["tab_ruteos"] = os.getenv("TAB_RUTEOS_ANTERIOR").strip()
    if os.getenv("MOVIMIENTOS_ANTERIOR_ID"):
        config["mes_anterior"]["movimientos_id"] = os.getenv("MOVIMIENTOS_ANTERIOR_ID").strip()
    if os.getenv("TAB_MOVIMIENTOS_ANTERIOR"):
        config["mes_anterior"]["tab_movimientos"] = os.getenv("TAB_MOVIMIENTOS_ANTERIOR").strip()

    if os.getenv("DIAS_TRANSICION_DUAL"):
        try:
            config["dias_transicion_lectura_dual"] = int(os.getenv("DIAS_TRANSICION_DUAL").strip())
        except ValueError:
            pass

    return config


def get_month_config(year: int, month: int, cfg: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Obtiene el bloque de configuración exacto para un (year, month) desde el registro."""
    c = cfg or _load_raw_json()
    key = _ym_key(year, month)
    meses = c.get("meses", {})
    if key in meses:
        return dict(meses[key])
    for slot in ("mes_actual", "mes_anterior", "mes_siguiente"):
        item = c.get(slot)
        if isinstance(item, dict) and item.get("nombre"):
            _, y, m = parse_month_year_name(item["nombre"])
            if (y, m) == (year, month):
                return dict(item)
    return None


def get_target_movimientos_for_date(dt: date, cfg: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Merge Virtual de Movimientos: retorna las planillas destino donde debe imprimirse la fecha `dt`.
    - Regla canónica: los días en `dias_dual_print_cruce` (default [1, 2]) del mes entrante
      se imprimen en AMBAS planillas (planilla del mes de `dt` + cola de la planilla del mes anterior).
    - El resto de los días se imprimen exclusivamente en la planilla de su mes.
    """
    c = cfg or load_config(dt)
    dual_days = c.get("dias_dual_print_cruce", [1, 2])
    targets: List[Dict[str, Any]] = []
    seen_ids = set()

    primary = get_month_config(dt.year, dt.month, c)
    if primary and primary.get("movimientos_id"):
        targets.append({
            "role": "primary",
            "movimientos_id": primary["movimientos_id"],
            "tab_movimientos": primary["tab_movimientos"],
            "nombre": primary["nombre"],
            "year": dt.year,
            "month": dt.month,
        })
        seen_ids.add(primary["movimientos_id"])

    if dt.day in dual_days:
        py, pm = _prev_ym(dt.year, dt.month)
        prev_m = get_month_config(py, pm, c)
        if prev_m and prev_m.get("movimientos_id") and prev_m["movimientos_id"] not in seen_ids:
            targets.append({
                "role": "bridge_tail",
                "movimientos_id": prev_m["movimientos_id"],
                "tab_movimientos": prev_m["tab_movimientos"],
                "nombre": prev_m["nombre"],
                "year": py,
                "month": pm,
            })
            seen_ids.add(prev_m["movimientos_id"])

    if not targets:
        act = c.get("mes_actual", {})
        if act.get("movimientos_id"):
            _, ay, am = parse_month_year_name(act.get("nombre", ""))
            targets.append({
                "role": "fallback",
                "movimientos_id": act["movimientos_id"],
                "tab_movimientos": act["tab_movimientos"],
                "nombre": act.get("nombre", ""),
                "year": ay,
                "month": am,
            })

    return targets


def save_config(config_data: Dict[str, Any]) -> None:
    """Guarda la configuración actualizada en config_operativas.json."""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2, ensure_ascii=False)


# Carga inicial y constantes expuestas para compatibilidad retroactiva
_current_cfg = load_config()

RUTEOS_ID = _current_cfg["mes_actual"]["ruteos_id"]
SOURCE_TAB_RUTEOS = _current_cfg["mes_actual"]["tab_ruteos"]
MOVIMIENTOS_ID = _current_cfg["mes_actual"]["movimientos_id"]
TARGET_TAB_MOV = _current_cfg["mes_actual"]["tab_movimientos"]

RUTEOS_ANTERIOR_ID = _current_cfg["mes_anterior"]["ruteos_id"]
SOURCE_TAB_RUTEOS_ANTERIOR = _current_cfg["mes_anterior"]["tab_ruteos"]
MOVIMIENTOS_ANTERIOR_ID = _current_cfg["mes_anterior"]["movimientos_id"]
TARGET_TAB_MOV_ANTERIOR = _current_cfg["mes_anterior"]["tab_movimientos"]

_mes_sig = _current_cfg.get("mes_siguiente") or {}
RUTEOS_SIGUIENTE_ID = _mes_sig.get("ruteos_id")
SOURCE_TAB_RUTEOS_SIGUIENTE = _mes_sig.get("tab_ruteos", "Ruteos")
MOVIMIENTOS_SIGUIENTE_ID = _mes_sig.get("movimientos_id")
TARGET_TAB_MOV_SIGUIENTE = _mes_sig.get("tab_movimientos")

MES_ACTUAL_NOMBRE, MES_ACTUAL_ANIO, MES_ACTUAL_NUM = parse_month_year_name(_current_cfg["mes_actual"].get("nombre", ""))
MES_ANTERIOR_NOMBRE, MES_ANTERIOR_ANIO, MES_ANTERIOR_NUM = parse_month_year_name(_current_cfg["mes_anterior"].get("nombre", ""))

DIAS_TRANSICION_DUAL = _current_cfg.get("dias_transicion_lectura_dual", 7)
DIAS_DUAL_PRINT_CRUCE = _current_cfg.get("dias_dual_print_cruce", [1, 2])
