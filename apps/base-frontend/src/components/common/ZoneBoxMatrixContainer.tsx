import React from 'react';
import { User } from 'lucide-react';
import { useDragAutoScroll } from '../../hooks/useDragAutoScroll';
import { DragScrollContainer } from './DragScrollContainer';
import {
  TallerUnitCard,
  type TallerCardItem,
  type TallerColumnId,
} from '../taller/TallerUnitCard';
import type { EstadoBox, ProcesoNota, TallerBoxOperario } from '../../types/planeacion';

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
}

export const ZoneBoxMatrixContainer: React.FC<ZoneBoxMatrixContainerProps> = ({
  zoneLabel,
  totalCount,
  slots,
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
}) => {
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

  const renderEmptyBoxOperarios = (
    operarios: TallerBoxOperario[] | undefined,
    minHeightClass: string
  ) => {
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

  return (
    <section
      onDragOver={
        readOnly
          ? undefined
          : (e) => {
              onTargetDragOver?.(e, sectionFallbackTarget);
            }
      }
      onDragLeave={
        readOnly
          ? undefined
          : (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
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
              onTargetDrop?.(e, sectionFallbackTarget);
            }
      }
      className={`h-full min-h-[280px] md:min-h-0 min-w-0 rounded-2xl border-2 border-dashed p-3.5 flex flex-col transition-colors ${colSpanClass} ${
        isOverSection ? borderOver : borderIdle
      }`}
    >
      {/* Header de Contenedor: Label Relacional de la Zona */}
      <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-[#1A2232] shrink-0">
        <h2 className="font-helvetica font-bold text-sm tracking-wide text-white uppercase truncate">
          {zoneLabel}
        </h2>

        <span
          className={`font-numeric tabular-nums text-xs font-semibold shrink-0 ${countClass}`}
        >
          {totalCount}
        </span>
      </div>

      {/* Matriz Relacional de Boxes Contenidos en la Zona (Dividers amarillos: Box | Box y ADENTRO / AFUERA) */}
      <div
        ref={setMatrixScrollRef}
        onWheel={handleMatrixWheel}
        className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden divide-x divide-amber-400/70 no-scrollbar"
      >
        {slots.map((slot) => {
          const targetAdentro = resolveTarget(slot.boxId, 'adentro');
          const targetAfuera = resolveTarget(slot.boxId, 'afuera');

          const isOverAdentro =
            !readOnly &&
            isDragging &&
            dragOverTarget?.col === 'INICIO' &&
            dragOverTarget?.boxId === slot.boxId &&
            dragOverTarget?.estado === 'adentro' &&
            Boolean(canDropOnTarget?.(dragOverTarget));

          const isOverAfuera =
            !readOnly &&
            isDragging &&
            dragOverTarget?.col === 'INICIO' &&
            dragOverTarget?.boxId === slot.boxId &&
            dragOverTarget?.estado === 'afuera' &&
            Boolean(canDropOnTarget?.(dragOverTarget));

          return (
            <div
              key={slot.boxId ?? `sin-box-${slot.boxName}`}
              className="flex-1 min-w-[195px] h-full min-h-0 flex flex-col"
            >
              {/* Encabezado de Box (sin contador verde duplicado; se conservan contadores ADENTRO y AFUERA) */}
              <div className="px-2.5 pb-2 flex items-center justify-center shrink-0">
                <h3 className="font-numeric font-bold text-lg tracking-wide text-white tabular-nums truncate">
                  {slot.boxName}
                </h3>
              </div>

              {/* Mitad Superior: ADENTRO (65%) */}
              <div
                onDragOver={
                  readOnly ? undefined : (e) => onTargetDragOver?.(e, targetAdentro)
                }
                onDragLeave={
                  readOnly
                    ? undefined
                    : (e) => {
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
                  readOnly ? undefined : (e) => onTargetDrop?.(e, targetAdentro)
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
                  <div className="mb-2 px-2 py-1 rounded-lg border border-dashed border-emerald-400/50 bg-emerald-500/10 text-[10px] font-semibold text-center text-emerald-200 shrink-0">
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
                        compact
                        isBusy={Boolean(busyIds[item.id])}
                        onNoteAdded={onNoteAdded}
                        onUndoCard={readOnly ? undefined : onUndoCard}
                        onDragStart={readOnly ? noopDragStart : onDragStart ?? noopDragStart}
                        onDragEnd={readOnly ? noopDragEnd : onDragEnd ?? noopDragEnd}
                      />
                    ))
                  )}
                </DragScrollContainer>
              </div>

              {/* Línea Divisoria Horizontal en Amarillo: ADENTRO / AFUERA */}
              <div className="border-t border-amber-400/70 shrink-0" />

              {/* Mitad Inferior: AFUERA (35%) */}
              <div
                onDragOver={
                  readOnly ? undefined : (e) => onTargetDragOver?.(e, targetAfuera)
                }
                onDragLeave={
                  readOnly
                    ? undefined
                    : (e) => {
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
                  readOnly ? undefined : (e) => onTargetDrop?.(e, targetAfuera)
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
                  <div className="mb-2 px-2 py-1 rounded-lg border border-dashed border-amber-400/50 bg-amber-500/10 text-[10px] font-semibold text-center text-amber-200 shrink-0">
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
                        compact
                        isBusy={Boolean(busyIds[item.id])}
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
    </section>
  );
};
