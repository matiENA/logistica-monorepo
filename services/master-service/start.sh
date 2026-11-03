#!/bin/sh
set -e

echo "=================================================================="
echo "🚀 MASTER SERVICE (Multi-Runtime: Python 3.11 + Node.js 20)"
echo "   Servicio Render: srv-db4302u0tbcc73ctq4ng (diaria-operativas)"
echo "=================================================================="

# 1. Iniciar FastAPI + APScheduler en segundo plano (puerto interno 8000)
echo "🐍 [1/2] Levantando Python Engine (Scheduler & Sync API) en 127.0.0.1:8000..."
cd /app/python_engine && python3 -m uvicorn server_render:app --host 127.0.0.1 --port 8000 &
PYTHON_PID=$!
echo "   Python Engine PID: $PYTHON_PID"

# Esperar 2 segundos a que el engine de Python esté listo
sleep 2

# 2. Iniciar Node.js en el puerto principal asignado por Render (PORT o 10000)
PUBLIC_PORT=${PORT:-10000}
echo "⚡ [2/2] Levantando Node.js Gateway (Hot RAM + Socket.IO + REST) en 0.0.0.0:$PUBLIC_PORT..."
cd /app/node_backend && exec node server.js
