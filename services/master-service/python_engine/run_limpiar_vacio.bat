@echo off
chcp 65001 >nul
echo ==============================================================================
echo   LIMPIEZA Y RESETEO DE VACÍO / BORDES ANÓMALOS
echo ==============================================================================
cd /d "%~dp0"
py -3.13 limpiar_vacio.py --apply
pause
