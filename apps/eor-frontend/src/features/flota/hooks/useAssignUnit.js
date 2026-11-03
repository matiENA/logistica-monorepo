import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { apiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryKeys';
import { showLegacyToast } from '@/utils/clipboard';

/**
 * Hook para consultar el catálogo de unidades operativas disponibles para asignación
 */
export const useAvailableUnits = (servicio = 'TODOS', options = {}) => {
  return useQuery({
    queryKey: queryKeys.flota.disponibles(servicio),
    queryFn: async () => {
      const data = await apiClient.getFlota();
      if (servicio && servicio !== 'TODOS') {
        return (data || []).filter((u) => (u.servicio || '').toUpperCase() === servicio.toUpperCase());
      }
      return data || [];
    },
    enabled: options.enabled !== undefined ? Boolean(options.enabled) : true,
    staleTime: 1000 * 60 * 3, // 3 min en RAM
  });
};

/**
 * Hook principal para Asignar o Desasignar Unidad Operativa
 * Implementa mutaciones optimistas en RAM (<16ms) y sincronización con PostgreSQL
 * y public.eor_sync_queue con capacidad total de rollback.
 */
export const useAssignUnit = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      choferId,
      choferNombre,
      unidadId = null,
      tractor = null,
      semi = null,
      n_ute = null,
      esDesasignar = false,
    }) => {
      if (!choferId && !choferNombre) {
        throw new Error('Identificador de chofer requerido para asignar unidad');
      }

      const usuarioActivo = localStorage.getItem('usuarioActivo') || 'OPERADOR';

      // 1. Desasignación Atómica (ACID vía RPC en PostgreSQL -> public.eor_sync_queue + Hot RAM)
      if (esDesasignar) {
        return await apiClient.desunirUnidad({
          choferId,
          usuario: usuarioActivo,
        });
      }

      // 2. Asignación Directa Atómica (ACID vía RPC en PostgreSQL -> public.eor_sync_queue + Hot RAM)
      return await apiClient.asignarUnidad({
        choferId,
        choferNombre,
        unidadId,
        tractor,
        semi,
        n_ute,
        usuario: usuarioActivo,
      });
    },

    // Mutación optimista en RAM para que la UI responda en <16 ms
    onMutate: async (vars) => {
      const { choferId, tractor, semi, n_ute, unidadId, esDesasignar } = vars;

      // Cancelar queries activas que pudieran sobreescribir la mutación optimista
      await queryClient.cancelQueries({ queryKey: queryKeys.individual.detail(choferId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.diaria.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.flota.all });
      await queryClient.cancelQueries({ queryKey: ['unidades_para_asignar'] });

      // Capturar snapshots para rollback en caso de error de red
      const prevDetail = queryClient.getQueryData(queryKeys.individual.detail(choferId));
      const prevDiaria = queryClient.getQueriesData({ queryKey: queryKeys.diaria.all });
      const prevFlota = queryClient.getQueriesData({ queryKey: queryKeys.flota.all });
      const prevDisponibles = queryClient.getQueriesData({ queryKey: ['unidades_para_asignar'] });

      // A. Actualizar ficha individual del chofer en RAM inmediatamente
      if (prevDetail) {
        queryClient.setQueryData(queryKeys.individual.detail(choferId), (old) => {
          if (!old) return old;
          return {
            ...old,
            unidad_id: esDesasignar ? null : unidadId || old.unidad_id,
            tractor: esDesasignar ? null : (tractor !== undefined ? tractor : old.tractor),
            semi: esDesasignar ? null : (semi !== undefined ? semi : old.semi),
            n_ute: esDesasignar ? null : (n_ute !== undefined ? n_ute : old.n_ute),
            estado_chofer: esDesasignar ? 'inactivo' : 'circulando',
            estado_unidad: esDesasignar ? 'disponible' : 'circulando',
          };
        });
      }

      // B. Actualizar Vista Diaria Operativa en RAM inmediatamente (<16ms)
      queryClient.setQueriesData({ queryKey: queryKeys.diaria.all }, (old) => {
        if (!old) return old;

        // Función auxiliar para transformar lista de drivers en memoria
        const updateDrivers = (drivers = []) => {
          return drivers.map((d) => {
            const isTarget = String(d.chofer_id) === String(choferId) || String(d.id) === String(choferId);
            if (isTarget) {
              return {
                ...d,
                unidad_id: esDesasignar ? null : unidadId || d.unidad_id,
                tractor: esDesasignar ? null : (tractor !== undefined ? tractor : d.tractor),
                semi: esDesasignar ? null : (semi !== undefined ? semi : d.semi),
                n_ute: esDesasignar ? null : (n_ute !== undefined ? n_ute : d.n_ute),
                estado_chofer: esDesasignar ? 'inactivo' : 'circulando',
                alerta_docs_unidad: esDesasignar ? 'S_D' : d.alerta_docs_unidad,
              };
            }

            // Si otra tarjeta tenía previamente esta misma unidad asignada, liberarla
            if (!esDesasignar && (
              (tractor && d.tractor === tractor) ||
              (n_ute && String(d.n_ute) === String(n_ute)) ||
              (unidadId && String(d.unidad_id) === String(unidadId))
            )) {
              return {
                ...d,
                unidad_id: null,
                tractor: null,
                semi: null,
                n_ute: null,
                estado_chofer: 'inactivo',
                alerta_docs_unidad: 'S_D',
              };
            }
            return d;
          });
        };

        // Soporta respuesta paginada de useInfiniteQuery
        if (old.pages) {
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              drivers: updateDrivers(page.drivers),
            })),
          };
        }

        if (Array.isArray(old.drivers)) {
          return {
            ...old,
            drivers: updateDrivers(old.drivers),
          };
        }

        if (Array.isArray(old)) {
          return updateDrivers(old);
        }

        return old;
      });

      // C. Actualizar Catálogo de Flota en RAM
      queryClient.setQueriesData({ queryKey: queryKeys.flota.all }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((u) => {
          const isAssigned = (unidadId && u.unidad_id === unidadId) || (tractor && u.tractor === tractor);
          if (isAssigned) {
            return {
              ...u,
              estado: esDesasignar ? 'disponible' : 'circulando',
              chofer_id: esDesasignar ? null : choferId,
              chofer_nombre: esDesasignar ? null : (vars.choferNombre || u.chofer_nombre),
            };
          }
          return u;
        });
      });

      // D. Actualizar unidades disponibles en RAM (filtro de catálogo)
      queryClient.setQueriesData({ queryKey: ['unidades_para_asignar'] }, (old) => {
        if (!Array.isArray(old)) return old;
        if (!esDesasignar && (unidadId || tractor)) {
          return old.filter((u) => (unidadId ? u.unidad_id !== unidadId : u.tractor !== tractor));
        }
        return old;
      });

      return { prevDetail, prevDiaria, prevFlota, prevDisponibles };
    },

    // Rollback exacto en caso de error de red o servidor
    onError: (err, vars, context) => {
      console.warn('⚠️ [useAssignUnit] Error en mutación, ejecutando rollback:', err.message);
      showLegacyToast(`Error al sincronizar pareo: ${err.message}`, 'error');

      if (context?.prevDetail && vars?.choferId) {
        queryClient.setQueryData(queryKeys.individual.detail(vars.choferId), context.prevDetail);
      }
      if (context?.prevDiaria) {
        context.prevDiaria.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
      if (context?.prevFlota) {
        context.prevFlota.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
      if (context?.prevDisponibles) {
        context.prevDisponibles.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
    },

    // Invalidación reactiva suave para confirmar con las SQL Views
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.individual.catalog });
      queryClient.invalidateQueries({ queryKey: queryKeys.diaria.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.flota.all });
      queryClient.invalidateQueries({ queryKey: ['unidades_para_asignar'] });
      if (variables?.choferId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.individual.detail(variables.choferId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.individual.calendar(variables.choferId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.individual.docs(variables.choferId) });
      }
    },
  });
};
