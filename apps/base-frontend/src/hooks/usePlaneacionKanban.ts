import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFinalizados,
  fetchPlaneacionBoard,
  subscribePlaneacionSocket,
} from '../services/planeacionApi';
import type {
  BoardResponse,
  CircuitoAbierto,
  CircuitoTerminado,
  CircuitoTimelineStep,
  IdleDockItem,
  PlaneacionCard,
  PlaneacionCatalog,
  PlaneacionHold,
  ProcesoNota,
} from '../types/planeacion';

export type PlaneacionTabMode = 'activos' | 'finalizados';
export type SortDirection = 'desc' | 'asc';

export type CatalogUnitItem = PlaneacionCatalog['unidades'][number];

export function normalizePlateKey(raw: string | null | undefined): string {
  return (raw || '').replace(/[\s-]/g, '').toUpperCase();
}

function toTimestampMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function usePlaneacionKanban(enabled = true) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PlaneacionTabMode>('activos');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');

  const boardQuery = useQuery({
    queryKey: ['planeacion', 'board'],
    queryFn: fetchPlaneacionBoard,
    enabled,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const finalizadosQuery = useQuery({
    queryKey: ['planeacion', 'finalizados'],
    queryFn: () => fetchFinalizados(50, 0),
    enabled: enabled && activeTab === 'finalizados',
    staleTime: 1000 * 60 * 2,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribePlaneacionSocket(() => {
      queryClient.invalidateQueries({ queryKey: ['planeacion'] });
    });
    return unsubscribe;
  }, [enabled, queryClient]);

  const activos = boardQuery.data?.activos ?? [];
  const holds = boardQuery.data?.holds ?? [];
  const circuitosAbiertos = boardQuery.data?.circuitos_abiertos ?? [];
  const rawCircuitosTerminados = boardQuery.data?.circuitos_terminados ?? [];
  const circuitosTimelines = boardQuery.data?.circuitos_timelines ?? {};

  const circuitosTerminados = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rawCircuitosTerminados;
    return rawCircuitosTerminados.filter(
      (c) =>
        c.tractor_plate.toLowerCase().includes(q) ||
        c.semi_plate.toLowerCase().includes(q) ||
        c.n_ute.toLowerCase().includes(q) ||
        (c.patente_cruzada || '').toLowerCase().includes(q)
    );
  }, [rawCircuitosTerminados, searchQuery]);
  const catalog = boardQuery.data?.catalog ?? {
    zones: [],
    boxes: [],
    usuarios: [],
    unidades: [],
  };
  const finalizados = finalizadosQuery.data ?? [];

  // Anti-duplicación estricta: compara IDs y patentes normalizadas contra circuitos abiertos, activos y holds.
  // Directamente omite del selector cualquier conjunto con patentes ya presentes en planta o duplicadas en el catálogo.
  const availableCatalogUnits = useMemo<CatalogUnitItem[]>(() => {
    const activeUnidadIds = new Set<string>();
    const activeTractorIds = new Set<string>();
    const activeSemiIds = new Set<string>();
    const activePlates = new Set<string>();

    const registerActive = (item: {
      unidad_id?: string | null;
      tractor_id?: string | null;
      semi_id?: string | null;
      tractor_plate?: string | null;
      semi_plate?: string | null;
      patente_cruzada?: string | null;
    }) => {
      if (item.unidad_id) activeUnidadIds.add(item.unidad_id);
      if (item.tractor_id) activeTractorIds.add(item.tractor_id);
      if (item.semi_id) activeSemiIds.add(item.semi_id);
      const tr = normalizePlateKey(item.tractor_plate);
      const sm = normalizePlateKey(item.semi_plate);
      const cr = normalizePlateKey(item.patente_cruzada);
      if (tr) activePlates.add(tr);
      if (sm) activePlates.add(sm);
      if (cr) activePlates.add(cr);
    };

    for (const c of circuitosAbiertos) registerActive(c);
    for (const a of activos) registerActive(a);
    for (const h of holds) registerActive(h);

    const seenUnidadIds = new Set<string>();
    const seenTractorIds = new Set<string>();
    const seenSemiIds = new Set<string>();
    const seenPlates = new Set<string>();
    const result: CatalogUnitItem[] = [];

    for (const u of catalog.unidades) {
      const tr = normalizePlateKey(u.tractor_plate);
      const sm = normalizePlateKey(u.semi_plate);
      if (!tr && !sm) continue;

      if (u.unidad_id && (activeUnidadIds.has(u.unidad_id) || seenUnidadIds.has(u.unidad_id))) {
        continue;
      }
      if (u.tractor_id && (activeTractorIds.has(u.tractor_id) || seenTractorIds.has(u.tractor_id))) {
        continue;
      }
      if (u.semi_id && (activeSemiIds.has(u.semi_id) || seenSemiIds.has(u.semi_id))) {
        continue;
      }
      if (tr && (activePlates.has(tr) || seenPlates.has(tr))) {
        continue;
      }
      if (sm && (activePlates.has(sm) || seenPlates.has(sm))) {
        continue;
      }

      if (u.unidad_id) seenUnidadIds.add(u.unidad_id);
      if (u.tractor_id) seenTractorIds.add(u.tractor_id);
      if (u.semi_id) seenSemiIds.add(u.semi_id);
      if (tr) seenPlates.add(tr);
      if (sm) seenPlates.add(sm);

      result.push(u);
    }

    return result;
  }, [catalog.unidades, circuitosAbiertos, activos, holds]);

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
      const enProcesoActivo = Boolean(h.en_proceso_activo ?? activeUnfinalized);
      const liberadoCircuito =
        !enProcesoActivo && Boolean(h.liberado_circuito ?? h.salida_previa_at);

      return {
        proceso_id: h.hold_id,
        hold_id: h.hold_id,
        circuito_id: h.circuito_id,
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
        encargado_id: h.encargado_id ?? null,
        encargado_nombre: h.encargado_nombre ?? null,
        encargado_at: h.encargado_at ?? null,
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
                  usuario: null,
                },
              ]
            : [],
        notes_count: h.notes_count ?? h.notes?.length ?? (h.nota_planificacion ? 1 : 0),
        salida_previa_at: h.salida_previa_at,
        salida_origen_box: ubicacionBox,
        salida_origen_zone: ubicacionZone,
        ultima_tarea: h.ultima_tarea,
        ultima_tarea_usuario: h.ultima_tarea_usuario,
        ultima_tarea_at: h.ultima_tarea_at,
        en_proceso_activo: enProcesoActivo,
        liberado_circuito: liberadoCircuito,
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

  // Contenedor jerárquico de Idles:
  // 1. SIN_ASIGNACION (circuitos abiertos sin procesos ni holds)
  // 2. TERMINADO (FINALIZÓ · salida_at != null)
  // 3. ESPERANDO_BOX (ESPERANDO A SER INGRESADO A BOX · llegada_at != null && !inicio_at)
  // 4. PREASIGNADO (holds sin estadía TRABAJANDO activa, agrupados 1 por circuito)
  const { idleItems, idleCounts } = useMemo(() => {
    const workingCircIds = new Set<string>();
    const workingAssets = new Set<string>();

    const activeCircIds = new Set<string>();
    const activeAssets = new Set<string>();

    const registerAsset = (
      set: Set<string>,
      item: {
        circuito_id?: string | null;
        unidad_id?: string | null;
        tractor_id?: string | null;
        semi_id?: string | null;
        tractor_plate?: string | null;
        semi_plate?: string | null;
      }
    ) => {
      if (item.unidad_id) set.add(`u_${item.unidad_id}`);
      if (item.tractor_id) set.add(`t_${item.tractor_id}`);
      if (item.semi_id) set.add(`s_${item.semi_id}`);
      const tr = normalizePlateKey(item.tractor_plate);
      const sm = normalizePlateKey(item.semi_plate);
      if (tr) set.add(`p_${tr}`);
      if (sm) set.add(`p_${sm}`);
    };

    const matchesSet = (
      circSet: Set<string>,
      assetSet: Set<string>,
      item: {
        circuito_id?: string | null;
        unidad_id?: string | null;
        tractor_id?: string | null;
        semi_id?: string | null;
        tractor_plate?: string | null;
        semi_plate?: string | null;
      }
    ) => {
      if (item.circuito_id && circSet.has(item.circuito_id)) return true;
      if (item.unidad_id && assetSet.has(`u_${item.unidad_id}`)) return true;
      if (item.tractor_id && assetSet.has(`t_${item.tractor_id}`)) return true;
      if (item.semi_id && assetSet.has(`s_${item.semi_id}`)) return true;
      const tr = normalizePlateKey(item.tractor_plate);
      const sm = normalizePlateKey(item.semi_plate);
      if (tr && assetSet.has(`p_${tr}`)) return true;
      if (sm && assetSet.has(`p_${sm}`)) return true;
      return false;
    };

    for (const a of activos) {
      if (a.circuito_id) activeCircIds.add(a.circuito_id);
      registerAsset(activeAssets, a);
      if (a.inicio_at && !a.salida_at) {
        if (a.circuito_id) workingCircIds.add(a.circuito_id);
        registerAsset(workingAssets, a);
      }
    }

    for (const h of holds) {
      if (h.circuito_id) activeCircIds.add(h.circuito_id);
      registerAsset(activeAssets, h);
    }

    const representedCircIds = new Set<string>();
    const representedAssets = new Set<string>();

    // Tier 1: SIN_ASIGNACION
    const tierSinAsignacion: IdleDockItem[] = [];
    const sortedOpenCircs = [...circuitosAbiertos].sort(
      (a, b) => toTimestampMs(b.ingreso_at) - toTimestampMs(a.ingreso_at)
    );
    for (const circ of sortedOpenCircs) {
      if (circ.pasos_count > 0) continue;
      if (matchesSet(activeCircIds, activeAssets, circ)) continue;

      representedCircIds.add(circ.circuito_id);
      registerAsset(representedAssets, circ);
      const lastNote = circ.notes && circ.notes.length > 0 ? circ.notes[circ.notes.length - 1] : null;
      tierSinAsignacion.push({
        key: `idle_circ_${circ.circuito_id}`,
        tier: 'SIN_ASIGNACION',
        targetId: circ.circuito_id,
        circuito_id: circ.circuito_id,
        unidad_id: circ.unidad_id,
        n_ute: circ.n_ute || '',
        tractor_id: circ.tractor_id,
        tractor_plate: circ.tractor_plate || '',
        semi_id: circ.semi_id,
        semi_plate: circ.semi_plate || '',
        modalidad_tracking: circ.modalidad_tracking,
        zone_id: null,
        zone_name: 'Sin asignar',
        box_id: null,
        box_name: '',
        timestamp: circ.ingreso_at,
        notes: circ.notes || [],
        notes_count: circ.notes_count ?? circ.notes?.length ?? 0,
        ultima_tarea: lastNote?.texto || null,
        ultima_tarea_usuario: lastNote?.usuario || null,
        ultima_tarea_at: lastNote?.timestamp || null,
        is_temp: circ.circuito_id.startsWith('temp_circ_'),
      });
    }

    // Tier 2: TERMINADO
    const tierTerminado: IdleDockItem[] = activos
      .filter((a) => Boolean(a.salida_at))
      .sort((a, b) => {
        const diff = toTimestampMs(b.salida_at) - toTimestampMs(a.salida_at);
        return sortDirection === 'desc' ? diff : -diff;
      })
      .map((a) => {
        if (a.circuito_id) representedCircIds.add(a.circuito_id);
        registerAsset(representedAssets, a);
        const lastNote = a.notes && a.notes.length > 0 ? a.notes[a.notes.length - 1] : null;
        return {
          key: `idle_fin_${a.proceso_id}`,
          tier: 'TERMINADO' as const,
          targetId: a.proceso_id,
          circuito_id: a.circuito_id,
          proceso_id: a.proceso_id,
          unidad_id: a.unidad_id,
          n_ute: a.n_ute || '',
          tractor_id: a.tractor_id,
          tractor_plate: a.tractor_plate || '',
          semi_id: a.semi_id,
          semi_plate: a.semi_plate || '',
          modalidad_tracking: a.modalidad_tracking,
          zone_id: a.zone_id,
          zone_name: a.zone_name,
          box_id: a.box_id || null,
          box_name: a.box_name || '',
          timestamp: a.salida_at,
          notes: a.notes || [],
          notes_count: a.notes_count ?? a.notes?.length ?? 0,
          ultima_tarea: a.ultima_tarea || lastNote?.texto || null,
          ultima_tarea_usuario: a.ultima_tarea_usuario || lastNote?.usuario || null,
          ultima_tarea_at: a.ultima_tarea_at || lastNote?.timestamp || null,
        };
      });

    // Tier 3: ESPERANDO_BOX
    const tierEsperandoBox: IdleDockItem[] = activos
      .filter((a) => Boolean(a.llegada_at && !a.inicio_at && !a.salida_at))
      .sort((a, b) => {
        const diff = toTimestampMs(b.llegada_at) - toTimestampMs(a.llegada_at);
        return sortDirection === 'desc' ? diff : -diff;
      })
      .map((a) => {
        if (a.circuito_id) representedCircIds.add(a.circuito_id);
        registerAsset(representedAssets, a);
        const lastNote = a.notes && a.notes.length > 0 ? a.notes[a.notes.length - 1] : null;
        return {
          key: `idle_esp_${a.proceso_id}`,
          tier: 'ESPERANDO_BOX' as const,
          targetId: a.proceso_id,
          circuito_id: a.circuito_id,
          proceso_id: a.proceso_id,
          unidad_id: a.unidad_id,
          n_ute: a.n_ute || '',
          tractor_id: a.tractor_id,
          tractor_plate: a.tractor_plate || '',
          semi_id: a.semi_id,
          semi_plate: a.semi_plate || '',
          modalidad_tracking: a.modalidad_tracking,
          zone_id: a.zone_id,
          zone_name: a.zone_name,
          box_id: a.box_id || null,
          box_name: a.box_name || '',
          timestamp: a.llegada_at,
          notes: a.notes || [],
          notes_count: a.notes_count ?? a.notes?.length ?? 0,
          ultima_tarea: a.ultima_tarea || lastNote?.texto || null,
          ultima_tarea_usuario: a.ultima_tarea_usuario || lastNote?.usuario || null,
          ultima_tarea_at: a.ultima_tarea_at || lastNote?.timestamp || null,
        };
      });

    // Tier 4: PREASIGNADO (solo unidades inactivas / no trabajando en box, 1 card consolidada por circuito)
    const preasignadoGroups = new Map<
      string,
      { primary: PlaneacionHold; zones: string[]; count: number }
    >();
    for (const h of holds) {
      if (h.en_proceso_activo) continue;
      if (matchesSet(workingCircIds, workingAssets, h)) continue;
      if (matchesSet(representedCircIds, representedAssets, h)) continue;

      const groupKey =
        h.circuito_id ||
        (h.unidad_id ? `u_${h.unidad_id}` : '') ||
        (h.tractor_id ? `t_${h.tractor_id}` : '') ||
        (h.semi_id ? `s_${h.semi_id}` : '') ||
        h.hold_id;

      const existing = preasignadoGroups.get(groupKey);
      if (!existing) {
        preasignadoGroups.set(groupKey, {
          primary: h,
          zones: h.zone_name ? [h.zone_name] : [],
          count: 1,
        });
      } else {
        existing.count += 1;
        if (h.zone_name && !existing.zones.includes(h.zone_name)) {
          existing.zones.push(h.zone_name);
        }
      }
    }

    const tierPreasignado: IdleDockItem[] = Array.from(preasignadoGroups.values())
      .sort((a, b) => {
        const diff = toTimestampMs(b.primary.created_at) - toTimestampMs(a.primary.created_at);
        return sortDirection === 'desc' ? diff : -diff;
      })
      .map(({ primary: h, zones, count }) => {
        const lastNote = h.notes && h.notes.length > 0 ? h.notes[h.notes.length - 1] : null;
        return {
          key: `idle_hold_${h.hold_id}`,
          tier: 'PREASIGNADO' as const,
          targetId: h.hold_id,
          circuito_id: h.circuito_id,
          hold_id: h.hold_id,
          unidad_id: h.unidad_id,
          n_ute: h.n_ute || '',
          tractor_id: h.tractor_id,
          tractor_plate: h.tractor_plate || '',
          semi_id: h.semi_id,
          semi_plate: h.semi_plate || '',
          modalidad_tracking: h.modalidad_tracking,
          zone_id: h.zone_id,
          zone_name: zones[0] || h.zone_name || 'Sin Zona',
          box_id: h.box_id || null,
          box_name: h.box_name || '',
          preasignado_zones: zones,
          holds_count: count,
          en_proceso_activo: Boolean(h.en_proceso_activo),
          liberado_circuito:
            !h.en_proceso_activo && Boolean(h.liberado_circuito ?? h.salida_previa_at),
          ubicacion_actual_box: h.ubicacion_actual_box || h.salida_origen_box || null,
          ubicacion_actual_zone: h.ubicacion_actual_zone || h.salida_origen_zone || null,
          salida_origen_box: h.salida_origen_box || null,
          salida_origen_zone: h.salida_origen_zone || null,
          timestamp: h.created_at,
          notes: h.notes || [],
          notes_count: h.notes_count ?? h.notes?.length ?? 0,
          ultima_tarea: h.ultima_tarea || lastNote?.texto || h.nota_planificacion || null,
          ultima_tarea_usuario: h.ultima_tarea_usuario || lastNote?.usuario || null,
          ultima_tarea_at: h.ultima_tarea_at || lastNote?.timestamp || null,
        };
      });

    const combined = [
      ...tierSinAsignacion,
      ...tierTerminado,
      ...tierEsperandoBox,
      ...tierPreasignado,
    ];

    const q = searchQuery.trim().toLowerCase();
    const filtered = !q
      ? combined
      : combined.filter(
          (item) =>
            item.tractor_plate.toLowerCase().includes(q) ||
            item.semi_plate.toLowerCase().includes(q) ||
            item.n_ute.toLowerCase().includes(q) ||
            item.zone_name.toLowerCase().includes(q) ||
            item.box_name.toLowerCase().includes(q) ||
            (item.preasignado_zones || []).some((z) => z.toLowerCase().includes(q))
        );

    const counts = {
      SIN_ASIGNACION: filtered.filter((i) => i.tier === 'SIN_ASIGNACION').length,
      TERMINADO: filtered.filter((i) => i.tier === 'TERMINADO').length,
      ESPERANDO_BOX: filtered.filter((i) => i.tier === 'ESPERANDO_BOX').length,
      PREASIGNADO: filtered.filter((i) => i.tier === 'PREASIGNADO').length,
      total: filtered.length,
    };

    return { idleItems: filtered, idleCounts: counts };
  }, [circuitosAbiertos, activos, holds, sortDirection, searchQuery]);

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
        circuito_id: sourceCard.circuito_id,
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
        nota_planificacion: lastNote?.texto || null,
        notes: sourceCard.notes || [],
        notes_count: sourceCard.notes_count ?? sourceCard.notes?.length ?? 0,
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
        liberado_circuito: true,
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
        circuito_id: sourceCard.circuito_id,
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
        nota_planificacion: lastNote?.texto || null,
        notes: sourceCard.notes || [],
        notes_count: sourceCard.notes_count ?? sourceCard.notes?.length ?? 0,
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
        liberado_circuito: false,
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
        liberado_circuito:
          !sourceHold.en_proceso_activo &&
          Boolean(sourceHold.liberado_circuito ?? sourceHold.salida_previa_at),
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

  const optimisticAddCircuitoIdle = useCallback(
    (unit: CatalogUnitItem) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      const nowIso = new Date().toISOString();
      const tempId = `temp_circ_${unit.unidad_id || unit.tractor_id || unit.semi_id || Date.now()}`;
      const modalidad: CircuitoAbierto['modalidad_tracking'] =
        unit.tractor_id && unit.semi_id
          ? 'EQUIPO_ACOPLADO'
          : unit.tractor_id
          ? 'SOLO_TRACTOR'
          : unit.semi_id
          ? 'SOLO_SEMI'
          : 'UNIDAD';

      const newCirc: CircuitoAbierto = {
        circuito_id: tempId,
        parent_circuito_id: null,
        unidad_id: unit.unidad_id || null,
        n_ute: unit.n_ute || '',
        tractor_id: unit.tractor_id,
        tractor_plate: unit.tractor_plate || '',
        semi_id: unit.semi_id,
        semi_plate: unit.semi_plate || '',
        tractor_n: null,
        semi_n: null,
        modalidad_tracking: modalidad,
        es_desunido: false,
        patente_cruzada: null,
        grupo_render: unit.unidad_id || tempId,
        ingreso_at: nowIso,
        alta_coord_id: null,
        pasos_count: 0,
        paso_activo_id: null,
        notes: [],
        notes_count: 0,
      };

      if (prev) {
        queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
          ...prev,
          circuitos_abiertos: [newCirc, ...(prev.circuitos_abiertos || [])],
        });
      }

      return { tempId, previousSnapshot: prev };
    },
    [queryClient]
  );

  const reconcileTempCircuito = useCallback(
    (tempId: string, realCircuito: CircuitoAbierto) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return;
      const existingList = prev.circuitos_abiertos || [];
      const hasTemp = existingList.some((c) => c.circuito_id === tempId);
      const hasReal = existingList.some((c) => c.circuito_id === realCircuito.circuito_id);

      const nextList = hasTemp
        ? existingList.map((c) =>
            c.circuito_id === tempId
              ? {
                  ...realCircuito,
                  notes: c.notes && c.notes.length > (realCircuito.notes?.length || 0) ? c.notes : realCircuito.notes || [],
                  notes_count: Math.max(c.notes_count || 0, realCircuito.notes_count || 0),
                }
              : c
          )
        : hasReal
        ? existingList
        : [realCircuito, ...existingList];

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        circuitos_abiertos: nextList,
      });
    },
    [queryClient]
  );

  const optimisticPromoteCircuitoToHold = useCallback(
    (circuitoId: string, targetZoneId: string) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const sourceCirc = (prev.circuitos_abiertos || []).find((c) => c.circuito_id === circuitoId);
      if (!sourceCirc) return prev;

      const targetZone = (prev.catalog?.zones || []).find((z) => z.id === targetZoneId);
      const nowIso = new Date().toISOString();
      const lastNote =
        sourceCirc.notes && sourceCirc.notes.length > 0
          ? sourceCirc.notes[sourceCirc.notes.length - 1]
          : null;

      const newHold: PlaneacionHold = {
        hold_id: `temp_hold_${circuitoId}_${targetZoneId}`,
        circuito_id: circuitoId,
        unidad_id: sourceCirc.unidad_id,
        n_ute: sourceCirc.n_ute,
        tractor_id: sourceCirc.tractor_id,
        tractor_plate: sourceCirc.tractor_plate,
        semi_id: sourceCirc.semi_id,
        semi_plate: sourceCirc.semi_plate,
        modalidad_tracking: sourceCirc.modalidad_tracking,
        zone_id: targetZoneId,
        zone_name: targetZone?.zone_name || 'Zona',
        box_id: null,
        box_name: '',
        orden: 1,
        usuarios_ids: [],
        usuarios_nombres: [],
        nota_planificacion: lastNote?.texto || null,
        notes: sourceCirc.notes || [],
        notes_count: sourceCirc.notes_count ?? sourceCirc.notes?.length ?? 0,
        proceso_origen_id: null,
        created_at: nowIso,
        updated_at: nowIso,
        en_proceso_activo: false,
        liberado_circuito: false,
      };

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        circuitos_abiertos: (prev.circuitos_abiertos || []).map((c) =>
          c.circuito_id === circuitoId ? { ...c, pasos_count: Math.max(1, c.pasos_count + 1) } : c
        ),
        holds: [newHold, ...(prev.holds || [])],
      });

      return prev;
    },
    [queryClient]
  );

  const optimisticRemoveCircuito = useCallback(
    (circuitoId: string) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const matchedCirc = (prev.circuitos_abiertos || []).find((c) => c.circuito_id === circuitoId);
      const matchedActivo = (prev.activos || []).find((a) => a.circuito_id === circuitoId);
      const matchedHold = (prev.holds || []).find((h) => h.circuito_id === circuitoId);
      const src = matchedCirc || matchedActivo || matchedHold;

      const existingTerminados = (prev.circuitos_terminados || []).filter(
        (t) => t.circuito_id !== circuitoId
      );
      const nextTerminados: CircuitoTerminado[] = src
        ? [
            {
              circuito_id: circuitoId,
              parent_circuito_id: matchedCirc?.parent_circuito_id ?? null,
              unidad_id: src.unidad_id ?? null,
              n_ute: src.n_ute || '',
              tractor_id: src.tractor_id ?? null,
              tractor_plate: src.tractor_plate || '',
              semi_id: src.semi_id ?? null,
              semi_plate: src.semi_plate || '',
              modalidad_tracking: src.modalidad_tracking,
              es_desunido: Boolean(matchedCirc?.es_desunido),
              patente_cruzada: matchedCirc?.patente_cruzada ?? null,
              ingreso_at: matchedCirc?.ingreso_at || new Date().toISOString(),
              egreso_at: new Date().toISOString(),
              baja_coord_nombre: null,
            },
            ...existingTerminados,
          ]
        : existingTerminados;

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        circuitos_abiertos: (prev.circuitos_abiertos || []).filter(
          (c) => c.circuito_id !== circuitoId
        ),
        circuitos_terminados: nextTerminados,
        holds: (prev.holds || []).filter((h) => h.circuito_id !== circuitoId),
        activos: (prev.activos || []).filter((a) => a.circuito_id !== circuitoId),
      });

      return prev;
    },
    [queryClient]
  );

  const optimisticRemoveCard = useCallback(
    (cardId: string, isHold: boolean) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const targetHold = isHold ? (prev.holds || []).find((h) => h.hold_id === cardId) : undefined;
      const targetActivo = !isHold ? (prev.activos || []).find((a) => a.proceso_id === cardId) : undefined;

      const nextHolds = isHold
        ? (prev.holds || []).filter((h) => h.hold_id !== cardId)
        : targetActivo?.circuito_id
        ? (prev.holds || []).filter((h) => h.circuito_id !== targetActivo.circuito_id)
        : (prev.holds || []);
      const nextActivos = !isHold
        ? (prev.activos || []).filter((a) => a.proceso_id !== cardId)
        : (prev.activos || []);

      let nextCircuitos = prev.circuitos_abiertos || [];
      if (!isHold && targetActivo?.circuito_id) {
        // ARCHIVAR closes the entire circuit
        nextCircuitos = nextCircuitos.filter((c) => c.circuito_id !== targetActivo.circuito_id);
      } else if (isHold && targetHold?.circuito_id) {
        const hasRemainingOpen =
          nextHolds.some((h) => h.circuito_id === targetHold.circuito_id) ||
          nextActivos.some((a) => a.circuito_id === targetHold.circuito_id && !a.salida_at);
        if (!hasRemainingOpen) {
          nextCircuitos = nextCircuitos.filter((c) => c.circuito_id !== targetHold.circuito_id);
        }
      }

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        holds: nextHolds,
        activos: nextActivos,
        circuitos_abiertos: nextCircuitos,
      });

      return prev;
    },
    [queryClient]
  );

  const optimisticUndoCard = useCallback(
    (cardId: string, isHold: boolean) => {
      const prev = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prev) return undefined;

      const targetHold = isHold ? (prev.holds || []).find((h) => h.hold_id === cardId) : undefined;
      const targetActivo = !isHold ? (prev.activos || []).find((a) => a.proceso_id === cardId) : undefined;
      const affectedCircuitoId = targetHold?.circuito_id || targetActivo?.circuito_id || null;

      const nextHoldsBase = isHold
        ? (prev.holds || []).filter((h) => h.hold_id !== cardId)
        : (prev.holds || []);
      const nextActivos = !isHold
        ? (prev.activos || []).filter((a) => a.proceso_id !== cardId)
        : (prev.activos || []);

      const nextHolds =
        !isHold && affectedCircuitoId
          ? nextHoldsBase.map((h) =>
              h.circuito_id === affectedCircuitoId
                ? { ...h, en_proceso_activo: false }
                : h
            )
          : nextHoldsBase;

      let nextCircuitos = prev.circuitos_abiertos || [];
      if (affectedCircuitoId) {
        const remainingActivos = nextActivos.filter((a) => a.circuito_id === affectedCircuitoId);
        const remainingHolds = nextHolds.filter((h) => h.circuito_id === affectedCircuitoId);
        const activeStep = remainingActivos.find((a) => !a.salida_at);
        const remainingCount = remainingActivos.length + remainingHolds.length;

        nextCircuitos = nextCircuitos.map((c) =>
          c.circuito_id === affectedCircuitoId
            ? {
                ...c,
                pasos_count: remainingCount,
                paso_activo_id: activeStep ? activeStep.proceso_id : null,
              }
            : c
        );
      }

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prev,
        holds: nextHolds,
        activos: nextActivos,
        circuitos_abiertos: nextCircuitos,
      });

      return prev;
    },
    [queryClient]
  );

  const optimisticSyncCircuitoNotes = useCallback(
    (targetId: string, circuitoId: string | undefined, nextNotes: ProcesoNota[]) => {
      const lastNote = nextNotes.length > 0 ? nextNotes[nextNotes.length - 1] : null;
      const matchesCircuito = (itemId: string, itemCircuitoId?: string) =>
        Boolean(circuitoId && itemCircuitoId && itemCircuitoId === circuitoId) || itemId === targetId;

      const prevBoard = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (prevBoard) {
        queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
          ...prevBoard,
          activos: (prevBoard.activos || []).map((a) =>
            matchesCircuito(a.proceso_id, a.circuito_id)
              ? {
                  ...a,
                  notes: nextNotes,
                  notes_count: nextNotes.length,
                  ultima_tarea: lastNote?.texto || null,
                  ultima_tarea_usuario: lastNote?.usuario || null,
                  ultima_tarea_at: lastNote?.timestamp || null,
                }
              : a
          ),
          holds: (prevBoard.holds || []).map((h) =>
            matchesCircuito(h.hold_id, h.circuito_id)
              ? {
                  ...h,
                  notes: nextNotes,
                  notes_count: nextNotes.length,
                  nota_planificacion: lastNote?.texto || null,
                  ultima_tarea: lastNote?.texto || null,
                  ultima_tarea_usuario: lastNote?.usuario || null,
                  ultima_tarea_at: lastNote?.timestamp || null,
                }
              : h
          ),
          circuitos_abiertos: (prevBoard.circuitos_abiertos || []).map((c) =>
            matchesCircuito(c.circuito_id, c.circuito_id)
              ? {
                  ...c,
                  notes: nextNotes,
                  notes_count: nextNotes.length,
                }
              : c
          ),
        });
      }

      const prevFin = queryClient.getQueryData<PlaneacionCard[]>(['planeacion', 'finalizados']);
      if (prevFin) {
        queryClient.setQueryData<PlaneacionCard[]>(
          ['planeacion', 'finalizados'],
          prevFin.map((f) =>
            matchesCircuito(f.proceso_id, f.circuito_id)
              ? {
                  ...f,
                  notes: nextNotes,
                  notes_count: nextNotes.length,
                  ultima_tarea: lastNote?.texto || null,
                  ultima_tarea_usuario: lastNote?.usuario || null,
                  ultima_tarea_at: lastNote?.timestamp || null,
                }
              : f
          )
        );
      }
    },
    [queryClient]
  );

  const optimisticReorderCircuitoTimeline = useCallback(
    (
      circuitoId: string,
      orderedPreasignadoIds: string[]
    ): BoardResponse | undefined => {
      const prevBoard = queryClient.getQueryData<BoardResponse>(['planeacion', 'board']);
      if (!prevBoard) return prevBoard;

      const currentSteps = prevBoard.circuitos_timelines?.[circuitoId];
      if (!currentSteps || currentSteps.length === 0) return prevBoard;

      const fixedSteps = currentSteps.filter((s) => s.status !== 'PREASIGNADO');
      const preMap = new Map(
        currentSteps
          .filter((s) => s.status === 'PREASIGNADO')
          .map((s) => [s.proceso_id, s])
      );

      const reorderedPre: CircuitoTimelineStep[] = [];
      const seen = new Set<string>();
      for (const id of orderedPreasignadoIds) {
        const step = preMap.get(id);
        if (step && !seen.has(id)) {
          seen.add(id);
          reorderedPre.push({ ...step, orden: reorderedPre.length + 1 });
        }
      }
      for (const s of currentSteps) {
        if (s.status === 'PREASIGNADO' && !seen.has(s.proceso_id)) {
          seen.add(s.proceso_id);
          reorderedPre.push({ ...s, orden: reorderedPre.length + 1 });
        }
      }

      const orderIndexMap = new Map(reorderedPre.map((s, idx) => [s.proceso_id, idx + 1]));

      queryClient.setQueryData<BoardResponse>(['planeacion', 'board'], {
        ...prevBoard,
        circuitos_timelines: {
          ...(prevBoard.circuitos_timelines ?? {}),
          [circuitoId]: [...fixedSteps, ...reorderedPre],
        },
        holds: (prevBoard.holds ?? []).map((h) =>
          h.circuito_id === circuitoId && orderIndexMap.has(h.hold_id)
            ? { ...h, orden: orderIndexMap.get(h.hold_id)! }
            : h
        ),
      });

      return prevBoard;
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
    columns,
    filteredCards,
    idleItems,
    idleCounts,
    availableCatalogUnits,
    circuitosAbiertos,
    circuitosTerminados,
    circuitosTimelines,
    activos,
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
    optimisticAddCircuitoIdle,
    reconcileTempCircuito,
    optimisticPromoteCircuitoToHold,
    optimisticRemoveCircuito,
    optimisticRemoveCard,
    optimisticUndoCard,
    optimisticSyncCircuitoNotes,
    optimisticReorderCircuitoTimeline,
    rollbackBoard,
  };
}
