#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  ORQUESTADOR MAESTRO DE OPERATIVAS DIARIAS (LOCAL Y CLOUD / RENDER)
================================================================================
Módulos Integrados:
  1. Tracking Col H:       sync_ruteos_movimientos.py
  2. VACÍO Col X:          sync_vacio.py
  3. Seguimiento Vacío:    sync_seguimiento_vacio.py (#9fc5e8 / sin nuevo TD)
  4. Disponibilidad VTV:   node pintarDisponibilidad.js (Semáforo 33 cols)
  5. Viajes Cordillera:    main.py --seguridad-vial (Filtro 21 localidades)
  6. CONF. DE VIAJE:       main.py --conf-viaje (Sujeto a seguimiento)
  7. Limpieza VACÍO:       limpiar_vacio.py (Herramienta administrativa)

Parámetros CLI:
  --apply          : Aplica escrituras reales en Google Sheets (por defecto: dry-run)
  --day <N>        : Día del mes específico (por defecto: día de hoy)
  --module <name>  : Ejecuta únicamente un módulo ('tracking', 'vacio', 'seguimiento', 'dispo', 'cordillera', 'conf_viaje', 'limpiar', 'all')
  --all            : Ejecuta todos los módulos operativos secuencialmente
  --daemon         : Modo bucle continuo con intervalo configurable
  --interval <sec> : Segundos entre ciclos en modo daemon (def: 600s / 10m)
================================================================================
"""

import os
import sys
import time
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Tuple

# Reconfigurar salida UTF-8
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

from execution_shield import ExecutionShield, ShieldBlockedException

BASE_DIR = Path(__file__).resolve().parent
PYTHON_EXE = sys.executable


def run_command_module(cmd: List[str], desc: str) -> Tuple[bool, float, str]:
    """Ejecuta un comando en un subproceso capturando código de salida, tiempo y salida."""
    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        dur = time.time() - t0
        output = proc.stdout.strip()
        errors = proc.stderr.strip()
        success = (proc.returncode == 0)
        msg = output if success else (errors or output or f"Código {proc.returncode}")
        return success, dur, msg
    except Exception as e:
        dur = time.time() - t0
        return False, dur, str(e)


def execute_syncs(
    modules_to_run: List[str],
    apply: bool = False,
    day: int = None
) -> Dict[str, Any]:
    """Ejecuta la lista seleccionada de módulos y devuelve un reporte estructurado."""
    t_start = datetime.now()
    day_val = day if day is not None else t_start.day
    day_str = str(day_val)

    print("\n" + "=" * 80)
    print(f"  🚀 [ORQUESTADOR] INICIO OPERATIVO: {t_start.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Modo: {'APLICAR EN SHEETS (--apply)' if apply else 'SIMULACIÓN (DRY-RUN)'} | Día: {day_str}")
    print(f"  Módulos: {', '.join(modules_to_run)}")
    print("=" * 80)

    # Definición canónica de módulos
    day_args = ["--day", day_str] if day is not None else []
    modules_map = {
        "unified": {
            "title": "1-3. Motor Unificado en Capas (Tracking + VACÍO + Seguimiento)",
            "cmd": [PYTHON_EXE, "sync_operativas_unificadas.py"] + (["--apply", "--borders"] if apply else ["--borders"]) + day_args
        },
        "tracking": {
            "title": "1. Tracking Col H (Ruteos ➡️ Movimientos)",
            "cmd": [PYTHON_EXE, "sync_ruteos_movimientos.py"] + (["--apply"] if apply else []) + day_args
        },
        "vacio": {
            "title": "2. VACÍO Col X con Bordes (Ruteos ➡️ Movimientos)",
            "cmd": [PYTHON_EXE, "sync_vacio.py"] + (["--apply", "--borders"] if apply else ["--borders"]) + day_args
        },
        "seguimiento": {
            "title": "3. Seguimiento Vacío #9fc5e8 (Sin Nuevo TD)",
            "cmd": [PYTHON_EXE, "sync_seguimiento_vacio.py"] + (["--apply"] if apply else []) + ["--day", day_str]
        },
        "dispo": {
            "title": "4. Pintar Disponibilidad (VTV & Habilitaciones)",
            "cmd": ["node", "pintarDisponibilidad.js"]
        },
        "cordillera": {
            "title": "5. Viajes Cordillera ➡️ SEGURIDA VIAL",
            "cmd": [PYTHON_EXE, "main.py", "--seguridad-vial"] + ([] if apply else ["--dry-run"])
        },
        "conf_viaje": {
            "title": "6. UTE Cordillera ➡️ CONF. DE VIAJE",
            "cmd": [PYTHON_EXE, "main.py", "--conf-viaje"] + ([] if apply else ["--dry-run"])
        },
        "limpiar": {
            "title": "7. Limpieza / Reset de VACÍO (Herramienta)",
            "cmd": [PYTHON_EXE, "limpiar_vacio.py"] + (["--apply"] if apply else []) + ["--day", day_str]
        },
        "bajas": {
            "title": "8. Bajas de Diagrama ➡️ Movimientos (Hover Notes)",
            "cmd": [PYTHON_EXE, "sync_bajas_movimientos.py"] + ([] if apply else ["--dry-run"])
        }
    }

    results = []
    all_ok = True

    for mod_key in modules_to_run:
        info = modules_map.get(mod_key)
        if not info:
            print(f"[WARN] Módulo desconocido: {mod_key}")
            continue

        print(f"\n>>> Ejecutando: {info['title']}...")
        ok, dur, detail = run_command_module(info["cmd"], info["title"])
        results.append({
            "key": mod_key,
            "title": info["title"],
            "success": ok,
            "duration": round(dur, 2),
            "detail": detail
        })
        if not ok:
            all_ok = False
            print(f"    ❌ FALLÓ ({dur:.1f}s): {detail[:200]}")
        else:
            print(f"    ✅ OK ({dur:.1f}s)")

    # Resumen
    total_elapsed = round((datetime.now() - t_start).total_seconds(), 2)
    print("\n" + "-" * 80)
    print(f"  🏁 RESUMEN GENERAL (Tiempo total: {total_elapsed}s):")
    for r in results:
        status_sym = "✅ OK   " if r["success"] else "❌ ERROR"
        print(f"    {status_sym} | {r['title']:<45} | {r['duration']}s")
    print("-" * 80 + "\n")

    return {
        "timestamp": t_start.isoformat(),
        "total_elapsed_seconds": total_elapsed,
        "all_success": all_ok,
        "results": results
    }


def main():
    parser = argparse.ArgumentParser(description="Orquestador unificado de sincronizaciones diarias")
    parser.add_argument("--apply", action="store_true", help="Escribe los cambios reales en Google Sheets")
    parser.add_argument("--day", type=int, default=None, help="Día del mes a procesar (por defecto: día de hoy)")
    parser.add_argument("--module", type=str, default="all", choices=["all", "unified", "tracking", "vacio", "seguimiento", "dispo", "cordillera", "conf_viaje", "limpiar", "bajas"])
    parser.add_argument("--daemon", action="store_true", help="Bucle continuo en segundo plano")
    parser.add_argument("--interval", type=int, default=600, help="Intervalo en segundos en modo daemon (def: 600s)")

    args = parser.parse_args()

    # Módulos estándar que componen la rutina diaria ('all' ejecuta el motor unificado + disponibilidad + cordillera + bajas)
    if args.module == "all":
        selected_modules = ["unified", "dispo", "cordillera", "conf_viaje", "bajas"]
    else:
        selected_modules = [args.module]

    try:
        with ExecutionShield("Orquestador Maestro run_all_syncs"):
            if args.daemon:
                print(f"[DAEMON] Iniciando modo daemon cada {args.interval} segundos...")
                while True:
                    try:
                        execute_syncs(selected_modules, apply=args.apply, day=args.day)
                    except Exception as e:
                        print(f"[DAEMON ERROR] {e}")
                    time.sleep(args.interval)
            else:
                report = execute_syncs(selected_modules, apply=args.apply, day=args.day)
                if not report["all_success"]:
                    sys.exit(1)
    except ShieldBlockedException:
        print("[BLINDAJE] 🛡️ Salida limpia sin colisión.")
        sys.exit(0)


if __name__ == "__main__":
    main()
