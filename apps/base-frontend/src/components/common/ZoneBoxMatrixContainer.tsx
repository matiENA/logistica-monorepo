import React, { useEffect, useRef, useState } from 'react';
import { Check, GripVertical, Loader2, User } from 'lucide-react';
import { useDragAutoScroll, useIsCardDragging } from '../../hooks/useDragAutoScroll';
import { DragScrollContainer } from './DragScrollContainer';
import {
  CARD_OPERARIO_DRAG_MIME,
  TallerUnitCard,
  type TallerCardItem,
  type TallerColumnId,
} from '../taller/TallerUnitCard';
import type { CircuitoTimelineStep, EstadoBox, ProcesoNota, TallerBoxOperario } from '../../types/planeacion';

const OPERARIO_DRAG_MIME = 'application/x-taller-operario';

interface DraggingOperarioState {
  id: string;
  nombre_usuario: string;
  sourceBoxId: string | null;
}

interface OpenOperarioMenuState {
  operario: TallerBoxOperario;
  sourceBoxId: string | null;
  top: number;
  left: number;
}

export interface ZoneBoxSlotItem {
  boxId: string | null;
  boxName: string;
  operarios?: TallerBoxOperario[];
  adentro: TallerCardItem[];
  afuera: TallerCardItem[];
}

export interface ZoneDropTarget {
  col: TallerColumnId;
  boxId?: string | null;
  estado?: EstadoBox;
}

export interface ZoneBoxMatrixContainerProps {
  zoneLabel: string;
  totalCount: number;
  slots: ZoneBoxSlotItem[];
  circuitosTimelines?: Record<string, CircuitoTimelineStep[]>;
  colSpanClass?: string;
  borderIdle?: string;
  borderOver?: string;
  countClass?: string;
  defaultDropBoxId?: string | null;
  readOnly?: boolean;
  nowMs?: number;
  busyIds?: Record<string, boolean>;
  isDragging?: boolean;
  dragOverTarget?: ZoneDropTarget | null;
  canDropOnTarget?: (target: ZoneDropTarget) => boolean;
  resolveDropTarget?: (slotBoxId: string | null, estado: EstadoBox) => ZoneDropTarget;
  onTargetDragOver?: (e: React.DragEvent<HTMLElement>, target: ZoneDropTarget) => void;
  onTargetDrop?: (e: React.DragEvent<HTMLElement>, target: ZoneDropTarget) => void;
  onClearDragOver?: (target?: ZoneDropTarget) => void;
  onNoteAdded?: (sync?: { procesoId: string; circuitoId?: string; notes: ProcesoNota[] }) => void;
  onUndoCard?: (item: TallerCardItem) => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, item: TallerCardItem) => void;
  onDragEnd?: () => void;
  canManageOperarios?: boolean;
  busyOperarioIds?: Record<string, boolean>;
  unassignedOperarios?: TallerBoxOperario[];
  onMoveOperarioToBox?: (operarioId: string, targetBoxId: string | null) => void;
  onRemoveOperarioFromProceso?: (
    procesoId: string,
    operarioId: string,
    operarioNombre: string
  ) => void;
}

export const ZoneBoxMatrixContainer: React.FC<ZoneBoxMatrixContainerProps> = ({
  zoneLabel,
  totalCount,
  slots,
  circuitosTimelines,
  colSpanClass = 'min-w-0',
  borderIdle = 'border-emerald-500/30 bg-[#0A0E15]/80',
  borderOver = 'border-emerald-400 bg-emerald-500/10',
  countClass = 'text-emerald-300',
  defaultDropBoxId = null,
  readOnly = false,
  busyIds = {},
  isDragging = false,
  dragOverTarget = null,
  canDropOnTarget,
  resolveDropTarget,
  onTargetDragOver,
  onTargetDrop,
  onClearDragOver,
  onNoteAdded,
  onUndoCard,
  onDragStart,
  onDragEnd,
  canManageOperarios = false,
  busyOperarioIds = {},
  unassignedOperarios = [],
  onMoveOperarioToBox,
  onRemoveOperarioFromProceso,
}) => {
  const isGlobalDragging = useIsCardDragging();
  const [draggingOperario, setDraggingOperario] = useState<DraggingOperarioState | null>(null);
  const [dragOverOperarioBoxId, setDragOverOperarioBoxId] = useState<string | '__SIN_BOX__' | null>(
    null
  );
  const [openOperarioMenu, setOpenOperarioMenu] = useState<OpenOperarioMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isGlobalDragging) {
      setDraggingOperario(null);
      setDragOverOperarioBoxId(null);
    }
  }, [isGlobalDragging]);

  useEffect(() => {
    if (!openOperarioMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenOperarioMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenOperarioMenu(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [openOperarioMenu]);

  const { setRef: setMatrixScrollRef, nodeRef: matrixScrollRef } =
    useDragAutoScroll<HTMLDivElement>({
      horizontal: true,
      edgeRatio: 1.5 / 7,
      minEdgePx: 110,
      edgePx: 250,
      maxSpeedPxPerSec: 620,
      leftAllowancePx: 28,
      rightAllowancePx: 28,
    });

  const handleMatrixWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = matrixScrollRef.current;
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
  };

  const resolveTarget = (slotBoxId: string | null, estado: EstadoBox): ZoneDropTarget =>
    resolveDropTarget
      ? resolveDropTarget(slotBoxId, estado)
      : { col: 'INICIO', boxId: slotBoxId, estado };

  const sectionFallbackTarget = resolveTarget(
    defaultDropBoxId ?? slots[0]?.boxId ?? null,
    'adentro'
  );

  const isOverSection =
    !readOnly &&
    isDragging &&
    dragOverTarget?.col === 'INICIO' &&
    Boolean(canDropOnTarget?.(dragOverTarget));

  const noopDragStart = () => {};
  const noopDragEnd = () => {};

  const isOperarioDragEvent = (e: React.DragEvent): boolean =>
    Boolean(draggingOperario) ||
    Array.from(e.dataTransfer.types || []).includes(OPERARIO_DRAG_MIME);

  const isCardOperarioBadgeDragEvent = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types || []).includes(CARD_OPERARIO_DRAG_MIME);

  const parseOperarioDragPayload = (e: React.DragEvent): DraggingOperarioState | null => {
    if (draggingOperario) return draggingOperario;
    try {
      const raw = e.dataTransfer.getData(OPERARIO_DRAG_MIME);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<DraggingOperarioState>;
      if (typeof parsed.id === 'string' && typeof parsed.nombre_usuario === 'string') {
        return {
          id: parsed.id,
          nombre_usuario: parsed.nombre_usuario,
          sourceBoxId: parsed.sourceBoxId ?? null,
        };
      }
    } catch {
      return null;
    }
    return null;
  };

  const handleOperarioBoxDragOver = (e: React.DragEvent, targetBoxId: string | null) => {
    if (!canManageOperarios || !isOperarioDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const targetKey = targetBoxId ?? '__SIN_BOX__';
    if (draggingOperario && draggingOperario.sourceBoxId === targetBoxId) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'move';
    if (dragOverOperarioBoxId !== targetKey) {
      setDragOverOperarioBoxId(targetKey);
    }
  };

  const handleOperarioBoxDrop = (e: React.DragEvent, targetBoxId: string | null) => {
    if (!canManageOperarios || !isOperarioDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const payload = parseOperarioDragPayload(e);
    setDraggingOperario(null);
    setDragOverOperarioBoxId(null);
    if (!payload || payload.sourceBoxId === targetBoxId) return;
    onMoveOperarioToBox?.(payload.id, targetBoxId);
  };

  const handleOperarioChipClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    op: TallerBoxOperario,
    sourceBoxId: string | null
  ) => {
    e.stopPropagation();
    if (!canManageOperarios || busyOperarioIds[op.id]) return;
    if (openOperarioMenu?.operario.id === op.id) {
      setOpenOperarioMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 212;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
    const top = Math.min(rect.bottom + 6, window.innerHeight - 240);
    setOpenOperarioMenu({
      operario: op,
      sourceBoxId,
      top,
      left,
    });
  };

  const renderOperarioChip = (op: TallerBoxOperario, sourceBoxId: string | null) => {
    const isBusy = Boolean(busyOperarioIds[op.id]);
    const isBeingDragged = draggingOperario?.id === op.id;
    const isMenuOpen = openOperarioMenu?.operario.id === op.id;

    return (
      <button
        key={op.id}
        type="button"
        data-drag-card="true"
        draggable={Boolean(canManageOperarios && !isBusy)}
        disabled={isBusy}
        title={
          canManageOperarios
            ? 'Arrastrá a otro box (adentro o afuera) o hacé clic para reasignar'
            : op.nombre_usuario
        }
        onDragStart={(e) => {
          if (!canManageOperarios || isBusy) {
            e.preventDefault();
            return;
          }
          e.stopPropagation();
          setOpenOperarioMenu(null);
          const payload: DraggingOperarioState = {
            id: op.id,
            nombre_usuario: op.nombre_usuario,
            sourceBoxId,
          };
          e.dataTransfer.setData(OPERARIO_DRAG_MIME, JSON.stringify(payload));
          e.dataTransfer.setData('text/plain', op.nombre_usuario);
          e.dataTransfer.effectAllowed = 'move';
          setDraggingOperario(payload);
        }}
        onDragEnd={(e) => {
          e.stopPropagation();
          setDraggingOperario(null);
          setDragOverOperarioBoxId(null);
        }}
        onClick={(e) => handleOperarioChipClick(e, op, sourceBoxId)}
        className={`inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-md border text-[10px] font-mono font-semibold uppercase tracking-wide transition-colors ${
          isMenuOpen
            ? 'border-sky-400 bg-sky-500/20 text-sky-100'
            : isBeingDragged
            ? 'border-sky-400/70 bg-sky-500/15 text-sky-200 opacity-50'
            : 'border-[#253047] bg-[#111827] hover:border-sky-400/60 hover:bg-[#172033] text-zinc-200'
        } ${canManageOperarios && !isBusy ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${
          isBusy ? 'opacity-60 cursor-wait' : ''
        }`}
      >
        {isBusy ? (
          <Loader2 size={10} className="shrink-0 animate-spin text-sky-300" aria-hidden="true" />
        ) : (
          <GripVertical size={10} className="shrink-0 text-zinc-400" aria-hidden="true" />
        )}
        <User size={10} strokeWidth={1.75} className="shrink-0 text-sky-300" aria-hidden="true" />
        <span className="truncate max-w-[115px]">{op.nombre_usuario}</span>
      </button>
    );
  };

  const renderEmptyBoxOperarios = (
    operarios: TallerBoxOperario[] | undefined,
    minHeightClass: string
  ) => {
    if (canManageOperarios) {
      return (
        <div
          className={`h-full ${minHeightClass} flex items-center justify-center text-center px-2 text-zinc-500/50 text-[11px] pointer-events-none select-none`}
        >
          <span>Sin unidades</span>
        </div>
      );
    }
    const list = operarios || [];
    if (list.length === 0) {
      return (
        <div
          className={`h-full ${minHeightClass} flex items-center justify-center text-center px-2 text-zinc-500/60 text-[11px] pointer-events-none select-none`}
        >
          <span>Sin operarios</span>
        </div>
      );
    }

    return (
      <div
        className={`h-full ${minHeightClass} flex flex-col items-center justify-center gap-1 px-2 py-1 pointer-events-none select-none opacity-45`}
      >
        {list.map((op) => (
          <div
            key={op.id}
            className="inline-flex items-center justify-center gap-1.5 max-w-full text-[11px] font-mono font-semibold uppercase tracking-wide text-zinc-300"
          >
            <User
              size={12}
              strokeWidth={1.75}
              aria-hidden="true"
              focusable="false"
              className="shrink-0 text-zinc-400"
            />
            <span className="truncate">{op.nombre_usuario}</span>
          </div>
        ))}
      </div>
    );
  };

  const menuBoxSlots = slots.filter(
    (s): s is ZoneBoxSlotItem & { boxId: string } => s.boxId !== null
  );
  const showUnassignedBar =
    canManageOperarios &&
    (unassignedOperarios.length > 0 ||
      (draggingOperario !== null && draggingOperario.sourceBoxId !== null));

  return (
    <section
      onDragOver={
        readOnly
          ? undefined
          : (e) => {
              if (isCardOperarioBadgeDragEvent(e)) return;
              if (canManageOperarios && isOperarioDragEvent(e)) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              onTargetDragOver?.(e, sectionFallbackTarget);
            }
      }
      onDragLeave={
        readOnly
          ? undefined
          : (e) => {
              if (isCardOperarioBadgeDragEvent(e)) return;
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (isOperarioDragEvent(e)) {
                  setDragOverOperarioBoxId(null);
                  return;
                }
                if (dragOverTarget?.col === 'INICIO') {
                  onClearDragOver?.();
                }
              }
            }
      }
      onDrop={
        readOnly
          ? undefined
          : (e) => {
              if (isCardOperarioBadgeDragEvent(e)) return;
              if (canManageOperarios && isOperarioDragEvent(e)) {
                e.preventDefault();
                e.stopPropagation();
                setDraggingOperario(null);
                setDragOverOperarioBoxId(null);
                return;
              }
              onTargetDrop?.(e, sectionFallbackTarget);
            }
      }
      className={`h-full min-h-[280px] md:min-h-0 min-w-0 rounded-2xl ui-stroke-dashed p-3.5 flex flex-col transition-colors ${colSpanClass} ${
        isOverSection ? borderOver : borderIdle
      }`}
    >
      {/* Header de Contenedor: Label Relacional de la Zona + Operarios sin box (si aplica) */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-3 ui-divider-dashed-subtle-b border-[#1A2232] shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h2 className="font-helvetica font-bold text-sm tracking-wide text-white uppercase truncate">
            {zoneLabel}
          </h2>

          {showUnassignedBar && (
            <div
              onDragOver={(e) => handleOperarioBoxDragOver(e, null)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dragOverOperarioBoxId === '__SIN_BOX__') {
                    setDragOverOperarioBoxId(null);
                  }
                }
              }}
              onDrop={(e) => handleOperarioBoxDrop(e, null)}
              className={`inline-flex flex-wrap items-center gap-1.5 px-2 py-0.5 rounded-lg ui-stroke-dashed-subtle transition-colors ${
                dragOverOperarioBoxId === '__SIN_BOX__'
                  ? 'border-sky-400 bg-sky-500/20'
                  : 'border-zinc-700/80 bg-[#0D131F]'
              }`}
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                Sin box:
              </span>
              {unassignedOperarios.length === 0 ? (
                <span className="text-[10px] text-sky-300 font-semibold">
                  Soltar para quitar box
                </span>
              ) : (
                unassignedOperarios.map((op) => renderOperarioChip(op, null))
              )}
            </div>
          )}
        </div>

        <span
          className={`font-numeric tabular-nums text-xs font-semibold shrink-0 ${countClass}`}
        >
          {totalCount}
        </span>
      </div>

      {/* Matriz Relacional de Boxes Contenidos en la Zona (Dividers amarillos dashed 2px: Box | Box y ADENTRO / AFUERA) */}
      <div
        ref={setMatrixScrollRef}
        onWheel={handleMatrixWheel}
        className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden divide-x-2 divide-dashed divide-amber-400/70 no-scrollbar"
      >
        {slots.map((slot) => {
          const targetAdentro = resolveTarget(slot.boxId, 'adentro');
          const targetAfuera = resolveTarget(slot.boxId, 'afuera');
          const isOperarioDragActive = canManageOperarios && draggingOperario !== null;

          const isOverAdentro =
            !readOnly &&
            !isOperarioDragActive &&
            isDragging &&
            dragOverTarget?.col === 'INICIO' &&
            dragOverTarget?.boxId === slot.boxId &&
            dragOverTarget?.estado === 'adentro' &&
            Boolean(canDropOnTarget?.(dragOverTarget));

          const isOverAfuera =
            !readOnly &&
            !isOperarioDragActive &&
            isDragging &&
            dragOverTarget?.col === 'INICIO' &&
            dragOverTarget?.boxId === slot.boxId &&
            dragOverTarget?.estado === 'afuera' &&
            Boolean(canDropOnTarget?.(dragOverTarget));

          const isOverBoxOperario =
            canManageOperarios &&
            slot.boxId !== null &&
            dragOverOperarioBoxId === slot.boxId;

          return (
            <div
              key={slot.boxId ?? `sin-box-${slot.boxName}`}
              onDragOver={
                canManageOperarios && slot.boxId !== null
                  ? (e) => handleOperarioBoxDragOver(e, slot.boxId)
                  : undefined
              }
              onDragLeave={
                canManageOperarios && slot.boxId !== null
                  ? (e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        if (dragOverOperarioBoxId === slot.boxId) {
                          setDragOverOperarioBoxId(null);
                        }
                      }
                    }
                  : undefined
              }
              onDrop={
                canManageOperarios && slot.boxId !== null
                  ? (e) => handleOperarioBoxDrop(e, slot.boxId)
                  : undefined
              }
              className={`flex-1 min-w-[195px] h-full min-h-0 flex flex-col transition-colors ${
                isOverBoxOperario
                  ? 'bg-sky-500/10 ring-1 ring-inset ring-sky-400/70 rounded-xl'
                  : ''
              }`}
            >
              {/* Encabezado de Box + Operarios asignados al box */}
              <div className="px-2.5 pb-2 flex flex-col items-center gap-1.5 shrink-0">
                <h3 className="font-numeric font-bold text-lg tracking-wide text-white tabular-nums truncate">
                  {slot.boxName}
                </h3>

                {canManageOperarios && slot.boxId !== null && (
                  <div className="w-full flex flex-wrap items-center justify-center gap-1 min-h-[22px]">
                    {(slot.operarios || []).length === 0 ? (
                      <span className="text-[10px] font-mono text-zinc-500/75 select-none">
                        Sin operario
                      </span>
                    ) : (
                      (slot.operarios || []).map((op) => renderOperarioChip(op, slot.boxId))
                    )}
                  </div>
                )}

                {isOverBoxOperario && (
                  <div className="w-full px-2 py-0.5 rounded-md ui-stroke-dashed-subtle border-sky-400/60 bg-sky-500/15 text-[10px] font-semibold text-center text-sky-200">
                    Mover operario a {slot.boxName}
                  </div>
                )}
              </div>

              {/* Mitad Superior: ADENTRO (65%) */}
              <div
                onDragOver={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (isCardOperarioBadgeDragEvent(e)) return;
                        if (canManageOperarios && isOperarioDragEvent(e)) {
                          if (slot.boxId) handleOperarioBoxDragOver(e, slot.boxId);
                          else {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                          return;
                        }
                        onTargetDragOver?.(e, targetAdentro);
                      }
                }
                onDragLeave={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (isCardOperarioBadgeDragEvent(e) || isOperarioDragEvent(e)) return;
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          if (
                            dragOverTarget?.col === 'INICIO' &&
                            dragOverTarget?.boxId === slot.boxId &&
                            dragOverTarget?.estado === 'adentro'
                          ) {
                            onClearDragOver?.(targetAdentro);
                          }
                        }
                      }
                }
                onDrop={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (isCardOperarioBadgeDragEvent(e)) return;
                        if (canManageOperarios && isOperarioDragEvent(e)) {
                          if (slot.boxId) handleOperarioBoxDrop(e, slot.boxId);
                          else {
                            e.preventDefault();
                            e.stopPropagation();
                            setDraggingOperario(null);
                            setDragOverOperarioBoxId(null);
                          }
                          return;
                        }
                        onTargetDrop?.(e, targetAdentro);
                      }
                }
                className={`flex-[65] min-h-0 flex flex-col px-2 py-1.5 transition-colors rounded-t-lg ${
                  isOverAdentro
                    ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/60'
                    : 'bg-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5 shrink-0">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400">
                    ADENTRO
                  </span>
                  <span className="font-numeric tabular-nums text-[10px] font-semibold text-zinc-400">
                    {slot.adentro.length}
                  </span>
                </div>

                {isOverAdentro && (
                  <div className="mb-2 px-2 py-1 rounded-lg ui-stroke-dashed-subtle border-emerald-400/50 bg-emerald-500/10 text-[10px] font-semibold text-center text-emerald-200 shrink-0">
                    Soltar en {slot.boxName} · Adentro
                  </div>
                )}

                <DragScrollContainer
                  vertical
                  edgePx={96}
                  maxSpeedPxPerSec={520}
                  topAllowancePx={32}
                  bottomAllowancePx={0}
                  className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5 no-scrollbar"
                >
                  {slot.adentro.length === 0 ? (
                    renderEmptyBoxOperarios(slot.operarios, 'min-h-[72px]')
                  ) : (
                    slot.adentro.map((item) => (
                      <TallerUnitCard
                        key={item.id}
                        item={item}
                        timelineSteps={
                          item.circuito_id ? circuitosTimelines?.[item.circuito_id] : undefined
                        }
                        compact
                        isBusy={Boolean(busyIds[item.id])}
                        canManageOperarios={canManageOperarios}
                        onRemoveOperario={onRemoveOperarioFromProceso}
                        onNoteAdded={onNoteAdded}
                        onUndoCard={readOnly ? undefined : onUndoCard}
                        onDragStart={readOnly ? noopDragStart : onDragStart ?? noopDragStart}
                        onDragEnd={readOnly ? noopDragEnd : onDragEnd ?? noopDragEnd}
                      />
                    ))
                  )}
                </DragScrollContainer>
              </div>

              {/* Línea Divisoria Horizontal en Amarillo Dashed 2px: ADENTRO / AFUERA */}
              <div className="ui-divider-dashed-t border-amber-400/70 shrink-0" />

              {/* Mitad Inferior: AFUERA (35%) */}
              <div
                onDragOver={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (isCardOperarioBadgeDragEvent(e)) return;
                        if (canManageOperarios && isOperarioDragEvent(e)) {
                          if (slot.boxId) handleOperarioBoxDragOver(e, slot.boxId);
                          else {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                          return;
                        }
                        onTargetDragOver?.(e, targetAfuera);
                      }
                }
                onDragLeave={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (isCardOperarioBadgeDragEvent(e) || isOperarioDragEvent(e)) return;
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          if (
                            dragOverTarget?.col === 'INICIO' &&
                            dragOverTarget?.boxId === slot.boxId &&
                            dragOverTarget?.estado === 'afuera'
                          ) {
                            onClearDragOver?.(targetAfuera);
                          }
                        }
                      }
                }
                onDrop={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (isCardOperarioBadgeDragEvent(e)) return;
                        if (canManageOperarios && isOperarioDragEvent(e)) {
                          if (slot.boxId) handleOperarioBoxDrop(e, slot.boxId);
                          else {
                            e.preventDefault();
                            e.stopPropagation();
                            setDraggingOperario(null);
                            setDragOverOperarioBoxId(null);
                          }
                          return;
                        }
                        onTargetDrop?.(e, targetAfuera);
                      }
                }
                className={`flex-[35] min-h-0 flex flex-col px-2 py-1.5 transition-colors rounded-b-lg ${
                  isOverAfuera
                    ? 'bg-amber-500/10 ring-1 ring-inset ring-amber-400/60'
                    : 'bg-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5 shrink-0">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400">
                    AFUERA
                  </span>
                  <span className="font-numeric tabular-nums text-[10px] font-semibold text-zinc-400">
                    {slot.afuera.length}
                  </span>
                </div>

                {isOverAfuera && (
                  <div className="mb-2 px-2 py-1 rounded-lg ui-stroke-dashed-subtle border-amber-400/50 bg-amber-500/10 text-[10px] font-semibold text-center text-amber-200 shrink-0">
                    Soltar en {slot.boxName} · Afuera
                  </div>
                )}

                <DragScrollContainer
                  vertical
                  edgePx={72}
                  maxSpeedPxPerSec={480}
                  topAllowancePx={26}
                  bottomAllowancePx={14}
                  className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5 no-scrollbar"
                >
                  {slot.afuera.length === 0 ? (
                    renderEmptyBoxOperarios(slot.operarios, 'min-h-[56px]')
                  ) : (
                    slot.afuera.map((item) => (
                      <TallerUnitCard
                        key={item.id}
                        item={item}
                        timelineSteps={
                          item.circuito_id ? circuitosTimelines?.[item.circuito_id] : undefined
                        }
                        compact
                        isBusy={Boolean(busyIds[item.id])}
                        canManageOperarios={canManageOperarios}
                        onRemoveOperario={onRemoveOperarioFromProceso}
                        onNoteAdded={onNoteAdded}
                        onUndoCard={readOnly ? undefined : onUndoCard}
                        onDragStart={readOnly ? noopDragStart : onDragStart ?? noopDragStart}
                        onDragEnd={readOnly ? noopDragEnd : onDragEnd ?? noopDragEnd}
                      />
                    ))
                  )}
                </DragScrollContainer>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selector rápido de Box por clic para j1 (encargado_zona) */}
      {canManageOperarios && openOperarioMenu && (
        <div
          ref={menuRef}
          style={{ top: openOperarioMenu.top, left: openOperarioMenu.left }}
          className="fixed z-50 w-[212px] rounded-xl border border-[#2A354A] bg-[#0F1521] shadow-2xl p-1.5"
        >
          <div className="px-2 py-1 border-b border-[#1E2738] mb-1">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 truncate">
              Mover a box · {openOperarioMenu.operario.nombre_usuario}
            </p>
          </div>

          <div className="max-h-[190px] overflow-y-auto space-y-0.5 no-scrollbar">
            {menuBoxSlots.map((b) => {
              const isCurrent = openOperarioMenu.sourceBoxId === b.boxId;
              return (
                <button
                  key={b.boxId}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => {
                    const opId = openOperarioMenu.operario.id;
                    setOpenOperarioMenu(null);
                    if (!isCurrent) {
                      onMoveOperarioToBox?.(opId, b.boxId);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                    isCurrent
                      ? 'bg-sky-500/15 text-sky-200 cursor-default'
                      : 'text-zinc-200 hover:bg-[#192234]'
                  }`}
                >
                  <span className="truncate">{b.boxName}</span>
                  {isCurrent && <Check size={12} className="shrink-0 text-sky-300" />}
                </button>
              );
            })}

            {openOperarioMenu.sourceBoxId !== null && (
              <button
                type="button"
                onClick={() => {
                  const opId = openOperarioMenu.operario.id;
                  setOpenOperarioMenu(null);
                  onMoveOperarioToBox?.(opId, null);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 mt-1 border-t border-[#1E2738] rounded-b-lg text-xs font-mono text-amber-300 hover:bg-amber-500/10 transition-colors"
              >
                <span>Quitar box (Sin box)</span>
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
