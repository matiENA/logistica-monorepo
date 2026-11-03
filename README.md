# 🚀 Logística Monorepo (Servicio Maestro Unificado en Render)

Monorepo centralizado para la infraestructura logística, unificando el motor de **Hot RAM Cache (Node.js)**, **Sincronizaciones Operativas & Schedulers 24/7 (Python)** y los frontends (**DASH** y **Diagramas EOR**) en un único Web Service en Render:
👉 **`srv-db4302u0tbcc73ctq4ng`** (`diaria-operativas` / `https://diaria-operativas.onrender.com`).

---

## 📁 Estructura del Repositorio

```
logistica-monorepo/
├── render.yaml                          <-- Blueprint orquestador de Render
│
├── services/
│   └── master-service/                  <-- Multi-Runtime Docker (Node 20 + Python 3.11)
│       ├── Dockerfile                   (Instala dependencias de Node y Python)
│       ├── start.sh                     (Arranca Uvicorn en 8000 y Node.js en 10000)
│       ├── node_backend/                (Hot RAM, Socket.IO /dash, Pooler pg :6543)
│       └── python_engine/               (FastAPI, APScheduler, Telegram, scripts diarios)
│
├── apps/
│   ├── dash-frontend/                   <-- React 19 + Vite (DASH Kanban)
│   │   └── .env.production              (VITE_API_URL=https://diaria-operativas.onrender.com)
│   │
│   └── eor-frontend/                    <-- React + Vite (Diagramas EOR)
│       └── .env.production              (VITE_API_URL=https://diaria-operativas.onrender.com)
│
└── scripts/
    └── test-health.ps1                  (Sonda de verificación de endpoints)
```

---

## 🌐 Mapeo de Enrutamiento de URLs

| Origen | Endpoint Solicitado | Destino / Handler Interno |
| :--- | :--- | :--- |
| **DASH Frontend** (`dash-aa1f`) | `GET /api/dash/flota` | Node.js Hot RAM (1.1 MB comprimido en Gzip a 42 KB) |
| **DASH Frontend** | `GET /api/dash/novedades` | Node.js Hot RAM |
| **DASH Frontend** | `GET /api/dash/terminales` | PostgreSQL directo (vía pooler puerto 6543) |
| **DASH Frontend** | `GET /api/dash/tipos-novedad`| PostgreSQL directo (vía pooler puerto 6543) |
| **DASH Frontend** | `WebSocket /socket.io` | Socket.IO Server (namespace `/dash`) |
| **Diagramas EOR** | `GET /api/datos` | Node.js Hot RAM (matriz diaria + KM) |
| **n8n / Triggers** | `POST /sync/*` | Proxy a Python FastAPI en `127.0.0.1:8000` |
| **Keep-Alive (n8n)** | `GET /health` | Node.js Gateway (devuelve `OK` 200) |
| **APScheduler** | Tareas 24/7 (viajes, vacío) | Python Background Scheduler autónomo |

---

## 🛡️ Guía de Rollback Garantizado

Tus directorios originales se encuentran **100% intactos**:
- `C:\Users\Matias Rodriguez\Documents\server_local\operativas_diarias`
- `C:\Users\Matias Rodriguez\Documents\server_local\sheet-render`
- `C:\Users\Matias Rodriguez\Documents\dash`
- `C:\Users\Matias Rodriguez\Documents\eor_v1`

Si en cualquier momento deseas volver a la arquitectura previa:
1. En el Dashboard de Render, reanuda los servicios `srv-dbdorkvavr4c738s3nbg` (`sheet-render`) y `srv-dbfpnrl9fdbs739n5vvg` (`back dash`).
2. Restaura la variable `VITE_API_URL` en el frontend de DASH hacia su backend anterior.
3. Continúa trabajando en las carpetas originales sin ningún cambio.
