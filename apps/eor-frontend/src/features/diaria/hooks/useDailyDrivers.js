import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryKeys';

const PAGE_SIZE = 16;

/**
 * Normaliza y extrae el estado del chofer para una fecha contexto dada (YYYY-MM-DD)
 */
export function getDriverDayStatus(chofer, fechaIso) {
  if (!chofer) return { raw: '-', base: '-', cons: 0, type: 'INACTIVO' };

  let raw = '';

  // 1. Prioridad: Día activo / último registrado precomputado en la vista (Opción C)
  if (chofer.dia_codigo && (!fechaIso || chofer.dia_fecha === fechaIso)) {
    raw = String(chofer.dia_codigo).trim();
  }

  // 2. Si hay fechaIso distinta o viene en diagrama_json
  if (!raw || raw === '-') {
    const diag = chofer.diagrama_json;
    if (diag?.caracteres_60_dias && diag.caracteres_60_dias[fechaIso]) {
      raw = String(diag.caracteres_60_dias[fechaIso]).trim();
    }
  }

  // 3. Fallback a dia_codigo del chofer si no se encontró por fecha específica
  if (!raw && chofer.dia_codigo) {
    raw = String(chofer.dia_codigo).trim();
  }

  // 4. Fallback al estado del chofer
  if (!raw || raw === '-' || raw === '0') {
    if (chofer.estado_chofer === 'circulando') return { raw: raw === '0' ? '0' : 'O', base: raw === '0' ? '0' : 'O', cons: 1, type: 'OPERATIVO' };
    if (chofer.estado_chofer === 'franco') return { raw: raw === '0' ? '0' : 'F', base: raw === '0' ? '0' : 'F', cons: 0, type: 'FRANCO' };
    if (chofer.estado_chofer === 'licencia') return { raw: raw === '0' ? '0' : 'IND', base: raw === '0' ? '0' : 'IND', cons: 0, type: 'LICENCIA' };
    return { raw: raw || '-', base: raw || '-', cons: 0, type: 'INACTIVO' };
  }

  let base = raw;
  if (base.includes('+')) base = base.split('+')[0].trim();

  // Evaluación de tipos
  if (['F', 'FSF', 'FRANCO', 'RPT'].includes(base.toUpperCase())) {
    return { raw, base, cons: 0, type: 'FRANCO' };
  }
  if (['V', 'VSF', 'VACACIONES'].includes(base.toUpperCase())) {
    return { raw, base, cons: 0, type: 'VACACIONES' };
  }
  if (['E', 'ART', 'IND', 'IIND', 'A', 'S', 'P', 'MED', 'SUSP', 'LIC'].some((k) => base.toUpperCase().includes(k))) {
    return { raw, base, cons: 0, type: 'LICENCIA' };
  }

  const cons = parseInt(base, 10);
  if (!isNaN(cons)) {
    return { raw, base, cons, type: 'OPERATIVO' };
  }

  if (base.toUpperCase() === 'O' || base.toUpperCase() === 'OPERATIVO') {
    return { raw, base, cons: 1, type: 'OPERATIVO' };
  }

  return { raw, base, cons: 0, type: 'OTRO' };
}

/**
 * Calcula si un conductor retorna a la actividad en los próximos días o retorna hoy (legacy function).
 * Retorna { date: string, diffDays: number, returnsToday: boolean } o null.
 */
export function calculateDriverReturn(driver, fechaIso) {
  if (!driver || !fechaIso) return null;

  const currentStatus = getDriverDayStatus(driver, fechaIso);

  // Helper para sumar días a una fecha ISO (YYYY-MM-DD)
  const addDaysIso = (baseIso, days) => {
    const d = new Date(baseIso + 'T12:00:00');
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // CASO 1: Hoy está inactivo (FRANCO, VACACIONES, LICENCIA, etc.)
  if (currentStatus.type !== 'OPERATIVO') {
    for (let i = 1; i <= 60; i++) {
      const nextDate = addDaysIso(fechaIso, i);
      const nextStatus = getDriverDayStatus(driver, nextDate);
      if (nextStatus.type === 'OPERATIVO') {
        return {
          date: nextDate,
          diffDays: i,
          returnsToday: false,
        };
      }
    }
  } else {
    // CASO 2: Hoy está OPERATIVO, verificar si ayer estaba inactivo (retoma hoy)
    const prevDate = addDaysIso(fechaIso, -1);
    const prevStatus = getDriverDayStatus(driver, prevDate);
    if (prevStatus.type !== 'OPERATIVO') {
      return {
        date: fechaIso,
        diffDays: 0,
        returnsToday: true,
      };
    }
  }

  return null;
}

/**
 * Hook de consulta paginada para la vista Diaria
 */
export const useDailyDrivers = (filters = {}, fechaContexto = null, options = {}) => {
  const isEnabled = options.enabled !== undefined ? Boolean(options.enabled) : true;

  return useInfiniteQuery({
    queryKey: queryKeys.diaria.list(filters, fechaContexto),
    queryFn: async ({ pageParam = 0 }) => {
      // MODO RETORNO (Carga bajo demanda directa desde RPC/vista)
      if (filters.retornan) {
        const fechaTarget = fechaContexto || new Date().toISOString().split('T')[0];
        const retRows = await apiClient.getPersonalRetorno(fechaTarget);

        if (!retRows || retRows.length === 0) {
          return {
            drivers: [],
            nextPage: undefined,
            totalCount: 0,
          };
        }

        // Traer fichas operativas con los filtros correspondientes (sin límite restrictivo de 200)
        const { drivers } = await apiClient.getDiaria({
          limit: 500,
          offset: 0,
          servicio: filters.servicio,
          alerta: filters.alerta,
          search: filters.search,
        });

        const driverMap = new Map((drivers || []).map((d) => [d.chofer_id, d]));

        // Construir listado enriquecido de todos los conductores que retornan sin truncamiento
        const enrichedDrivers = retRows
          .filter((r) => {
            if (filters.servicio && filters.servicio !== 'TODOS') {
              const sFilter = filters.servicio.trim().toUpperCase();
              const sRow = (r.servicio || '').trim().toUpperCase();
              if (sFilter === 'GRALES.' || sFilter === 'GRALES') {
                if (sRow !== 'GRALES' && sRow !== 'GRALES.') return false;
              } else if (sRow !== sFilter) {
                return false;
              }
            }
            if (filters.search && filters.search.trim()) {
              const term = filters.search.trim().toLowerCase();
              const match =
                (r.nombre || '').toLowerCase().includes(term) ||
                (r.dni || '').toLowerCase().includes(term) ||
                (r.tractor || '').toLowerCase().includes(term) ||
                (r.n_ute || '').toLowerCase().includes(term);
              if (!match) return false;
            }
            return true;
          })
          .map((r) => {
            const baseDriver = driverMap.get(r.chofer_id);
            if (baseDriver) {
              return {
                ...baseDriver,
                retorno_info: r,
              };
            }
            // Fallback para garantizar que el 100% de los choferes que retornan aparezcan
            return {
              chofer_id: r.chofer_id,
              nombre: r.nombre,
              dni: r.dni,
              servicio: r.servicio,
              tractor: r.tractor,
              semi: r.semi,
              n_ute: r.n_ute,
              dia_codigo: r.codigo_hoy,
              dia_fecha: fechaTarget,
              retorno_info: r,
            };
          });

        // Orden cronológico estricto por fecha_retorno ASC, luego por nombre ASC
        enrichedDrivers.sort((a, b) => {
          const dateA = a.retorno_info?.fecha_retorno || '';
          const dateB = b.retorno_info?.fecha_retorno || '';
          if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
          return (a.nombre || '').localeCompare(b.nombre || '');
        });

        return {
          drivers: enrichedDrivers,
          nextPage: undefined,
          totalCount: enrichedDrivers.length,
        };
      }

      // MODO NORMAL (Paginación optimizada a través de apiClient / Node backend)
      const offset = pageParam * PAGE_SIZE;
      const { drivers, totalCount, hayMas } = await apiClient.getDiaria({
        limit: PAGE_SIZE,
        offset,
        servicio: filters.servicio,
        alerta: filters.alerta,
        search: filters.search,
      });

      return {
        drivers: drivers || [],
        nextPage: hayMas ? pageParam + 1 : undefined,
        totalCount: totalCount || 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    placeholderData: (previousData) => previousData,
    enabled: isEnabled,
    staleTime: 1000 * 30,       // 30 seg en RAM (Realtime WebSockets sincroniza cambios inmediatos)
    gcTime: 1000 * 60 * 30,     // 30 min persistido en memoria
    refetchInterval: isEnabled ? 60000 : false, // Sondeo de respaldo cada 60s solo en pestaña activa
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true, // Recargar inmediatamente al volver a la ventana
    refetchOnReconnect: true,
  });
};

