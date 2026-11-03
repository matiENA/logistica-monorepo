@echo off
REM ==============================================================
REM EJECUTOR SINCRONIZACION FOTOS CHOFERES WEBP Y REPORTE FALTANTES
REM ==============================================================
cd /d "C:\Users\Matias Rodriguez\Documents\eor_v1\apps\backend"
node sync\syncChoferesFotos.js >> "C:\Users\Matias Rodriguez\Documents\reportes\choferes_fotos\sync_execution.log" 2>&1
