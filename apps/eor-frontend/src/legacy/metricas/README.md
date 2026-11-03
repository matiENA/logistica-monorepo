# 📦 Módulo de Métricas (Legacy)

Este directorio contiene el componente original de métricas y KPIs (`MetricasModule.jsx`), retirado de la interfaz principal de navegación el **29 de Septiembre de 2026**.

## 📌 Contexto de la Extracción

Tanto el módulo de **Métricas** como el módulo de **Inducciones** han sido desacoplados del frontend principal de Diagramas EOR para conformar un **proyecto independiente dedicado** a Analítica, Métricas de Flota y Gestión de Inducciones/Habilitaciones.

## 📊 Descripción del Módulo

El componente `MetricasModule.jsx` consumía la vista agregada en PostgreSQL:
- **Vista SQL**: `public.view_dashboard_kpis`
- **Métricas renderizadas**:
  - `unidades_circulando` (Unidades en estado 'circulando' sobre el total)
  - `unidades_disponibles` (Unidades en estado 'disponible')
  - `choferes_circulando` (Conductores en ruta activa)
  - `novedades_pendientes` y `novedades_resueltas` (Incidentes y tareas operativas)
  - `alertas_vtv_vencidas` y `alertas_vtv_por_vencer` (Vencimientos de VTV en tractores y semis a 15 días)

## 🔄 Cómo Reincorporar el Módulo a Futuro

Si se requiere habilitar este módulo nuevamente en la aplicación activa:

1. **Reintegrar en `src/features/navigation/HeaderNav.jsx`**:
   Agregar el item en la lista `modules`:
   ```javascript
   { id: 'metricas', label: 'Métricas' },
   ```

2. **Importar y renderizar en `src/App.jsx`**:
   ```javascript
   const MetricasModule = lazy(() => import('./legacy/metricas/MetricasModule').then((m) => ({ default: m.MetricasModule })));
   ```
   Y dentro del switch del `<main>`:
   ```jsx
   {activeTab === 'metricas' && <MetricasModule />}
   ```

3. **Verificar la vista en PostgreSQL**:
   Asegurarse de que `public.view_dashboard_kpis` continúe activa en la base de datos (definida en `scripts/setup-db-views.js`).
