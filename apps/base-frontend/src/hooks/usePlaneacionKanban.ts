import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFinalizados,
  fetchPlaneacionBoard,
  subscribePlaneacionSocket,
} from '../services/planeacionApi';
import type { BoardResponse, PlaneacionCard, PlaneacionHold } from '../types/planeacion';

export type PlaneacionTabMode = 'activos' | 'finalizados';
export type SortDirection = 'desc' | 'asc';

export function usePlaneacionKanban() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PlaneacionTabMode>('activos');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProcesoId, setSelectedProcesoId] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ['planeacion', 'board'],
    queryFn: fetchPlaneacionBoard,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const finalizadosQuery = useQuery({
    queryKey: ['planeacion', 'finalizados'],
    queryFn: () => fetchFinalizados(50, 0),
    enabled: activeTab === 'finalizados',
    staleTime: 1000 * 60 * 2,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const unsubscribe = subscribePlaneacionSocket(() => {
      queryClient.invalidateQueries({ queryKey: ['planeacion'] });
    });
    return unsubscribe;
  }, [queryClient]);

  const activos = boardQuery.data?.activos ?? [];
  const holds = boardQuery.data?.holds ?? [];
  const catalog = boardQuery.data?.catalog ?? {
    zones: [],
    boxes: [],
    usuarios: [],
    unidades: [],
  };
  const finalizados = finalizadosQuery.data ?? [];

  // Mapeo unificado de base.procesos_hold a PlaneacionCard para el sub-dock PREASIGNADO (location: empty)
  const holdCards = useMemo<PlaneacionCard[]>(() => {
    return holds.map((h) => {
      const activeUnfinalized = activos.find(
        (a) =>
          !a.salida_at &&
          ((h.unidad_id && a.unidad_id === h.unidad_id) ||
            (h.tractor_id && a.tractor_id === h.tractor_id) ||
            (h.semi_id && a.semi_id === h.semi_id))
      );

      const ubicacionBox =
        h.ubicacion_actual_box || activeUnfinalized?.box_name || h.salida_origen_box || null;
      const ubicacionZone =
        h.ubicacion_actual_zone || activeUnfinalized?.zone_name || h.salida_origen_zone || null;

      return {
        proceso_id: h.hold_id,
        hold_id: h.hold_id,
        unidad_id: h.unidad_id,
        n_ute: h.n_ute || '',
        tractor_id: h.tractor_id,
        tractor_plate: h.tractor_plate || '',
        semi_id: h.semi_id,
        semi_plate: h.semi_plate || '',
        modalidad_tracking: h.modalidad_tracking,
        box_id: h.box_id || '',
        box_name: h.box_name || '',
        zone_id: h.zone_id,
        zone_name: h.zone_name,
        estado_proceso: 'PREASIGNADO',
        etapa_ciclo: 'PLANIFICADO_HOLD',
        orden: h.orden,
        llegada_at: '',
        inicio_at: null,
        salida_at: null,
        usuarios_ids: h.usuarios_ids || [],
        usuarios_nombres: h.usuarios_nombres || [],
        notes:
          h.notes && h.notes.length > 0
            ? h.notes
            : h.nota_planificacion
            ? [
                {
                  id: h.hold_id,
                  texto: h.nota_planificacion,
                  location: 'Coordinación',
                  timestamp: h.created_at,
                  usuario_id: null,
                  usuario: 'Coordinación',
                },
              ]
            : [],
        salida_previa_at: h.salida_previa_at,
        salida_origen_box: ubicacionBox,
        salida_origen_zone: ubicacionZone,
        ultima_tarea: h.ultima_tarea,
        ultima_tarea_usuario: h.ultima_tarea_usuario,
        ultima_tarea_at: h.ultima_tarea_at,
        en_proceso_activo: Boolean(h.en_proceso_activo ?? activeUnfinalized),
        ubicacion_actual_box: ubicacionBox,
        ubicacion_actual_zone: ubicacionZone,
      };
    });
  }, [holds, activos]);

  const sourceCards = useMemo(() => {
    return activeTab === 'activos' ? [...activos, ...holdCards] : finalizados;
  }, [activeTab, activos, holdCards, finalizados]);

  // Filtrado multi-criterio en memoria (patentes, box, zona, ute, usuarios)
  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sourceCards;
    return sourceCards.filter(
      (c) =>
        c.tractor_plate.toLowerCase().includes(q) ||
        c.semi_plate.toLowerCase().includes(q) ||
        c.box_name.toLowerCase().includes(q) ||
        c.zone_name.toLowerCase().includes(q) ||
        c.n_ute.toLowerCase().includes(q) ||
        c.usuarios_nombres.some((u) => u.toLowerCase().includes(q))
    );
  }, [sourceCards, searchQuery]);

  // Agrupación dinámica de columnas según base.zones (misma lógica de columnas que Coordinación)
  const columns = useMemo(() => {
    const zoneMap = new Map<string, { id: string; title: string; cards: PlaneacionCard[] }>();

    for (const z of catalog.zones) {
      zoneMap.set(z.id, { id: z.id, title: z.zone_name, cards: [] });
    }

    for (const card of filteredCards) {
      if (!zoneMap.has(card.zone_id)) {
        zoneMap.set(card.zone_id, { id: card.zone_id, title: card.zone_name, cards: [] });
      }
      zoneMap.get(card.zone_id)!.cards.push(card);
    }

    const result = Array.from(zoneMap.values());
    for (const col of result) {
      col.cards.sort((a, b) => {
        const tA = a.llegada_at ? new Date(a.llegada_at).getTime() : 0;
        const tB = b.llegada_at ? new Date(b.llegada_at).getTime() : 0;
        return sortDirection === 'desc' ? tB - tA : tA - tB;
      });
    }
    return result;
  }, [catalog.zones, filteredCards, sortDirection]);

  const selectedCard = useMemo(
    () => sourceCards.find((c) => c.proceso_id === selectedProcesoId) || null,
    [sourceCards, selectedProcesoId]
  );

  // --- MUTACIONES OPTIMISTAS EN MEMORIA (0 ms Latencia, Ultra-Smooth Drag & Drop) ---
  const optimisticMoveHoldZone = useCallback(
    (holdId: string, targetZoneId: string) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const targetZone = (prev.catalog?.zones || []).find((z) => z.id === targetZoneId);
      const sourceHold = (prev.holds || []).find((h) => h.hold_id === holdId);

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        // Wipe de cualquier proceso finalizado anterior de la misma unidad al arrastrar desde PREASIGNADO
        activos: sourceHold
          ? (prev.activos || []).filter(
              (a) =>
                !(
                  Boolean(a.salida_at) &&
                  ((sourceHold.unidad_id && a.unidad_id === sourceHold.unidad_id) ||
                    (sourceHold.tractor_id && a.tractor_id === sourceHold.tractor_id) ||
                    (sourceHold.semi_id && a.semi_id === sourceHold.semi_id))
                )
            )
          : prev.activos,
        holds: (prev.holds || []).map((h) =>
          h.hold_id === holdId
            ? { ...h, zone_id: targetZoneId, zone_name: targetZone?.zone_name || h.zone_name, box_id: null, box_name: '' }
            : h
        ),
      });

      return prev;
    },
    [queryClient]
  );

  const optimisticMoveProcesoBox = useCallback(
    (procesoId: string, targetBoxId: string) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const targetBox = (prev.catalog?.boxes || []).find((b) => b.id === targetBoxId);
      const targetZone = (prev.catalog?.zones || []).find((z) => z.id === targetBox?.zone_id);

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        activos: (prev.activos || []).map((a) =>
          a.proceso_id === procesoId
            ? {
                ...a,
                box_id: targetBoxId,
                box_name: targetBox?.box_name || a.box_name,
                zone_id: targetBox?.zone_id || a.zone_id,
                zone_name: targetZone?.zone_name || a.zone_name,
              }
            : a
        ),
      });

      return prev;
    },
    [queryClient]
  );

  // Desde FINALIZÓ: sale de su columna del Kanban (archiva a cold) y pasa a la nueva zona en PREASIGNADO (hold) con su última ubicación (Zona · Box)
  const optimisticMoveFinalizadoToHold = useCallback(
    (procesoId: string, targetZoneId: string) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const sourceCard = (prev.activos || []).find((a) => a.proceso_id === procesoId);
      if (!sourceCard) return prev;

      const targetZone = (prev.catalog?.zones || []).find((z) => z.id === targetZoneId);
      const nowIso = new Date().toISOString();
      const lastNote =
        sourceCard.notes && sourceCard.notes.length > 0
          ? sourceCard.notes[sourceCard.notes.length - 1]
          : null;

      const newHold: PlaneacionHold = {
        hold_id: `temp_hold_${procesoId}`,
        unidad_id: sourceCard.unidad_id,
        n_ute: sourceCard.n_ute,
        tractor_id: sourceCard.tractor_id,
        tractor_plate: sourceCard.tractor_plate,
        semi_id: sourceCard.semi_id,
        semi_plate: sourceCard.semi_plate,
        modalidad_tracking: sourceCard.modalidad_tracking,
        zone_id: targetZoneId,
        zone_name: targetZone?.zone_name || sourceCard.zone_name,
        box_id: null,
        box_name: '',
        orden: 1,
        usuarios_ids: [],
        usuarios_nombres: [],
        nota_planificacion: null,
        notes: sourceCard.notes || [],
        proceso_origen_id: procesoId,
        created_at: nowIso,
        updated_at: nowIso,
        salida_previa_at: sourceCard.salida_at || nowIso,
        salida_origen_box: sourceCard.box_name || null,
        salida_origen_zone: sourceCard.zone_name || null,
        ultima_tarea: lastNote?.texto || sourceCard.ultima_tarea || null,
        ultima_tarea_usuario: lastNote?.usuario || sourceCard.ultima_tarea_usuario || null,
        ultima_tarea_at: lastNote?.timestamp || sourceCard.ultima_tarea_at || null,
        en_proceso_activo: false,
        ubicacion_actual_box: sourceCard.box_name || null,
        ubicacion_actual_zone: sourceCard.zone_name || null,
      };

      // Multi-PREASIGNADO: solo reemplaza si ya había un PREASIGNADO en la MISMA targetZoneId (evita blink de otras zonas)
      const filteredHolds = (prev.holds || []).filter(
        (h) =>
          !(
            h.zone_id === targetZoneId &&
            ((sourceCard.unidad_id && h.unidad_id === sourceCard.unidad_id) ||
              (sourceCard.tractor_id && h.tractor_id === sourceCard.tractor_id) ||
              (sourceCard.semi_id && h.semi_id === sourceCard.semi_id))
          )
      );

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        activos: (prev.activos || []).filter((a) => a.proceso_id !== procesoId),
        holds: [newHold, ...filteredHolds],
      });

      return prev;
    },
    [queryClient]
  );

  // Desde otra instancia (TRABAJANDO / ESPERANDO A SER INGRESADO A BOX): mantiene carta activa y desprende PREASIGNADO amarillo
  const optimisticCloneActiveToHold = useCallback(
    (procesoId: string, targetZoneId: string) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const sourceCard = (prev.activos || []).find((a) => a.proceso_id === procesoId);
      if (!sourceCard) return prev;

      const targetZone = (prev.catalog?.zones || []).find((z) => z.id === targetZoneId);
      const nowIso = new Date().toISOString();
      const lastNote =
        sourceCard.notes && sourceCard.notes.length > 0
          ? sourceCard.notes[sourceCard.notes.length - 1]
          : null;

      const newHold: PlaneacionHold = {
        hold_id: `temp_hold_${procesoId}_${targetZoneId}`,
        unidad_id: sourceCard.unidad_id,
        n_ute: sourceCard.n_ute,
        tractor_id: sourceCard.tractor_id,
        tractor_plate: sourceCard.tractor_plate,
        semi_id: sourceCard.semi_id,
        semi_plate: sourceCard.semi_plate,
        modalidad_tracking: sourceCard.modalidad_tracking,
        zone_id: targetZoneId,
        zone_name: targetZone?.zone_name || sourceCard.zone_name,
        box_id: null,
        box_name: '',
        orden: 1,
        usuarios_ids: [],
        usuarios_nombres: [],
        nota_planificacion: null,
        notes: sourceCard.notes || [],
        proceso_origen_id: procesoId,
        created_at: nowIso,
        updated_at: nowIso,
        salida_previa_at: null,
        salida_origen_box: sourceCard.box_name || null,
        salida_origen_zone: sourceCard.zone_name || null,
        ultima_tarea: lastNote?.texto || sourceCard.ultima_tarea || null,
        ultima_tarea_usuario: lastNote?.usuario || sourceCard.ultima_tarea_usuario || null,
        ultima_tarea_at: lastNote?.timestamp || sourceCard.ultima_tarea_at || null,
        en_proceso_activo: true,
        ubicacion_actual_box: sourceCard.box_name || null,
        ubicacion_actual_zone: sourceCard.zone_name || null,
      };

      // Multi-PREASIGNADO: conserva las otras cards PREASIGNADO en otras zonas (0 blink)
      const filteredHolds = (prev.holds || []).filter(
        (h) =>
          !(
            h.zone_id === targetZoneId &&
            ((sourceCard.unidad_id && h.unidad_id === sourceCard.unidad_id) ||
              (sourceCard.tractor_id && h.tractor_id === sourceCard.tractor_id) ||
              (sourceCard.semi_id && h.semi_id === sourceCard.semi_id))
          )
      );

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        holds: [newHold, ...filteredHolds],
      });

      return prev;
    },
    [queryClient]
  );

  // Desde otro PREASIGNADO: conserva el origen y desprende un nuevo PREASIGNADO en targetZoneId (0 blink)
  const optimisticCloneHoldToZone = useCallback(
    (sourceHoldId: string, targetZoneId: string) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const sourceHold = (prev.holds || []).find((h) => h.hold_id === sourceHoldId);
      if (!sourceHold || sourceHold.zone_id === targetZoneId) return prev;

      const targetZone = (prev.catalog?.zones || []).find((z) => z.id === targetZoneId);
      const nowIso = new Date().toISOString();

      const newHold: PlaneacionHold = {
        ...sourceHold,
        hold_id: `temp_hold_${sourceHoldId}_${targetZoneId}`,
        zone_id: targetZoneId,
        zone_name: targetZone?.zone_name || sourceHold.zone_name,
        box_id: null,
        box_name: '',
        proceso_origen_id: sourceHoldId,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const filteredHolds = (prev.holds || []).filter(
        (h) =>
          !(
            h.zone_id === targetZoneId &&
            ((sourceHold.unidad_id && h.unidad_id === sourceHold.unidad_id) ||
              (sourceHold.tractor_id && h.tractor_id === sourceHold.tractor_id) ||
              (sourceHold.semi_id && h.semi_id === sourceHold.semi_id))
          )
      );

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        holds: [newHold, ...filteredHolds],
      });

      return prev;
    },
    [queryClient]
  );

  const optimisticRemoveCard = useCallback(
    (cardId: string, isHold: boolean) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        holds: isHold ? (prev.holds || []).filter((h) => h.hold_id !== cardId) : prev.holds,
        activos: !isHold ? (prev.activos || []).filter((a) => a.proceso_id !== cardId) : prev.activos,
      });

      return prev;
    },
    [queryClient]
  );

  const rollbackBoard = useCallback(
    (previousSnapshot: BoardResponse | undefined) => {
      if (previousSnapshot) {
        queryClient.setQueryData(['planeacion', 'board'], previousSnapshot);
      }
    },
    [queryClient]
  );

  return {
    activeTab,
    setActiveTab,
    sortDirection,
    setSortDirection,
    searchQuery,
    setSearchQuery,
    selectedProcesoId,
    setSelectedProcesoId,
    selectedCard,
    columns,
    filteredCards,
    activosCount: activos.length,
    finalizadosCount: finalizados.length,
    holds,
    catalog,
    isLoading: boardQuery.isLoading,
    isFetching: boardQuery.isFetching || finalizadosQuery.isFetching,
    error: boardQuery.error,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['planeacion'] }),
    optimisticMoveHoldZone,
    optimisticMoveProcesoBox,
    optimisticMoveFinalizadoToHold,
    optimisticCloneActiveToHold,
    optimisticCloneHoldToZone,
    optimisticRemoveCard,
    rollbackBoard,
  };
}
