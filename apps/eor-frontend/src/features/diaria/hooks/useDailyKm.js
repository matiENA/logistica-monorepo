import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryKeys';

/**
 * Hook para consultar los kilómetros y hojas de ruta de todos los choferes para una fecha contexto
 */
export const useDailyKm = (fechaContexto) => {
  return useQuery({
    queryKey: queryKeys.diaria.km(fechaContexto),
    queryFn: async () => {
      if (!fechaContexto) return {};

      const data = await apiClient.getDiariaKm(fechaContexto);

      const map = {};
      (data || []).forEach((row) => {
        const chId = row.id_chofer || row.chofer_id;
        const kmVal = parseFloat(row.km_totales !== undefined ? row.km_totales : row.km) || 0;
        const hrStr = Array.isArray(row.hoja_ruta) ? row.hoja_ruta.join(', ') : (row.hoja_ruta || '');

        if (chId) {
          map[chId] = {
            km_totales: kmVal,
            hoja_ruta: hrStr,
            dominio: row.dominio || '',
            id_unidad: row.id_unidad || null,
            n_ute: row.n_ute || null,
          };
        }
        if (row.id_unidad) {
          map[`ut_${row.id_unidad}`] = {
            km_totales: kmVal,
            hoja_ruta: hrStr,
            dominio: row.dominio || '',
            id_chofer: chId,
          };
        }
      });

      return map;
    },
    staleTime: 1000 * 60 * 5, // 5 min en RAM
    gcTime: 1000 * 60 * 20,
    enabled: Boolean(fechaContexto),
  });
};
