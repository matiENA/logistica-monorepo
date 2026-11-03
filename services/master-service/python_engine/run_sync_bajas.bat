@echo off
chcp 65001 > nul
echo ==============================================================================
echo   🛰️ SINCRONIZADOR DE BAJAS DE DIAGRAMA A MOVIMIENTOS (NOTAS EN HOVER)
echo ==============================================================================
cd /d "%~dp0"
py -3.13 sync_bajas_movimientos.py %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ Ocurrio un error durante la sincronizacion de bajas.
    exit /b %ERRORLEVEL%
)
echo.
echo ✅ Proceso completado exitosamente.
