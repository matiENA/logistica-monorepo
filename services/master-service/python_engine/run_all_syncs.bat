@echo off
chcp 65001 >nul
echo ==============================================================================
echo   EJECUTANDO ORQUESTADOR GLOBAL: TODAS LAS OPERATIVAS DIARIAS
echo ==============================================================================
cd /d "%~dp0"
py -3.13 run_all_syncs.py --apply
pause
