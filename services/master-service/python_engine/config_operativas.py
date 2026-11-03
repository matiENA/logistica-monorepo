#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  CONFIGURACIÓN CENTRALIZADA DE PLANILLAS OPERATIVAS (RUTEOS Y MOVIMIENTOS)
================================================================================
Descripción:
  Centraliza los IDs y nombres de pestañas de las planillas mensuales de Ruteos
  y Movimientos (mes actual y mes anterior), así como los parámetros de
  transición para lectura dual vs caché congelada.

  Permite sobreescritura transparente mediante variables de entorno (Render/Docker)
  o mediante el archivo local 'config_operativas.json'.
================================================================================
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config_operativas.json"
CACHE_FILE_PREV_MONTH = BASE_DIR / "cache_ruteos_mes_anterior.json"

# Valores por defecto de contingencia (Octubre / Septiembre 2026)
FALLBACK_CONFIG = {
    "mes_actual": {
        "nombre": "Noviembre 2026",
        "ruteos_id": "1oIadEZE1vXCOaTjj8USAOAYVwibY5XMfmCaJbp0bqZE",
        "tab_ruteos": "Ruteos",
        "movimientos_id": "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc",
        "tab_movimientos": "NOVIEMBRE 2026- Mov.Unidades y Choferes",
        "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
        "tab_conf_source": "UTE Cordillera Noviembre 26",
        "tab_conf_target": "CONF. DE VIAJE NOVIEMBRE 26"
    },
    "mes_anterior": {
        "nombre": "Septiembre 2026",
        "ruteos_id": "1H-UoO3VmwNH7YMnvycKfZTyPbYcwpJNjbEKqU7MZKmM",
        "tab_ruteos": "Liviano",
        "movimientos_id": "1Bwj8WCykMn_FbZhQ_FqnDH3K_WCod52YTSvsaxIDNS8",
        "tab_movimientos": "SEPTIEMBRE 2026- Mov.Unidades y Choferes",
        "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
        "tab_conf_source": "UTE Cordillera",
        "tab_conf_target": "CONF. DE VIAJE"
    },
    "dias_transicion_lectura_dual": 7
}


def load_config() -> Dict[str, Any]:
    """Carga la configuración desde config_operativas.json con fallback seguro."""
    config = dict(FALLBACK_CONFIG)
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    # Actualizar mes_actual
                    if "mes_actual" in data and isinstance(data["mes_actual"], dict):
                        config["mes_actual"] = {**config["mes_actual"], **data["mes_actual"]}
                    # Actualizar mes_anterior
                    if "mes_anterior" in data and isinstance(data["mes_anterior"], dict):
                        config["mes_anterior"] = {**config["mes_anterior"], **data["mes_anterior"]}
                    if "dias_transicion_lectura_dual" in data:
                        config["dias_transicion_lectura_dual"] = int(data["dias_transicion_lectura_dual"])
        except Exception as e:
            print(f"[WARN config_operativas] Error leyendo {CONFIG_FILE.name}: {e}. Usando fallback.")

    # Sobreescrituras por variables de entorno (Prioridad Alta en Cloud / Render)
    # Mes actual
    if os.getenv("RUTEOS_ID"):
        config["mes_actual"]["ruteos_id"] = os.getenv("RUTEOS_ID").strip()
    if os.getenv("TAB_RUTEOS"):
        config["mes_actual"]["tab_ruteos"] = os.getenv("TAB_RUTEOS").strip()
    if os.getenv("MOVIMIENTOS_ID"):
        config["mes_actual"]["movimientos_id"] = os.getenv("MOVIMIENTOS_ID").strip()
    if os.getenv("TAB_MOVIMIENTOS"):
        config["mes_actual"]["tab_movimientos"] = os.getenv("TAB_MOVIMIENTOS").strip()
    if os.getenv("CONF_SPREADSHEET_ID") or os.getenv("CONF_VIAJE_ID"):
        config["mes_actual"]["conf_viaje_id"] = (os.getenv("CONF_SPREADSHEET_ID") or os.getenv("CONF_VIAJE_ID")).strip()
    if os.getenv("CONF_SOURCE_SHEET_NAME") or os.getenv("CONF_SOURCE_TAB"):
        config["mes_actual"]["tab_conf_source"] = (os.getenv("CONF_SOURCE_SHEET_NAME") or os.getenv("CONF_SOURCE_TAB")).strip()
    if os.getenv("CONF_TARGET_SHEET_NAME") or os.getenv("CONF_TARGET_TAB"):
        config["mes_actual"]["tab_conf_target"] = (os.getenv("CONF_TARGET_SHEET_NAME") or os.getenv("CONF_TARGET_TAB")).strip()

    # Mes anterior
    if os.getenv("RUTEOS_ANTERIOR_ID"):
        config["mes_anterior"]["ruteos_id"] = os.getenv("RUTEOS_ANTERIOR_ID").strip()
    if os.getenv("TAB_RUTEOS_ANTERIOR"):
        config["mes_anterior"]["tab_ruteos"] = os.getenv("TAB_RUTEOS_ANTERIOR").strip()
    if os.getenv("MOVIMIENTOS_ANTERIOR_ID"):
        config["mes_anterior"]["movimientos_id"] = os.getenv("MOVIMIENTOS_ANTERIOR_ID").strip()
    if os.getenv("TAB_MOVIMIENTOS_ANTERIOR"):
        config["mes_anterior"]["tab_movimientos"] = os.getenv("TAB_MOVIMIENTOS_ANTERIOR").strip()
    if os.getenv("CONF_ANTERIOR_ID"):
        config["mes_anterior"]["conf_viaje_id"] = os.getenv("CONF_ANTERIOR_ID").strip()
    if os.getenv("TAB_CONF_SOURCE_ANTERIOR"):
        config["mes_anterior"]["tab_conf_source"] = os.getenv("TAB_CONF_SOURCE_ANTERIOR").strip()
    if os.getenv("TAB_CONF_TARGET_ANTERIOR"):
        config["mes_anterior"]["tab_conf_target"] = os.getenv("TAB_CONF_TARGET_ANTERIOR").strip()

    # Días de transición
    if os.getenv("DIAS_TRANSICION_DUAL"):
        try:
            config["dias_transicion_lectura_dual"] = int(os.getenv("DIAS_TRANSICION_DUAL").strip())
        except ValueError:
            pass

    return config


def save_config(config_data: Dict[str, Any]) -> None:
    """Guarda la configuración actualizada en config_operativas.json."""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2, ensure_ascii=False)


# Carga inicial y constantes expuestas para importación directa
_current_cfg = load_config()

RUTEOS_ID = _current_cfg["mes_actual"]["ruteos_id"]
SOURCE_TAB_RUTEOS = _current_cfg["mes_actual"]["tab_ruteos"]
MOVIMIENTOS_ID = _current_cfg["mes_actual"]["movimientos_id"]
TARGET_TAB_MOV = _current_cfg["mes_actual"]["tab_movimientos"]

RUTEOS_ANTERIOR_ID = _current_cfg["mes_anterior"]["ruteos_id"]
SOURCE_TAB_RUTEOS_ANTERIOR = _current_cfg["mes_anterior"]["tab_ruteos"]
MOVIMIENTOS_ANTERIOR_ID = _current_cfg["mes_anterior"]["movimientos_id"]
TARGET_TAB_MOV_ANTERIOR = _current_cfg["mes_anterior"]["tab_movimientos"]

DIAS_TRANSICION_DUAL = _current_cfg.get("dias_transicion_lectura_dual", 7)
