@echo off
title Polling Inteligente VACIO y Seguimiento (Ruteos -^> Movimientos)
cd /d "%~dp0"

echo ============================================================
echo   Iniciando Polling Inteligente de VACIO y Movimientos...
echo ============================================================

py -3.13 poll_sync_vacio.py --apply --borders %*

echo ============================================================
echo   Ejecucion finalizada.
echo ============================================================
pause
