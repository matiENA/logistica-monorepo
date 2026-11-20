# Handoff & Blueprint Activo (`logistica-monorepo` + `base`)

## 1. Variación Actual
- **Objetivo**: Adherir el módulo de Planeación, Coordinación y Taller (`base`) al monorepo principal (`logistica-monorepo`) y desplegar sus Static Sites en Render Cloud.
- **Modo**: Brownfield (Adherencia a `services/master-service/node_backend` + `apps/base-frontend`)
- **Escala (`db-render-arch`)**: Tier M (Web Service único `diaria-operativas` con Pool PG compartido de 5 conexiones + Hot RAM C1 + Static Sites `dash`, `eor`, `coordinacion`, `taller`)

## 2. Servicios Activos en Render Cloud
| Servicio Render | Service ID | Tipo | URL Producción | Entrada / Destino |
| :--- | :--- | :--- | :--- | :--- |
| `diaria-operativas` | `srv-db4302u0tbcc73ctq4ng` | Web Service (Docker) | `https://diaria-operativas.onrender.com` | `/api/planeacion/*` + Socket.IO |
| `coordinacion` | `srv-dbvjple1egvs73age6q0` | Static Site | `https://coordinacion-06ce.onrender.com` | Rewrite `/*` -> `/coordinacion.html` |
| `taller` | `srv-dbvjqgavcj2c73d5uod0` | Static Site | `https://taller-jdzi.onrender.com` | Rewrite `/*` -> `/taller.html` |

## 3. Contratos de Datos y Endpoints Adheridos en `diaria-operativas`
| Entidad / Endpoint | Grupo Render | Capa | Identificador Natural | Campos Expuestos en DTO |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/planeacion/board` | G1 Tablero Vivo | C1 Hot RAM (`ETag` 304) | `n_ute`, `tractor_plate`, `semi_plate` | `activos`, `holds`, `catalog` (`zones`, `boxes`, `unidades`) |
| `POST /api/planeacion/procesos/*` | G1 Transición Box | C1 Write-Through + Socket.IO | `n_ute`, `box_name`, `zone_name` | `llegada_at`, `inicio_at`, `salida_at`, `notes[]` |
| `POST /api/planeacion/holds/*` | G1 Preasignación | C1 Write-Through + Socket.IO | `n_ute`, `zone_name`, `orden` | `nota_planificacion`, `ubicacion_actual_zone`, `ubicacion_actual_box` |
| `POST /api/planeacion/taller/login` | G2 Auth Terminal | C2 On-Demand (`base.usuarios_taller`) | `usuario`, `box_name` | `usuario`, `box_name`, `zone_name`, `notes` |
| `POST /api/planeacion/coordinacion/login` | G2 Auth Coordinación | C2 On-Demand (`base.user_coordinacion`) | `user` | `user` |

## 4. Variables de Entorno Requeridas
- [x] `DATABASE_URL`, `PG_MAX_CONNECTIONS`, `PG_IDLE_TIMEOUT` (Compartidas en `diaria-operativas`)
- [x] `VITE_API_URL`, `VITE_SOCKET_URL` (`https://diaria-operativas.onrender.com` en `coordinacion` y `taller`)

## 5. Estado de Compilación y Despliegue
- **Módulos Backend (`node_backend/planeacion`)**: PASS (Exit Code 0, Live en `diaria-operativas`)
- **Build & Deploy `coordinacion`**: PASS (Live en `https://coordinacion-06ce.onrender.com`)
- **Build & Deploy `taller`**: PASS (Live en `https://taller-jdzi.onrender.com`)

## 6. Variación 2026-11-19 (`dash-frontend` — Idle Cartelera 60s + Smooth Transitions)
- **Objetivo**: Auto-transición tras 60s sin interacción hacia `modoCartelera`, retorno Opción B (clic/tap o tecla, ignorando `mousemove`) y transiciones CSS *smooth* sin layout shift.
- **Clasificación (`/db-render-arch`)**: 100% **Capa C0** (Zustand + CSS; 0 queries DB, 0 Egress extra, 0 reconexiones Socket.IO, 0 variables `.env` nuevas).
- **Archivos**:
  - `apps/dash-frontend/src/hooks/useIdleCartelera.ts` (nuevo)
  - `apps/dash-frontend/src/store/useDashStore.ts`, `apps/dash-frontend/src/App.tsx`, `apps/dash-frontend/src/index.css`
  - `apps/dash-frontend/src/components/layout/Header.tsx`, `apps/dash-frontend/src/components/kanban/{QuickAddLibre,ColumnSplitter,LibresRow,NoveltyCard}.tsx`
  - `apps/dash-frontend/UPDATE_2026-11-19_IDLE_CARTELERA.md` (nuevo)

## 7. Variación 2026-11-20 (`base-frontend` + `node_backend/planeacion` — Matriz Box × ADENTRO/AFUERA, Rol `encargado_zona` y `OperariosAssignDropdownCard`)
- **Objetivo**: Sincronizar cambios locales validados en `localhost:5173` hacia `logistica-monorepo`: rol `encargado_zona` con stamp `encargado_id`/`encargado_at`, estado físico `adentro`/`afuera` en `base.procesos`, matriz dinámica por zona/box y portal de asignación de operarios en `/coordinacion` y `/taller`.
- **Clasificación (`/db-render-arch`)**: **Capa C1 Hot RAM (`ETag` 304 por `zoneId`) + Write-Through + Capa C0 (micro-buffer 450 ms)**; 0 variables `.env` nuevas.
- **Contratos Actualizados**:
  - `GET /api/planeacion/board?includeCatalog=0&zoneId=<uuid>` & `GET /api/planeacion/taller-zone-map/:zoneId`: devuelven `taller_zone_map` (`boxes[]` con carriles `adentro`/`afuera`) y `catalog` filtrado por zona (`rol`, `zone_id`).
  - `PATCH /api/planeacion/procesos/:id` / `POST /api/planeacion/holds/:id/activar` / `PATCH /api/planeacion/holds/:id`: aceptan `estado` (`'adentro' | 'afuera'`), validan permisos (`403 Forbidden` si `operario` intenta editar `usuariosIds`/`boxId`) y estampan `encargado_id`/`encargado_at` (nullable).
- **Archivos**:
  - `apps/base-frontend/src/components/common/{OperariosAssignDropdownCard,ZoneBoxMatrixContainer}.tsx` (nuevos)
  - `apps/base-frontend/src/{components/kanban/{UnitPlaneacionCard,UnitPlaneacionDeployedModal},components/taller/TallerUnitCard,hooks/usePlaneacionKanban,pages/{PlaneacionKanbanPage,TallerLoginTerminalPage},services/planeacionApi,types/planeacion}.{ts,tsx}`
  - `services/master-service/node_backend/planeacion/{db/schema,services/hotRamBaseService,routes/planeacionRoutes}.js`
