@echo off
title [LOGISTICA] Panol (Backend Node.js + Frontend React)
cd /d "%~dp0\..\apps\panol"

echo ==============================================================
echo 🔧 INICIANDO PAÑOL LOCAL (Backend: 5000 / Frontend: 5173)
echo ==============================================================

start "Pañol Backend" cmd /k "cd /d "%~dp0\..\apps\panol\backend" && node --watch index.js"
timeout /t 2 /nobreak >nul
cd /d "%~dp0\..\apps\panol\frontend" && npm run dev
