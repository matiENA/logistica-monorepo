@echo off
chcp 65001 >nul
echo ==============================================================================
echo   SINCRONIZANDO VIAJES CORDILLERA -> SEGURIDA VIAL
echo ==============================================================================
cd /d "%~dp0"
py -3.13 main.py --seguridad-vial
pause
