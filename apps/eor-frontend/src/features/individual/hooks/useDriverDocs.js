import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { apiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryKeys';

export const useDriverDocs = (choferId, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.individual.docs(choferId),
    queryFn: async () => {
      if (!choferId) return null;
      return apiClient.getChoferDocs(choferId);
    },
    enabled: Boolean(choferId) && Boolean(enabled),
    staleTime: 1000 * 60 * 10, // 10 min en RAM
  });
};

export const useDriverObservations = (choferId, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.individual.observations(choferId),
    queryFn: async () => {
      if (!choferId) return [];
      return apiClient.getChoferObservaciones(choferId);
    },
    enabled: Boolean(choferId) && Boolean(enabled),
    staleTime: 1000 * 60 * 10,
  });
};

/**
 * Hook para actualizar un campo individual de documentación con Optimistic UI (<16ms)
 * y enrutamiento hacia public.eor_sync_queue vía triggers de PostgreSQL.
 */
export const useUpdateDocField = (choferParam) => {
  const queryClient = useQueryClient();
  const choferId = typeof choferParam === 'object' ? choferParam?.id || choferParam?.chofer_id : choferParam;

  return useMutation({
    mutationFn: async ({ field, value, docId }) => {
      const usuarioActivo = localStorage.getItem('usuarioActivo') || 'OPERADOR';
      const updatePayload = {
        [field]: value || null,
        actualizado_el: new Date().toISOString(),
        actualizado_por: usuarioActivo,
      };

      // 1. Persistencia en Supabase
      if (docId) {
        const { error } = await supabase
          .from('chofer_documentacion')
          .update(updatePayload)
          .eq('id', docId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('chofer_documentacion')
          .insert([{
            chofer_id: choferId,
            ...updatePayload,
          }]);
        if (error) throw error;
      }

      return { field, value };
    },

    // Mutación optimista sincrónica en RAM (<16ms)
    onMutate: async ({ field, value, docId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.individual.docs(choferId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.individual.detail(choferId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.diaria.all });

      const prevDocs = queryClient.getQueryData(queryKeys.individual.docs(choferId));
      const prevDetail = queryClient.getQueryData(queryKeys.individual.detail(choferId));
      const prevDiaria = queryClient.getQueriesData({ queryKey: queryKeys.diaria.all });

      // Actualizar docs del chofer en RAM
      queryClient.setQueryData(queryKeys.individual.docs(choferId), (old) => {
        if (!old) return { id: docId, chofer_id: choferId, [field]: value };
        return { ...old, [field]: value };
      });

      // Actualizar vista individual (view_individual_chofer) en RAM
      if (prevDetail) {
        queryClient.setQueryData(queryKeys.individual.detail(choferId), (old) => {
          if (!old) return old;
          return { ...old, [field]: value };
        });
      }

      // Actualizar alerta en vista diaria en RAM si corresponde
      queryClient.setQueriesData({ queryKey: queryKeys.diaria.all }, (old) => {
        if (!old) return old;
        const updateDriverDocs = (drivers = []) => {
          return drivers.map((d) => {
            if (d.chofer_id === choferId || d.id === choferId) {
              return { ...d, [field]: value };
            }
            return d;
          });
        };

        if (old.pages) {
          return {
            ...old,
            pages: old.pages.map((p) => ({ ...p, drivers: updateDriverDocs(p.drivers) })),
          };
        }
        if (Array.isArray(old.drivers)) {
          return { ...old, drivers: updateDriverDocs(old.drivers) };
        }
        return old;
      });

      return { prevDocs, prevDetail, prevDiaria };
    },

    // Rollback ante errores de red o base de datos
    onError: (err, vars, context) => {
      console.warn('⚠️ [useUpdateDocField] Error en mutación, ejecutando rollback:', err.message);
      if (context?.prevDocs) {
        queryClient.setQueryData(queryKeys.individual.docs(choferId), context.prevDocs);
      }
      if (context?.prevDetail) {
        queryClient.setQueryData(queryKeys.individual.detail(choferId), context.prevDetail);
      }
      if (context?.prevDiaria) {
        context.prevDiaria.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
    },

    // Sincronización canónica posterior contra Hot RAM C1 y las Views de Supabase
    onSettled: async () => {
      if (choferId) {
        const fresh = await apiClient.getChoferDocs(choferId, true).catch(() => null);
        if (fresh) {
          queryClient.setQueryData(queryKeys.individual.docs(choferId), fresh);
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.individual.detail(choferId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.diaria.all });
    },
  });
};

/**
 * Hook para guardar en bloque todos los campos de documentación con Optimistic UI (<16ms)
 * y enrutamiento hacia public.eor_sync_queue.
 */
export const useSaveAllDocs = (choferParam) => {
  const queryClient = useQueryClient();
  const choferId = typeof choferParam === 'object' ? choferParam?.id || choferParam?.chofer_id : choferParam;

  return useMutation({
    mutationFn: async ({ docId, fields }) => {
      const usuarioActivo = localStorage.getItem('usuarioActivo') || 'OPERADOR';
      const updatePayload = {
        ...fields,
        actualizado_el: new Date().toISOString(),
        actualizado_por: usuarioActivo,
      };

      // 1. Persistencia en Supabase
      if (docId) {
        const { error } = await supabase
          .from('chofer_documentacion')
          .update(updatePayload)
          .eq('id', docId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('chofer_documentacion')
          .insert([{
            chofer_id: choferId,
            ...updatePayload,
          }]);
        if (error) throw error;
      }
    },

    // Mutación optimista sincrónica en RAM (<16ms)
    onMutate: async ({ docId, fields }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.individual.docs(choferId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.individual.detail(choferId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.diaria.all });

      const prevDocs = queryClient.getQueryData(queryKeys.individual.docs(choferId));
      const prevDetail = queryClient.getQueryData(queryKeys.individual.detail(choferId));
      const prevDiaria = queryClient.getQueriesData({ queryKey: queryKeys.diaria.all });

      queryClient.setQueryData(queryKeys.individual.docs(choferId), (old) => {
        if (!old) return { id: docId, chofer_id: choferId, ...fields };
        return { ...old, ...fields };
      });

      if (prevDetail) {
        queryClient.setQueryData(queryKeys.individual.detail(choferId), (old) => {
          if (!old) return old;
          return { ...old, ...fields };
        });
      }

      return { prevDocs, prevDetail, prevDiaria };
    },

    onError: (err, vars, context) => {
      console.warn('⚠️ [useSaveAllDocs] Error en guardado general, ejecutando rollback:', err.message);
      if (context?.prevDocs) {
        queryClient.setQueryData(queryKeys.individual.docs(choferId), context.prevDocs);
      }
      if (context?.prevDetail) {
        queryClient.setQueryData(queryKeys.individual.detail(choferId), context.prevDetail);
      }
      if (context?.prevDiaria) {
        context.prevDiaria.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
    },

    onSettled: async () => {
      if (choferId) {
        const fresh = await apiClient.getChoferDocs(choferId, true).catch(() => null);
        if (fresh) {
          queryClient.setQueryData(queryKeys.individual.docs(choferId), fresh);
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.individual.detail(choferId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.diaria.all });
    },
  });
};
