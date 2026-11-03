@echo off
chcp 65001 > nul
echo ==============================================================================
echo   EJECUTANDO ROTACION MENSUAL GLOBAL - NOVIEMBRE 2026
echo ==============================================================================
cd /d "C:\Users\Matias Rodriguez\Documents\server_local\operativas_diarias"
py -3.13 rotar_mes_global.py --apply
echo.
echo Presione cualquier tecla para finalizar...
pause > nul
