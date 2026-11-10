#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  API WEB & SCHEDULER EN NUBE PARA RENDER (OPERATIVAS DIARIAS)
================================================================================
Descripción:
  Servidor FastAPI autónomo para ejecutar y calendarizar todas las tareas
  operativas en Render Cloud sin depender de una PC local encendida.
  
Características:
  1. Scheduler en segundo plano (APScheduler) para ejecución continua 24/7 en la nube.
  2. Endpoints HTTP REST para disparadores manuales / webhooks desde n8n o dashboards.
  3. Soporte multi-entorno: lee credenciales directamente desde GOOGLE_SERVICE_ACCOUNT_JSON.
================================================================================
"""

import os
import sys
import gc
import subprocess
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    from apscheduler.triggers.cron import CronTrigger
    HAS_SCHEDULER = True
except ImportError:
    HAS_SCHEDULER = False

from telegram_notifier import notify_task_result, send_telegram_message

BASE_DIR = Path(__file__).resolve().parent
PYTHON_EXE = sys.executable

app = FastAPI(
    title="Servicio de Operativas Diarias (Render Cloud)",
    description="Motor central de sincronizaciones y calendarización automática de flotas y viajes.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registro de estados en memoria
EXECUTION_STATE: Dict[str, Any] = {
    "tracking": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "vacio": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "seguimiento": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "dispo": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "cordillera": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "conf_viaje": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "limpiar": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "poll_vacio": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "unified": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "bajas": {"last_run": None, "status": "idle", "duration": 0, "output": ""},
    "all": {"last_run": None, "status": "idle", "duration": 0, "output": ""}
}

# Bloqueo global de concurrencia: Render Free dispone de 512MB RAM.
# Previene que dos subprocesos pesados de Google Sheets compitan o saturen la memoria a la vez.
EXECUTION_LOCK = threading.Lock()

# ==============================================================================
# CONFIGURACIÓN RESILIENTE DE TIMEOUTS Y MÁRGENES (CONFIGURABLE POR ENV VARS)
# ==============================================================================
# Margen general ampliado por defecto a 1800s (30 min) para evitar cortes prematuros
# en planillas extensas (ej. análisis multi-día, rotaciones de fin de mes o cuellos de botella).
DEFAULT_TASK_TIMEOUT = int(os.getenv("DEFAULT_TASK_TIMEOUT", "1800"))

BASE_TIMEOUTS: Dict[str, int] = {
    "poll_vacio": int(os.getenv("TIMEOUT_POLL_VACIO", "1800")),     # 30 min (cubre holgadamente escaneos pesados de ~880s)
    "unified": int(os.getenv("TIMEOUT_UNIFIED", "1800")),           # 30 min
    "all": int(os.getenv("TIMEOUT_ALL", "1800")),                   # 30 min
    "cordillera": int(os.getenv("TIMEOUT_CORDILLERA", "600")),      # 10 min (antes 5 min)
    "conf_viaje": int(os.getenv("TIMEOUT_CONF_VIAJE", "600")),      # 10 min (antes 5 min)
    "tracking": int(os.getenv("TIMEOUT_TRACKING", "600")),          # 10 min (antes 5 min)
    "vacio": int(os.getenv("TIMEOUT_VACIO", "600")),                # 10 min (antes 5 min)
    "seguimiento": int(os.getenv("TIMEOUT_SEGUIMIENTO", "600")),    # 10 min (antes 5 min)
    "dispo": int(os.getenv("TIMEOUT_DISPO", "600")),                # 10 min (antes 3 min)
    "bajas": int(os.getenv("TIMEOUT_BAJAS", "600")),                # 10 min (antes 3 min)
    "limpiar": int(os.getenv("TIMEOUT_LIMPIAR", "600"))             # 10 min (antes 5 min)
}

def get_timeout_for_task(key: str, override_timeout: Optional[int] = None) -> int:
    """Devuelve el timeout en segundos aplicando override explícito, variable de entorno o base con amplio margen."""
    if override_timeout and override_timeout > 0:
        return override_timeout
    env_key = f"TIMEOUT_{key.upper()}"
    if env_key in os.environ:
        try:
            return int(os.environ[env_key])
        except ValueError:
            pass
    return BASE_TIMEOUTS.get(key, DEFAULT_TASK_TIMEOUT)


def run_command(cmd: list, key: str, timeout: Optional[int] = None) -> Dict[str, Any]:
    """Ejecuta un comando transmitiendo la salida en vivo a consola y actualizando el estado de forma serializada."""
    t_enqueued = datetime.now()
    if EXECUTION_LOCK.locked():
        EXECUTION_STATE[key]["status"] = "waiting (en cola)"
        print(f"⏳ [{t_enqueued.strftime('%H:%M:%S')}] Tarea '{key}' esperando turno en cola (lock bloqueado)...", flush=True)

    with EXECUTION_LOCK:
        t0 = datetime.now()  # Momento real en el que arranca la ejecución del proceso hijo
        EXECUTION_STATE[key]["status"] = "running"
        EXECUTION_STATE[key]["last_run"] = t0.isoformat()
        EXECUTION_STATE[key]["duration"] = 0

        max_sec = get_timeout_for_task(key, timeout)
        output_lines = []
        error_lines = []
        returncode = -1
        timed_out = False

        print(f"\n==================================================================", flush=True)
        print(f"▶ [{t0.strftime('%H:%M:%S')}] INICIANDO TAREA: {key} (Timeout máx: {max_sec}s / {max_sec//60} min)", flush=True)
        print(f"  Comando: {' '.join(str(c) for c in cmd)}", flush=True)
        print(f"==================================================================", flush=True)

        try:
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"

            proc = subprocess.Popen(
                cmd,
                cwd=str(BASE_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                bufsize=1
            )

            # Transmisión en tiempo real a stdout/stderr de Render para evitar silencios en logs
            def stream_pipe(pipe, collector, is_err=False):
                try:
                    for line in iter(pipe.readline, ''):
                        if not line:
                            break
                        collector.append(line)
                        prefix = f"[{key}:err] " if is_err else f"[{key}] "
                        sys.stdout.write(prefix + line)
                        sys.stdout.flush()
                except Exception:
                    pass
                finally:
                    pipe.close()

            t_stdout = threading.Thread(target=stream_pipe, args=(proc.stdout, output_lines, False))
            t_stderr = threading.Thread(target=stream_pipe, args=(proc.stderr, error_lines, True))
            t_stdout.daemon = True
            t_stderr.daemon = True
            t_stdout.start()
            t_stderr.start()

            try:
                proc.wait(timeout=max_sec)
                returncode = proc.returncode
            except subprocess.TimeoutExpired:
                timed_out = True
                print(f"\n⏰ [{key}] TIMEOUT EXCEDIDO ({max_sec}s). Terminando subproceso forzadamente...", flush=True)
                proc.kill()
                proc.wait()
                returncode = -9
                error_lines.append(f"Timeout de {max_sec}s excedido")

            t_stdout.join(timeout=2)
            t_stderr.join(timeout=2)

            # Forzar limpieza inmediata de memoria tras salida del subproceso
            gc.collect()

            elapsed = round((datetime.now() - t0).total_seconds(), 2)
            success = (returncode == 0) and not timed_out
            stdout_txt = "".join(output_lines).strip()
            stderr_txt = "".join(error_lines).strip()

            result = {
                "task": key,
                "success": success,
                "exit_code": returncode,
                "duration_seconds": elapsed,
                "timestamp": t0.isoformat(),
                "output": stdout_txt if success else (stderr_txt or stdout_txt),
                "errors": stderr_txt if not success else ""
            }
            EXECUTION_STATE[key] = {
                "last_run": t0.isoformat(),
                "status": "success" if success else ("timeout" if timed_out else "failed"),
                "duration": elapsed,
                "output": result["output"][:500]
            }

            estado_str = "ÉXITO" if success else ("TIMEOUT" if timed_out else "FALLO")
            print(f"⏹ [{datetime.now().strftime('%H:%M:%S')}] FIN TAREA {key}: {estado_str} en {elapsed}s (Exit code: {returncode})\n", flush=True)

            # Notificación a Telegram (fallos inmediatos o todas según TELEGRAM_NOTIFY_ALL)
            try:
                notify_task_result(
                    task_name=key,
                    success=success,
                    duration=elapsed,
                    error_msg=stderr_txt,
                    output_preview=stdout_txt
                )
            except Exception as e_tg:
                print(f"[TELEGRAM] ⚠️ Error en handler de notificación: {e_tg}", flush=True)

            return result

        except Exception as e:
            elapsed = round((datetime.now() - t0).total_seconds(), 2)
            res_err = {
                "task": key,
                "success": False,
                "exit_code": -1,
                "duration_seconds": elapsed,
                "timestamp": t0.isoformat(),
                "output": "",
                "errors": str(e)
            }
            EXECUTION_STATE[key] = {
                "last_run": t0.isoformat(),
                "status": "error",
                "duration": elapsed,
                "output": str(e)
            }

            print(f"💥 [{datetime.now().strftime('%H:%M:%S')}] ERROR EN TAREA {key}: {e} en {elapsed}s\n", flush=True)

            try:
                notify_task_result(
                    task_name=key,
                    success=False,
                    duration=elapsed,
                    error_msg=str(e),
                    output_preview=""
                )
            except Exception as e_tg:
                print(f"[TELEGRAM] ⚠️ Error en handler de notificación: {e_tg}", flush=True)

            return res_err


def execute_or_background(
    cmd: list,
    key: str,
    timeout: Optional[int] = None,
    background: bool = False,
    bg_tasks: Optional[BackgroundTasks] = None
) -> Dict[str, Any]:
    """
    Ejecuta el comando en primer plano o lo despacha a BackgroundTasks (para evitar
    el timeout HTTP de 100s de Render cuando se invoca vía Webhook, n8n o cURL).
    """
    if background and bg_tasks is not None:
        eff_timeout = get_timeout_for_task(key, timeout)
        bg_tasks.add_task(run_command, cmd, key, eff_timeout)
        return {
            "status": "enqueued",
            "task": key,
            "mode": "background",
            "timeout_seconds": eff_timeout,
            "message": f"Tarea '{key}' iniciada en segundo plano con margen de {eff_timeout}s ({eff_timeout//60} min). Monitorea el progreso en /status.",
            "timestamp": datetime.now().isoformat()
        }
    return run_command(cmd, key, timeout=timeout)


# ==============================================================================
# ENDPOINTS REST
# ==============================================================================

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def root_dashboard():
    sched_ok = os.getenv("ENABLE_SCHEDULER", "true").lower() == "true"
    badge_color = "#10b981" if sched_ok else "#f59e0b"
    badge_text = "ACTIVO 24/7" if sched_ok else "MANUAL"

    tg_ok = bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID"))
    tg_color = "#10b981" if tg_ok else "#64748b"
    tg_text = "🔔 TELEGRAM ACTIVO" if tg_ok else "🔕 TELEGRAM INACTIVO"

    int_cord = os.getenv("INTERVAL_CORDILLERA_MINUTES", "10")
    int_conf = os.getenv("INTERVAL_CONF_VIAJE_MINUTES", "10")
    int_poll = os.getenv("INTERVAL_POLL_VACIO_MINUTES", "15")
    to_poll_m = get_timeout_for_task("poll_vacio") // 60
    to_cord_m = get_timeout_for_task("cordillera") // 60
    to_conf_m = get_timeout_for_task("conf_viaje") // 60
    to_dispo_m = get_timeout_for_task("dispo") // 60

    html_content = f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Servicio de Operativas Diarias (Render Cloud)</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }}
        .card {{
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            max-width: 600px;
            width: 100%;
            padding: 32px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
        }}
        h1 {{
            font-size: 1.5rem;
            margin: 0 0 8px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }}
        .badge {{
            display: inline-block;
            background: {badge_color};
            color: #0f172a;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 9999px;
            text-transform: uppercase;
        }}
        p {{
            color: #94a3b8;
            margin: 0 0 24px 0;
            line-height: 1.5;
        }}
        .links {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
            margin-top: 24px;
        }}
        .btn {{
            display: block;
            text-align: center;
            text-decoration: none;
            padding: 12px 16px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.9rem;
            transition: all 0.2s ease;
        }}
        .btn-primary {{
            background: #3b82f6;
            color: white;
        }}
        .btn-primary:hover {{
            background: #2563eb;
        }}
        .btn-secondary {{
            background: #334155;
            color: #e2e8f0;
        }}
        .btn-secondary:hover {{
            background: #475569;
        }}
        .tasks-list {{
            background: #0f172a;
            border-radius: 8px;
            padding: 16px;
            font-size: 0.85rem;
            color: #cbd5e1;
            margin-top: 20px;
        }}
        .tasks-list li {{
            margin-bottom: 6px;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
            <span class="badge" style="background: {badge_color};">● {badge_text}</span>
            <span class="badge" style="background: {tg_color}; color: #f8fafc;">● {tg_text}</span>
        </div>
        <h1 style="margin-top: 12px;">Servicio de Operativas Diarias</h1>
        <p>Motor de sincronización y automatización en la nube (Render Cloud) para planillas operativas, tracking, vacíos y disponibilidades.</p>
        
        <div class="tasks-list">
            <strong>Tareas programadas y márgenes de ejecución:</strong>
            <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                <li>Polling Inteligente (Tracking + Vacío + Seguimiento) — Cada {int_poll} min (Margen máx: {to_poll_m} min)</li>
                <li>Viajes Cordillera — Cada {int_cord} min (Margen máx: {to_cord_m} min)</li>
                <li>CONF. DE VIAJE — Cada {int_conf} min (Margen máx: {to_conf_m} min)</li>
                <li>Disponibilidad VTV — Diario 06:00 AM (Margen máx: {to_dispo_m} min)</li>
            </ul>
        </div>

        <div class="links">
            <a href="/docs" class="btn btn-primary">📖 Swagger UI</a>
            <a href="/status" class="btn btn-secondary">📊 Estado</a>
            <a href="/health" class="btn btn-secondary">🩺 Salud</a>
            <a href="/test-telegram" class="btn btn-secondary">🔔 Probar Telegram</a>
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html_content)

@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    return {
        "status": "ok",
        "service": "diaria-operativas",
        "scheduler_enabled": os.getenv("ENABLE_SCHEDULER", "true").lower() == "true",
        "has_scheduler_lib": HAS_SCHEDULER,
        "telegram_configured": bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
        "time": datetime.now().isoformat()
    }

@app.api_route("/test-telegram", methods=["GET", "POST"])
def test_telegram(message: str = Query("🔔 Mensaje de prueba desde Render Cloud")):
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return {
            "success": False,
            "configured": False,
            "error": "TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no están configurados en las variables de entorno de Render.",
            "instructions": "Agrega TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en el panel de Render > Environment."
        }
    ok = send_telegram_message(f"🧪 <b>Prueba de Notificación Telegram</b>\n{message}")
    return {
        "success": ok,
        "configured": True,
        "message": "Mensaje enviado exitosamente a Telegram." if ok else "Error al contactar API de Telegram (asegúrate de haber iniciado el bot con /start)."
    }

@app.get("/status")
def get_status():
    return {
        "time": datetime.now().isoformat(),
        "default_task_timeout_seconds": DEFAULT_TASK_TIMEOUT,
        "socket_timeout_seconds": int(os.getenv("SOCKET_TIMEOUT", "600")),
        "configured_timeouts_seconds": {k: get_timeout_for_task(k) for k in BASE_TIMEOUTS},
        "tasks": EXECUTION_STATE
    }

@app.post("/sync/tracking")
def trigger_tracking(
    day: Optional[int] = Query(None, description="Día específico del mes"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "sync_ruteos_movimientos.py", "--apply"]
    if day:
        args += ["--day", str(day)]
    return execute_or_background(args, "tracking", timeout, background, bg_tasks)

@app.post("/sync/vacio")
def trigger_vacio(
    day: Optional[int] = Query(None, description="Día específico del mes"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "sync_vacio.py", "--apply", "--borders"]
    if day:
        args += ["--day", str(day)]
    return execute_or_background(args, "vacio", timeout, background, bg_tasks)

@app.post("/sync/poll-vacio")
def trigger_poll_vacio(
    day: Optional[int] = Query(None, description="Día específico del mes"),
    force: bool = Query(False, description="Forzar ejecución ignorando hash previo"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 1800s / 30m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "poll_sync_vacio.py", "--apply", "--borders"]
    if day:
        args += ["--day", str(day)]
    if force:
        args.append("--force")
    return execute_or_background(args, "poll_vacio", timeout, background, bg_tasks)

@app.post("/sync/unified")
def trigger_unified(
    day: Optional[int] = Query(None, description="Día específico del mes"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 1800s / 30m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "sync_operativas_unificadas.py", "--apply", "--borders"]
    if day:
        args += ["--day", str(day)]
    return execute_or_background(args, "unified", timeout, background, bg_tasks)

@app.post("/sync/seguimiento-vacio")
def trigger_seguimiento_vacio(
    day: Optional[int] = Query(None, description="Día específico del mes"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "sync_seguimiento_vacio.py", "--apply"]
    if day:
        args += ["--day", str(day)]
    return execute_or_background(args, "seguimiento", timeout, background, bg_tasks)

@app.post("/sync/dispo")
def trigger_dispo(
    spreadsheet_id: Optional[str] = Query(None, description="ID de planilla opcional"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = ["node", "pintarDisponibilidad.js"]
    if spreadsheet_id:
        args.append(spreadsheet_id)
    return execute_or_background(args, "dispo", timeout, background, bg_tasks)

@app.post("/sync/cordillera")
def trigger_cordillera(
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    return execute_or_background([PYTHON_EXE, "main.py", "--seguridad-vial"], "cordillera", timeout, background, bg_tasks)

@app.post("/sync/conf-viaje")
def trigger_conf_viaje(
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    return execute_or_background([PYTHON_EXE, "main.py", "--conf-viaje"], "conf_viaje", timeout, background, bg_tasks)

@app.post("/sync/limpiar-vacio")
def trigger_limpiar_vacio(
    day: Optional[int] = Query(None, description="Día específico del mes"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "limpiar_vacio.py", "--apply"]
    if day:
        args += ["--day", str(day)]
    return execute_or_background(args, "limpiar", timeout, background, bg_tasks)

@app.post("/sync/bajas")
def trigger_bajas(
    dry_run: bool = Query(False, description="Modo simulación"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 600s / 10m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "sync_bajas_movimientos.py"]
    if dry_run:
        args.append("--dry-run")
    return execute_or_background(args, "bajas", timeout, background, bg_tasks)

@app.post("/sync/all")
def trigger_all(
    day: Optional[int] = Query(None, description="Día específico del mes"),
    timeout: Optional[int] = Query(None, description="Timeout en segundos (default 1800s / 30m)"),
    background: bool = Query(False, description="Ejecutar en segundo plano para evitar timeout HTTP de Render"),
    bg_tasks: BackgroundTasks = None
):
    args = [PYTHON_EXE, "run_all_syncs.py", "--apply", "--module", "all"]
    if day:
        args += ["--day", str(day)]
    return execute_or_background(args, "all", timeout, background, bg_tasks)


# ==============================================================================
# SCHEDULER EN SEGUNDO PLANO (APScheduler)
# ==============================================================================

if HAS_SCHEDULER and os.getenv("ENABLE_SCHEDULER", "true").lower() == "true":
    scheduler = BackgroundScheduler(
        timezone="America/Argentina/Buenos_Aires",
        job_defaults={
            "coalesce": True,        # Si se atrasó por cola, no acumula disparos repetidos
            "max_instances": 1       # Una sola instancia activa por tarea
        }
    )

    now = datetime.now()

    interval_cordillera = int(os.getenv("INTERVAL_CORDILLERA_MINUTES", "10"))
    interval_conf_viaje = int(os.getenv("INTERVAL_CONF_VIAJE_MINUTES", "10"))
    interval_poll_vacio = int(os.getenv("INTERVAL_POLL_VACIO_MINUTES", "15"))

    # Planificación escalonada (Staggered) para Render Free/Starter (límite 512MB RAM):
    # 1. Cordillera: cada N min (primer disparo en 1 min)
    scheduler.add_job(
        lambda: run_command([PYTHON_EXE, "main.py", "--seguridad-vial"], "cordillera"),
        trigger=IntervalTrigger(minutes=interval_cordillera),
        next_run_time=now + timedelta(minutes=1),
        id="job_cordillera",
        replace_existing=True
    )

    # 2. CONF. DE VIAJE: cada N min (primer disparo en 3 min)
    scheduler.add_job(
        lambda: run_command([PYTHON_EXE, "main.py", "--conf-viaje"], "conf_viaje"),
        trigger=IntervalTrigger(minutes=interval_conf_viaje),
        next_run_time=now + timedelta(minutes=3),
        id="job_conf_viaje",
        replace_existing=True
    )

    # 3. Polling Inteligente Unificado (Tracking + VACÍO + Seguimiento en Capas): cada N min (primer disparo en 5 min)
    # Por defecto 15m para dejar amplio margen tras ejecuciones multi-día (~700-880s)
    scheduler.add_job(
        lambda: run_command([PYTHON_EXE, "poll_sync_vacio.py", "--apply", "--borders"], "poll_vacio"),
        trigger=IntervalTrigger(minutes=interval_poll_vacio),
        next_run_time=now + timedelta(minutes=5),
        id="job_poll_vacio",
        replace_existing=True
    )

    # 4. Disponibilidad: diario 06:00 AM
    scheduler.add_job(
        lambda: run_command(["node", "pintarDisponibilidad.js"], "dispo"),
        trigger=CronTrigger(hour=6, minute=0),
        id="job_dispo",
        replace_existing=True
    )

    scheduler.start()
    print(f"[SCHEDULER] ✅ APScheduler iniciado con tareas escalonadas (Cordillera: {interval_cordillera}m, CONF: {interval_conf_viaje}m, Polling: {interval_poll_vacio}m, Dispo: 06:00 AM).")
else:
    print("[SCHEDULER] 🛡️ Scheduler en segundo plano DESHABILITADO (ENABLE_SCHEDULER=false). Modo seguro: no se ejecutarán tareas diarias ni llamadas automáticas a Google Sheets.")
