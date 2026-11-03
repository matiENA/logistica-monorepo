#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  MÓDULO DE BLINDAJE DE CONCURRENCIA & GENERADOR DE REPORTES DE AUDITORÍA
================================================================================
1. ExecutionShield:
   Garantiza exclusión mutua estricta a nivel de sistema operativo para prevenir
   que ejecuciones concurrentes de sincronización o polling compitan o colisionen.
   Utiliza verificación de PID nativa mediante Win32 API (kernel32.OpenProcess)
   y auto-recuperación ante bloqueos huérfanos (stale locks).

2. AuditReporter:
   Genera reportes detallados en formato Markdown y JSONL en la carpeta 'reportes/'
   cada vez que se detectan y aplican cambios, permitiendo la auditoría inmediata
   y verificación visual de celdas en 'Movimientos'.
================================================================================
"""

import os
import sys
import json
import time
import ctypes
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

BASE_DIR = Path(__file__).resolve().parent
REPORTES_DIR = BASE_DIR / "reportes"
LOCK_FILE = BASE_DIR / ".sync.lock"

# Configurar salida UTF-8
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def is_pid_running_windows(pid: int) -> bool:
    """Verifica si un PID de Windows se encuentra en ejecución activa."""
    if pid <= 0:
        return False
    # PROCESS_QUERY_LIMITED_INFORMATION (0x1000) | SYNCHRONIZE (0x00100000) = 0x101000
    try:
        handle = ctypes.windll.kernel32.OpenProcess(0x101000, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    except Exception:
        return False


class ShieldBlockedException(Exception):
    """Excepción lanzada cuando otra sincronización ya se encuentra en ejecución."""
    pass


class ExecutionShield:
    """
    Context manager para blindar ejecuciones operativas contra superposiciones.
    
    Uso:
        with ExecutionShield("Polling Inteligente"):
            # Trabajo protegido
            ...
    """
    def __init__(self, task_name: str = "Sincronización", max_age_seconds: int = 300):
        self.task_name = task_name
        self.max_age_seconds = max_age_seconds
        self.acquired = False

    def __enter__(self):
        if LOCK_FILE.exists():
            try:
                with open(LOCK_FILE, "r", encoding="utf-8") as f:
                    lock_data = json.load(f)
                locked_pid = lock_data.get("pid", 0)
                started_at_str = lock_data.get("started_at", "")
                locked_task = lock_data.get("task", "Desconocida")

                lock_age = 0
                if started_at_str:
                    try:
                        started_dt = datetime.fromisoformat(started_at_str)
                        lock_age = (datetime.now() - started_dt).total_seconds()
                    except Exception:
                        pass

                # Verificar si el proceso sigue vivo
                if is_pid_running_windows(locked_pid) and lock_age < self.max_age_seconds:
                    print(f"\n[BLINDAJE] 🔒 Proceso en curso detectado: '{locked_task}' (PID {locked_pid}, hace {int(lock_age)}s).")
                    print(f"[BLINDAJE] 🛡️ Omitiendo ejecución actual para evitar superposición concurrente.")
                    raise ShieldBlockedException(f"Bloqueo activo por PID {locked_pid}")
                else:
                    # Stale lock (proceso muerto o superó el tiempo máximo)
                    print(f"[BLINDAJE] ⚠️ Limpiando bloqueo huérfano/expirado previo (PID {locked_pid}, antigüedad {int(lock_age)}s).")
                    try:
                        LOCK_FILE.unlink(missing_ok=True)
                    except Exception:
                        pass
            except ShieldBlockedException:
                raise
            except Exception as e:
                print(f"[BLINDAJE] ⚠️ Error leyendo archivo de bloqueo, renovando: {e}")
                try:
                    LOCK_FILE.unlink(missing_ok=True)
                except Exception:
                    pass

        # Adquirir nuevo bloqueo
        lock_info = {
            "pid": os.getpid(),
            "task": self.task_name,
            "started_at": datetime.now().isoformat(),
            "command": " ".join(sys.argv)
        }
        try:
            with open(LOCK_FILE, "w", encoding="utf-8") as f:
                json.dump(lock_info, f, indent=2)
            self.acquired = True
        except Exception as e:
            print(f"[BLINDAJE] ⚠️ No se pudo escribir archivo de bloqueo: {e}")

        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.acquired:
            try:
                if LOCK_FILE.exists():
                    LOCK_FILE.unlink(missing_ok=True)
            except Exception as e:
                print(f"[BLINDAJE] ⚠️ Error eliminando archivo de bloqueo: {e}")
        # Si fue ShieldBlockedException, no propagar para permitir salida limpia
        if exc_type is ShieldBlockedException:
            return True
        return False


def generate_audit_report(
    analysis: Dict[str, Any],
    batch_result: Optional[Dict[str, Any]] = None,
    apply: bool = False,
    mode: str = "Polling Inteligente Unificado",
    duration_sec: float = 0.0
) -> str:
    """
    Genera un informe completo en Markdown en 'reportes/ULTIMO_REPORTE_POLLING.md'
    y un archivo histórico fechado en 'reportes/'. Retorna la ruta al reporte generado.
    """
    REPORTES_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    timestamp_filename = now.strftime("%Y%m%d_%H%M%S")

    day = analysis.get("day", now.day)
    notes = analysis.get("notes", [])
    borders = analysis.get("borders", [])
    colors = analysis.get("colors", [])

    paint_list = [c for c in colors if c.get("action") == "paint"]
    clear_list = [c for c in colors if c.get("action") == "clear"]

    applied_ops = batch_result.get("updated_count", 0) if batch_result else 0
    batches_cnt = batch_result.get("batches", 0) if batch_result else 0

    mode_label = "✅ APLICADO REAL EN GOOGLE SHEETS" if apply else "ℹ️ SIMULACIÓN (DRY-RUN - Sin escrituras)"

    md_lines = [
        "# 📊 Reporte de Auditoría: Sincronización Operativa Diaria",
        "",
        f"- **Fecha y Hora:** `{now_str}`",
        f"- **Día Operativo Procesado:** `Día {day} de {datetime.now().strftime('%B')}`",
        f"- **Modo de Ejecución:** **{mode_label}**",
        f"- **Motor:** `{mode}`",
        f"- **Duración Total:** `{duration_sec:.2f} segundos`",
        f"- **Operaciones en Google Sheets:** `{applied_ops} operaciones en {batches_cnt} lote(s)`",
        "",
        "---",
        "",
        "## 📈 Resumen Ejecutivo de Métricas",
        "",
        "| Métrica | Cantidad Detectada | Estado en Sheets |",
        "| :--- | :--- | :--- |",
        f"| **Notas Hover Actualizadas (Capa 1 & 2)** | `{len(notes)}` | {'Aplicadas' if apply else 'Simuladas'} |",
        f"| **Bordes Dobles de VACÍO (SOLID_MEDIUM)** | `{len(borders)}` | {'Aplicados' if apply else 'Simulados'} |",
        f"| **Celdas Pintadas Celeste (#9fc5e8)** | `+{len(paint_list)}` | {'Coloreadas' if apply else 'Simuladas'} |",
        f"| **Celdas Limpiadas (Cleanup automático)** | `-{len(clear_list)}` | {'Restauradas' if apply else 'Simuladas'} |",
        "",
        "---",
        "",
        "## 🔍 Detalle de Celdas Modificadas en la Planilla Mensual de Movimientos",
        "",
        "> 💡 **Verificación Visual:** Puedes abrir la planilla y buscar las siguientes coordenadas exactas:",
        ""
    ]

    # Tabla detallada de notas y bordes
    if notes:
        md_lines.append("### 📝 Notas en Hover y Bordes (Capa 1 & Capa 2)")
        md_lines.append("")
        md_lines.append("| Celda | Fila | Slot | Tractor | UT | TD | Encabezado Col X | Borde SOLID_MEDIUM |")
        md_lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")

        border_coords = {b["cell_coord"] for b in borders}

        for n in notes:
            cell = n.get("cell_coord", "")
            r = n.get("row", "")
            slot = n.get("slot", "")
            trk = n.get("trk", "")
            ut = n.get("ut", "")
            td = n.get("td", "")
            vacio = n.get("vacio_header") or "*(Sin vacío / Solo Tracking)*"
            has_border = "✅ Sí (Doble)" if cell in border_coords else "❌ No"
            md_lines.append(f"| **`{cell}`** | {r} | Slot {slot} | `{trk}` | {ut} | `{td}` | `{vacio}` | {has_border} |")

        md_lines.append("")

    # Tabla de Seguimiento Celeste (#9fc5e8)
    if colors:
        md_lines.append("### 🎨 Seguimiento de Vacío: Pintados y Cleanups (Capa 3)")
        md_lines.append("")
        md_lines.append("| Celda | Fila | Tractor | Acción | Último TD | Reporte Vacío | Columna Dispo | Motivo |")
        md_lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")

        for c in colors:
            cell = c.get("cell_coord", "")
            r = c.get("row", "")
            trk = c.get("trk", "")
            action = "🎨 PINTAR #9fc5e8" if c.get("action") == "paint" else "🧹 CLEANUP (Restaurar)"
            td = c.get("td", "-")
            vacio = c.get("vacio", "-")
            dispo = c.get("dispo", "-")
            reason = "Vacío sin TD posterior (Dispo válida)" if c.get("action") == "paint" else c.get("reason", "Nuevo TD asignado o Dispo excluida")
            md_lines.append(f"| **`{cell}`** | {r} | `{trk}` | **{action}** | `{td}` | `{vacio}` | `{dispo}` | {reason} |")

        md_lines.append("")

    # Muestra del contenido textual de las notas
    if notes:
        md_lines.append("### 📜 Muestra del Texto de Notas Hover (Top 10)")
        md_lines.append("")
        for idx, n in enumerate(notes[:10], 1):
            cell = n.get("cell_coord", "")
            trk = n.get("trk", "")
            note_content = n.get("new_note", "").replace("\n", "\n> ")
            md_lines.append(f"#### [{idx}] Celda `{cell}` (Tractor `{trk}`)")
            md_lines.append(f"> {note_content}")
            md_lines.append("")

    md_lines.append("---")
    md_lines.append("*Reporte autogenerado por el Motor Operativo Unificado — Central Operativa Diaria © 2026*")

    md_content = "\n".join(md_lines)

    # 1. Guardar archivo principal más reciente (sobreescribible)
    latest_path = REPORTES_DIR / "ULTIMO_REPORTE_POLLING.md"
    try:
        with open(latest_path, "w", encoding="utf-8") as f:
            f.write(md_content)
    except Exception as e:
        print(f"[REPORTE] ⚠️ Error guardando reporte principal: {e}")

    # 2. Guardar archivo histórico con timestamp
    archive_path = REPORTES_DIR / f"reporte_{timestamp_filename}.md"
    try:
        with open(archive_path, "w", encoding="utf-8") as f:
            f.write(md_content)
    except Exception as e:
        print(f"[REPORTE] ⚠️ Error guardando archivo histórico: {e}")

    # 3. Guardar línea en JSONL histórico
    jsonl_path = REPORTES_DIR / "historial_auditoria.jsonl"
    jsonl_entry = {
        "timestamp": now.isoformat(),
        "day": day,
        "mode": mode,
        "apply": apply,
        "duration_sec": duration_sec,
        "notes_count": len(notes),
        "borders_count": len(borders),
        "paint_count": len(paint_list),
        "clear_count": len(clear_list),
        "applied_ops": applied_ops
    }
    try:
        with open(jsonl_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(jsonl_entry, ensure_ascii=False) + "\n")
    except Exception:
        pass

    return str(latest_path)
