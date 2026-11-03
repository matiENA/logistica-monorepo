# 📦 Componentes Legacy (Desacoplados de la Navegación Principal)

Este directorio alberga los módulos que han sido retirados de la aplicación principal de **Diagramas EOR**:

## 📁 Contenido del Directorio

1. **[`metricas/`](./metricas/)**:
   - Componente: `MetricasModule.jsx`
   - Vista SQL: `public.view_dashboard_kpis`
   - Función: Panel de métricas globales, choferes y unidades en ruta, disponibilidad de flota y alertas de VTV.
   - *Destino:* Proyecto aparte de Analítica y Métricas.

2. **[`inducciones/`](./inducciones/)**:
   - Componente: `InduccionesModule.jsx`
   - Vista SQL: `public.view_inducciones_recientes`
   - Función: Monitoreo de choferes en proceso de inducción, exámenes médicos/habilitaciones y estado de resolución.
   - *Destino:* Proyecto aparte de Analítica e Inducciones.

3. **[`diagramas/`](./diagramas/)**:
   - Componente: `DiagramaModule.jsx`
   - Vista SQL: `public.view_diagrama_mensual`
   - Función: Grilla operativa de diagramas mensuales consolidada con selector de mes, filtros por servicio y buscador de choferes/tractores.

---

## 🎯 Navegación Activa en Diagramas EOR

En la aplicación principal de Diagramas EOR, la navegación queda simplificada y focalizada en la operación esencial:
- **Diaria** (`DailyDashboard.jsx`)
- **Individual** (`IndividualModule.jsx` — incluye edición de diagrama por conductor con `TrimestralCalendar.jsx`)
- **Flota** (`FlotaModule.jsx`)
