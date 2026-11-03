@echo off
chcp 65001 >nul
echo ==============================================================================
echo   SINCRONIZANDO VACÍO CON BORDES (COLUMNA X)
echo ==============================================================================
cd /d "%~dp0"
py -3.13 sync_vacio.py --apply --borders
pause
