@echo off
chcp 65001 >nul
echo ==============================================================================
echo   PINTANDO DISPONIBILIDAD (VTV & HABILITACIONES)
echo ==============================================================================
cd /d "%~dp0"
node pintarDisponibilidad.js
pause
