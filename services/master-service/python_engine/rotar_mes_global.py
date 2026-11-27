#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  ROTACIÓN GLOBAL DE MES OPERATIVO (PARAMETRIZABLE MES A MES)
================================================================================
Propósito:
  Ejecutar atómicamente la transición mensual de IDs y pestañas operativas en:
    1. config_operativas.json & config.json (operativas_diarias / python_engine)
    2. Archivos .env y .env.example
    3. Archivos render.yaml (monorepo raíz + node_backend + python_engine + legacy)
    4. Base de datos SQLite de n8n (basesOrgTractores01 y ProIae9THNBFF8oR)
    5. Espejos de workflows n8n en JSON
    6. Defaults y fallbacks en scripts Python / Node.js (incluyendo DASH y sheets.js)
    7. Notas de control en Obsidian Vault (id movimientos.md y ute. movimientos. seguridad..md)

Uso:
  # Simulación segura (Dry-run, no modifica archivos):
  py -3.13 rotar_mes_global.py --dry-run

  # Aplicación real (usa los defaults del próximo mes configurado):
  py -3.13 rotar_mes_global.py --apply

  # Uso genérico para cualquier mes futuro (solo volcás las IDs nuevas):
  py -3.13 rotar_mes_global.py --mes-nombre "Enero 2027" --mov-id <ID_MOV> --ruteos-id <ID_RUTEOS> --apply
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
from typing import Dict, Any, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

MESES_ABREV = {
    "enero": "Ene", "febrero": "Feb", "marzo": "Mar", "abril": "Abr",
    "mayo": "May", "junio": "Jun", "julio": "Jul", "agosto": "Ago",
    "septiembre": "Sep", "octubre": "Oct", "noviembre": "Nov", "diciembre": "Dic"
}

# ==============================================================================
# 🎯 PARÁMETROS POR DEFECTO DEL PRÓXIMO MES OPERATIVO (DICIEMBRE 2026)
# ==============================================================================
DEFAULT_NUEVO_MES_NOMBRE = "Diciembre 2026"
DEFAULT_NUEVO_MOV_ID = "14QpWY9KvOVj2Yinn5F1hOiSkTxASYwLc-Cd7F2rFO_k"
DEFAULT_NUEVO_RUTEOS_ID = "1h-x0rFJLrZxyhzFhRi03BDPN3APSx0EwpkbJo7F15Ms"
DEFAULT_CONF_VIAJE_ID = "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU"
DEFAULT_RUTEOS_TAB = "Ruteos"

# Fallback saliente (si config_operativas.json no estuviera disponible)
FALLBACK_SALIENTE = {
    "nombre": "Noviembre 2026",
    "ruteos_id": "1oIadEZE1vXCOaTjj8USAOAYVwibY5XMfmCaJbp0bqZE",
    "tab_ruteos": "Ruteos",
    "movimientos_id": "1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc",
    "tab_movimientos": "NOVIEMBRE 2026- Mov.Unidades y Choferes",
    "conf_viaje_id": "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU",
    "tab_conf_source": "UTE Cordillera Noviembre 26",
    "tab_conf_target": "CONF. DE VIAJE NOVIEMBRE 26",
}

# Rutas Base
USER_HOME = Path(r"C:\Users\Matias Rodriguez")
DOCS = USER_HOME / "Documents"
DESKTOP = USER_HOME / "Desktop"
MONOREPO = DOCS / "logistica-monorepo"
PYTHON_ENGINE = MONOREPO / "services" / "master-service" / "python_engine"
NODE_BACKEND = MONOREPO / "services" / "master-service" / "node_backend"
N8N_DIR = USER_HOME / ".n8n"
OBSIDIAN_NOTE = DOCS / "Obsidian Vault" / "id movimientos.md"
OBSIDIAN_UTE_NOTE = DOCS / "Obsidian Vault" / "ute. movimientos. seguridad..md"


def log(msg: str, tag: str = "INFO"):
    print(f"[{tag}] {msg}")


def derive_month_tokens(mes_nombre: str) -> Dict[str, str]:
    """Deriva tokens estándar desde 'Diciembre 2026' -> corto, tab diagrama, tabs mov/conf."""
    parts = mes_nombre.strip().split()
    mes_word = parts[0].capitalize()
    anio = parts[1] if len(parts) > 1 else str(datetime.now().year)
    yy = anio[-2:]
    abrev = MESES_ABREV.get(mes_word.lower(), mes_word[:3].capitalize())
    return {
        "nombre": f"{mes_word} {anio}",
        "corto": f"{mes_word} {yy}",
        "diagrama_tab": f"{abrev}-{yy}",
        "mov_tab": f"{mes_word.upper()} {anio}- Mov.Unidades y Choferes",
        "conf_source": f"UTE Cordillera {mes_word} {yy}",
        "conf_target": f"CONF. DE VIAJE {mes_word.upper()} {yy}",
    }


def load_outgoing_config() -> Dict[str, str]:
    """Lee el mes saliente actual desde config_operativas.json (auto-detección mes a mes)."""
    cfg_path = PYTHON_ENGINE / "config_operativas.json"
    if cfg_path.exists():
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            actual = data.get("mes_actual", {})
            if actual.get("movimientos_id") and actual.get("ruteos_id"):
                return {**FALLBACK_SALIENTE, **actual}
        except Exception as e:
            log(f"Error leyendo {cfg_path}: {e}. Usando fallback.", "WARN")
    return dict(FALLBACK_SALIENTE)


# ==============================================================================
# 1. ACTUALIZAR CONFIG_OPERATIVAS.JSON Y CONFIG.JSON
# ==============================================================================
def update_operativas_configs(ctx: Dict[str, Any], apply_changes: bool, summary: Dict[str, List[str]]):
    oper_dirs = [PYTHON_ENGINE]

    log("--- 1. Actualizando configuraciones locales de operativas (Bridge Dual-Month) ---")
    for oper_dir in oper_dirs:
        cfg_oper_path = oper_dir / "config_operativas.json"
        cfg_dispo_path = oper_dir / "config.json"
        cache_prev = oper_dir / "cache_mes_anterior.json"

        if cfg_oper_path.exists():
            with open(cfg_oper_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)

            old_actual = dict(cfg.get("mes_actual", {}))
            if old_actual.get("movimientos_id") and old_actual.get("movimientos_id") != ctx["in_mov_id"]:
                cfg["mes_anterior"] = old_actual
            cfg["mes_actual"] = {
                "nombre": ctx["in_nombre"],
                "ruteos_id": ctx["in_ruteos_id"],
                "tab_ruteos": ctx["in_ruteos_tab"],
                "movimientos_id": ctx["in_mov_id"],
                "tab_movimientos": ctx["in_mov_tab"],
                "conf_viaje_id": ctx["in_conf_id"],
                "tab_conf_source": ctx["in_conf_source"],
                "tab_conf_target": ctx["in_conf_target"],
            }
            cfg["dias_transicion_lectura_dual"] = 7

            log(f"config_operativas.json ({oper_dir.name}): {ctx['out_nombre']} -> {ctx['in_nombre']} (Mov: {ctx['in_mov_id']}, Ruteos: {ctx['in_ruteos_id']})")
            summary["configs"].append(f"{cfg_oper_path} (mes_actual={ctx['in_nombre']}, mes_anterior={cfg.get('mes_anterior', {}).get('nombre', '-')})")

            if apply_changes:
                with open(cfg_oper_path, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, indent=2, ensure_ascii=False)
                if cache_prev.exists():
                    cache_prev.unlink()
                    log(f"Caché previa purgada: {cache_prev.name}", "OK")

        if cfg_dispo_path.exists():
            with open(cfg_dispo_path, "r", encoding="utf-8") as f:
                cdisp = json.load(f)

            cdisp["spreadsheetId"] = ctx["in_mov_id"]
            cdisp["spreadsheetIdsActivos"] = [ctx["in_mov_id"]]
            guardadas = cdisp.get("planillasGuardadas", [])
            for g in guardadas:
                if g.get("id") == ctx["out_mov_id"]:
                    g["nombre"] = ctx["out_nombre"]
                elif g.get("id") == ctx["in_mov_id"]:
                    g["nombre"] = f"{ctx['in_nombre']} (Activa)"
                    g["pestaña"] = ctx["in_mov_tab"]

            if not any(g.get("id") == ctx["in_mov_id"] for g in guardadas):
                guardadas.insert(0, {
                    "id": ctx["in_mov_id"],
                    "nombre": f"{ctx['in_nombre']} (Activa)",
                    "pestaña": ctx["in_mov_tab"]
                })
            cdisp["planillasGuardadas"] = guardadas

            log(f"config.json ({oper_dir.name}): spreadsheetId = {ctx['in_mov_id']}")
            summary["configs"].append(f"{cfg_dispo_path} (spreadsheetId={ctx['in_mov_id']})")
            if apply_changes:
                with open(cfg_dispo_path, "w", encoding="utf-8") as f:
                    json.dump(cdisp, f, indent=2, ensure_ascii=False)


# ==============================================================================
# 2. ACTUALIZAR ARCHIVOS .ENV
# ==============================================================================
ENV_FILES = [
    NODE_BACKEND / ".env",
    MONOREPO / ".env.example",
    DOCS / "server_local" / ".env",
    DOCS / "server_local" / "extractor_local" / ".env",
]


def update_env_files(ctx: Dict[str, Any], apply_changes: bool, summary: Dict[str, List[str]]):
    log("--- 2. Actualizando archivos .env y .env.example ---")
    replacements = {
        "MES_MOVIMIENTOS_ID=": ctx["in_mov_id"],
        "ID_SHEET_MOVIMIENTOS=": ctx["in_mov_id"],
        "TAB_MOVIMIENTOS=": ctx["in_mov_tab"],
        "DEFAULT_RUTEOS_ID=": ctx["in_ruteos_id"],
        "RUTEOS_ID=": ctx["in_ruteos_id"],
        "CONF_SOURCE_SHEET_NAME=": ctx["in_conf_source"],
        "CONF_TARGET_SHEET_NAME=": ctx["in_conf_target"],
    }
    for env_path in ENV_FILES:
        if not env_path.exists():
            continue

        with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        changed = False
        new_lines = []
        for line in lines:
            line_str = line
            for prefix, target_val in replacements.items():
                if line.startswith(prefix):
                    new_val = f"{prefix}{target_val}\n"
                    if line_str != new_val:
                        line_str = new_val
                        changed = True
                    break
            new_lines.append(line_str)

        if changed:
            log(f".env modificado: {env_path}")
            summary["envs"].append(str(env_path))
            if apply_changes:
                if env_path.name == ".env":
                    shutil.copy2(env_path, env_path.with_suffix(".env.bak_rotacion"))
                with open(env_path, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)
        else:
            log(f".env sin cambios necesarios: {env_path}")


# ==============================================================================
# 3. ACTUALIZAR ARCHIVOS RENDER.YAML
# ==============================================================================
RENDER_FILES = [
    MONOREPO / "render.yaml",
    NODE_BACKEND / "render.yaml",
    PYTHON_ENGINE / "render.yaml",
]


def update_render_yamls(ctx: Dict[str, Any], apply_changes: bool, summary: Dict[str, List[str]]):
    log("--- 3. Actualizando archivos render.yaml (incluyendo DEFAULT_RUTEOS_ID) ---")
    for rpath in RENDER_FILES:
        if not rpath.exists():
            continue

        with open(rpath, "r", encoding="utf-8") as f:
            content = f.read()

        new_content = content
        new_content = new_content.replace(ctx["out_mov_id"], ctx["in_mov_id"])
        new_content = new_content.replace(ctx["out_ruteos_id"], ctx["in_ruteos_id"])
        new_content = new_content.replace(ctx["out_mov_tab"], ctx["in_mov_tab"])
        new_content = new_content.replace(ctx["out_conf_source"], ctx["in_conf_source"])
        new_content = new_content.replace(ctx["out_conf_target"], ctx["in_conf_target"])

        if new_content != content:
            log(f"render.yaml modificado: {rpath}")
            summary["render"].append(str(rpath))
            if apply_changes:
                shutil.copy2(rpath, rpath.with_suffix(".yaml.bak_rotacion"))
                with open(rpath, "w", encoding="utf-8") as f:
                    f.write(new_content)
        else:
            log(f"render.yaml sin cambios: {rpath}")


# ==============================================================================
# 4. ACTUALIZAR BASE DE DATOS SQLITE Y WORKFLOWS N8N
# ==============================================================================
def _replace_in_obj(obj: Any, ctx: Dict[str, Any], update_diagram_tab: bool = False) -> Any:
    if isinstance(obj, str):
        s = obj
        s = s.replace(ctx["out_mov_id"], ctx["in_mov_id"])
        s = s.replace(ctx["out_ruteos_id"], ctx["in_ruteos_id"])
        s = s.replace(ctx["out_mov_tab"], ctx["in_mov_tab"])
        s = s.replace(ctx["out_conf_source"], ctx["in_conf_source"])
        s = s.replace(ctx["out_conf_target"], ctx["in_conf_target"])
        if update_diagram_tab:
            s = re.sub(r"'[A-Z][a-z]{2}-\d{2}'", f"'{ctx['in_diagrama_tab']}'", s)
        return s
    if isinstance(obj, list):
        return [_replace_in_obj(x, ctx, update_diagram_tab) for x in obj]
    if isinstance(obj, dict):
        return {k: _replace_in_obj(v, ctx, update_diagram_tab) for k, v in obj.items()}
    return obj


def update_n8n_database(ctx: Dict[str, Any], apply_changes: bool, summary: Dict[str, List[str]]):
    db_path = N8N_DIR / "database.sqlite"
    log("--- 4. Actualizando base de datos SQLite de n8n (localhost:5678) ---")
    if not db_path.exists():
        log(f"Base de datos n8n no encontrada: {db_path}", "ERROR")
        return

    conn = sqlite3.connect(f"file:{db_path}?mode=ro" if not apply_changes else str(db_path), uri=not apply_changes)
    cur = conn.cursor()

    cur.execute("SELECT id, name, nodes FROM workflow_entity WHERE id IN ('basesOrgTractores01', 'ProIae9THNBFF8oR')")
    rows = cur.fetchall()

    for wfid, wfname, nodes_json in rows:
        nodes = json.loads(nodes_json)
        new_nodes = []
        changed_nodes = 0

        for n in nodes:
            nname = n.get("name", "")
            is_diag_node = (wfid == "basesOrgTractores01" and nname in [
                "⚙️ Configuración: Choferes",
                "⚙️ Configuración: Días Diagrama",
                "3. Normalizar Calendario y Diffing O(1)",
            ])
            updated_n = _replace_in_obj(n, ctx, update_diagram_tab=is_diag_node)
            if updated_n != n:
                changed_nodes += 1
            new_nodes.append(updated_n)

        if changed_nodes > 0:
            log(f"Workflow '{wfname}' ({wfid}): {changed_nodes} nodo(s) actualizados")
            summary["n8n"].append(f"{wfid} ({changed_nodes} nodos)")
            if apply_changes:
                cur.execute("UPDATE workflow_entity SET nodes = ? WHERE id = ?", (json.dumps(new_nodes, ensure_ascii=False), wfid))

    if apply_changes:
        bak_db = db_path.with_suffix(".sqlite.bak_rotacion")
        shutil.copy2(db_path, bak_db)
        conn.commit()
        log(f"Base de datos SQLite de n8n guardada y respaldada en {bak_db.name}", "OK")
    conn.close()

    mirror_files = [
        PYTHON_ENGINE / "n8n_workflow_integrado_operativas.json",
        DOCS / "server_local" / "n8n" / "workflows" / "bases_organizacion_tractores.json",
        DOCS / "server_local" / "n8n" / "workflows" / "operativas_diarias_diagrama.json",
        DOCS / "server_local" / "n8n" / "workflows" / "activos_recientes" / "bases_organizacion_tractores.json",
    ]
    for mpath in mirror_files:
        if mpath.exists():
            with open(mpath, "r", encoding="utf-8") as f:
                c = f.read()
            nc = (
                c.replace(ctx["out_mov_id"], ctx["in_mov_id"])
                .replace(ctx["out_ruteos_id"], ctx["in_ruteos_id"])
                .replace(ctx["out_mov_tab"], ctx["in_mov_tab"])
                .replace(ctx["out_conf_source"], ctx["in_conf_source"])
                .replace(ctx["out_conf_target"], ctx["in_conf_target"])
            )
            nc = re.sub(r"'[A-Z][a-z]{2}-\d{2}'", f"'{ctx['in_diagrama_tab']}'", nc)
            if nc != c:
                log(f"Espejo n8n JSON modificado: {mpath.name}")
                summary["n8n_mirrors"].append(str(mpath))
                if apply_changes:
                    with open(mpath, "w", encoding="utf-8") as f:
                        f.write(nc)


# ==============================================================================
# 5. ACTUALIZAR DEFAULTS Y FALLBACKS EN SCRIPTS PYTHON Y NODE.JS
# ==============================================================================
SCRIPT_FALLBACK_FILES = [
    PYTHON_ENGINE / "sync_ruteos_movimientos.py",
    PYTHON_ENGINE / "sync_vacio.py",
    PYTHON_ENGINE / "sync_seguimiento_vacio.py",
    PYTHON_ENGINE / "config.py",
    PYTHON_ENGINE / "config_operativas.py",
    PYTHON_ENGINE / "core.js",
    NODE_BACKEND / "utils" / "shared.js",
    NODE_BACKEND / "utils" / "sheets.js",
    NODE_BACKEND / "routes" / "movimientos.js",
    NODE_BACKEND / "routes" / "dash.js",
    DOCS / "server_local" / "extractor_local" / "utils" / "shared.js",
    DOCS / "server_local" / "extractor_local" / "utils" / "sheets.js",
]


def update_scripts_fallbacks(ctx: Dict[str, Any], apply_changes: bool, summary: Dict[str, List[str]]):
    log("--- 5. Actualizando defaults y fallbacks en scripts Python / Node.js ---")
    for spath in SCRIPT_FALLBACK_FILES:
        if not spath.exists():
            continue

        with open(spath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        new_c = content
        new_c = new_c.replace(ctx["out_mov_id"], ctx["in_mov_id"])
        new_c = new_c.replace(ctx["out_ruteos_id"], ctx["in_ruteos_id"])
        new_c = new_c.replace(ctx["out_mov_tab"], ctx["in_mov_tab"])
        new_c = new_c.replace(ctx["out_conf_source"], ctx["in_conf_source"])
        new_c = new_c.replace(ctx["out_conf_target"], ctx["in_conf_target"])

        if spath.name == "config_operativas.py":
            new_c = new_c.replace(f'"{ctx["out_nombre"]}"', f'"{ctx["in_nombre"]}"')

        if spath.name == "sheets.js":
            new_c = re.sub(
                r'(resolveTabNameDiagramas\([^)]*fallbackName\s*=\s*["\'])[A-Z][a-z]{2}-\d{2}(["\'])',
                rf'\g<1>{ctx["in_diagrama_tab"]}\g<2>',
                new_c,
            )

        if new_c != content:
            log(f"Fallback en script actualizado: {spath.name} ({spath.parent.name})")
            summary["scripts"].append(str(spath))
            if apply_changes:
                with open(spath, "w", encoding="utf-8") as f:
                    f.write(new_c)


# ==============================================================================
# 6. ACTUALIZAR NOTAS EN OBSIDIAN VAULT
# ==============================================================================
def update_obsidian_notes(ctx: Dict[str, Any], apply_changes: bool, summary: Dict[str, List[str]]):
    log("--- 6. Actualizando notas de control en Obsidian Vault ---")
    if OBSIDIAN_NOTE.exists():
        with open(OBSIDIAN_NOTE, "r", encoding="utf-8") as f:
            old_md = f.read()

        # Preservar fila histórica del mes saliente si no existe aún en la tabla
        hist_row = f"| **{ctx['out_nombre']}** | `{ctx['out_mov_id']}` | `{ctx['out_mov_tab']}` |"
        hist_marker = "## 📂 Meses Anteriores (Histórico de Auditoría)"
        hist_rows = []
        if hist_marker in old_md:
            after_hist = old_md.split(hist_marker, 1)[1].split("---", 1)[0]
            for line in after_hist.splitlines():
                if line.strip().startswith("| **") and ctx["in_mov_id"] not in line:
                    hist_rows.append(line.strip())
        if hist_row not in hist_rows:
            hist_rows.insert(0, hist_row)
        hist_table = "\n".join(hist_rows)

        note_content = f"""# Control de Movimientos y Rotación Mensual

#local_server #backend #n8n #render #operativas #monorepo #idmensual #org

---

## 📌 Mes Activo: {ctx['in_nombre']}
- **Estado:** {'✅ ACTIVO / EN PRODUCCIÓN' if apply_changes else '⏳ PREPARADO PARA CORTE'} (`logistica-monorepo` unificado)
- **Spreadsheet ID:** `{ctx['in_mov_id']}`
- **URL Google Sheets:** [Abrir Planilla Movimientos {ctx['in_nombre']}](https://docs.google.com/spreadsheets/d/{ctx['in_mov_id']}/edit)
- **Pestaña Principal:** `{ctx['in_mov_tab']}`
- **Pestaña Vencimientos Flota:** `base datos Uni QM`

---

## 🔄 Configuración de Ruteos, DASH y Operativas Asociadas
- **Planilla Ruteos:** `{ctx['in_ruteos_id']}` (Pestaña: `{ctx['in_ruteos_tab']}`)
- **CONF. DE VIAJE ID:** `{ctx['in_conf_id']}`
  - **Origen:** `{ctx['in_conf_source']}`
  - **Destino:** `{ctx['in_conf_target']}`
- **Diagramas (Choferes / Días):** `{ctx['in_diagrama_tab']}` en `14jgQZF0gkbT7k3mps1k3dM3qtoaseoCOUfK4PFRozKU`
- **Monorepo Unificado (`logistica-monorepo` — Servicio Maestro `diaria-operativas`):**
  - **Blueprint Render:** `C:\\Users\\Matias Rodriguez\\Documents\\logistica-monorepo\\render.yaml`
  - **Config Dual-Month (Bridge):** `services/master-service/python_engine/config_operativas.json`

---

## 📂 Meses Anteriores (Histórico de Auditoría)
| Mes | Spreadsheet ID | Pestaña |
| :--- | :--- | :--- |
{hist_table}

---

## 🔁 Protocolo Mes a Mes (Solo Volcar IDs)
```powershell
cd "C:\\Users\\Matias Rodriguez\\Documents\\logistica-monorepo"
py -3.13 services/master-service/python_engine/rotar_mes_global.py --mes-nombre "Enero 2027" --mov-id <ID_MOV> --ruteos-id <ID_RUTEOS> --dry-run
py -3.13 services/master-service/python_engine/rotar_mes_global.py --mes-nombre "Enero 2027" --mov-id <ID_MOV> --ruteos-id <ID_RUTEOS> --apply
```
- **Última actualización:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

#idmensual
"""
        summary["obsidian"].append(str(OBSIDIAN_NOTE))
        if apply_changes:
            with open(OBSIDIAN_NOTE, "w", encoding="utf-8") as f:
                f.write(note_content)
            log(f"Nota Obsidian actualizada: {OBSIDIAN_NOTE.name}", "OK")

    if OBSIDIAN_UTE_NOTE.exists():
        with open(OBSIDIAN_UTE_NOTE, "r", encoding="utf-8") as f:
            ute_md = f.read()
        entry = f"\nute {ctx['in_nombre'].lower()} https://docs.google.com/spreadsheets/d/{ctx['in_ruteos_id']}/edit?gid=757061763#gid=757061763\n"
        if ctx["in_ruteos_id"] not in ute_md:
            new_ute_md = ute_md.replace(ctx["out_conf_source"], ctx["in_conf_source"]).replace(ctx["out_conf_target"], ctx["in_conf_target"])
            new_ute_md = new_ute_md.replace("obsidian://open", f"{entry}\nobsidian://open") if "obsidian://open" in new_ute_md else new_ute_md + entry
            summary["obsidian"].append(str(OBSIDIAN_UTE_NOTE))
            if apply_changes:
                with open(OBSIDIAN_UTE_NOTE, "w", encoding="utf-8") as f:
                    f.write(new_ute_md)
                log(f"Nota Obsidian UTE actualizada: {OBSIDIAN_UTE_NOTE.name}", "OK")


# ==============================================================================
# MAIN ORCHESTRATOR
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Rotación Global de Mes Operativo (Mes a Mes)")
    parser.add_argument("--apply", action="store_true", help="Aplica las modificaciones a los archivos y DB")
    parser.add_argument("--dry-run", action="store_true", help="Simula los cambios sin modificar archivos (por defecto)")
    parser.add_argument("--mes-nombre", default=DEFAULT_NUEVO_MES_NOMBRE, help="Ej: 'Diciembre 2026'")
    parser.add_argument("--mov-id", default=DEFAULT_NUEVO_MOV_ID, help="Nuevo Spreadsheet ID de Movimientos")
    parser.add_argument("--ruteos-id", default=DEFAULT_NUEVO_RUTEOS_ID, help="Nuevo Spreadsheet ID de UTE/Ruteos")
    parser.add_argument("--diagrama-tab", default=None, help="Pestaña de Diagramas (ej: Dic-26)")
    parser.add_argument("--tab-mov", default=None, help="Pestaña principal de Movimientos")
    parser.add_argument("--conf-source", default=None, help="Pestaña origen CONF. DE VIAJE")
    parser.add_argument("--conf-target", default=None, help="Pestaña destino CONF. DE VIAJE")
    args = parser.parse_args()

    apply_changes = args.apply and not args.dry_run
    tokens = derive_month_tokens(args.mes_nombre)
    outgoing = load_outgoing_config()

    ctx = {
        "out_nombre": outgoing["nombre"],
        "out_mov_id": outgoing["movimientos_id"],
        "out_mov_tab": outgoing["tab_movimientos"],
        "out_ruteos_id": outgoing["ruteos_id"],
        "out_ruteos_tab": outgoing["tab_ruteos"],
        "out_conf_id": outgoing.get("conf_viaje_id", DEFAULT_CONF_VIAJE_ID),
        "out_conf_source": outgoing["tab_conf_source"],
        "out_conf_target": outgoing["tab_conf_target"],
        "in_nombre": tokens["nombre"],
        "in_corto": tokens["corto"],
        "in_diagrama_tab": args.diagrama_tab or tokens["diagrama_tab"],
        "in_mov_id": args.mov_id.strip(),
        "in_mov_tab": args.tab_mov or tokens["mov_tab"],
        "in_ruteos_id": args.ruteos_id.strip(),
        "in_ruteos_tab": DEFAULT_RUTEOS_TAB,
        "in_conf_id": DEFAULT_CONF_VIAJE_ID,
        "in_conf_source": args.conf_source or tokens["conf_source"],
        "in_conf_target": args.conf_target or tokens["conf_target"],
    }

    summary: Dict[str, List[str]] = {
        "configs": [], "envs": [], "render": [],
        "n8n": [], "n8n_mirrors": [], "scripts": [], "obsidian": [],
    }

    print("\n" + "=" * 74)
    mode_label = "APLICACIÓN REAL" if apply_changes else "SIMULACIÓN SEGURA (DRY-RUN)"
    print(f"  {mode_label}: {ctx['out_nombre']} -> {ctx['in_nombre']}")
    print("=" * 74 + "\n")

    update_operativas_configs(ctx, apply_changes, summary)
    update_env_files(ctx, apply_changes, summary)
    update_render_yamls(ctx, apply_changes, summary)
    update_n8n_database(ctx, apply_changes, summary)
    update_scripts_fallbacks(ctx, apply_changes, summary)
    update_obsidian_notes(ctx, apply_changes, summary)

    print("\n" + "=" * 74)
    print("  SUMARIZACIÓN DE IMPACTO")
    print("=" * 74)
    for k, items in summary.items():
        print(f"  - {k:<12}: {len(items)} elemento(s)")
    total = sum(len(v) for v in summary.values())
    print(f"  - TOTAL       : {total} elemento(s) {'actualizados' if apply_changes else 'listos para actualizar'}")
    print("=" * 74 + "\n")


if __name__ == "__main__":
    main()
