@echo off
title [LOGISTICA] Backend Maestro (Node.js Gateway + Python Engine)
cd /d "%~dp0\..\services\master-service"

echo ==============================================================
echo 🚀 INICIANDO SERVICIO MAESTRO LOCAL
echo    Puerto Node Gateway:   10000 (o segun .env)
echo    Puerto Python Engine:  8000
echo ==============================================================

start "Python Engine (FastAPI)" cmd /k "cd /d python_engine && python -m uvicorn server_render:app --host 127.0.0.1 --port 8000 --reload"
timeout /t 2 /nobreak >nul
cd /d node_backend && node --watch server.js
