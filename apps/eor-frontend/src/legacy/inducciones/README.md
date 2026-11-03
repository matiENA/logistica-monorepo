# 📦 Módulo de Inducciones (Legacy)

Este directorio contiene el componente de inducciones y nuevos ingresos (`InduccionesModule.jsx`), retirado de la interfaz principal de navegación el **29 de Septiembre de 2026**.

## 📌 Contexto de la Extracción

Tanto el módulo de **Métricas** como el módulo de **Inducciones** han sido desacoplados del frontend principal de Diagramas EOR para conformar un **proyecto independiente dedicado** a Analítica, Métricas de Flota y Gestión de Inducciones/Habilitaciones.

## 📊 Descripción del Módulo

El componente `InduccionesModule.jsx` consumía la vista relacional en PostgreSQL:
- **Vista SQL**: `public.view_inducciones_recientes`
- **Métricas e información renderizada**:
  - `chofer_nombre`: Conductor asociado a la novedad de inducción/examen.
  - `servicio`: Servicio o unidad asignada.
  - `fecha_induccion`: Fecha programada o realizada para el examen/inducción.
  - `chofer_telefono`: Contacto directo del chofer.
  - `detalle`: Observaciones de la novedad.
  - `resuelto`: Estado de resolución (Pendiente / Resuelto).

## 🔄 Cómo Reincorporar el Módulo a Futuro (Si se requiriera en este proyecto)

Si se necesitara volver a activar este módulo en la aplicación principal:

1. **Reintegrar en `src/features/navigation/HeaderNav.jsx`**:
   Agregar el item en la lista `modules`:
   ```javascript
   { id: 'inducciones', label: 'Inducciones' },
   ```

2. **Importar y renderizar en `src/App.jsx`**:
   ```javascript
   const InduccionesModule = lazy(() => import('./legacy/inducciones/InduccionesModule').then((m) => ({ default: m.InduccionesModule })));
   ```
   Y dentro del switch del `<main>`:
   ```jsx
   {activeTab === 'inducciones' && <InduccionesModule />}
   ```

3. **Verificar la vista en PostgreSQL**:
   Asegurarse de que `public.view_inducciones_recientes` continúe activa en la base de datos (definida en `scripts/setup-db-views.js` o en las migraciones SQL).
