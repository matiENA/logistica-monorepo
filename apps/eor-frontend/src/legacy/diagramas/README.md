# 📦 Módulo de Diagramas Mensuales (Legacy)

Este directorio contiene el componente de la grilla operativa mensual consolidada (`DiagramaModule.jsx`), retirado de la interfaz principal de navegación el **30 de Septiembre de 2026**.

## 📊 Descripción del Módulo

El componente `DiagramaModule.jsx` consumía la vista agregada en PostgreSQL:
- **Vista SQL**: `public.view_diagrama_mensual`
- **Funcionalidades**:
  - Visualización tabular de los 31 días del mes con codificación de colores por estado:
    - `F` / Francos (Azul suave)
    - `V` / Vacaciones (Verde suave)
    - Ausencias / ART / IND / Med (Rojo/Ámbar)
    - Trabajo / Guardias
  - Filtro por mes (`mes_tab` ej. `Sep-26`, `Ago-26`, etc.).
  - Filtro por servicio operativo (`LIVIANO`, `METANOL`, `CAMPO`, `GLP`, `TDS`, `EURO`).
  - Buscador reactivo por nombre de conductor o unidad de tractor.
  - Cómputo resumido de días trabajados y días de franco.

> **Nota:** La gestión y edición individual de diagramas por chofer sigue disponible operativamente a través del módulo **Individual** (`TrimestralCalendar.jsx`).

## 🔄 Cómo Reincorporar el Módulo a Futuro

Si se requiere habilitar este módulo nuevamente en la aplicación activa:

1. **Reintegrar en `src/features/navigation/HeaderNav.jsx`**:
   Agregar el item en la lista `modules`:
   ```javascript
   { id: 'diagrama', label: 'Diagrama' },
   ```

2. **Importar y renderizar en `src/App.jsx`**:
   ```javascript
   const DiagramaModule = lazy(() => import('./legacy/diagramas/DiagramaModule').then((m) => ({ default: m.DiagramaModule })));
   ```
   Y dentro del switch del `<main>`:
   ```jsx
   {activeTab === 'diagrama' && <DiagramaModule />}
   ```

3. **Verificar la vista en PostgreSQL**:
   Asegurarse de que `public.view_diagrama_mensual` continúe activa en la base de datos (definida en `scripts/setup-db-views.js`).
