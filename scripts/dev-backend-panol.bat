@echo off
title [LOGISTICA] Backend Maestro + Pañol
cd /d "%~dp0\.."

set RUN_SCHEDULER=false
if "%1"=="--with-scheduler" set RUN_SCHEDULER=true

echo ==============================================================
echo 🚀 INICIANDO ENTORNO INTEGRADO: BACKEND MAESTRO + PAÑOL
echo.
echo    [1] Python Engine:       http://127.0.0.1:8000
echo    [2] Node Gateway:        http://localhost:3005
echo    [3] Pañol Backend API:   http://localhost:5000
echo    [4] Pañol Frontend:      http://localhost:5173
echo.
if "%RUN_SCHEDULER%"=="true" (
    echo    Tareas Diarias (disp): ACTIVADAS (Modo scheduler)
) else (
    echo    Tareas Diarias (disp): DESACTIVADAS (Modo Seguro: sin sobrecarga Google API)
)
echo ==============================================================

set ENABLE_SCHEDULER=%RUN_SCHEDULER%
set ENABLE_QUEUE_RUNNER=%RUN_SCHEDULER%
set ENABLE_RAM_CACHE_POLLING=false

echo [1/4] Levantando Python Engine (FastAPI :8000)...
start "Python Engine (FastAPI :8000)" cmd /k "set ENABLE_SCHEDULER=%RUN_SCHEDULER% && cd /d "%~dp0\..\services\master-service\python_engine" && python -m uvicorn server_render:app --host 127.0.0.1 --port 8000 --reload"

timeout /t 2 /nobreak >nul

echo [2/4] Levantando Backend Maestro Node Gateway (:3005)...
start "Node Gateway (:3005)" cmd /k "cd /d "%~dp0\..\services\master-service\node_backend" && set ENABLE_QUEUE_RUNNER=%RUN_SCHEDULER% && set ENABLE_RAM_CACHE_POLLING=false && node --watch server.js"

timeout /t 2 /nobreak >nul

echo [3/4] Levantando Pañol Backend (:5000)...
start "Pañol Backend (:5000)" cmd /k "cd /d "%~dp0\..\apps\panol\backend" && node --watch index.js"

timeout /t 2 /nobreak >nul

echo [4/4] Levantando Pañol Frontend (:5173)...
cd /d "%~dp0\..\apps\panol\frontend" && npm run dev
