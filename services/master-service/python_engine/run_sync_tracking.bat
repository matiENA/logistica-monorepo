@echo off
chcp 65001 >nul
echo ==============================================================================
echo   SINCRONIZANDO TRACKING HOVER (COLUMNA H)
echo ==============================================================================
cd /d "%~dp0"
py -3.13 sync_ruteos_movimientos.py --apply
pause
