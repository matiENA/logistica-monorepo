@echo off
title [LOGISTICA] Backend Maestro (Node.js Gateway + Python Engine)
cd /d "%~dp0\..\services\master-service"

set RUN_SCHEDULER=false
if "%1"=="--with-scheduler" set RUN_SCHEDULER=true

echo ==============================================================
echo 🚀 INICIANDO SERVICIO MAESTRO LOCAL
echo    Puerto Node Gateway:   3005 (o segun .env)
echo    Puerto Python Engine:  8000
if "%RUN_SCHEDULER%"=="true" (
    echo    Tareas Diarias (disp): ACTIVADAS (Modo scheduler)
) else (
    echo    Tareas Diarias (disp): DESACTIVADAS (Proteccion Google API)
)
echo ==============================================================

set ENABLE_SCHEDULER=%RUN_SCHEDULER%
set ENABLE_QUEUE_RUNNER=%RUN_SCHEDULER%
set ENABLE_RAM_CACHE_POLLING=false

start "Python Engine (FastAPI)" cmd /k "set ENABLE_SCHEDULER=%RUN_SCHEDULER% && cd /d python_engine && python -m uvicorn server_render:app --host 127.0.0.1 --port 8000 --reload"
timeout /t 2 /nobreak >nul
cd /d node_backend && set ENABLE_QUEUE_RUNNER=%RUN_SCHEDULER% && set ENABLE_RAM_CACHE_POLLING=false && node --watch server.js

