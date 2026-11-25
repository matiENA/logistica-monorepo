import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown,
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
import {
  PlaneacionApiError,
  actualizarProceso,
  altaCircuito,
  bajaCircuito,
  clearBoardCache,
  clearCoordinacionUser,
  crearHold,
  eliminarHold,
  getSavedCoordinacionUser,
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

export const PlaneacionKanbanPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [coordUser, setCoordUser] = useState<UsuarioCoordinacionSession | null>(() =>
    getSavedCoordinacionUser()
  );
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    () => (getSavedCoordinacionUser()?.id ? 'checking' : 'unauthenticated')
  );

  const {
    sortDirection,
    setSortDirection,
    searchQuery,
    setSearchQuery,
    columns,
    idleItems,
    idleCounts,
    availableCatalogUnits,
    activosCount,
    isLoading,
    isFetching,
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
    rollbackBoard,
  } = usePlaneacionKanban(authStatus === 'authenticated');

  const [hoveredColId, setHoveredColId] = useState<string | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [dragOverPreasignadoZoneId, setDragOverPreasignadoZoneId] = useState<string | null>(null);
  const [isDragOverEgreso, setIsDragOverEgreso] = useState(false);
  const [isNewIngresoOpen, setIsNewIngresoOpen] = useState(false);
  const [pinnedCardIds, setPinnedCardIds] = useState<Record<string, boolean>>({});

  const [flyingCard, setFlyingCard] = useState<FlyingCardState | null>(null);
  const [justLandedUnitKey, setJustLandedUnitKey] = useState<string | null>(null);

  const idleDockRef = useRef<IdleDockHandle | null>(null);
  const pendingAltaByTempIdRef = useRef<Map<string, Promise<CircuitoAbierto | null>>>(new Map());
  const landedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDroppedColRef = useRef<string | null>(null);

  const isCardDragging = useIsCardDragging();
  const { setRef: setBoardScrollRef } = useDragAutoScroll<HTMLDivElement>({
    horizontal: true,
    edgeRatio: 1.5 / 9,
    minEdgePx: 120,
    edgePx: 260,
    maxSpeedPxPerSec: 620,
    leftAllowancePx: 28,
    rightAllowancePx: 28,
  });

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
    (message?: string) => {
      clearCoordinacionUser();
      clearBoardCache();
      queryClient.removeQueries({ queryKey: ['planeacion'] });
      setCoordUser(null);
      setAuthStatus('unauthenticated');
      if (message) {
        toast.error(message);
      }
    },
    [queryClient]
  );

  // Verificación bloqueante de sesión contra base.user_coordinacion antes de montar el tablero
  useEffect(() => {
    if (authStatus !== 'checking') return;
    const saved = coordUser || getSavedCoordinacionUser();
    if (!saved?.id) {
      setCoordUser(null);
      setAuthStatus('unauthenticated');
      return;
    }

    let active = true;
    verificarAccesoCoordinacion(saved.id)
      .then((res) => {
        if (!active) return;
        if (!res.authorized || !res.user) {
          clearCoordinacionUser();
          clearBoardCache();
          queryClient.removeQueries({ queryKey: ['planeacion'] });
          setCoordUser(null);
          setAuthStatus('unauthenticated');
        } else {
          setCoordUser(res.user);
          setAuthStatus('authenticated');
        }
      })
      .catch(() => {
        if (!active) return;
        clearCoordinacionUser();
        clearBoardCache();
        queryClient.removeQueries({ queryKey: ['planeacion'] });
        setCoordUser(null);
        setAuthStatus('unauthenticated');
      });

    return () => {
      active = false;
    };
  }, [authStatus, coordUser, queryClient]);

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
    forceAuthLogout();
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

  const renderUnitCard = (card: PlaneacionCard) => (
    <UnitPlaneacionCard
      key={card.proceso_id}
      card={card}
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
            unidadId: data.unidadId || null,
            tractorId: data.tractorId || null,
            semiId: data.semiId || null,
            procesoOrigenId: data.holdId,
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
            unidadId: data.unidadId || null,
            tractorId: data.tractorId || null,
            semiId: data.semiId || null,
            procesoOrigenId: data.procesoId,
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

  // Manejo de Drop en Egreso / Salida (Optimistic UI 0 ms, eliminación protegida por jerarquía user_coordinacion)
  const handleDropOnEgreso = async (e: React.DragEvent) => {
    e.preventDefault();
    lastDroppedColRef.current = null;
    setIsDragOverEgreso(false);
    try {
      const data = extractDragPayload(e) as Record<string, any> | null;
      (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = null;
      if (!data) return;

      // Desde Idle SIN ASIGNACIÓN -> baja explícita del circuito
      if (data.type === 'CARD_CIRCUITO' && data.circuitoId) {
        const rawCircuitoId = String(data.circuitoId);
        const previousSnapshot = optimisticRemoveCircuito(rawCircuitoId);

        const performBaja = async () => {
          let resolvedId = rawCircuitoId;
          if (rawCircuitoId.startsWith('temp_circ_')) {
            const pendingAlta = pendingAltaByTempIdRef.current.get(rawCircuitoId);
            const created = pendingAlta ? await pendingAlta : null;
            if (!created?.circuito_id) return;
            resolvedId = created.circuito_id;
          }
          await bajaCircuito(resolvedId);
        };

        try {
          await performBaja();
        } catch (err) {
          console.error('Error al dar de baja circuito idle:', err);
          rollbackBoard(previousSnapshot);
          if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
            forceAuthLogout(err.message);
            return;
          }
          toast.error(err instanceof Error ? err.message : 'Error dando de baja la unidad');
        }
        return;
      }

      if (data.type === 'CARD_HOLD' && data.holdId) {
        // Si proviene del dock de Idles y consolida múltiples holds del circuito, dar baja al circuito completo
        if (data.fromIdleDock && data.circuitoId && Number(data.holdsCount || 1) > 1) {
          const previousSnapshot = optimisticRemoveCircuito(data.circuitoId);
          try {
            await bajaCircuito(data.circuitoId);
          } catch (err) {
            rollbackBoard(previousSnapshot);
            if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
              forceAuthLogout(err.message);
              return;
            }
            toast.error(err instanceof Error ? err.message : 'Error al dar egreso');
          }
          return;
        }

        const previousSnapshot = optimisticRemoveCard(data.holdId, true);

        try {
          await eliminarHold(data.holdId);
        } catch (err) {
          console.error('Error al eliminar preasignación:', err);
          rollbackBoard(previousSnapshot);
          if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
            forceAuthLogout(err.message);
            return;
          }
          toast.error(err instanceof Error ? err.message : 'Error al dar egreso');
        }
        return;
      }

      if (data.type === 'CARD_PROCESO' && data.procesoId) {
        const previousSnapshot = optimisticRemoveCard(data.procesoId, false);

        try {
          await actualizarProceso(data.procesoId, { action: 'ARCHIVAR' });
        } catch (err) {
          console.error('Error al archivar por egreso:', err);
          rollbackBoard(previousSnapshot);
          if (err instanceof PlaneacionApiError && (err.status === 401 || err.status === 403)) {
            forceAuthLogout(err.message);
            return;
          }
          toast.error(err instanceof Error ? err.message : 'Error al dar egreso');
        }
        return;
      }
    } catch (err) {
      console.error('Error al dar egreso:', err);
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
        {/* Controles Izquierda: Buscador + Refresh + Contador */}
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

          <button
            type="button"
            onClick={() => refresh()}
            title="Actualizar tablero"
            aria-label="Actualizar tablero"
            className="w-8 h-8 rounded-full bg-white border border-zinc-400 flex items-center justify-center text-zinc-700 hover:text-zinc-950 hover:border-zinc-600 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <RefreshCw
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              focusable="false"
              className={isFetching ? 'animate-spin' : ''}
            />
          </button>

          <span
            className="hidden sm:inline-flex items-center h-8 text-[11px] font-mono font-bold px-2.5 rounded-full border border-dashed border-zinc-400 text-zinc-800 select-none"
            title="Unidades activas en planta"
          >
            {activosCount} activas
          </span>
        </div>

        {/* Controles Derecha: Primary CTA (+ Ingresar Unidad) + Sort + Sesión */}
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

          {/* Sort Button (btn-sm icon, height 32px) */}
          <button
            type="button"
            onClick={() => setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            title={`Ordenar por llegada (${sortDirection === 'desc' ? 'Más reciente' : 'Más antiguo'})`}
            aria-label={`Ordenar por llegada (${sortDirection === 'desc' ? 'Más reciente' : 'Más antiguo'})`}
            className="w-8 h-8 rounded-full bg-white border border-zinc-400 hover:border-zinc-600 text-zinc-700 hover:text-zinc-950 flex items-center justify-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <ArrowUpDown size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
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
          className="flex-1 min-h-0 w-full flex flex-col overflow-x-auto overflow-y-hidden"
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
            <div
              className="grid flex-1 min-h-0 h-full gap-0 min-w-max"
              style={{
                gridTemplateColumns: `repeat(${columns.length}, minmax(260px, 1fr)) minmax(180px, 220px)`,
              }}
            >
              {columns.map((col) => {
                const isDragOver = dragOverZoneId === col.id;
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
                    onMouseEnter={() => setHoveredColId(col.id)}
                    onMouseLeave={() => setHoveredColId(null)}
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
                    className={`h-full flex flex-col min-h-0 px-2.5 pt-1.5 pb-2 border-r-[3px] border-dashed border-amber-400 transition-colors ${
                      isDragOver ? 'bg-emerald-50/70 border-emerald-500' : ''
                    }`}
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
                          <span>FINALIZÓ</span>
                          <span className="tabular-nums font-semibold">{salidaCards.length}</span>
                        </div>
                        {salidaCards.length === 0 ? (
                          <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-500 italic select-none">
                            sin unidades
                          </div>
                        ) : (
                          salidaCards.map(renderUnitCard)
                        )}
                      </div>

                      {/* DIVIDER */}
                      <div className="border-t border-zinc-300/80 my-0.5" />

                      {/* 2. MEDIO: inicio_at / TRABAJANDO */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-600 select-none">
                          <span>TRABAJANDO</span>
                          <span className="tabular-nums font-semibold">{inicioCards.length}</span>
                        </div>
                        {inicioCards.length === 0 ? (
                          <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-500 italic select-none">
                            sin unidades
                          </div>
                        ) : (
                          inicioCards.map(renderUnitCard)
                        )}
                      </div>

                      {/* DIVIDER */}
                      <div className="border-t border-zinc-300/80 my-0.5" />

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
                          reservadoCards.map(renderUnitCard)
                        )}
                      </div>

                      {/* DIVIDER */}
                      <div className="border-t border-zinc-300/80 my-0.5" />

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
                        className={`flex flex-col gap-2 p-1.5 rounded-lg transition-all ${
                          dragOverPreasignadoZoneId === col.id
                            ? 'bg-amber-100/70 border-2 border-dashed border-amber-500 ring-2 ring-amber-400/40'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-600 select-none">
                          <span>PREASIGNADO</span>
                          <span className="tabular-nums font-semibold">
                            {preasignadoCards.length}
                          </span>
                        </div>
                        {preasignadoCards.length === 0 ? (
                          <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-500 italic select-none">
                            sin unidades
                          </div>
                        ) : (
                          preasignadoCards.map(renderUnitCard)
                        )}
                      </div>
                    </AutoScrollColumn>
                  </section>
                );
              })}

              {/* Columna / Drop Zone para Dar Egreso y Terminar Proceso (no sólida, dashed) */}
              <section
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
                className={`h-full flex flex-col min-h-0 px-3 pt-2 pb-2 rounded-xl border-2 border-dashed transition-all ${
                  isDragOverEgreso
                    ? 'border-rose-500 bg-rose-50/80 text-rose-950 scale-[1.01]'
                    : 'border-zinc-400/75 bg-zinc-200/30 text-zinc-700'
                }`}
              >
                <div className="mb-2 px-1 flex items-center justify-between gap-2 h-[38px] shrink-0">
                  <div className="flex items-center gap-1.5 font-mono text-[13px] font-black uppercase text-zinc-900">
                    <LogOut size={16} strokeWidth={2} aria-hidden="true" className="text-zinc-700" />
                    <span>Egreso Planta</span>
                  </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-4 text-center border border-dashed border-zinc-400/60 rounded-lg bg-transparent">
                  <CheckCircle2
                    size={28}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="text-zinc-500 mb-2"
                  />
                  <span className="text-xs font-bold text-zinc-800 uppercase tracking-wide">
                    Zona de Salida / Egreso
                  </span>
                  <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
                    Arrastrá aquí una unidad para dar egreso definitivo de planta.
                  </p>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Contenedor Horizontal Inferior de Idles (orden jerárquico + zoom-in en hover) */}
        <IdleUnitsHorizontalDock
          ref={idleDockRef}
          items={idleItems}
          counts={idleCounts}
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
