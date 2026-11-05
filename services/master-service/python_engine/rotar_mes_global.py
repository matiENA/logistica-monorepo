#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  ROTACIÓN GLOBAL DE MES OPERATIVO (NOVIEMBRE 2026)
================================================================================
Propósito:
  Ejecutar atómicamente la transición mensual de IDs y pestañas operativas en:
    1. config_operativas.json & config.json (operativas_diarias)
    2. Archivos .env (6 proyectos locales)
    3. Archivos render.yaml (blueprints para servicios en Render)
    4. Base de datos SQLite de n8n (basesOrgTractores01 y ProIae9THNBFF8oR)
    5. Espejos de workflows n8n en JSON
    6. Defaults y fallbacks en scripts Python / Node.js
    7. Nota de control en Obsidian Vault (id movimientos.md)

Uso:
  # Simulación segura (Dry-run, no modifica archivos):
  py -3.13 rotar_mes_global.py --dry-run

  # Aplicación real de los cambios:
  py -3.13 rotar_mes_global.py --apply
================================================================================
"""

import os
import sys
import json
import re
import shutil
import sqlite3
import argparse
from pathlib import Path
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ==============================================================================
# 🎯 PARÁMETROS DEL MES OPERATIVO (CONFIGURACIÓN NOVIEMBRE 2026)
# ==============================================================================
NUEVO_MES_NOMBRE = "Noviembre 2026"
NUEVO_MES_CORTO = "Noviembre 26"
NUEVO_DIAGRAMA_TAB = "Nov-26"

# Spreadsheet IDs
OCTUBRE_MOV_ID = "14Mb5rD853zxDkaLDS-IrW-OBDTDBjuJxn_3olXeWlkc"
SEPTIEMBRE_MOV_ID = "1Bwj8WCykMn_FbZhQ_FqnDH3K_WCod52YTSvsaxIDNS8"
NOVIEMBRE_MOV_ID = "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc"

OCTUBRE_MOV_TAB = "OCTUBRE 2026- Mov.Unidades y Choferes"
NOVIEMBRE_MOV_TAB = "NOVIEMBRE 2026- Mov.Unidades y Choferes"

RUTEOS_ID_ACTUAL = "1oIadEZE1vXCOaTjj8USAOAYVwibY5XMfmCaJbp0bqZE"
RUTEOS_TAB = "Ruteos"

CONF_VIAJE_ID = "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU"
OCT_CONF_SOURCE = "UTE Cordillera Octubre 26"
OCT_CONF_TARGET = "CONF. DE VIAJE OCTUBRE 26"
NOV_CONF_SOURCE = f"UTE Cordillera {NUEVO_MES_CORTO}"
NOV_CONF_TARGET = f"CONF. DE VIAJE {NUEVO_MES_CORTO.upper()}"

# Rutas Base
USER_HOME = Path(r"C:\Users\Matias Rodriguez")
DOCS = USER_HOME / "Documents"
DESKTOP = USER_HOME / "Desktop"
N8N_DIR = USER_HOME / ".n8n"
OBSIDIAN_NOTE = DOCS / "Obsidian Vault" / "id movimientos.md"


def log(msg: str, tag: str = "INFO"):
    print(f"[{tag}] {msg}")


# ==============================================================================
# 1. ACTUALIZAR CONFIG_OPERATIVAS.JSON Y CONFIG.JSON
# ==============================================================================
def update_operativas_configs(apply_changes: bool):
    monorepo_oper_dir = DOCS / "logistica-monorepo" / "services" / "master-service" / "python_engine"
    legacy_oper_dir = DOCS / "server_local" / "operativas_diarias"
    oper_dirs = [d for d in (monorepo_oper_dir, legacy_oper_dir) if d.exists()]

    log("--- 1. Actualizando configuraciones locales de operativas ---")
    for oper_dir in oper_dirs:
        cfg_oper_path = oper_dir / "config_operativas.json"
        cfg_dispo_path = oper_dir / "config.json"
        cache_prev = oper_dir / "cache_mes_anterior.json"

        if cfg_oper_path.exists():
            with open(cfg_oper_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)

            old_actual = dict(cfg.get("mes_actual", {}))
            if old_actual.get("movimientos_id") and old_actual.get("movimientos_id") != NOVIEMBRE_MOV_ID:
                cfg["mes_anterior"] = old_actual
            cfg["mes_actual"] = {
                "nombre": NUEVO_MES_NOMBRE,
                "ruteos_id": RUTEOS_ID_ACTUAL,
                "tab_ruteos": RUTEOS_TAB,
                "movimientos_id": NOVIEMBRE_MOV_ID,
                "tab_movimientos": NOVIEMBRE_MOV_TAB,
                "conf_viaje_id": CONF_VIAJE_ID,
                "tab_conf_source": NOV_CONF_SOURCE,
                "tab_conf_target": NOV_CONF_TARGET
            }
            cfg["dias_transicion_lectura_dual"] = 7

            log(f"config_operativas.json ({oper_dir.name}): Nuevo mes actual = {NUEVO_MES_NOMBRE} (ID: {NOVIEMBRE_MOV_ID})")

            if apply_changes:
                with open(cfg_oper_path, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, indent=2, ensure_ascii=False)
                log(f"{cfg_oper_path} guardado exitosamente.", "OK")

                if cache_prev.exists():
                    cache_prev.unlink()
                    log(f"Caché previa purgada: {cache_prev.name}", "OK")

        if cfg_dispo_path.exists():
            with open(cfg_dispo_path, "r", encoding="utf-8") as f:
                cdisp = json.load(f)

            cdisp["spreadsheetId"] = NOVIEMBRE_MOV_ID
            guardadas = cdisp.get("planillasGuardadas", [])
            for g in guardadas:
                if g.get("id") == OCTUBRE_MOV_ID:
                    g["nombre"] = "Octubre 2026"
                elif g.get("id") == NOVIEMBRE_MOV_ID:
                    g["nombre"] = f"{NUEVO_MES_NOMBRE} (Activa)"
                    g["pestaña"] = NOVIEMBRE_MOV_TAB

            if not any(g.get("id") == NOVIEMBRE_MOV_ID for g in guardadas):
                guardadas.insert(0, {
                    "id": NOVIEMBRE_MOV_ID,
                    "nombre": f"{NUEVO_MES_NOMBRE} (Activa)",
                    "pestaña": NOVIEMBRE_MOV_TAB
                })
            cdisp["planillasGuardadas"] = guardadas

            log(f"config.json ({oper_dir.name}): spreadsheetId principal establecido a {NOVIEMBRE_MOV_ID}")
            if apply_changes:
                with open(cfg_dispo_path, "w", encoding="utf-8") as f:
                    json.dump(cdisp, f, indent=2, ensure_ascii=False)
                log(f"{cfg_dispo_path} guardado exitosamente.", "OK")


# ==============================================================================
# 2. ACTUALIZAR ARCHIVOS .ENV
# ==============================================================================
ENV_FILES = [
    DOCS / "logistica-monorepo" / "services" / "master-service" / "node_backend" / ".env",
    DOCS / "logistica-monorepo" / "apps" / "panol" / ".env",
    DOCS / "logistica-monorepo" / "apps" / "panol" / "backend" / ".env",
    DOCS / "eor_v1" / ".env",
    DOCS / "server_local" / ".env",
    DOCS / "server_local" / "extractor_local" / ".env",
    DOCS / "server_local" / "sheet-render" / ".env",
    DOCS / "panol" / ".env",
    DOCS / "panol" / "backend" / ".env",
    DOCS / "dash" / "backend" / ".env",
    DESKTOP / "jAVI" / "diagramas" / "diagramasnode" / ".env"
]

def update_env_files(apply_changes: bool):
    log("--- 2. Actualizando archivos .env ---")
    for env_path in ENV_FILES:
        if not env_path.exists():
            log(f"Archivo no encontrado (se omite): {env_path}", "WARN")
            continue

        with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        changed = False
        new_lines = []
        for line in lines:
            line_str = line
            # Actualizar MES_MOVIMIENTOS_ID
            if line.startswith("MES_MOVIMIENTOS_ID="):
                new_val = f"MES_MOVIMIENTOS_ID={NOVIEMBRE_MOV_ID}\n"
                if line_str != new_val:
                    line_str = new_val
                    changed = True
            # Actualizar ID_SHEET_MOVIMIENTOS
            elif line.startswith("ID_SHEET_MOVIMIENTOS="):
                new_val = f"ID_SHEET_MOVIMIENTOS={NOVIEMBRE_MOV_ID}\n"
                if line_str != new_val:
                    line_str = new_val
                    changed = True
            new_lines.append(line_str)

        if changed:
            log(f".env modificado: {env_path}")
            if apply_changes:
                # Backup previo
                bak_path = env_path.with_suffix(".env.bak_rotacion")
                shutil.copy2(env_path, bak_path)
                with open(env_path, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)
                log(f"Archivo guardado y respaldado en {bak_path.name}", "OK")
        else:
            log(f".env sin cambios necesarios: {env_path}")


# ==============================================================================
# 3. ACTUALIZAR ARCHIVOS RENDER.YAML
# ==============================================================================
RENDER_FILES = [
    DOCS / "logistica-monorepo" / "render.yaml",
    DOCS / "eor_v1" / "render.yaml",
    DOCS / "eor_v1" / "deploy" / "render.yaml",
    DOCS / "server_local" / "operativas_diarias" / "render.yaml",
    DOCS / "server_local" / "sheet-render" / "render.yaml",
    DOCS / "panol" / "render.yaml",
    DOCS / "dash" / "render.yaml",
    DESKTOP / "jAVI" / "diagramas" / "diagramasnode" / "render.yaml"
]

def update_render_yamls(apply_changes: bool):
    log("--- 3. Actualizando archivos render.yaml ---")
    for rpath in RENDER_FILES:
        if not rpath.exists():
            continue

        with open(rpath, "r", encoding="utf-8") as f:
            content = f.read()

        new_content = content
        # Reemplazar ID de movimientos (tanto de Octubre como de Septiembre en panol)
        new_content = new_content.replace(OCTUBRE_MOV_ID, NOVIEMBRE_MOV_ID)
        new_content = new_content.replace(SEPTIEMBRE_MOV_ID, NOVIEMBRE_MOV_ID)

        # Reemplazar nombres de pestañas de Movimientos y CONF. DE VIAJE en blueprints Render
        new_content = new_content.replace(OCTUBRE_MOV_TAB, NOVIEMBRE_MOV_TAB)
        new_content = new_content.replace(OCT_CONF_SOURCE, NOV_CONF_SOURCE)
        new_content = new_content.replace(OCT_CONF_TARGET, NOV_CONF_TARGET)

        if new_content != content:
            log(f"render.yaml modificado: {rpath}")
            if apply_changes:
                bak_path = rpath.with_suffix(".yaml.bak_rotacion")
                shutil.copy2(rpath, bak_path)
                with open(rpath, "w", encoding="utf-8") as f:
                    f.write(new_content)
                log(f"render.yaml actualizado y respaldado en {bak_path.name}", "OK")
        else:
            log(f"render.yaml sin cambios: {rpath}")


# ==============================================================================
# 4. ACTUALIZAR BASE DE DATOS SQLITE Y WORKFLOWS N8N
# ==============================================================================
def update_n8n_database(apply_changes: bool):
    db_path = N8N_DIR / "database.sqlite"
    log("--- 4. Actualizando base de datos SQLite de n8n ---")
    if not db_path.exists():
        log(f"Base de datos n8n no encontrada: {db_path}", "ERROR")
        return

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("SELECT id, name, nodes FROM workflow_entity WHERE id IN ('basesOrgTractores01', 'ProIae9THNBFF8oR')")
    rows = cur.fetchall()

    for wfid, wfname, nodes_json in rows:
        nodes = json.loads(nodes_json)
        wf_modified = False

        if wfid == "basesOrgTractores01":
            for n in nodes:
                nname = n.get("name", "")
                params = n.get("parameters", {})
                assignments = params.get("assignments", {}).get("assignments", [])

                for a in assignments:
                    val = a.get("value", "")
                    if isinstance(val, str):
                        # Reemplazar ID de spreadsheet
                        if OCTUBRE_MOV_ID in val:
                            a["value"] = val.replace(OCTUBRE_MOV_ID, NOVIEMBRE_MOV_ID)
                            wf_modified = True
                        # Reemplazar nombre de pestaña
                        if OCTUBRE_MOV_TAB in val:
                            a["value"] = val.replace(OCTUBRE_MOV_TAB, NOVIEMBRE_MOV_TAB)
                            wf_modified = True
                        # Actualizar pestaña de diagrama (cualquier mes anterior ej. 'Oct-26', 'Nov-26') dinámicamente con regex
                        if nname in ["⚙️ Configuración: Choferes", "⚙️ Configuración: Días Diagrama"]:
                            new_tab_val = re.sub(r"'[A-Z][a-z]{2}-\d{2}'", f"'{NUEVO_DIAGRAMA_TAB}'", val)
                            if new_tab_val != val:
                                a["value"] = new_tab_val
                                wf_modified = True

            if wf_modified:
                log(f"Workflow '{wfname}' ({wfid}) actualizado en memoria con ID {NOVIEMBRE_MOV_ID}")
                if apply_changes:
                    cur.execute("UPDATE workflow_entity SET nodes = ? WHERE id = ?", (json.dumps(nodes, ensure_ascii=False), wfid))

        elif wfid == "ProIae9THNBFF8oR":
            for n in nodes:
                if n.get("type") == "n8n-nodes-base.stickyNote":
                    params = n.get("parameters", {})
                    content = params.get("content", "")
                    if OCTUBRE_MOV_ID in content:
                        params["content"] = content.replace(OCTUBRE_MOV_ID, NOVIEMBRE_MOV_ID)
                        wf_modified = True

            if wf_modified:
                log(f"Workflow '{wfname}' ({wfid}) notas sticky actualizadas con ID {NOVIEMBRE_MOV_ID}")
                if apply_changes:
                    cur.execute("UPDATE workflow_entity SET nodes = ? WHERE id = ?", (json.dumps(nodes, ensure_ascii=False), wfid))

    if apply_changes:
        # Backup previo de la base de datos sqlite
        bak_db = db_path.with_suffix(".sqlite.bak_rotacion")
        shutil.copy2(db_path, bak_db)
        conn.commit()
        log(f"Base de datos SQLite de n8n guardada y respaldada en {bak_db.name}", "OK")
    conn.close()

    # Actualizar espejos JSON en disco
    mirror_files = [
        DOCS / "server_local" / "n8n" / "workflows" / "bases_organizacion_tractores.json",
        DOCS / "server_local" / "n8n" / "workflows" / "activos_recientes" / "bases_organizacion_tractores.json",
        DOCS / "eor_v1" / "extraction" / "n8n" / "workflows" / "bases_organizacion_tractores.json"
    ]
    for mpath in mirror_files:
        if mpath.exists():
            with open(mpath, "r", encoding="utf-8") as f:
                c = f.read()
            nc = c.replace(OCTUBRE_MOV_ID, NOVIEMBRE_MOV_ID).replace(OCTUBRE_MOV_TAB, NOVIEMBRE_MOV_TAB)
            nc = re.sub(r"'[A-Z][a-z]{2}-\d{2}'", f"'{NUEVO_DIAGRAMA_TAB}'", nc)
            if nc != c:
                log(f"Espejo n8n JSON modificado: {mpath.name}")
                if apply_changes:
                    with open(mpath, "w", encoding="utf-8") as f:
                        f.write(nc)
                    log(f"Espejo {mpath.name} guardado.", "OK")


# ==============================================================================
# 5. ACTUALIZAR DEFAULTS Y FALLBACKS EN SCRIPTS PYTHON Y NODE.JS
# ==============================================================================
SCRIPT_FALLBACK_FILES = [
    DOCS / "logistica-monorepo" / "services" / "master-service" / "python_engine" / "sync_ruteos_movimientos.py",
    DOCS / "logistica-monorepo" / "services" / "master-service" / "python_engine" / "sync_vacio.py",
    DOCS / "logistica-monorepo" / "services" / "master-service" / "python_engine" / "sync_seguimiento_vacio.py",
    DOCS / "logistica-monorepo" / "services" / "master-service" / "python_engine" / "config_operativas.py",
    DOCS / "logistica-monorepo" / "services" / "master-service" / "python_engine" / "core.js",
    DOCS / "logistica-monorepo" / "services" / "master-service" / "node_backend" / "utils" / "shared.js",
    DOCS / "logistica-monorepo" / "services" / "master-service" / "node_backend" / "utils" / "sheets.js",
    DOCS / "server_local" / "operativas_diarias" / "sync_ruteos_movimientos.py",
    DOCS / "server_local" / "operativas_diarias" / "sync_vacio.py",
    DOCS / "server_local" / "operativas_diarias" / "sync_seguimiento_vacio.py",
    DOCS / "server_local" / "operativas_diarias" / "config_operativas.py",
    DOCS / "server_local" / "operativas_diarias" / "core.js",
    DOCS / "eor_v1" / "apps" / "backend" / "utils" / "shared.js",
    DOCS / "eor_v1" / "apps" / "backend" / "utils" / "sheets.js",
    DOCS / "server_local" / "sheet-render" / "utils" / "shared.js",
    DOCS / "server_local" / "extractor_local" / "utils" / "shared.js",
    DESKTOP / "jAVI" / "diagramas" / "diagramasnode" / "utils" / "shared.js"
]

def update_scripts_fallbacks(apply_changes: bool):
    log("--- 5. Actualizando defaults y fallbacks en scripts de código ---")
    for spath in SCRIPT_FALLBACK_FILES:
        if not spath.exists():
            continue

        with open(spath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        new_c = content
        new_c = new_c.replace(OCTUBRE_MOV_ID, NOVIEMBRE_MOV_ID)
        new_c = new_c.replace(OCTUBRE_MOV_TAB, NOVIEMBRE_MOV_TAB)

        if spath.name == "config_operativas.py":
            # Actualizar valores por defecto de variables exportadas
            new_c = new_c.replace('"Octubre 2026"', f'"{NUEVO_MES_NOMBRE}"')
            new_c = new_c.replace(OCT_CONF_TARGET, NOV_CONF_TARGET)

        if new_c != content:
            log(f"Fallback en script actualizado: {spath.name} ({spath.parent.name})")
            if apply_changes:
                with open(spath, "w", encoding="utf-8") as f:
                    f.write(new_c)
                log(f"Script {spath.name} guardado.", "OK")
        else:
            log(f"Script sin cambios necesarios: {spath.name}")


# ==============================================================================
# 6. ACTUALIZAR NOTA EN OBSIDIAN VAULT (SINGLE SOURCE OF TRUTH)
# ==============================================================================
def update_obsidian_note(apply_changes: bool):
    log("--- 6. Actualizando nota de control en Obsidian Vault ---")
    if not OBSIDIAN_NOTE.exists():
        log(f"Nota Obsidian no encontrada: {OBSIDIAN_NOTE}", "WARN")
        return

    note_content = f"""# Control de Movimientos y Rotación Mensual

#local_server #backend #n8n #render #operativas

---

## 📌 Mes Activo: {NUEVO_MES_NOMBRE}
- **Estado:** {'✅ ACTIVO / EN PRODUCCIÓN' if apply_changes else '⏳ LISTO PARA IMPLEMENTAR (DOMINGO 1, 00:00)'}
- **Spreadsheet ID:** `{NOVIEMBRE_MOV_ID}`
- **URL Google Sheets:** [Abrir Planilla Movimientos {NUEVO_MES_NOMBRE}](https://docs.google.com/spreadsheets/d/{NOVIEMBRE_MOV_ID}/edit)
- **Pestaña Principal:** `{NOVIEMBRE_MOV_TAB}`
- **Pestaña Vencimientos Flota:** `base datos Uni QM`

---

## 🔄 Configuración de Ruteos y Operativas Asociadas
- **Planilla Ruteos:** `{RUTEOS_ID_ACTUAL}` (Pestaña: `{RUTEOS_TAB}`)
- **CONF. DE VIAJE ID:** `{CONF_VIAJE_ID}`
  - **Origen:** `{NOV_CONF_SOURCE}`
  - **Destino:** `{NOV_CONF_TARGET}`
- **Diagramas (Choferes / Días):** `{NUEVO_DIAGRAMA_TAB}` en `14jgQZF0gkbT7k3mps1k3dM3qtoaseoCOUfK4PFRozKU`
- **Monorepo Unificado (`logistica-monorepo` — DASH & Sincronización Bajas Hover):**
  - **Blueprint Render:** `C:\\Users\\Matias Rodriguez\\Documents\\logistica-monorepo\\render.yaml` (`ID_SHEET_MOVIMIENTOS`, `MES_MOVIMIENTOS_ID`, `TAB_MOVIMIENTOS`)
  - **Variables Locales:** `C:\\Users\\Matias Rodriguez\\Documents\\logistica-monorepo\\services\\master-service\\node_backend\\.env`
  - **Motor Nativo Node.js:** `services/master-service/node_backend/utils/googleSheetsSync.js` (Inyección y limpieza de notas hover por UUID `tipos_novedad.imprime_nota_movimientos`)
  - **Motor CLI / FastAPI Python:** `services/master-service/python_engine/sync_bajas_movimientos.py` (`POST /sync/bajas`)

---

## 📂 Meses Anteriores (Histórico de Auditoría)
| Mes | Spreadsheet ID | Pestaña |
| :--- | :--- | :--- |
| **Octubre 2026** | `{OCTUBRE_MOV_ID}` | `OCTUBRE 2026- Mov.Unidades y Choferes` |
| **Septiembre 2026** | `{SEPTIEMBRE_MOV_ID}` | `SEPTIEMBRE 2026- Mov.Unidades y Choferes` |
| **Agosto 2026** | `1vYw-Zm51m50PeJmvLqshW4lBDonI7KTvBD14uIJioAU` | `AGOSTO 2026- Mov.Unidades y Choferes` |

---

## 🛠️ Herramientas de Ejecución
- **Documentación y Roadmap de Automatización:** [[procesos cambio mensual.]]
- **Script Unificado (Monorepo):** `C:\\Users\\Matias Rodriguez\\Documents\\logistica-monorepo\\services\\master-service\\python_engine\\rotar_mes_global.py`
- **Lanzador por Lotes:** `C:\\Users\\Matias Rodriguez\\Documents\\server_local\\operativas_diarias\\ejecutar_rotacion_noviembre.bat`
- **Tarea Programada Windows:** `RotacionMesNoviembre` (Programada para domingo 01/11/2026 a las 00:00:00)
- **Última actualización:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

#idmensual
"""

    if apply_changes:
        with open(OBSIDIAN_NOTE, "w", encoding="utf-8") as f:
            f.write(note_content)
        log(f"Nota de Obsidian actualizada exitosamente: {OBSIDIAN_NOTE.name}", "OK")
    else:
        log("Nota de Obsidian preparada en memoria para escribir al aplicar.")


# ==============================================================================
# MAIN ORCHESTRATOR
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Rotación Global de Mes Operativo")
    parser.add_argument("--apply", action="store_true", help="Aplica las modificaciones a los archivos y DB")
    parser.add_argument("--dry-run", action="store_true", help="Simula los cambios sin modificar archivos (por defecto)")
    args = parser.parse_args()

    apply_changes = args.apply and not args.dry_run

    print("\n" + "=" * 70)
    if apply_changes:
        print("  🚀 INICIANDO APLICACIÓN REAL DE ROTACIÓN MENSUAL (NOVIEMBRE 2026)")
    else:
        print("  🔍 SIMULACIÓN SEGURA (DRY-RUN) - NINGÚN ARCHIVO SERÁ MODIFICADO")
    print("=" * 70 + "\n")

    update_operativas_configs(apply_changes)
    update_env_files(apply_changes)
    update_render_yamls(apply_changes)
    update_n8n_database(apply_changes)
    update_scripts_fallbacks(apply_changes)
    update_obsidian_note(apply_changes)

    print("\n" + "=" * 70)
    if apply_changes:
        print("  ✅ ROTACIÓN MENSUAL COMPLETADA CON ÉXITO")
        print("  Todos los archivos .env, render.yaml, n8n y configs han sido actualizados.")
    else:
        print("  ✅ SIMULACIÓN EXITOSA")
        print("  Ejecute con '--apply' para persistir los cambios.")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
