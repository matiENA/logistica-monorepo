import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { apiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryKeys';

const PAGE_SIZE = 12;

export const useDailyCardsInfinite = (filters = {}) => {
  return useInfiniteQuery({
    queryKey: queryKeys.diaria.cards(filters),
    queryFn: async ({ pageParam = 0 }) => {
      const offset = pageParam * PAGE_SIZE;
      const { cards, totalCount, hayMas } = await apiClient.getCards({
        limit: PAGE_SIZE,
        offset,
        estado: filters.estado,
        servicio: filters.servicio,
        tipo: filters.tipo,
        search: filters.search,
      });

      return {
        cards: cards || [],
        nextPage: hayMas ? pageParam + 1 : undefined,
        totalCount: totalCount || 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    placeholderData: (previousData) => previousData,
    staleTime: 1000 * 60 * 3, // 3 minutos en memoria RAM
    gcTime: 1000 * 60 * 15,
  });
};

export const useToggleResolveCard = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cardId, resuelto }) => {
      const nuevoEstado = !resuelto;
      const { error } = await supabase
        .from('novedades')
        .update({
          resuelto: nuevoEstado,
          fecha_resolucion: nuevoEstado ? new Date().toISOString() : null,
          actualizado_el: new Date().toISOString(),
        })
        .eq('id', cardId);

      if (error) throw error;
      return { cardId, nuevoEstado };
    },
    // Mutación optimista en RAM
    onMutate: async ({ cardId, resuelto }) => {
      await queryClient.cancelQueries({ queryKey: ['cards_diarias_infinite'] });

      const prevData = queryClient.getQueriesData({ queryKey: ['cards_diarias_infinite'] });

      queryClient.setQueriesData({ queryKey: ['cards_diarias_infinite'] }, (old) => {
        if (!old || !old.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            cards: page.cards.map((c) =>
              c.card_id === cardId ? { ...c, resuelto: !resuelto } : c
            ),
          })),
        };
      });

      return { prevData };
    },
    onError: (err, variables, context) => {
      if (context?.prevData) {
        context.prevData.forEach(([key, val]) => queryClient.setQueryData(key, val));
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cards_diarias_infinite'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.badge });
      queryClient.invalidateQueries({ queryKey: queryKeys.kpis });
    },
  });
};

export const useCreateCard = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (cardPayload) => {
      const usuarioActivo = localStorage.getItem('usuarioActivo') || 'OPERADOR';
      const { error } = await supabase
        .from('novedades')
        .insert([{
          ...cardPayload,
          creador: cardPayload.creador || usuarioActivo,
          legacy_id: `nov_${Date.now()}`,
          creado_el: new Date().toISOString(),
          actualizado_el: new Date().toISOString(),
        }]);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards_diarias_infinite'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.badge });
      queryClient.invalidateQueries({ queryKey: queryKeys.kpis });
    },
  });
};
