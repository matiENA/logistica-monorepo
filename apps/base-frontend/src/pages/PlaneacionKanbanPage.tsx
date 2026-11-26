import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePlaneacionKanban, type CatalogUnitItem } from '../hooks/usePlaneacionKanban';
import { useDragAutoScroll, useIsCardDragging } from '../hooks/useDragAutoScroll';
import { AutoScrollColumn } from '../components/common/AutoScrollColumn';
import { UnitPlaneacionCard } from '../components/kanban/UnitPlaneacionCard';
import { NewIngresoModal, type OriginRect } from '../components/kanban/NewIngresoModal';
import {
  IdleUnitsHorizontalDock,
  buildUnitFlightSignature,
  type IdleDockHandle,
} from '../components/kanban/IdleUnitsHorizontalDock';
import { FlyingCardTransition } from '../components/kanban/FlyingCardTransition';
import { CoordinacionLoginWall } from '../components/kanban/CoordinacionLoginWall';
import { CoordinacionConfirmTerminarModal } from '../components/kanban/CoordinacionConfirmTerminarModal';
import {
  COORDINACION_AUTH_STORAGE_KEY,
  PlaneacionApiError,
  actualizarProceso,
  altaCircuito,
  bajaCircuito,
  clearBoardCache,
  clearCoordinacionUser,
  crearHold,
  getSavedCoordinacionUser,
  logoutUsuarioCoordinacion,
  reordenarProcesosCircuito,
  verificarAccesoCoordinacion,
} from '../services/planeacionApi';
import type {
  BoardResponse,
  CircuitoAbierto,
  PlaneacionCard,
  ProcesoNota,
  UsuarioCoordinacionSession,
} from '../types/planeacion';

interface FlyingCardState {
  key: string;
  unit: CatalogUnitItem;
  originRect: OriginRect;
}

interface PendingTerminarState {
  payload: Record<string, any>;
  resolvedCircuitoId: string | null;
  unitLabel: string;
  tractorPlate: string;
  semiPlate: string;
  sourceStageLabel: string;
  activeProcesosCount: number;
  holdsCount: number;
  finalizadosCount: number;
  affectedZones: string[];
}

export const PlaneacionKanbanPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [coordUser, setCoordUser] = useState<UsuarioCoordinacionSession | null>(() =>
    getSavedCoordinacionUser()
  );
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    'checking'
  );

  const {
    searchQuery,
    setSearchQuery,
    columns,
    idleItems,
    idleCounts,
    availableCatalogUnits,
    circuitosAbiertos,
    circuitosTerminados,
    circuitosTimelines,
    activos,
    holds,
    activosCount,
    isLoading,
    error: boardError,
    refresh,
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
  } = usePlaneacionKanban(authStatus === 'authenticated');

  const [hoveredColId, setHoveredColId] = useState<string | null>(null);
  const [focusedColId, setFocusedColId] = useState<string | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [dragOverPreasignadoZoneId, setDragOverPreasignadoZoneId] = useState<string | null>(null);
  const [isDragOverEgreso, setIsDragOverEgreso] = useState(false);
  const [isNewIngresoOpen, setIsNewIngresoOpen] = useState(false);
  const [pendingTerminar, setPendingTerminar] = useState<PendingTerminarState | null>(null);
  const [isTerminating, setIsTerminating] = useState(false);
  const [pinnedCardIds, setPinnedCardIds] = useState<Record<string, boolean>>({});

  const [flyingCard, setFlyingCard] = useState<FlyingCardState | null>(null);
  const [justLandedUnitKey, setJustLandedUnitKey] = useState<string | null>(null);

  const idleDockRef = useRef<IdleDockHandle | null>(null);
  const pendingAltaByTempIdRef = useRef<Map<string, Promise<CircuitoAbierto | null>>>(new Map());
  const landedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDroppedColRef = useRef<string | null>(null);

  const isCardDragging = useIsCardDragging();
  const { setRef: setBoardScrollRef, nodeRef: boardScrollRef } = useDragAutoScroll<HTMLDivElement>({
    horizontal: true,
    edgeRatio: 1.5 / 9,
    minEdgePx: 120,
    edgePx: 260,
    maxSpeedPxPerSec: 620,
    leftAllowancePx: 28,
    rightAllowancePx: 28,
  });

  const handleBoardWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = boardScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

    if (!e.shiftKey && e.target instanceof HTMLElement) {
      const verticalScroller = e.target.closest('.overflow-y-auto') as HTMLElement | null;
      if (verticalScroller && el.contains(verticalScroller)) {
        if (verticalScroller.scrollHeight - verticalScroller.clientHeight > 2) {
          return;
        }
      }
    }

    el.scrollLeft += e.deltaY;
  }, [boardScrollRef]);

  useEffect(() => {
    if (isCardDragging) {
      lastDroppedColRef.current = null;
      return;
    }
    setDragOverZoneId(null);
    setDragOverPreasignadoZoneId(null);
    setIsDragOverEgreso(false);
    setHoveredColId(lastDroppedColRef.current);
  }, [isCardDragging]);

  const forceAuthLogout = useCallback(
    (message?: string, notifyServer = false) => {
      if (notifyServer) {
        void logoutUsuarioCoordinacion();
      } else {
        clearCoordinacionUser();
        clearBoardCache();
      }
      queryClient.removeQueries({ queryKey: ['planeacion'] });
      setCoordUser(null);
      setAuthStatus('unauthenticated');
      if (message) {
        toast.error(message);
      }
    },
    [queryClient]
  );

  // Verificación persistente de sesión en dispositivo (Cookie HttpOnly + Token + LocalStorage)
  useEffect(() => {
    if (authStatus !== 'checking') return;
    const saved = coordUser || getSavedCoordinacionUser();

    let active = true;
    verificarAccesoCoordinacion(saved?.id)
      .then((res) => {
        if (!active) return;
        if (res.authorized && res.user) {
          setCoordUser(res.user);
          setAuthStatus('authenticated');
        } else if (res.transientError && saved?.id) {
          // Error transitorio (cold start / red): conservar sesión persistida del dispositivo
          setCoordUser(saved);
          setAuthStatus('authenticated');
        } else {
          clearCoordinacionUser();
          clearBoardCache();
          queryClient.removeQueries({ queryKey: ['planeacion'] });
          setCoordUser(null);
          setAuthStatus('unauthenticated');
        }
      })
      .catch(() => {
        if (!active) return;
        if (saved?.id) {
          setCoordUser(saved);
          setAuthStatus('authenticated');
        } else {
          setCoordUser(null);
          setAuthStatus('unauthenticated');
        }
      });

    return () => {
      active = false;
    };
  }, [authStatus, coordUser, queryClient]);

  // Sincronización de sesión entre pestañas del mismo dispositivo
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== COORDINACION_AUTH_STORAGE_KEY) return;
      const synced = getSavedCoordinacionUser();
      if (!synced) {
        clearBoardCache();
        queryClient.removeQueries({ queryKey: ['planeacion'] });
        setCoordUser(null);
        setAuthStatus('unauthenticated');
      } else {
        setCoordUser(synced);
        setAuthStatus('authenticated');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  useEffect(() => {
    if (
      boardError instanceof PlaneacionApiError &&
      (boardError.status === 401 || boardError.status === 403)
    ) {
      forceAuthLogout(boardError.message || 'Sesión inválida o sin acceso de Coordinación.');
    }
  }, [boardError, forceAuthLogout]);

  useEffect(() => {
    return () => {
      if (landedTimerRef.current) clearTimeout(landedTimerRef.current);
    };
  }, []);

  const handleCoordLogout = () => {
    forceAuthLogout(undefined, true);
  };

  const handleLoginAuthenticated = (user: UsuarioCoordinacionSession) => {
    clearBoardCache();
    setCoordUser(user);
    setAuthStatus('authenticated');
  };

  const handlePinChange = useCallback((cardId: string, isPinned: boolean) => {
    setPinnedCardIds((prev) => {
      const current = Boolean(prev[cardId]);
      if (current === isPinned) return prev;
      const next = { ...prev };
      if (isPinned) next[cardId] = true;
      else delete next[cardId];
      return next;
    });
  }, []);

  const handleNoteSynced = useCallback(
    (sync?: { procesoId: string; circuitoId?: string; notes: ProcesoNota[] }) => {
      if (sync?.notes) {
        optimisticSyncCircuitoNotes(sync.procesoId, sync.circuitoId, sync.notes);
      }
      refresh();
    },
    [optimisticSyncCircuitoNotes, refresh]
  );

  const handleUndoCard = useCallback(
    async (card: PlaneacionCard) => {
      if (card.salida_at) return;
      const isHold = Boolean(card.hold_id || card.etapa_ciclo === 'PLANIFICADO_HOLD');
      const targetId = card.hold_id || card.proceso_id;
      if (!targetId || targetId.startsWith('temp_')) return;

      const previousSnapshot = optimisticUndoCard(targetId, isHold);
      try {
        await actualizarProceso(targetId, { action: 'DESHACER' });
      } catch (err) {
        rollbackBoard(previousSnapshot);
        if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
          forceAuthLogout(err.message);
          return;
        }
        toast.error(err instanceof Error ? err.message : 'No se pudo deshacer la card');
      }
    },
    [optimisticUndoCard, rollbackBoard, forceAuthLogout]
  );

  const executeAltaCircuito = useCallback(
    async (
      unit: CatalogUnitItem,
      tempId: string,
      previousSnapshot: BoardResponse | undefined
    ): Promise<CircuitoAbierto | null> => {
      try {
        const res = await altaCircuito({
          unidadId: unit.unidad_id,
          tractorId: unit.tractor_id,
          semiId: unit.semi_id,
        });
        reconcileTempCircuito(tempId, res.circuito);
        return res.circuito;
      } catch (err) {
        rollbackBoard(previousSnapshot);
        if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
          forceAuthLogout(err.message);
          return null;
        }
        toast.error(
          err instanceof Error ? err.message : 'No se pudo incorporar la unidad al circuito'
        );
        refresh();
        return null;
      }
    },
    [reconcileTempCircuito, forceAuthLogout, rollbackBoard, refresh]
  );

  const handleSelectPlateUnit = useCallback(
    (unit: CatalogUnitItem, originRect: OriginRect) => {
      setIsNewIngresoOpen(false);
      idleDockRef.current?.focusTier('SIN_ASIGNACION');
      idleDockRef.current?.scrollToStart();

      const { tempId, previousSnapshot } = optimisticAddCircuitoIdle(unit);
      setFlyingCard({
        key: `${tempId}_${Date.now()}`,
        unit,
        originRect,
      });

      const altaPromise = executeAltaCircuito(unit, tempId, previousSnapshot).finally(() => {
        pendingAltaByTempIdRef.current.delete(tempId);
      });
      pendingAltaByTempIdRef.current.set(tempId, altaPromise);
    },
    [optimisticAddCircuitoIdle, executeAltaCircuito]
  );

  const handleFlightComplete = useCallback(() => {
    setFlyingCard((current) => {
      if (current) {
        const sig = buildUnitFlightSignature(current.unit);
        setJustLandedUnitKey(sig);
        if (landedTimerRef.current) clearTimeout(landedTimerRef.current);
        landedTimerRef.current = setTimeout(() => {
          setJustLandedUnitKey(null);
        }, 650);
      }
      return null;
    });
  }, []);

  const handleReorderCircuitoTimeline = useCallback(
    async (circuitoId: string, orderedPreasignadoIds: string[]) => {
      const prevBoard = optimisticReorderCircuitoTimeline(circuitoId, orderedPreasignadoIds);
      try {
        await reordenarProcesosCircuito(circuitoId, orderedPreasignadoIds);
      } catch (err) {
        rollbackBoard(prevBoard);
        if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
          clearCoordinacionUser();
          clearBoardCache();
          setCoordUser(null);
          setAuthStatus('unauthenticated');
          return;
        }
        toast.error(err instanceof Error ? err.message : 'Error al reordenar zonas del circuito');
      }
    },
    [optimisticReorderCircuitoTimeline, rollbackBoard]
  );

  const renderUnitCard = (card: PlaneacionCard, isZoneExpanded: boolean) => (
    <UnitPlaneacionCard
      key={card.proceso_id}
      card={card}
      isZoneExpanded={isZoneExpanded}
      timelineSteps={card.circuito_id ? circuitosTimelines[card.circuito_id] : undefined}
      onReorderTimeline={handleReorderCircuitoTimeline}
      onPinChange={handlePinChange}
      onNoteAdded={handleNoteSynced}
      onUndoCard={handleUndoCard}
    />
  );

  const extractDragPayload = (e: React.DragEvent) => {
    try {
      const raw =
        e.dataTransfer?.getData('application/json') ||
        e.dataTransfer?.getData('text/plain') ||
        '';
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore parse errors
    }
    return ((window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD as Record<string, unknown>) || null;
  };

  // Manejo de Drag & Drop a Zonas (Optimistic UI 0 ms, sin formularios extra)
  const handleDropOnZone = async (
    zoneId: string,
    e: React.DragEvent,
    isPreasignadoSection = false
  ) => {
    e.preventDefault();
    lastDroppedColRef.current = zoneId;
    setDragOverZoneId(null);
    setDragOverPreasignadoZoneId(null);
    try {
      const data = extractDragPayload(e) as Record<string, any> | null;
      (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = null;
      if (!data) return;

      // Desde Idle SIN ASIGNACIÓN -> pasa a PREASIGNADO de la zona destino
      if (data.type === 'CARD_CIRCUITO' && data.circuitoId) {
        const rawCircuitoId = String(data.circuitoId);
        const previousSnapshot = optimisticPromoteCircuitoToHold(rawCircuitoId, zoneId);

        try {
          let resolvedCircuitoId: string | null = rawCircuitoId.startsWith('temp_circ_')
            ? null
            : rawCircuitoId;
          if (!resolvedCircuitoId) {
            const pendingAlta = pendingAltaByTempIdRef.current.get(rawCircuitoId);
            if (pendingAlta) {
              const created = await pendingAlta;
              if (created?.circuito_id) resolvedCircuitoId = created.circuito_id;
            }
          }

          await crearHold({
            zoneId,
            boxId: null,
            circuitoId: resolvedCircuitoId,
            unidadId: data.unidadId || null,
            tractorId: data.tractorId || null,
            semiId: data.semiId || null,
          });
        } catch (err) {
          console.error('Error al asignar unidad idle a zona:', err);
          rollbackBoard(previousSnapshot);
          if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
            forceAuthLogout(err.message);
            return;
          }
          toast.error(err instanceof Error ? err.message : 'Error asignando unidad a zona');
        }
        return;
      }

      // Multi-PREASIGNADO: arrastrar un PREASIGNADO a otra zona desprende un nuevo PREASIGNADO sin ocultar el origen
      if (data.type === 'CARD_HOLD' && data.holdId) {
        if (data.zoneId === zoneId) return;
        const previousSnapshot = optimisticCloneHoldToZone(data.holdId, zoneId);

        try {
          await crearHold({
            zoneId,
            boxId: null,
            circuitoId:
              data.circuitoId && !String(data.circuitoId).startsWith('temp_')
                ? data.circuitoId
                : null,
            unidadId: data.unidadId || null,
            tractorId: data.tractorId || null,
            semiId: data.semiId || null,
            procesoOrigenId: !String(data.holdId).startsWith('temp_') ? data.holdId : null,
          });
        } catch (err) {
          console.error('Error al desprender preasignación:', err);
          rollbackBoard(previousSnapshot);
          if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
            forceAuthLogout(err.message);
          }
        }
        return;
      }

      if (data.type === 'CARD_PROCESO' && data.procesoId) {
        // Caso 1 · Desde FINALIZÓ: sale de su columna del Kanban y pasa a la nueva zona en PREASIGNADO con su última ubicación
        if (data.salidaAt) {
          const previousSnapshot = optimisticMoveFinalizadoToHold(data.procesoId, zoneId);

          try {
            await actualizarProceso(data.procesoId, {
              zoneId,
              action: 'REINTEGRAR_A_PREASIGNADO',
            });
          } catch (err) {
            console.error('Error al trasladar unidad a preasignado:', err);
            rollbackBoard(previousSnapshot);
            if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
              forceAuthLogout(err.message);
            }
          }
          return;
        }

        // Caso 2A · Desde otra instancia soltada sobre PREASIGNADO de su misma zona: revertir a hold
        if (data.zoneId === zoneId) {
          if (!isPreasignadoSection) return;
          try {
            await actualizarProceso(data.procesoId, {
              action: 'REVERTIR_A_HOLD',
            });
            refresh();
          } catch (err) {
            console.error('Error al revertir unidad a preasignado:', err);
            if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
              forceAuthLogout(err.message);
            }
          }
          return;
        }

        // Caso 2B · Desde otra instancia (TRABAJANDO / ESPERANDO A SER INGRESADO A BOX) hacia otra zona: mantiene carta activa y desprende PREASIGNADO amarillo
        const previousSnapshot = optimisticCloneActiveToHold(data.procesoId, zoneId);

        try {
          await crearHold({
            zoneId,
            boxId: null,
            circuitoId:
              data.circuitoId && !String(data.circuitoId).startsWith('temp_')
                ? data.circuitoId
                : null,
            unidadId: data.unidadId || null,
            tractorId: data.tractorId || null,
            semiId: data.semiId || null,
            procesoOrigenId: !String(data.procesoId).startsWith('temp_') ? data.procesoId : null,
          });
        } catch (err) {
          console.error('Error al preasignar unidad activa:', err);
          rollbackBoard(previousSnapshot);
          if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
            forceAuthLogout(err.message);
          }
        }
        return;
      }
    } catch (err) {
      console.error('Error al procesar asignación por arrastre:', err);
    }
  };

  // Manejo de Drop en TERMINADOS (abre pop-up de confirmación antes de cerrar el circuito completo)
  const handleDropOnEgreso = (e: React.DragEvent) => {
    e.preventDefault();
    lastDroppedColRef.current = null;
    setIsDragOverEgreso(false);

    const data = extractDragPayload(e) as Record<string, any> | null;
    (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = null;
    if (!data) return;

    const isSupportedCard =
      (data.type === 'CARD_CIRCUITO' && Boolean(data.circuitoId)) ||
      (data.type === 'CARD_HOLD' && Boolean(data.holdId)) ||
      (data.type === 'CARD_PROCESO' && Boolean(data.procesoId));
    if (!isSupportedCard) return;

    const matchedHold =
      data.type === 'CARD_HOLD' && data.holdId
        ? holds.find((h) => h.hold_id === data.holdId)
        : undefined;
    const matchedActivo =
      data.type === 'CARD_PROCESO' && data.procesoId
        ? activos.find((a) => a.proceso_id === data.procesoId)
        : undefined;
    const rawCircuitoId =
      (typeof data.circuitoId === 'string' && data.circuitoId) ||
      matchedHold?.circuito_id ||
      matchedActivo?.circuito_id ||
      null;
    const matchedCirc = rawCircuitoId
      ? circuitosAbiertos.find((c) => c.circuito_id === rawCircuitoId)
      : undefined;

    const tractorPlate = String(
      data.tractorPlate ||
        matchedHold?.tractor_plate ||
        matchedActivo?.tractor_plate ||
        matchedCirc?.tractor_plate ||
        ''
    );
    const semiPlate = String(
      data.semiPlate ||
        matchedHold?.semi_plate ||
        matchedActivo?.semi_plate ||
        matchedCirc?.semi_plate ||
        ''
    );
    const unitLabel = String(
      data.plate ||
        [tractorPlate, semiPlate].filter(Boolean).join(' / ') ||
        matchedHold?.n_ute ||
        matchedActivo?.n_ute ||
        matchedCirc?.n_ute ||
        'Unidad'
    );

    const holdsInCircuit = rawCircuitoId
      ? holds.filter((h) => h.circuito_id === rawCircuitoId)
      : matchedHold
      ? [matchedHold]
      : [];
    const activosInCircuit = rawCircuitoId
      ? activos.filter((a) => a.circuito_id === rawCircuitoId)
      : matchedActivo
      ? [matchedActivo]
      : [];

    const activeProcesosCount = activosInCircuit.filter((a) => !a.salida_at).length;
    const finalizadosCount = activosInCircuit.filter((a) => Boolean(a.salida_at)).length;
    const holdsCount =
      holdsInCircuit.length > 0 ? holdsInCircuit.length : data.type === 'CARD_HOLD' ? 1 : 0;

    const zoneNamesSet = new Set<string>();
    for (const a of activosInCircuit) {
      if (a.zone_name) zoneNamesSet.add(a.zone_name);
    }
    for (const h of holdsInCircuit) {
      if (h.zone_name) zoneNamesSet.add(h.zone_name);
    }
    if (zoneNamesSet.size === 0 && typeof data.zoneName === 'string' && data.zoneName) {
      zoneNamesSet.add(data.zoneName);
    }

    let sourceStageLabel = 'Unidad en circuito';
    if (data.type === 'CARD_CIRCUITO') {
      sourceStageLabel = 'Sin Asignación';
    } else if (data.type === 'CARD_HOLD') {
      const zName = String(data.zoneName || matchedHold?.zone_name || '').trim();
      sourceStageLabel = zName ? `Preasignado · ${zName}` : 'Preasignado';
    } else if (data.type === 'CARD_PROCESO') {
      const zName = String(data.zoneName || matchedActivo?.zone_name || '').trim();
      const bName = String(data.boxName || matchedActivo?.box_name || '').trim();
      if (data.salidaAt || matchedActivo?.salida_at) {
        sourceStageLabel = zName ? `Finalizó · ${zName}` : 'Finalizó';
      } else if (data.inicioAt || matchedActivo?.inicio_at) {
        sourceStageLabel = bName
          ? `Trabajando · ${bName}`
          : zName
          ? `Trabajando · ${zName}`
          : 'Trabajando';
      } else {
        sourceStageLabel = zName ? `Esperando Box · ${zName}` : 'Esperando Box';
      }
    }

    setPendingTerminar({
      payload: data,
      resolvedCircuitoId: rawCircuitoId,
      unitLabel,
      tractorPlate,
      semiPlate,
      sourceStageLabel,
      activeProcesosCount,
      holdsCount,
      finalizadosCount,
      affectedZones: Array.from(zoneNamesSet),
    });
  };

  const handleConfirmTerminar = async () => {
    if (!pendingTerminar || isTerminating) return;
    const pending = pendingTerminar;
    setIsTerminating(true);

    let previousSnapshot: BoardResponse | undefined;
    if (pending.resolvedCircuitoId) {
      previousSnapshot = optimisticRemoveCircuito(pending.resolvedCircuitoId);
    } else if (pending.payload.type === 'CARD_HOLD' && pending.payload.holdId) {
      previousSnapshot = optimisticRemoveCard(String(pending.payload.holdId), true);
    } else if (pending.payload.type === 'CARD_PROCESO' && pending.payload.procesoId) {
      previousSnapshot = optimisticRemoveCard(String(pending.payload.procesoId), false);
    }

    try {
      let finalCircuitoId = pending.resolvedCircuitoId;
      if (finalCircuitoId && finalCircuitoId.startsWith('temp_circ_')) {
        const pendingAlta = pendingAltaByTempIdRef.current.get(finalCircuitoId);
        const created = pendingAlta ? await pendingAlta : null;
        if (!created?.circuito_id) {
          throw new Error('No se pudo resolver el circuito recién creado para finalizarlo.');
        }
        finalCircuitoId = created.circuito_id;
      }

      if (finalCircuitoId && !finalCircuitoId.startsWith('temp_')) {
        await bajaCircuito(finalCircuitoId);
      } else {
        const fallbackProcesoId =
          pending.payload.procesoId || pending.payload.holdId || null;
        if (!fallbackProcesoId || String(fallbackProcesoId).startsWith('temp_')) {
          throw new Error('No se pudo identificar el circuito de la unidad para finalizar.');
        }
        await actualizarProceso(String(fallbackProcesoId), { action: 'ARCHIVAR' });
      }

      setPendingTerminar(null);
      toast.success('Circuito finalizado · Unidad en Terminados');
    } catch (err) {
      console.error('Error al finalizar circuito en Terminados:', err);
      rollbackBoard(previousSnapshot);
      if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
        setPendingTerminar(null);
        forceAuthLogout(err.message);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Error al finalizar el circuito');
    } finally {
      setIsTerminating(false);
    }
  };

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen w-full bg-[#EDEDED] text-zinc-950 flex items-center justify-center p-4 select-none">
        <div className="flex flex-col items-center gap-3 text-zinc-700">
          <RefreshCw className="w-7 h-7 animate-spin text-zinc-950" />
          <span className="text-sm font-bold font-mono">
            Verificando sesión de Coordinación...
          </span>
        </div>
      </div>
    );
  }

  if (authStatus !== 'authenticated' || !coordUser) {
    return <CoordinacionLoginWall onAuthenticated={handleLoginAuthenticated} />;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col select-none bg-[#EDEDED] text-zinc-950 font-sans">
      {/* Header Coordinación · UI Design System compliant */}
      <header className="w-full px-4 md:px-6 py-2 flex items-center justify-between min-h-[48px] shrink-0 bg-[#EDEDED] border-b border-zinc-300/80">
        {/* Controles Izquierda: Buscador + Contador */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              focusable="false"
              className="text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Patente, box o zona..."
              aria-label="Buscar unidad por patente, box o zona"
              className="h-8 pl-8 pr-3 bg-white border border-zinc-400 rounded-full text-xs text-zinc-950 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 w-48 sm:w-56 md:w-64 transition-all"
            />
          </div>

          <span
            className="hidden sm:inline-flex items-center h-8 text-[11px] font-mono font-bold px-2.5 rounded-full ui-stroke-dashed-subtle border-zinc-400 text-zinc-800 select-none"
            title="Unidades activas en planta"
          >
            {activosCount} activas
          </span>
        </div>

        {/* Controles Derecha: Primary CTA (+ Ingresar Unidad) + Sesión */}
        <div className="flex items-center gap-2">
          {/* Primary Action Button (btn-sm, height 32px, WCAG compliant >= 4.5:1) */}
          <button
            type="button"
            onClick={() => setIsNewIngresoOpen(true)}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-full bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 active:scale-[0.98] border border-transparent transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
          >
            <Plus size={16} strokeWidth={2.25} aria-hidden="true" focusable="false" />
            <span>Ingresar Unidad</span>
          </button>

          {/* Sesión de Coordinación (Top Right: usuario + botón salir) */}
          <div className="flex items-center gap-2 pl-1">
            <span className="hidden md:inline-block text-xs font-semibold text-zinc-900 tracking-tight font-mono select-none">
              {coordUser.nombre_usuario}
            </span>
            <button
              type="button"
              onClick={handleCoordLogout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="w-8 h-8 rounded-lg border border-transparent hover:border-red-300 text-zinc-700 hover:text-red-700 hover:bg-red-50/70 inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
            </button>
          </div>
        </div>
      </header>

      {/* Cuerpo Principal: Tablero Kanban por Zonas + Contenedor Horizontal Inferior de Idles */}
      <main className="flex-1 min-h-0 w-full px-3 md:px-6 py-2.5 flex flex-col gap-2.5 overflow-hidden">
        <div
          ref={setBoardScrollRef}
          onWheel={handleBoardWheel}
          className="flex-1 min-h-0 w-full flex flex-col overflow-x-auto overflow-y-hidden no-scrollbar"
        >
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-zinc-700">
                <RefreshCw className="w-7 h-7 animate-spin text-zinc-950" />
                <span className="text-sm font-bold">Cargando tablero de planeación...</span>
              </div>
            </div>
          ) : columns.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-2">
              <span className="text-sm font-bold">Sin zonas configuradas en base.zones</span>
              <span className="text-xs">Agregá zonas y boxes para visualizar columnas.</span>
            </div>
          ) : (
            <div className="flex flex-row items-stretch flex-1 min-h-0 h-full gap-0 w-max">
              {columns.map((col) => {
                const isDragOver = dragOverZoneId === col.id;
                const hasPinnedInCol = col.cards.some((c) => Boolean(pinnedCardIds[c.proceso_id]));
                const isZoneExpanded =
                  hoveredColId === col.id ||
                  focusedColId === col.id ||
                  dragOverZoneId === col.id ||
                  dragOverPreasignadoZoneId === col.id ||
                  hasPinnedInCol;
                const salidaCards = col.cards.filter(
                  (c) => !c.hold_id && c.etapa_ciclo !== 'PLANIFICADO_HOLD' && Boolean(c.salida_at)
                );
                const inicioCards = col.cards.filter(
                  (c) =>
                    !c.hold_id &&
                    c.etapa_ciclo !== 'PLANIFICADO_HOLD' &&
                    Boolean(c.inicio_at && !c.salida_at)
                );
                const reservadoCards = col.cards.filter(
                  (c) =>
                    !c.hold_id &&
                    c.etapa_ciclo !== 'PLANIFICADO_HOLD' &&
                    Boolean(c.llegada_at && !c.inicio_at && !c.salida_at)
                );
                const preasignadoCards = col.cards.filter((c) =>
                  Boolean(c.hold_id || c.etapa_ciclo === 'PLANIFICADO_HOLD')
                );

                return (
                  <section
                    key={col.id}
                    data-zone-expanded={isZoneExpanded ? 'true' : 'false'}
                    onMouseEnter={() => setHoveredColId(col.id)}
                    onMouseLeave={() => setHoveredColId((prev) => (prev === col.id ? null : prev))}
                    onFocusCapture={() => setFocusedColId(col.id)}
                    onBlurCapture={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setFocusedColId((prev) => (prev === col.id ? null : prev));
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverZoneId !== col.id) setDragOverZoneId(col.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        if (dragOverZoneId === col.id) setDragOverZoneId(null);
                      }
                    }}
                    onDrop={(e) => handleDropOnZone(col.id, e)}
                    className={`h-full flex flex-col min-h-0 shrink-0 pt-1.5 pb-2 ui-divider-dashed-r border-amber-400 transition-[width,padding,background-color,border-color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                      isZoneExpanded ? 'w-[348px] px-2.5' : 'w-[148px] px-1.5'
                    } ${isDragOver ? 'bg-emerald-50/70 border-emerald-500' : ''}`}
                  >
                    <div className="mb-2 px-1 flex items-center justify-between gap-2 h-[38px] shrink-0">
                      <h2 className="text-[15px] xl:text-[17px] font-extrabold tracking-tight text-zinc-950 lowercase font-mono truncate">
                        {col.title}
                      </h2>
                      <span className="text-xs font-mono font-bold text-zinc-800 bg-white border border-zinc-400/80 rounded-full px-2 py-0.5 shrink-0">
                        {col.cards.length}
                      </span>
                    </div>

                    <AutoScrollColumn
                      itemsCount={col.cards.length}
                      isHovered={hoveredColId === col.id}
                      isPaused={Object.keys(pinnedCardIds).length > 0}
                      ariaLabel={`Zona ${col.title}`}
                      className="flex flex-col gap-2.5 pr-0.5"
                    >
                      {/* 1. TOPE: salida_at / FINALIZÓ */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-600 select-none">
                          <span className="truncate">FINALIZÓ</span>
                          <span className="tabular-nums font-semibold shrink-0">{salidaCards.length}</span>
                        </div>
                        {salidaCards.length === 0 ? (
                          <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-500 italic select-none">
                            sin unidades
                          </div>
                        ) : (
                          salidaCards.map((card) => renderUnitCard(card, isZoneExpanded))
                        )}
                      </div>

                      {/* DIVIDER */}
                      <div className="ui-divider-dashed-subtle-t border-zinc-400/70 my-0.5" />

                      {/* 2. MEDIO: inicio_at / TRABAJANDO */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-600 select-none">
                          <span className="truncate">TRABAJANDO</span>
                          <span className="tabular-nums font-semibold shrink-0">{inicioCards.length}</span>
                        </div>
                        {inicioCards.length === 0 ? (
                          <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-500 italic select-none">
                            sin unidades
                          </div>
                        ) : (
                          inicioCards.map((card) => renderUnitCard(card, isZoneExpanded))
                        )}
                      </div>

                      {/* DIVIDER */}
                      <div className="ui-divider-dashed-subtle-t border-zinc-400/70 my-0.5" />

                      {/* 3. SUBDIVIDER RESERVADO: procesos.llegada_at / ESPERANDO A SER INGRESADO A BOX */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-1 px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-600 select-none">
                          <span
                            className="truncate"
                            title="Reservado (procesos.llegada_at) · Esperando a ser ingresado a Box"
                          >
                            ESPERANDO A SER INGRESADO A BOX
                          </span>
                          <span className="tabular-nums font-semibold shrink-0">
                            {reservadoCards.length}
                          </span>
                        </div>
                        {reservadoCards.length === 0 ? (
                          <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-500 italic select-none">
                            sin unidades
                          </div>
                        ) : (
                          reservadoCards.map((card) => renderUnitCard(card, isZoneExpanded))
                        )}
                      </div>

                      {/* DIVIDER */}
                      <div className="ui-divider-dashed-subtle-t border-zinc-400/70 my-0.5" />

                      {/* 4. FONDO: procesos_hold / PREASIGNADO */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOverPreasignadoZoneId !== col.id) {
                            setDragOverPreasignadoZoneId(col.id);
                          }
                        }}
                        onDragLeave={(e) => {
                          e.stopPropagation();
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            if (dragOverPreasignadoZoneId === col.id) {
                              setDragOverPreasignadoZoneId(null);
                            }
                          }
                        }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          handleDropOnZone(col.id, e, true);
                        }}
                        className={`flex flex-col gap-2 rounded-lg ui-stroke-dashed transition-[padding,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                          isZoneExpanded ? 'p-1.5' : 'p-1'
                        } ${
                          dragOverPreasignadoZoneId === col.id
                            ? 'bg-amber-100/70 border-amber-500 ring-2 ring-amber-400/40'
                            : 'border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-600 select-none">
                          <span className="truncate">PREASIGNADO</span>
                          <span className="tabular-nums font-semibold shrink-0">
                            {preasignadoCards.length}
                          </span>
                        </div>
                        {preasignadoCards.length === 0 ? (
                          <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-500 italic select-none">
                            sin unidades
                          </div>
                        ) : (
                          preasignadoCards.map((card) => renderUnitCard(card, isZoneExpanded))
                        )}
                      </div>
                    </AutoScrollColumn>
                  </section>
                );
              })}

              {/* Columna / Drop Zone TERMINADOS: fin de circuito (retención sincronizada con sweep Cold) */}
              <section
                aria-label="Zona Terminados: arrastrá cualquier card para finalizar el circuito en planta"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setIsDragOverEgreso(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDragOverEgreso(false);
                  }
                }}
                onDrop={handleDropOnEgreso}
                className={`h-full flex flex-col min-h-0 shrink-0 px-2.5 pt-2 pb-2 rounded-xl ui-stroke-dashed transition-[width,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                  isDragOverEgreso
                    ? 'w-[220px] border-rose-500 bg-rose-50/80 text-rose-950 scale-[1.01]'
                    : circuitosTerminados.length > 0
                    ? 'w-[196px] border-zinc-400/75 bg-zinc-200/35 text-zinc-700'
                    : 'w-[160px] border-zinc-400/75 bg-zinc-200/30 text-zinc-700'
                }`}
              >
                <div className="mb-2 px-1 flex items-center justify-between gap-2 h-[38px] shrink-0">
                  <div className="flex items-center gap-1.5 font-mono text-[13px] font-black uppercase text-zinc-900 min-w-0">
                    <LogOut size={16} strokeWidth={2} aria-hidden="true" className="text-zinc-700 shrink-0" />
                    <span className="truncate">TERMINADOS</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-900/10 text-zinc-800 font-mono text-[11px] font-bold tabular-nums shrink-0">
                    {circuitosTerminados.length}
                  </span>
                </div>

                {circuitosTerminados.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-4 text-center ui-stroke-dashed-subtle border-zinc-400/60 rounded-lg bg-transparent">
                    <CheckCircle2
                      size={28}
                      strokeWidth={1.75}
                      aria-hidden="true"
                      className="text-zinc-500 mb-2"
                    />
                    <span className="text-xs font-bold text-zinc-800 uppercase tracking-wide">
                      Fin del flow · Egreso Planta
                    </span>
                    <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
                      Arrastrá aquí cualquier card para finalizar el circuito y terminar todos los procesos de la unidad en esta instancia.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                    <div className="px-2 py-1.5 rounded-lg ui-stroke-dashed-subtle border-zinc-400/60 text-center text-[10px] font-mono text-zinc-600 shrink-0 select-none">
                      Soltá aquí para finalizar circuito
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 flex flex-col gap-1.5">
                      {circuitosTerminados.map((circ) => {
                        const primaryPlate =
                          [circ.tractor_plate, circ.semi_plate].filter(Boolean).join(' / ') ||
                          circ.n_ute ||
                          'Unidad';
                        const egresoLabel = new Date(circ.egreso_at).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        });
                        return (
                          <article
                            key={circ.circuito_id}
                            aria-label={`Circuito terminado ${primaryPlate}`}
                            className="rounded-lg border border-zinc-300/90 bg-white/85 px-2.5 py-2 text-left select-none shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-mono text-[11px] font-black text-zinc-900 truncate">
                                {primaryPlate}
                              </span>
                              <CheckCircle2
                                size={13}
                                strokeWidth={2}
                                aria-hidden="true"
                                className="text-emerald-700 shrink-0"
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-1 text-[10px] font-mono text-zinc-500">
                              <span className="truncate">
                                {circ.n_ute ? `UTE ${circ.n_ute}` : circ.es_desunido ? 'Desunido' : 'Egresado'}
                              </span>
                              <span className="tabular-nums shrink-0">{egresoLabel}</span>
                            </div>
                            {circ.baja_coord_nombre && (
                              <div className="mt-0.5 text-[10px] font-mono text-zinc-400 truncate">
                                {circ.baja_coord_nombre}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Contenedor Horizontal Inferior de Idles (orden jerárquico + zoom-in en hover) */}
        <IdleUnitsHorizontalDock
          ref={idleDockRef}
          items={idleItems}
          counts={idleCounts}
          circuitosTimelines={circuitosTimelines}
          onReorderTimeline={handleReorderCircuitoTimeline}
          flyingUnit={flyingCard?.unit ?? null}
          justLandedUnitKey={justLandedUnitKey}
          onNoteAdded={handleNoteSynced}
        />
      </main>

      {/* Selector de Patentes puro (sin box, zona ni nota) */}
      <NewIngresoModal
        open={isNewIngresoOpen}
        availableUnits={availableCatalogUnits}
        onClose={() => setIsNewIngresoOpen(false)}
        onSelectUnit={handleSelectPlateUnit}
      />

      {/* Pop-up de confirmación de usuario antes de cerrar el circuito en TERMINADOS */}
      <CoordinacionConfirmTerminarModal
        open={Boolean(pendingTerminar)}
        unitLabel={pendingTerminar?.unitLabel ?? 'Unidad'}
        tractorPlate={pendingTerminar?.tractorPlate ?? null}
        semiPlate={pendingTerminar?.semiPlate ?? null}
        sourceStageLabel={pendingTerminar?.sourceStageLabel ?? null}
        activeProcesosCount={pendingTerminar?.activeProcesosCount ?? 0}
        holdsCount={pendingTerminar?.holdsCount ?? 0}
        finalizadosCount={pendingTerminar?.finalizadosCount ?? 0}
        affectedZones={pendingTerminar?.affectedZones ?? []}
        isSubmitting={isTerminating}
        onCancel={() => {
          if (!isTerminating) setPendingTerminar(null);
        }}
        onConfirm={handleConfirmTerminar}
      />

      {/* Portal de Confección y Desplazamiento de Card hacia Dock de Idles */}
      {flyingCard && (
        <FlyingCardTransition
          key={flyingCard.key}
          unit={flyingCard.unit}
          originRect={flyingCard.originRect}
          getTargetRect={() => idleDockRef.current?.getSlotRectForUnit(flyingCard.unit) ?? null}
          onComplete={handleFlightComplete}
        />
      )}
    </div>
  );
};
