# Handoff & Blueprint Activo (`logistica-monorepo` + `base`)

## 1. Variación Actual
- **Objetivo**: Adherir el módulo de Planeación, Coordinación y Taller (`base`) al monorepo principal (`logistica-monorepo`) y a su infraestructura en Render (`render.yaml`).
- **Modo**: Brownfield (Adherencia a `services/master-service/node_backend` + `apps/base-frontend`)
- **Escala (`db-render-arch`)**: Tier M (Web Service único `diaria-operativas` con Pool PG compartido de 5 conexiones + Hot RAM C1 + 3 Static Sites: `dash`, `eor`, `base`)

## 2. Contratos de Datos y Endpoints Adheridos en `diaria-operativas`
| Entidad / Endpoint | Grupo Render | Capa | Identificador Natural | Campos Expuestos en DTO |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/planeacion/board` | G1 Tablero Vivo | C1 Hot RAM (`ETag` 304) | `n_ute`, `tractor_plate`, `semi_plate` | `activos`, `holds`, `catalog` (`zones`, `boxes`, `unidades`) |
| `POST /api/planeacion/procesos/*` | G1 Transición Box | C1 Write-Through + Socket.IO | `n_ute`, `box_name`, `zone_name` | `llegada_at`, `inicio_at`, `salida_at`, `notes[]` |
| `POST /api/planeacion/holds/*` | G1 Preasignación | C1 Write-Through + Socket.IO | `n_ute`, `zone_name`, `orden` | `nota_planificacion`, `ubicacion_actual_zone`, `ubicacion_actual_box` |
| `POST /api/planeacion/taller/login` | G2 Auth Terminal | C2 On-Demand (`base.usuarios_taller`) | `usuario`, `box_name` | `usuario`, `box_name`, `zone_name`, `notes` |
| `POST /api/planeacion/coordinacion/login` | G2 Auth Coordinación | C2 On-Demand (`base.user_coordinacion`) | `user` | `user` |

## 3. Árbol de Archivos Adheridos en `logistica-monorepo`
- `render.yaml`, `.gitignore`, `HANDOFF.md`
- `services/master-service/node_backend/`: `package.json`, `package-lock.json`, `server.js`, `planeacion/db/{index,schema}.js`, `planeacion/services/hotRamBaseService.js`, `planeacion/routes/planeacionRoutes.js`
- `apps/base-frontend/`: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `coordinacion.html`, `taller.html`, `public/fonts/*`, `src/**` (100% producción)

## 4. Variables de Entorno Requeridas
- [x] `DATABASE_URL`, `PG_MAX_CONNECTIONS`, `PG_IDLE_TIMEOUT` (Compartidas en `diaria-operativas`)
- [x] `VITE_API_URL`, `VITE_SOCKET_URL` (`https://diaria-operativas.onrender.com` en Static Site `base`)

## 5. Estado de Compilación y Verificación
- **Módulos Backend (`node_backend/planeacion`)**: PASS (Exit Code 0)
- **Build Frontend (`apps/base-frontend`)**: PASS (Exit Code 0)
