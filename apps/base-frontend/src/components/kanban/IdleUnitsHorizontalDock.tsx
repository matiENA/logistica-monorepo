import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  normalizePlateKey,
  type CatalogUnitItem,
} from '../../hooks/usePlaneacionKanban';
import type {
  CircuitoTimelineStep,
  IdleDockItem,
  IdleHierarchyTier,
  ProcesoNota,
} from '../../types/planeacion';
import { useDragAutoScroll, useIsCardDragging } from '../../hooks/useDragAutoScroll';
import { IdleHorizontalCard } from './IdleHorizontalCard';
import {
  IDLE_DOCK_STATE_SPEC,
  IDLE_SMOOTH_EASE,
  IDLE_TAB_AUTO_CYCLE_MS,
  resolveIdleDockState,
} from './idleDockStates';
import type { OriginRect } from './NewIngresoModal';

export interface IdleCounts {
  SIN_ASIGNACION: number;
  TERMINADO: number;
  ESPERANDO_BOX: number;
  PREASIGNADO: number;
  total: number;
}

export interface IdleDockHandle {
  scrollToStart: () => void;
  focusTier: (tier: IdleHierarchyTier) => void;
  getSlotRectForUnit: (unit: CatalogUnitItem) => OriginRect | null;
}

interface IdleUnitsHorizontalDockProps {
  items: IdleDockItem[];
  counts: IdleCounts;
  circuitosTimelines?: Record<string, CircuitoTimelineStep[]>;
  onReorderTimeline?: (circuitoId: string, orderedPreasignadoIds: string[]) => void;
  flyingUnit: CatalogUnitItem | null;
  justLandedUnitKey: string | null;
  onNoteAdded?: (sync?: { procesoId: string; circuitoId?: string; notes: ProcesoNota[] }) => void;
}

interface IdleTabSpec {
  tier: IdleHierarchyTier;
  label: string;
  emptyLabel: string;
  dotClass: string;
  activeSurfaceClass: string;
  activeCountClass: string;
  activeBarClass: string;
}

const IDLE_TAB_SPECS: readonly IdleTabSpec[] = [
  {
    tier: 'SIN_ASIGNACION',
    label: 'Sin asignar',
    emptyLabel: 'Sin unidades sin asignar · Ingresá patentes desde + Ingresar Unidad',
    dotClass: 'bg-emerald-700',
    activeSurfaceClass: 'bg-emerald-50 border-emerald-700/90 text-emerald-950 shadow-2xs',
    activeCountClass: 'text-emerald-900',
    activeBarClass: 'bg-emerald-700',
  },
  {
    tier: 'TERMINADO',
    label: 'Finalizó',
    emptyLabel: 'Sin unidades finalizadas en el circuito',
    dotClass: 'bg-zinc-700',
    activeSurfaceClass: 'bg-white border-zinc-800 text-zinc-950 shadow-2xs',
    activeCountClass: 'text-zinc-950',
    activeBarClass: 'bg-zinc-800',
  },
  {
    tier: 'ESPERANDO_BOX',
    label: 'Esperando',
    emptyLabel: 'Sin unidades esperando ingreso a box',
    dotClass: 'bg-blue-700',
    activeSurfaceClass: 'bg-blue-50 border-blue-700/90 text-blue-950 shadow-2xs',
    activeCountClass: 'text-blue-900',
    activeBarClass: 'bg-blue-700',
  },
  {
    tier: 'PREASIGNADO',
    label: 'Preasignado',
    emptyLabel: 'Sin unidades preasignadas en espera',
    dotClass: 'bg-amber-600',
    activeSurfaceClass: 'bg-amber-50 border-amber-700/90 text-amber-950 shadow-2xs',
    activeCountClass: 'text-amber-900',
    activeBarClass: 'bg-amber-600',
  },
];

const TIER_ORDER: readonly IdleHierarchyTier[] = IDLE_TAB_SPECS.map((t) => t.tier);

const TAB_SPEC_BY_TIER: Record<IdleHierarchyTier, IdleTabSpec> = {
  SIN_ASIGNACION: IDLE_TAB_SPECS[0],
  TERMINADO: IDLE_TAB_SPECS[1],
  ESPERANDO_BOX: IDLE_TAB_SPECS[2],
  PREASIGNADO: IDLE_TAB_SPECS[3],
};

interface IdleTabState {
  tier: IdleHierarchyTier;
  direction: 'next' | 'prev';
  seq: number;
}

export function buildUnitFlightSignature(unit: {
  unidad_id?: string | null;
  tractor_id?: string | null;
  semi_id?: string | null;
  tractor_plate?: string | null;
  semi_plate?: string | null;
}): string {
  const tr = normalizePlateKey(unit.tractor_plate);
  const sm = normalizePlateKey(unit.semi_plate);
  return `${unit.unidad_id || ''}|${unit.tractor_id || ''}|${unit.semi_id || ''}|${tr}|${sm}`;
}

function itemMatchesUnit(item: IdleDockItem, unit: CatalogUnitItem): boolean {
  if (unit.unidad_id && item.unidad_id === unit.unidad_id) return true;
  if (unit.tractor_id && item.tractor_id === unit.tractor_id) return true;
  if (unit.semi_id && item.semi_id === unit.semi_id) return true;
  const uTr = normalizePlateKey(unit.tractor_plate);
  const uSm = normalizePlateKey(unit.semi_plate);
  const iTr = normalizePlateKey(item.tractor_plate);
  const iSm = normalizePlateKey(item.semi_plate);
  if (uTr && iTr && uTr === iTr) return true;
  if (uSm && iSm && uSm === iSm) return true;
  return false;
}

export const IdleUnitsHorizontalDock = forwardRef<IdleDockHandle, IdleUnitsHorizontalDockProps>(
  ({ items, counts, circuitosTimelines, onReorderTimeline, flyingUnit, justLandedUnitKey, onNoteAdded }, ref) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isDraggingCard, setIsDraggingCard] = useState(false);
    const [pinnedKeys, setPinnedKeys] = useState<Record<string, boolean>>({});
    const [tabState, setTabState] = useState<IdleTabState>(() => ({
      tier: TIER_ORDER.find((t) => counts[t] > 0) ?? 'SIN_ASIGNACION',
      direction: 'next',
      seq: 0,
    }));

    const activeTier = tabState.tier;

    const { setRef: setScrollContainerRef, nodeRef: scrollContainerRef } =
      useDragAutoScroll<HTMLDivElement>({
        horizontal: true,
        edgeRatio: 1.5 / 9,
        minEdgePx: 120,
        edgePx: 240,
        maxSpeedPxPerSec: 620,
        leftAllowancePx: 28,
        rightAllowancePx: 28,
      });
    const isGlobalCardDragging = useIsCardDragging();
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cardElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const tabRefs = useRef<Partial<Record<IdleHierarchyTier, HTMLButtonElement | null>>>({});
    const activeTierRef = useRef<IdleHierarchyTier>(activeTier);
    activeTierRef.current = activeTier;

    // C0 in-memory grouping por tier (0 llamadas extra a API/DB)
    const itemsByTier = useMemo<Record<IdleHierarchyTier, IdleDockItem[]>>(() => {
      const grouped: Record<IdleHierarchyTier, IdleDockItem[]> = {
        SIN_ASIGNACION: [],
        TERMINADO: [],
        ESPERANDO_BOX: [],
        PREASIGNADO: [],
      };
      for (const item of items) {
        grouped[item.tier].push(item);
      }
      return grouped;
    }, [items]);

    const nonEmptyTiers = useMemo<IdleHierarchyTier[]>(
      () => TIER_ORDER.filter((t) => itemsByTier[t].length > 0),
      [itemsByTier]
    );

    const selectTier = useCallback(
      (nextTier: IdleHierarchyTier, explicitDirection?: 'next' | 'prev') => {
        if (activeTierRef.current !== nextTier) {
          setPinnedKeys((prev) => (Object.keys(prev).length > 0 ? {} : prev));
        }
        setTabState((prev) => {
          if (prev.tier === nextTier) return prev;
          const direction =
            explicitDirection ??
            (TIER_ORDER.indexOf(nextTier) >= TIER_ORDER.indexOf(prev.tier) ? 'next' : 'prev');
          return {
            tier: nextTier,
            direction,
            seq: prev.seq + 1,
          };
        });
      },
      []
    );

    useEffect(() => {
      if (!isGlobalCardDragging) {
        setIsDraggingCard(false);
      }
    }, [isGlobalCardDragging]);

    useEffect(() => {
      return () => {
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      };
    }, []);

    // Al iniciar un vuelo de alta, enfocar inmediatamente Sin asignar para aterrizar la card
    useEffect(() => {
      if (flyingUnit) {
        selectTier('SIN_ASIGNACION');
      }
    }, [flyingUnit, selectTier]);

    // Reiniciar scroll horizontal al cambiar de tab
    useEffect(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = 0;
      }
    }, [activeTier, scrollContainerRef]);

    const hasPinned = Object.keys(pinnedKeys).length > 0;
    const dockState = resolveIdleDockState({
      isHovered,
      hasPinned,
      isDraggingCard,
    });
    const dockSpec = IDLE_DOCK_STATE_SPEC[dockState];

    // Recuperación automática en reposo si la tab activa queda vacía y existen otras con unidades
    useEffect(() => {
      if (
        dockState === 'zoom-out' &&
        !flyingUnit &&
        itemsByTier[activeTier].length === 0 &&
        nonEmptyTiers.length > 0
      ) {
        selectTier(nonEmptyTiers[0]);
      }
    }, [dockState, flyingUnit, itemsByTier, activeTier, nonEmptyTiers, selectTier]);

    // Rotación automática solo en reposo (zoom-out), con >1 sección con unidades y sin reduced-motion
    useEffect(() => {
      if (dockState !== 'zoom-out' || flyingUnit || nonEmptyTiers.length <= 1) {
        return;
      }
      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }

      const timer = setInterval(() => {
        setTabState((prev) => {
          const currentIdx = nonEmptyTiers.indexOf(prev.tier);
          const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % nonEmptyTiers.length;
          const nextTier = nonEmptyTiers[nextIdx];
          if (nextTier === prev.tier) return prev;
          return {
            tier: nextTier,
            direction: 'next',
            seq: prev.seq + 1,
          };
        });
      }, IDLE_TAB_AUTO_CYCLE_MS);

      return () => clearInterval(timer);
    }, [dockState, flyingUnit, nonEmptyTiers]);

    const handleMouseEnter = useCallback(() => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      setIsHovered(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = setTimeout(() => {
        setIsHovered(false);
      }, 90);
    }, []);

    const handlePinChange = useCallback((cardKey: string, isPinned: boolean) => {
      setPinnedKeys((prev) => {
        const current = Boolean(prev[cardKey]);
        if (current === isPinned) return prev;
        const next = { ...prev };
        if (isPinned) next[cardKey] = true;
        else delete next[cardKey];
        return next;
      });
    }, []);

    const registerCardRef = useCallback((item: IdleDockItem, el: HTMLDivElement | null) => {
      const sig = buildUnitFlightSignature(item);
      if (el) {
        cardElsRef.current.set(item.key, el);
        cardElsRef.current.set(sig, el);
      } else {
        cardElsRef.current.delete(item.key);
        if (cardElsRef.current.get(sig) === el) {
          cardElsRef.current.delete(sig);
        }
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        scrollToStart: () => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollLeft = 0;
          }
        },
        focusTier: (tier: IdleHierarchyTier) => {
          selectTier(tier);
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollLeft = 0;
          }
        },
        getSlotRectForUnit: (unit: CatalogUnitItem): OriginRect | null => {
          const sig = buildUnitFlightSignature(unit);
          let el = cardElsRef.current.get(sig) || null;
          if (!el) {
            const matchedItem = items.find((it) => itemMatchesUnit(it, unit));
            if (matchedItem) {
              el = cardElsRef.current.get(matchedItem.key) || null;
            }
          }
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return null;
          return {
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
          };
        },
      }),
      [items, scrollContainerRef, selectTier]
    );

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
      const el = scrollContainerRef.current;
      if (!el) return;
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
      }
    };

    const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
      let targetIdx: number | null = null;
      let explicitDir: 'next' | 'prev' | undefined;

      if (e.key === 'ArrowRight') {
        targetIdx = (currentIdx + 1) % TIER_ORDER.length;
        explicitDir = 'next';
      } else if (e.key === 'ArrowLeft') {
        targetIdx = (currentIdx - 1 + TIER_ORDER.length) % TIER_ORDER.length;
        explicitDir = 'prev';
      } else if (e.key === 'Home') {
        targetIdx = 0;
      } else if (e.key === 'End') {
        targetIdx = TIER_ORDER.length - 1;
      }

      if (targetIdx === null) return;
      e.preventDefault();
      const targetTier = TIER_ORDER[targetIdx];
      selectTier(targetTier, explicitDir);
      tabRefs.current[targetTier]?.focus();
    };

    const activeItems = itemsByTier[activeTier];
    const activeSpec = TAB_SPEC_BY_TIER[activeTier];
    const panelAnimClass =
      !flyingUnit && tabState.seq > 0
        ? tabState.direction === 'next'
          ? 'animate-idle-tab-next'
          : 'animate-idle-tab-prev'
        : '';

    return (
      <section
        aria-label="Contenedor horizontal de unidades idle"
        data-dock-state={dockState}
        data-active-tier={activeTier}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`w-full shrink-0 rounded-2xl ui-stroke-dashed transition-[height,border-color,background-color] ${IDLE_SMOOTH_EASE} flex flex-col overflow-hidden ${dockSpec.heightClass} ${dockSpec.surfaceClass}`}
      >
        {/* Header del dock sin título: 4 denominaciones como tabs con estado activo reconocible */}
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsHovered((prev) => !prev);
            }
          }}
          className="h-11 px-3 flex items-center justify-between gap-2 ui-divider-dashed-subtle-b border-zinc-400/70 shrink-0 select-none"
        >
          <div
            role="tablist"
            aria-label="Estados de unidades idle"
            className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar py-1"
          >
            {IDLE_TAB_SPECS.map((tab, idx) => {
              const isActive = tab.tier === activeTier;
              const tierCount = counts[tab.tier];
              const inactiveTextClass = tierCount > 0 ? 'text-zinc-800' : 'text-zinc-600';

              return (
                <button
                  key={tab.tier}
                  ref={(el) => {
                    tabRefs.current[tab.tier] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`idle-tab-${tab.tier}`}
                  aria-selected={isActive}
                  aria-controls={`idle-tabpanel-${tab.tier}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => selectTier(tab.tier)}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  className={`relative h-[32px] px-3 border rounded-md inline-flex items-center gap-1.5 text-[11px] font-mono whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-[#EDEDED] ${
                    isActive
                      ? tab.activeSurfaceClass
                      : `bg-transparent border-transparent hover:bg-white/60 hover:text-zinc-950 ${inactiveTextClass}`
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${tab.dotClass}`}
                    aria-hidden="true"
                  />
                  <span className={isActive ? 'font-bold' : 'font-semibold'}>{tab.label}</span>
                  <span
                    className={`font-numeric font-bold tabular-nums ${
                      isActive
                        ? tab.activeCountClass
                        : tierCount > 0
                        ? 'text-zinc-700'
                        : 'text-zinc-600'
                    }`}
                  >
                    ({tierCount})
                  </span>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full ${tab.activeBarClass}`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <span
            className="font-numeric tabular-nums text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/80 border border-zinc-400/80 text-zinc-900 shrink-0"
            title="Total de unidades idle"
          >
            {counts.total}
          </span>
        </div>

        {/* Panel de Patentes de la sección activa */}
        <div
          ref={setScrollContainerRef}
          role="tabpanel"
          id={`idle-tabpanel-${activeTier}`}
          aria-labelledby={`idle-tab-${activeTier}`}
          onWheel={handleWheel}
          className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden no-scrollbar"
        >
          <div
            key={`${activeTier}-${tabState.seq}`}
            className={`min-w-full w-max h-full px-3 py-2 flex flex-row items-center gap-2.5 ${
              activeItems.length === 0 ? 'justify-center' : ''
            } ${panelAnimClass}`}
          >
            {activeItems.length === 0 ? (
              <div className="flex items-center justify-center text-xs font-mono text-zinc-600 select-none">
                <span>{activeSpec.emptyLabel}</span>
              </div>
            ) : (
              activeItems.map((item) => {
                const isHiddenForFlight = Boolean(flyingUnit && itemMatchesUnit(item, flyingUnit));
                const isJustLanded =
                  Boolean(justLandedUnitKey) &&
                  buildUnitFlightSignature(item) === justLandedUnitKey;

                const circId =
                  item.circuito_id || (item.tier === 'SIN_ASIGNACION' ? item.targetId : undefined);
                const timelineSteps = circId ? circuitosTimelines?.[circId] : undefined;

                return (
                  <IdleHorizontalCard
                    key={item.key}
                    item={item}
                    dockState={dockState}
                    timelineSteps={timelineSteps}
                    onReorderTimeline={onReorderTimeline}
                    isHiddenForFlight={isHiddenForFlight}
                    isJustLanded={isJustLanded}
                    registerCardRef={registerCardRef}
                    onPinChange={handlePinChange}
                    onNoteAdded={onNoteAdded}
                    onDragStateChange={setIsDraggingCard}
                  />
                );
              })
            )}
          </div>
        </div>
      </section>
    );
  }
);

IdleUnitsHorizontalDock.displayName = 'IdleUnitsHorizontalDock';
