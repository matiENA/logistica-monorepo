import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { queryKeys } from '@/api/queryKeys';

/**
 * Hook de sincronización en tiempo real con Supabase Realtime (WebSockets)
 * Escucha cambios en las tablas 'movimientos', 'choferes' y 'unidades'
 * e invalida automáticamente las queries de React Query para que toda la interfaz
 * (tarjetas diarias, tabla de movimientos, flota) refleje los cambios al instante.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const pendingInvalidations = new Map();
    let flushTimer = null;

    const scheduleInvalidate = (queryKey) => {
      if (!queryKey) return;
      pendingInvalidations.set(JSON.stringify(queryKey), queryKey);
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const keysToFlush = Array.from(pendingInvalidations.values());
        pendingInvalidations.clear();
        keysToFlush.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      }, 500);
    };

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'movimientos' },
        () => {
          scheduleInvalidate(queryKeys.diaria.all);
          scheduleInvalidate(queryKeys.flota.all);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'choferes' },
        (payload) => {
          scheduleInvalidate(queryKeys.diaria.all);
          scheduleInvalidate(queryKeys.individual.catalog);
          const chId = payload.new?.id || payload.old?.id;
          if (chId) {
            scheduleInvalidate(queryKeys.individual.detail(chId));
          } else {
            scheduleInvalidate(queryKeys.individual.all);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'diagramas' },
        (payload) => {
          scheduleInvalidate(queryKeys.diaria.all);
          const chId = payload.new?.chofer_id || payload.old?.chofer_id;
          if (chId) {
            scheduleInvalidate(queryKeys.individual.calendar(chId));
          } else {
            scheduleInvalidate(queryKeys.individual.all);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'unidades' },
        () => {
          scheduleInvalidate(queryKeys.diaria.all);
          scheduleInvalidate(queryKeys.flota.all);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'choferes_km_mensual' },
        (payload) => {
          scheduleInvalidate(queryKeys.diaria.all);
          const chId = payload.new?.chofer_id || payload.old?.chofer_id;
          if (chId) {
            scheduleInvalidate(queryKeys.individual.calendar(chId));
            scheduleInvalidate(queryKeys.individual.detail(chId));
          } else {
            scheduleInvalidate(queryKeys.individual.all);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seguridad_vial' },
        (payload) => {
          const chId = payload.new?.chofer_id || payload.old?.chofer_id;
          if (chId) {
            scheduleInvalidate(queryKeys.individual.calendar(chId));
            scheduleInvalidate(queryKeys.individual.detail(chId));
          } else {
            scheduleInvalidate(queryKeys.individual.all);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('⚡ [Realtime] Conectado exitosamente al canal en vivo de Supabase');
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('⚠️ [Realtime] Advertencia en canal Supabase (cuota o egress excedido):', err?.message || err);
        } else if (status === 'TIMED_OUT') {
          console.warn('⚠️ [Realtime] Timeout de suscripción en canal Supabase');
        }
      });

    return () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingInvalidations.clear();
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
