@echo off
title [LOGISTICA] Dash Backend Node Gateway (:3005)
cd /d "%~dp0\..\services\master-service\node_backend"

echo ==============================================================
echo 🚀 INICIANDO DASH BACKEND (Node.js Gateway :3005)
echo    Apunta a: Supabase PostgreSQL (:6543)
echo    Frontends compatibles: DASH (:3000), Diagramas EOR (:4000)
echo ==============================================================

node --watch server.js
