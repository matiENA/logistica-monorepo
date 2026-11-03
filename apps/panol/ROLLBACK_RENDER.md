# 🚀 Guía de Arquitectura y Despliegue en Render: Pañol Logistics

Esta arquitectura desacopla el proyecto en dos servicios independientes:
1. **Frontend (Static Service en Render):** Publica `./frontend` en el CDN global de Render (100 GB/mes gratis, 0 MB de consumo de RAM).
2. **Backend (Web Service en Render):** Corre Node.js en `./backend` gestionando APIs, WebSockets (`socket.io`) y sincronizaciones en tiempo real.

---

## 📁 Nueva Estructura del Proyecto

```text
panolnd/
├── frontend/                     # 🌐 Servicio Estático (Front)
│   ├── index.html                # Terminal de Órdenes & Pedidos
│   ├── coordinacion.html         # Tablero de Coordinación
│   ├── panol.html                # Monitor Pañol en tiempo real
│   ├── mobile.html               # App Móvil Mecánicos
│   ├── login.html                # Pantalla de Ingreso
│   ├── wireframe.html            # Wireframe canónico
│   ├── config.js                 # Configuración universal de conexión
│   ├── client-shim.js            # RPC & WebSockets shim
│   ├── fonts/                    # Tipografías offline
│   ├── js/                       # Scripts auxiliares y config
│   ├── socket.io/                # Socket.io cliente estático
│   ├── server.js                 # Servidor local de desarrollo (Puerto 5173)
│   └── package.json
│
├── backend/                      # ⚙️ Web Service (Back)
│   ├── index.js                  # Servidor Express + Socket.io
│   ├── plateNormalizer.js        # Normalizador de patentes
│   ├── otSyncService.js          # Sincronización de OTs
│   ├── otsManagerService.js      # Gestor de órdenes de trabajo
│   ├── fleetMasterSyncService.js # Sincronización con flota
│   ├── taskSyncService.js        # Sincronización de tareas y estados
│   ├── utils/db.js               # Pool PostgreSQL (Listo para Supabase)
│   ├── data/                     # Cache y datos cold
│   ├── scripts/                  # Scripts de utilidades y pruebas
│   ├── .env                      # Variables de entorno locales
│   ├── .env.example              # Plantilla documentada
│   └── package.json
│
├── scripts/
│   └── dev.js                    # Runner unificado local (Front + Back)
├── render.yaml                   # Blueprint de Render (Static + Web Service)
├── package.json                  # Scripts globales de workspace
└── .gitignore
```

---

## 💻 Desarrollo Local (Localhosts Independientes)

Cada servicio cuenta con su propio puerto y localhost asignado:

| Servicio | Entorno Local | Función | Comando |
|---|---|---|---|
| **Frontend** | `http://localhost:5173` | UI Estática con URLs amigables | `npm run dev:front` |
| **Backend** | `http://localhost:5000` | APIs REST, WebSockets, DB Pool | `npm run dev:back` |
| **Ambos** | Puertos 5173 y 5000 | Inicia ambos en paralelo | `npm run dev` |

> **Nota de Convivencia Local:** El Backend utiliza el puerto `5000` para evitar conflictos con el proyecto `dash` (cuyo frontend corre en `3000` y backend en `3005`) y el `local_loader` (en `3010`).

### Rutas amigables locales del Frontend:
- Terminal: `http://localhost:5173/`
- Coordinación: `http://localhost:5173/coordinacion`
- Monitor Pañol: `http://localhost:5173/panol`
- App Móvil: `http://localhost:5173/mobile`
- Ingreso: `http://localhost:5173/login`

---

## ☁️ Subida y Configuración en Render

El archivo [`render.yaml`](file:///c:/Users/Matias%20Rodriguez/Documents/panolnd/render.yaml) ya define los 2 servicios automáticamente mediante **Blueprints**:

### 1. Static Service (`panol-static-site`)
- **Proyecto en Render:** `prj-d9adg8ho3t8c738mncb0`
- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Publish Directory:** `dist`
- **Routes (Rewrites):** Redirige limpiamente `/coordinacion`, `/panol`, `/mobile`, `/login`, `/wireframe`, `/terminal` a sus respectivos archivos HTML sin recarga.

### 2. Web Service (`panol-monolith-service`)
- **Proyecto en Render:** `prj-d9adg8ho3t8c738mncb0`
- **Root Directory:** `backend`
- **Environment:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Servicio Unificado de Vistas:** Sirve directamente todas las pantallas (`/` -> Terminal clásico, `/coordinacion`, `/panol`, `/mobile`, `/login`, `/react`) en el mismo dominio, eliminando cualquier problema de CORS.
- **Variables de Entorno en Render:**
  - `NODE_ENV`: `production`
  - `SPREADSHEET_ID`: `1aKptNgy8a9Ca3rDW-HSlWEiriMRJMOIJuFsdViwEGFc`
  - `SOURCE_SPREADSHEET_ID`: `1HKXGsRC149Kw4aBXQwGcPVpAvObvTUFis6YV6R5cTXk`
  - `MES_MOVIMIENTOS_ID`: `1Bwj8WCykMn_FbZhQ_FqnDH3K_WCod52YTSvsaxIDNS8`
  - `OT_SYNC_INTERVAL_MINUTES`: `2`
  - `SYSTEM_USER`: `taller`
  - `SYSTEM_PASSWORD`: `taller2026`
  - `SYSTEM_AUTH_SECRET`: `panol-secret-auth-key-2026-xyz`
  - `DIAGRAMAS_URL`: `https://diagramasnode-production.up.railway.app/api/datos`
  - `DATABASE_URL`: *(Opcional - Cadena PostgreSQL de Supabase si está disponible)*
  - `PG_MAX_CONNECTIONS`: `5`
  - `PG_IDLE_TIMEOUT`: `10000`

---

## ⚡ Preparación para Conexión con Supabase (Siguiente Paso)

El módulo [`backend/utils/db.js`](file:///c:/Users/Matias%20Rodriguez/Documents/panolnd/backend/utils/db.js) ya está optimizado con un Pool de PostgreSQL (`pg`) con límites de memoria y reconexión automática.

Cuando obtengas tus credenciales de Supabase:
1. Agrega a tu archivo `backend/.env` (o en Render Environment):
   ```ini
   DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
   ```
2. Ejecuta el test de conexión en cualquier momento:
   ```bash
   npm run test-db
   ```
   O desde el directorio backend:
   ```bash
   cd backend && npm run test-db
   ```
