import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryKeys';
import {
  parseMesTab,
  buildUpdatedTira,
  calcularContabilizador,
} from '@/utils/diagramaUtils';

export { calcularContabilizador };

const mesesAbrev = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

/**
 * Semáforos canónicos de Seguridad Vial (ICM + ISP)
 */
export function clasificarIcm(icm) {
  if (icm === null || icm === undefined || icm === '') return null;
  const val = Number(icm);
  if (isNaN(val)) return null;
  if (val < 0.08) return { nivel: 'verde', label: 'Bajo Riesgo', color: '#10b981' };
  if (val <= 0.12) return { nivel: 'naranja', label: 'Riesgo Medio', color: '#f59e0b' };
  return { nivel: 'rojo', label: 'Alto Riesgo', color: '#ef4444' };
}

export function clasificarIsp(isp) {
  if (isp === null || isp === undefined || isp === '') return null;
  const val = Number(isp);
  if (isNaN(val)) return null;
  if (val < 1.20) return { nivel: 'verde', label: 'Excelente', color: '#10b981' };
  if (val <= 1.50) return { nivel: 'naranja', label: 'Atención', color: '#f59e0b' };
  return { nivel: 'rojo', label: 'Crítico', color: '#ef4444' };
}

/**
 * Hook para consultar el calendario con diagramas y KMs pre-agregados
 * desde public.view_calendario_diagrama_km vía Node.js backend
 */
export const useCalendarDiagramaKm = (choferId, zoomLevel = 3, baseDate = new Date()) => {
  const queryClient = useQueryClient();

  // Construir las claves de pestañas objetivo
  const targetTabs = [];
  const year = baseDate.getFullYear();
  const monthIdx = baseDate.getMonth();

  if (zoomLevel === 3) {
    [-1, 0, 1].forEach((offset) => {
      const d = new Date(year, monthIdx + offset, 1);
      const m = d.getMonth();
      const yShort = String(d.getFullYear()).slice(-2);
      targetTabs.push(`${mesesAbrev[m]}-${yShort}`);
    });
  } else {
    for (let m = 0; m < 12; m++) {
      const yShort = String(year).slice(-2);
      targetTabs.push(`${mesesAbrev[m]}-${yShort}`);
    }
  }

  return useQuery({
    queryKey: queryKeys.individual.calendar(choferId, zoomLevel, zoomLevel === 12 ? String(year) : targetTabs.join(',')),
    queryFn: async () => {
      if (!choferId) {
        return { months: [], monthsMap: {}, tripsMap: {}, totalKm: 0, totalViajes: 0 };
      }

      const data = await apiClient.getCalendarioDiagramaKm(
        choferId,
        zoomLevel,
        zoomLevel === 3 ? targetTabs : [],
        zoomLevel === 12 ? year : null
      );

      const months = data || [];
      const monthsMap = {};
      const tripsMap = {};
      let totalKm = 0;
      let totalViajes = 0;

      months.forEach((m) => {
        // Enriquecer y blindar métricas decimales de Seguridad Vial
        if (m.icm !== undefined && m.icm !== null) {
          m.icm = Number(m.icm);
          if (!m.icm_clasificacion) m.icm_clasificacion = clasificarIcm(m.icm);
        }
        if (m.isp !== undefined && m.isp !== null) {
          m.isp = Number(m.isp);
          if (!m.isp_clasificacion) m.isp_clasificacion = clasificarIsp(m.isp);
        }

        if (m.mes_tab) {
          monthsMap[m.mes_tab] = m;
        }
        totalKm += parseFloat(m.km_mes_total) || 0;
        totalViajes += parseInt(m.cant_viajes_mes, 10) || 0;

        // Aplanar los días con KM a un mapa global para búsqueda instantánea en O(1)
        if (m.dias_km && typeof m.dias_km === 'object') {
          Object.entries(m.dias_km).forEach(([isoDate, tripInfo]) => {
            tripsMap[isoDate] = {
              km: parseFloat(tripInfo.km) || 0,
              hr: tripInfo.hr || '',
              tractor: tripInfo.tractor || '',
              n_ute: tripInfo.n_ute || '',
              id_unidad: tripInfo.id_unidad || null,
            };
          });
        }
      });

      return {
        months,
        monthsMap,
        tripsMap,
        totalKm: Math.round(totalKm * 100) / 100,
        totalViajes,
      };
    },
    enabled: Boolean(choferId),
    staleTime: 1000 * 30, // 30 segundos de frescura en RAM
    refetchOnMount: true, // Revalidar siempre al seleccionar el chofer
    gcTime: 1000 * 60 * 30,
  });
};

/**
 * Hook para actualizar días de diagrama en lote con Optimistic UI (<16ms),
 * rollback automático ante error de red y enrutamiento hacia public.eor_sync_queue.
 */
export const useUpdateDiagramaRange = (choferId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ updatesPorMes, monthsMap, usuario }) => {
      if (!choferId) throw new Error('ID de chofer requerido para actualizar diagrama');
      const usuarioActivo = usuario || localStorage.getItem('usuarioActivo') || 'OPERADOR';

      return await apiClient.upsertDiagramaRange({
        choferId,
        updatesPorMes,
        monthsMap,
        usuario: usuarioActivo,
      });
    },

    // Mutación optimista sincrónica en memoria RAM (<16ms)
    onMutate: async ({ updatesPorMes }) => {
      // Cancelar queries que pudieran sobreescribir la mutación
      await queryClient.cancelQueries({ queryKey: queryKeys.individual.calendar(choferId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.individual.detail(choferId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.diaria.all });

      // Captura de snapshots para rollback
      const prevCalendars = queryClient.getQueriesData({ queryKey: queryKeys.individual.calendar(choferId) });
      const prevDetail = queryClient.getQueryData(queryKeys.individual.detail(choferId));
      const prevDiaria = queryClient.getQueriesData({ queryKey: queryKeys.diaria.all });

      // Actualizar en RAM en <16ms todas las instancias de calendario del chofer
      queryClient.setQueriesData(
        { queryKey: queryKeys.individual.calendar(choferId) },
        (oldData) => {
          if (!oldData) return oldData;
          const currentMonths = oldData.months || [];
          const touchedTabs = new Set();

          const nextMonths = currentMonths.map((m) => {
            if (!updatesPorMes[m.mes_tab]) return m;
            touchedTabs.add(m.mes_tab);
            const parsed = parseMesTab(m.mes_tab);
            const daysInMonth = parsed?.daysInMonth || 31;
            const arr = buildUpdatedTira(m.tira_dias || '', updatesPorMes[m.mes_tab], daysInMonth);
            const nuevaTira = arr.join(',');
            const nuevoContabilizador = calcularContabilizador(arr);
            return {
              ...m,
              tira_dias: nuevaTira,
              contabilizador: nuevoContabilizador,
            };
          });

          // Si el mes (ej. Dic-26 o Ene-27) aún no existía en BD/vista, crear entrada optimista inmediata
          Object.entries(updatesPorMes).forEach(([tabKey, dayUpdates]) => {
            if (touchedTabs.has(tabKey)) return;
            const parsed = parseMesTab(tabKey);
            if (!parsed) return;
            const arr = buildUpdatedTira('', dayUpdates, parsed.daysInMonth);
            nextMonths.push({
              diagrama_id: `optimistic-${tabKey}`,
              chofer_id: choferId,
              mes_tab: parsed.mesTab,
              anio: parsed.anio,
              mes_numero: parsed.mesNumero,
              tira_dias: arr.join(','),
              contabilizador: calcularContabilizador(arr),
              km_mes_total: 0,
              cant_viajes_mes: 0,
              dias_km: {},
              icm: null,
              isp: null,
              cant_infracciones: 0,
              tiempo_conduccion_horas: 0,
            });
          });

          nextMonths.sort((a, b) => (a.anio - b.anio) || (a.mes_numero - b.mes_numero));

          const nextMonthsMap = {};
          nextMonths.forEach((m) => {
            if (m.mes_tab) nextMonthsMap[m.mes_tab] = m;
          });

          return {
            ...oldData,
            months: nextMonths,
            monthsMap: nextMonthsMap,
          };
        }
      );

      return { prevCalendars, prevDetail, prevDiaria };
    },

    // Rollback ante errores
    onError: (err, vars, context) => {
      console.warn('⚠️ [useUpdateDiagramaRange] Error en mutación de diagrama, ejecutando rollback:', err.message);
      if (context?.prevCalendars) {
        context.prevCalendars.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
      if (context?.prevDetail) {
        queryClient.setQueryData(queryKeys.individual.detail(choferId), context.prevDetail);
      }
      if (context?.prevDiaria) {
        context.prevDiaria.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
    },

    // Sincronización canónica posterior con las SQL Views
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.individual.calendar(choferId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.individual.detail(choferId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.diaria.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.flota.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.diagramas.mensual() });
    },
  });
};
