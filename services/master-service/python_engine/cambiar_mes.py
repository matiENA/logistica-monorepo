#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  CAMBIO Y ROTACIÓN MENSUAL DE PLANILLAS OPERATIVAS
================================================================================
Uso:
  # Modo interactivo asistido por consola:
  py -3.13 cambiar_mes.py --interactivo

  # Modo directo con parámetros:
  py -3.13 cambiar_mes.py \\
      --nombre "Noviembre 2026" \\
      --ruteos-id "1-wNLgr2b1TibP_MPwA9ToF9jlH_jiPxjN0iirWbFb3o" \\
      --tab-ruteos "Ruteos" \\
      --mov-id "14Mb5rD853zxDkaLDS-IrW-OBDTDBjuJxn_3olXeWlkc" \\
      --tab-mov "NOVIEMBRE 2026- Mov.Unidades y Choferes"

  # Limpiar la caché local del mes anterior:
  py -3.13 cambiar_mes.py --limpiar-cache
================================================================================
"""

import sys
import argparse
from pathlib import Path
from config_operativas import (
    load_config,
    save_config,
    CONFIG_FILE,
    CACHE_FILE_PREV_MONTH
)

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def print_status(cfg: dict):
    print("\n" + "=" * 60)
    print("  ESTADO ACTUAL DE CONFIGURACIÓN OPERATIVA")
    print("=" * 60)
    m_act = cfg.get("mes_actual", {})
    m_ant = cfg.get("mes_anterior", {})
    print(f" MES ACTUAL: {m_act.get('nombre', 'N/A')}")
    print(f"   - Ruteos ID:         {m_act.get('ruteos_id')}")
    print(f"   - Tab Ruteos:        {m_act.get('tab_ruteos')}")
    print(f"   - Movimientos:       {m_act.get('movimientos_id')}")
    print(f"   - Tab Mov:           {m_act.get('tab_movimientos')}")
    print(f"   - CONF. DE VIAJE ID: {m_act.get('conf_viaje_id')}")
    print(f"   - Tab UTE Origen:    {m_act.get('tab_conf_source')}")
    print(f"   - Tab CONF Destino:  {m_act.get('tab_conf_target')}")
    print("-" * 60)
    print(f" MES ANTERIOR: {m_ant.get('nombre', 'N/A')}")
    print(f"   - Ruteos ID:         {m_ant.get('ruteos_id')}")
    print(f"   - Tab Ruteos:        {m_ant.get('tab_ruteos')}")
    print(f"   - Movimientos:       {m_ant.get('movimientos_id')}")
    print(f"   - Tab Mov:           {m_ant.get('tab_movimientos')}")
    print(f"   - CONF. DE VIAJE ID: {m_ant.get('conf_viaje_id')}")
    print(f"   - Tab UTE Origen:    {m_ant.get('tab_conf_source')}")
    print(f"   - Tab CONF Destino:  {m_ant.get('tab_conf_target')}")
    print("-" * 60)
    print(f" Días de transición lectura dual: {cfg.get('dias_transicion_lectura_dual', 7)} días")
    cache_status = "EXISTE (Congelada)" if CACHE_FILE_PREV_MONTH.exists() else "NO EXISTE"
    print(f" Caché local mes anterior:       {cache_status}")
    print("=" * 60 + "\n")


def rotar_mes(
    nombre: str,
    ruteos_id: str,
    tab_ruteos: str,
    mov_id: str,
    tab_mov: str,
    conf_id: str = None,
    tab_conf_source: str = None,
    tab_conf_target: str = None,
    dias_transicion: int = 7
):
    cfg = load_config()
    print("Rotando mes operativo...")
    # El mes actual pasa a ser mes anterior
    cfg["mes_anterior"] = dict(cfg["mes_actual"])

    # Extraer formato corto de mes (ej. 'Noviembre 2026' -> 'Noviembre 26')
    parts = nombre.strip().split()
    if len(parts) >= 2 and len(parts[-1]) == 4:
        nombre_corto = f"{parts[0]} {parts[-1][2:]}"
    else:
        nombre_corto = nombre

    actual_conf_id = conf_id or cfg["mes_actual"].get("conf_viaje_id", "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU")
    actual_conf_source = tab_conf_source or f"UTE Cordillera {nombre_corto}"
    actual_conf_target = tab_conf_target or f"CONF. DE VIAJE {nombre_corto.upper()}"

    # Nuevo mes actual
    cfg["mes_actual"] = {
        "nombre": nombre,
        "ruteos_id": ruteos_id,
        "tab_ruteos": tab_ruteos,
        "movimientos_id": mov_id,
        "tab_movimientos": tab_mov,
        "conf_viaje_id": actual_conf_id,
        "tab_conf_source": actual_conf_source,
        "tab_conf_target": actual_conf_target
    }
    cfg["dias_transicion_lectura_dual"] = dias_transicion

    save_config(cfg)

    # Limpiar caché del mes anterior para que se refresque con el mes recién archivado
    if CACHE_FILE_PREV_MONTH.exists():
        CACHE_FILE_PREV_MONTH.unlink()
        print(f"[OK] Se purgó la caché anterior '{CACHE_FILE_PREV_MONTH.name}' para reentrenar nuevo mes.")

    print("[EXITO] Configuración actualizada correctamente.")
    print_status(cfg)


def main():
    parser = argparse.ArgumentParser(description="Gestor de cambio de mes para planillas operativas")
    parser.add_argument("--status", action="store_true", help="Muestra el estado de la configuración actual")
    parser.add_argument("--interactivo", action="store_true", help="Modo interactivo asistido por preguntas")
    parser.add_argument("--nombre", type=str, help="Nombre del nuevo mes (ej: 'Noviembre 2026')")
    parser.add_argument("--ruteos-id", type=str, help="ID de la nueva planilla de Ruteos")
    parser.add_argument("--tab-ruteos", type=str, default="Ruteos", help="Nombre de pestaña de Ruteos")
    parser.add_argument("--mov-id", type=str, help="ID de la nueva planilla de Movimientos")
    parser.add_argument("--tab-mov", type=str, help="Nombre de pestaña de Movimientos")
    parser.add_argument("--conf-id", type=str, help="ID de la planilla de UTE Cordillera / CONF. DE VIAJE")
    parser.add_argument("--tab-conf-source", type=str, help="Nombre de pestaña de origen UTE Cordillera")
    parser.add_argument("--tab-conf-target", type=str, help="Nombre de pestaña de destino CONF. DE VIAJE")
    parser.add_argument("--dias-transicion", type=int, default=7, help="Días de lectura dual al inicio de mes")
    parser.add_argument("--limpiar-cache", action="store_true", help="Elimina el archivo de caché del mes anterior")

    args = parser.parse_args()

    if getattr(args, "limpiar_cache", False):
        if CACHE_FILE_PREV_MONTH.exists():
            CACHE_FILE_PREV_MONTH.unlink()
            print(f"[OK] Caché eliminada: {CACHE_FILE_PREV_MONTH.name}")
        else:
            print("[INFO] No existía archivo de caché previo.")
        return

    cfg = load_config()

    if args.status or (not args.interactivo and not args.nombre):
        print_status(cfg)
        return

    if args.interactivo:
        print_status(cfg)
        print("Ingrese los datos del NUEVO mes operativo:")
        nombre = input("Nombre del mes (ej: Noviembre 2026): ").strip()
        if not nombre:
            print("[CANCELADO] No se ingresó nombre.")
            return

        parts = nombre.strip().split()
        nombre_corto = f"{parts[0]} {parts[-1][2:]}" if len(parts) >= 2 and len(parts[-1]) == 4 else nombre

        ruteos_id = input(f"ID Ruteos (Enter para mantener {cfg['mes_actual']['ruteos_id']}): ").strip() or cfg["mes_actual"]["ruteos_id"]
        tab_ruteos = input("Pestaña Ruteos (Enter para 'Ruteos'): ").strip() or "Ruteos"
        mov_id = input(f"ID Movimientos (Enter para mantener {cfg['mes_actual']['movimientos_id']}): ").strip() or cfg["mes_actual"]["movimientos_id"]
        tab_mov_sugg = f"{nombre.upper()}- Mov.Unidades y Choferes"
        tab_mov = input(f"Pestaña Movimientos (Enter para '{tab_mov_sugg}'): ").strip() or tab_mov_sugg

        curr_conf_id = cfg['mes_actual'].get('conf_viaje_id', '1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU')
        conf_id = input(f"ID CONF. DE VIAJE (Enter para mantener {curr_conf_id}): ").strip() or curr_conf_id

        sugg_conf_src = f"UTE Cordillera {nombre_corto}"
        tab_conf_source = input(f"Pestaña UTE Origen (Enter para '{sugg_conf_src}'): ").strip() or sugg_conf_src

        sugg_conf_dst = f"CONF. DE VIAJE {nombre_corto.upper()}"
        tab_conf_target = input(f"Pestaña CONF Destino (Enter para '{sugg_conf_dst}'): ").strip() or sugg_conf_dst

        rotar_mes(
            nombre=nombre,
            ruteos_id=ruteos_id,
            tab_ruteos=tab_ruteos,
            mov_id=mov_id,
            tab_mov=tab_mov,
            conf_id=conf_id,
            tab_conf_source=tab_conf_source,
            tab_conf_target=tab_conf_target,
            dias_transicion=cfg.get("dias_transicion_lectura_dual", 7)
        )
        return

    if args.nombre and args.ruteos_id and args.mov_id:
        tab_m = args.tab_mov or f"{args.nombre.upper()}- Mov.Unidades y Choferes"
        rotar_mes(
            nombre=args.nombre,
            ruteos_id=args.ruteos_id,
            tab_ruteos=args.tab_ruteos,
            mov_id=args.mov_id,
            tab_mov=tab_m,
            conf_id=args.conf_id,
            tab_conf_source=args.tab_conf_source,
            tab_conf_target=args.tab_conf_target,
            dias_transicion=args.dias_transicion
        )
    else:
        print("[ERROR] Faltan argumentos requeridos (--nombre, --ruteos-id, --mov-id). Use --interactivo si lo prefiere.")


if __name__ == "__main__":
    main()
