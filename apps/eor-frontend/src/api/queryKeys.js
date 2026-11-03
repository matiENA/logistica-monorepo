/**
 * Query Key Factory centralizado para TanStack Query (React Query v5)
 * Estandariza la jerarquía de claves en toda la aplicación para garantizar
 * consistencia en caché, deduplicación e invalidación reactiva en cascada.
 */

export const queryKeys = {
  // Autenticación y badges
  auth: {
    badge: ['novedades_pendientes_badge'],
  },

  // Vista Diaria Operativa
  diaria: {
    all: ['view_diaria_operativa'],
    list: (filters = {}, fechaContexto = null) => [
      'view_diaria_operativa',
      {
        search: filters.search || '',
        servicio: filters.servicio || 'TODOS',
        alerta: filters.alerta || 'TODAS',
        retornan: Boolean(filters.retornan),
        fecha: fechaContexto || '',
      },
    ],
    km: (fechaContexto) => ['daily_km_feed', fechaContexto],
    cards: (filters = {}) => ['cards_diarias_infinite', filters],
  },

  // Control de Flota
  flota: {
    all: ['flota_operativa'],
    disponibles: (servicio = 'TODOS') => ['unidades_para_asignar', servicio],
  },

  // Ficha Individual de Chofer
  individual: {
    all: ['individual_chofer'],
    catalog: ['catalogo_choferes_lite'],
    detail: (choferId) => ['individual_chofer', String(choferId || '')],
    calendar: (choferId, zoom, targetTabs) => {
      const key = ['calendario_diagrama_km'];
      if (choferId !== undefined && choferId !== null && choferId !== '') {
        key.push(String(choferId));
        if (zoom !== undefined && zoom !== null) {
          key.push(zoom);
          if (targetTabs !== undefined && targetTabs !== null && targetTabs !== '') {
            key.push(targetTabs);
          }
        }
      }
      return key;
    },
    docs: (choferId) => ['chofer_documentacion', String(choferId || '')],
    observations: (choferId) => ['chofer_observaciones', String(choferId || '')],
  },

  // Diagramas Mensuales
  diagramas: {
    all: ['diagrama_mensual'],
    mensual: (mesTab, servicio) => {
      const key = ['diagrama_mensual'];
      if (mesTab !== undefined && mesTab !== null) {
        key.push(mesTab);
        if (servicio !== undefined && servicio !== null) {
          key.push({ servicio });
        }
      }
      return key;
    },
  },

  // Movimientos Activos (Unidad + Chofer Actual)
  movimientos: {
    all: ['view_movimientos'],
    list: (filters = {}) => [
      'view_movimientos',
      {
        search: filters.search || '',
        servicio: filters.servicio || 'TODOS',
        estado: filters.estado || 'TODOS',
      },
    ],
  },

  // Métricas y KPIs
  kpis: ['view_dashboard_kpis'],
};
