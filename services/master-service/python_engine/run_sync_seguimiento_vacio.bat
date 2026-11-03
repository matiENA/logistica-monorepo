@echo off
chcp 65001 >nul
echo ==============================================================================
echo   SINCRONIZANDO SEGUIMIENTO DE VACÍO (#9fc5e8 / SIN NUEVO TD)
echo ==============================================================================
cd /d "%~dp0"
py -3.13 sync_seguimiento_vacio.py --apply
pause
