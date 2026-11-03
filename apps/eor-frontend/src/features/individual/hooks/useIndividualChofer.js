import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryKeys';

/**
 * Hook para consultar la vista unificada de Chofer + Unidad + Vencimientos + Avalados
 * desde public.view_individual_chofer vía Node.js backend (con compresión Gzip y pooler)
 */
export const useIndividualChofer = (choferId) => {
  return useQuery({
    queryKey: queryKeys.individual.detail(choferId),
    queryFn: async () => {
      if (!choferId) return null;
      return await apiClient.getIndividualChofer(choferId);
    },
    enabled: Boolean(choferId),
    staleTime: 1000 * 30, // 30 seg de frescura
    refetchOnMount: true,
    gcTime: 1000 * 60 * 30,
  });
};
