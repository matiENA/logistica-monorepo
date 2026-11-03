@echo off
chcp 65001 >nul
echo ==============================================================================
echo   SINCRONIZANDO UTE CORDILLERA -> CONF. DE VIAJE
echo ==============================================================================
cd /d "%~dp0"
py -3.13 main.py --conf-viaje
pause
