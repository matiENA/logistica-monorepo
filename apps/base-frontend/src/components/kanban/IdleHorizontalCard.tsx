import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, GripVertical, Loader2, MapPin, Pin, User } from 'lucide-react';
import { toast } from 'sonner';
import type { IdleDockItem, IdleHierarchyTier, ProcesoNota } from '../../types/planeacion';
import { agregarNotaProceso, fetchProcesoNotas } from '../../services/planeacionApi';
import { UnitLicensePlate } from '../common/UnitLicensePlate';
import {
  IDLE_CARD_STATE_SPEC,
  IDLE_SMOOTH_EASE,
  resolveIdleCardState,
  type IdleDockState,
} from './idleDockStates';

interface IdleHorizontalCardProps {
  item: IdleDockItem;
  dockState: IdleDockState;
  isHiddenForFlight?: boolean;
  isJustLanded?: boolean;
  registerCardRef?: (item: IdleDockItem, el: HTMLDivElement | null) => void;
  onPinChange?: (cardKey: string, isPinned: boolean) => void;
  onNoteAdded?: (sync?: { procesoId: string; circuitoId?: string; notes: ProcesoNota[] }) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

const TIER_META: Record<
  IdleHierarchyTier,
  {
    label: string;
    badgeTextClass: string;
  }
> = {
  SIN_ASIGNACION: {
    label: 'SIN ASIGNACIÓN',
    badgeTextClass: 'text-emerald-800',
  },
  TERMINADO: {
    label: 'FINALIZÓ',
    badgeTextClass: 'text-zinc-800',
  },
  ESPERANDO_BOX: {
    label: 'ESPERANDO BOX',
    badgeTextClass: 'text-blue-800',
  },
  PREASIGNADO: {
    label: 'PREASIGNADO',
    badgeTextClass: 'text-amber-800',
  },
};

function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) {
    return d.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const IdleHorizontalCard: React.FC<IdleHorizontalCardProps> = ({
  item,
  dockState,
  isHiddenForFlight = false,
  isJustLanded = false,
  registerCardRef,
  onPinChange,
  onNoteAdded,
  onDragStateChange,
}) => {
  const [isPinned, setIsPinned] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fetchedNotes, setFetchedNotes] = useState<ProcesoNota[] | null>(null);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  const isDraggingRef = useRef(false);
  const isPinnedRef = useRef(false);
  const notesListRef = useRef<HTMLDivElement | null>(null);
  const onPinChangeRef = useRef(onPinChange);
  onPinChangeRef.current = onPinChange;
  const onDragStateChangeRef = useRef(onDragStateChange);
  onDragStateChangeRef.current = onDragStateChange;

  const tierMeta = TIER_META[item.tier];
  const isUnfinalizedPreasignado =
    item.tier === 'PREASIGNADO' && Boolean(item.en_proceso_activo);

  const cardState = resolveIdleCardState({ dockState, isCardPinned: isPinned });
  const stateSpec = IDLE_CARD_STATE_SPEC[cardState];
  const { slots, dataDependencies } = stateSpec;

  useEffect(() => {
    return () => {
      if (isPinnedRef.current) {
        onPinChangeRef.current?.(item.key, false);
      }
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        onDragStateChangeRef.current?.(false);
      }
    };
  }, [item.key]);

  const totalNotesCount = Math.max(item.notes_count ?? 0, item.notes?.length ?? 0);
  const effectiveNotes = fetchedNotes ?? item.notes ?? [];
  const latestNote =
    item.notes && item.notes.length > 0 ? item.notes[item.notes.length - 1] : null;
  const latestNoteSig = `${latestNote?.id || ''}|${latestNote?.edited_at || ''}|${latestNote?.texto || ''}|${totalNotesCount}|${item.notes?.length ?? 0}`;

  // C2 On-Demand al fijar la card (regido por stateSpec.dataDependencies.fetchFullNotesOnDemand)
  useEffect(() => {
    if (!dataDependencies.fetchFullNotesOnDemand) {
      setFetchedNotes(null);
      return;
    }
    const localCount = item.notes?.length ?? 0;
    if (totalNotesCount === 0 || localCount >= totalNotesCount || item.is_temp) {
      setFetchedNotes(null);
      return;
    }

    let cancelled = false;
    setIsLoadingNotes(true);
    fetchProcesoNotas(item.targetId)
      .then((all) => {
        if (!cancelled) setFetchedNotes(all);
      })
      .catch(() => {
        // Fallback silencioso
      })
      .finally(() => {
        if (!cancelled) setIsLoadingNotes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    dataDependencies.fetchFullNotesOnDemand,
    item.targetId,
    item.is_temp,
    latestNoteSig,
    totalNotesCount,
  ]);

  const lastEffectiveNoteId =
    effectiveNotes.length > 0 ? effectiveNotes[effectiveNotes.length - 1]?.id : null;
  useEffect(() => {
    if (isPinned && notesListRef.current) {
      notesListRef.current.scrollTop = notesListRef.current.scrollHeight;
    }
  }, [isPinned, effectiveNotes.length, lastEffectiveNoteId]);

  const togglePin = () => {
    if (isDraggingRef.current || isHiddenForFlight) return;
    const next = !isPinned;
    isPinnedRef.current = next;
    setIsPinned(next);
    onPinChangeRef.current?.(item.key, next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePin();
    }
  };

  const handleDragStartInternal = (e: React.DragEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsDragging(true);
    onDragStateChange?.(true);

    const plateLabel = item.tractor_plate || item.semi_plate || item.n_ute || 'Unidad';
    const payloadObj =
      item.tier === 'SIN_ASIGNACION'
        ? {
            type: 'CARD_CIRCUITO',
            circuitoId: item.circuito_id || item.targetId,
            unidadId: item.unidad_id,
            tractorId: item.tractor_id,
            semiId: item.semi_id,
            plate: plateLabel,
            fromIdleDock: true,
          }
        : item.tier === 'PREASIGNADO'
        ? {
            type: 'CARD_HOLD',
            holdId: item.hold_id || item.targetId,
            circuitoId: item.circuito_id,
            holdsCount: item.holds_count ?? 1,
            unidadId: item.unidad_id,
            tractorId: item.tractor_id,
            semiId: item.semi_id,
            plate: plateLabel,
            zoneId: item.zone_id,
            boxId: item.box_id || null,
            fromIdleDock: true,
          }
        : {
            type: 'CARD_PROCESO',
            procesoId: item.proceso_id || item.targetId,
            circuitoId: item.circuito_id,
            unidadId: item.unidad_id,
            tractorId: item.tractor_id,
            semiId: item.semi_id,
            plate: plateLabel,
            boxId: item.box_id || '',
            boxName: item.box_name || '',
            zoneId: item.zone_id || '',
            zoneName: item.zone_name || '',
            salidaAt: item.tier === 'TERMINADO' ? item.timestamp : null,
            inicioAt: null,
            llegadaAt: item.timestamp,
            fromIdleDock: true,
          };

    (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = payloadObj;
    const jsonStr = JSON.stringify(payloadObj);
    try {
      e.dataTransfer.setData('application/json', jsonStr);
      e.dataTransfer.setData('text/plain', jsonStr);
      e.dataTransfer.effectAllowed = 'move';
    } catch {
      // ignore dataTransfer restrictions
    }
  };

  const handleDragEndInternal = () => {
    (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = null;
    setIsDragging(false);
    onDragStateChange?.(false);
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 60);
  };

  const handleKeyDownNote = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = noteText.trim();
      if (!trimmed || isSubmitting || item.is_temp) return;

      setIsSubmitting(true);
      try {
        const res = await agregarNotaProceso(item.targetId, {
          texto: trimmed,
          usuarioId: null,
          location: 'Coordinación',
        });
        setNoteText('');
        toast.success('Nota registrada');
        if (res?.result?.notes) {
          if (isPinned) setFetchedNotes(res.result.notes);
          onNoteAdded?.({
            procesoId: item.targetId,
            circuitoId: res.result.circuitoId || item.circuito_id,
            notes: res.result.notes,
          });
        } else {
          onNoteAdded?.();
          if (isPinned) {
            const updated = await fetchProcesoNotas(item.targetId).catch(() => null);
            if (updated) setFetchedNotes(updated);
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error registrando nota');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const previewNote = latestNote?.texto || item.ultima_tarea || null;
  const isCoordNote =
    !latestNote?.usuario_id ||
    latestNote?.location === 'Coordinación' ||
    latestNote?.usuario === 'Coordinación' ||
    latestNote?.usuario === 'coordinacion';
  const previewLocation = isCoordNote
    ? 'Coordinación'
    : latestNote?.location || item.salida_origen_box || item.box_name || 'Box';
  const previewAuthor = isCoordNote
    ? null
    : latestNote?.usuario || item.ultima_tarea_usuario || null;
  const previewTimestamp = latestNote?.timestamp || item.ultima_tarea_at || null;

  const displayZone =
    item.tier === 'SIN_ASIGNACION'
      ? 'Sin asignar'
      : item.tier === 'PREASIGNADO' && item.preasignado_zones && item.preasignado_zones.length > 1
      ? `${item.preasignado_zones[0]} (+${item.preasignado_zones.length - 1})`
      : item.zone_name || 'Sin Zona';

  const displayBox =
    item.tier === 'SIN_ASIGNACION'
      ? 'En circuito'
      : item.tier === 'PREASIGNADO'
      ? item.ubicacion_actual_box || item.salida_origen_box || item.box_name || 'Sin Box'
      : item.box_name || 'Sin Box';

  const renderPlates = () => (
    <div className="flex flex-col items-center justify-center gap-[3px] shrink-0">
      {(item.tractor_plate || !item.semi_plate) && item.tractor_plate && (
        <UnitLicensePlate plate={item.tractor_plate} label="Tractor" size={stateSpec.plateSize} />
      )}
      {item.semi_plate && (
        <UnitLicensePlate plate={item.semi_plate} label="Semi" size={stateSpec.plateSize} />
      )}
      {!item.tractor_plate && !item.semi_plate && (
        <span className="font-mono text-xs font-bold text-zinc-900">
          UTE {item.n_ute || 'S/N'}
        </span>
      )}
    </div>
  );

  const renderAllComments = () => {
    if (isLoadingNotes && effectiveNotes.length <= 1) {
      return (
        <div className="flex items-center gap-1.5 py-2 text-[11px] text-zinc-600">
          <Loader2 size={13} strokeWidth={2} className="animate-spin shrink-0" />
          <span>Cargando notas...</span>
        </div>
      );
    }
    if (effectiveNotes.length === 0) {
      return (
        <p className="text-[11px] italic py-1 text-zinc-500">Sin notas registradas</p>
      );
    }
    return (
      <div
        ref={notesListRef}
        className="max-h-[104px] overflow-y-auto space-y-2 pr-0.5 pt-1 border-t border-zinc-300/80 no-scrollbar"
      >
        {effectiveNotes.map((note, idx) => {
          const isCoord =
            !note.usuario_id ||
            note.location === 'Coordinación' ||
            note.usuario === 'Coordinación' ||
            note.usuario === 'coordinacion';
          const noteLoc = isCoord
            ? 'Coordinación'
            : note.location || item.salida_origen_box || item.box_name || 'Box';
          const noteAuthor = isCoord ? null : note.usuario || null;
          return (
            <div key={note.id || `${note.timestamp}-${idx}`} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 leading-tight">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] font-bold tracking-wide shrink-0 text-[#B45309]">
                    {noteLoc}
                  </span>
                  {noteAuthor && (
                    <span className="inline-flex items-center gap-1 font-roboto text-[10.5px] font-semibold text-zinc-700 truncate">
                      <User
                        size={11}
                        strokeWidth={2}
                        aria-hidden="true"
                        focusable="false"
                        className="text-zinc-600 shrink-0"
                      />
                      <span className="truncate">{noteAuthor}</span>
                    </span>
                  )}
                </div>
                {note.timestamp && (
                  <span className="font-numeric text-[10px] font-medium tabular-nums shrink-0 text-right text-zinc-600">
                    {formatDateTimeShort(note.timestamp)}
                  </span>
                )}
              </div>
              <p className="font-notes text-[11.5px] font-medium leading-snug text-zinc-800 whitespace-pre-wrap">
                {note.texto}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={(el) => registerCardRef?.(item, el)}
      data-drag-card="true"
      data-card-state={cardState}
      role="button"
      tabIndex={0}
      aria-expanded={isPinned}
      aria-pressed={isPinned}
      aria-label={`Idle ${tierMeta.label}: ${item.tractor_plate || ''} ${item.semi_plate || ''}. Arrastrar a una zona o clic para ${isPinned ? 'desfijar' : 'fijar y ver notas'}.`}
      draggable={!isHiddenForFlight}
      onClick={togglePin}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStartInternal}
      onDragEnd={handleDragEndInternal}
      className={`shrink-0 rounded-lg border flex flex-col justify-between overflow-hidden transition-[width,height,padding,border-color,background-color,box-shadow,opacity,transform] ${IDLE_SMOOTH_EASE} select-none outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:ring-offset-[#EDEDED] ${stateSpec.sizeClass} ${
        isUnfinalizedPreasignado ? stateSpec.surfacePreasignadoClass : stateSpec.surfaceStandardClass
      } ${
        isJustLanded ? 'ring-2 ring-emerald-600/60 shadow-md' : ''
      } ${isHiddenForFlight ? 'opacity-0 pointer-events-none' : ''} ${
        isDragging ? 'opacity-40 scale-[0.98]' : 'cursor-pointer'
      }`}
    >
      <div className="flex flex-col w-full min-h-0 flex-1 gap-1.5">
        {/* Header: Patentes (Zoom-Out: SOLO patentes) | Hover/Pinned: Grip + Info */}
        <div
          className={`flex items-center min-w-0 w-full shrink-0 transition-[gap] ${IDLE_SMOOTH_EASE} ${stateSpec.headerLayoutClass}`}
        >
          <div
            className={`flex items-center shrink-0 transition-[gap] ${IDLE_SMOOTH_EASE} ${stateSpec.platesGroupGapClass}`}
          >
            <span
              aria-hidden="true"
              className={`inline-flex items-center overflow-hidden transition-[width,opacity] ${IDLE_SMOOTH_EASE} shrink-0 ${
                slots.showGrip ? 'w-3.5 opacity-100' : 'w-0 opacity-0'
              }`}
            >
              <GripVertical
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                focusable="false"
                className="text-zinc-500 shrink-0 cursor-grab active:cursor-grabbing"
              />
            </span>
            {renderPlates()}
          </div>

          {/* Bloque Hover lateral (Jerarquía + Ubicación + Timestamp) */}
          <div
            aria-hidden={!slots.showHoverMetadata}
            className={`flex flex-col justify-center min-w-0 self-stretch border-l border-zinc-200 transition-[max-width,opacity,padding] ${IDLE_SMOOTH_EASE} overflow-hidden ${
              slots.showHoverMetadata
                ? 'flex-1 max-w-[178px] opacity-100 pl-2'
                : 'max-w-0 opacity-0 pl-0 border-l-0 pointer-events-none'
            }`}
          >
            <div className="flex items-center justify-between gap-1 w-full">
              <span
                className={`text-[9.5px] font-mono font-extrabold uppercase tracking-wider truncate ${tierMeta.badgeTextClass}`}
              >
                {tierMeta.label}
              </span>
              {item.timestamp && (
                <span className="text-[10px] font-numeric font-bold text-zinc-700 tabular-nums shrink-0">
                  {formatDateTimeShort(item.timestamp)}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-0.5 mt-1">
              <div className="flex items-center gap-1 text-[11.5px] leading-tight">
                <MapPin
                  size={10}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="text-zinc-600 shrink-0"
                />
                <span className="font-extrabold text-zinc-950 truncate" title={displayZone}>
                  {displayZone}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] leading-tight pl-3.5">
                <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase">BOX:</span>
                <span className="font-bold font-mono text-zinc-800 truncate" title={displayBox}>
                  {displayBox}
                </span>
              </div>
            </div>
          </div>

          {/* Bloque Pinned header right (Timestamp + Pin) */}
          <div
            aria-hidden={!slots.showPinnedHeaderMeta}
            className={`flex items-center gap-1.5 shrink-0 transition-[max-width,opacity] ${IDLE_SMOOTH_EASE} overflow-hidden ${
              slots.showPinnedHeaderMeta ? 'max-w-[110px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'
            }`}
          >
            {item.timestamp && (
              <span className="text-[10.5px] font-numeric tabular-nums text-zinc-700 font-bold">
                {formatDateTimeShort(item.timestamp)}
              </span>
            )}
            <span
              title="Card fijada · Clic para desfijar"
              className="inline-flex items-center text-zinc-700 shrink-0"
            >
              <Pin size={12} strokeWidth={2} aria-hidden="true" focusable="false" className="rotate-45" />
            </span>
          </div>
        </div>

        {/* Panel Hover inferior: Preview de última nota */}
        <div
          aria-hidden={!slots.showHoverNotePreview}
          className={`grid transition-[grid-template-rows,opacity] ${IDLE_SMOOTH_EASE} ${
            slots.showHoverNotePreview ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            {previewNote && (
              <div className="mt-0.5 pl-5 space-y-0.5">
                <div className="flex items-center justify-between gap-2 leading-tight">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10.5px] font-bold text-[#B45309] tracking-wide shrink-0">
                      {previewLocation}
                    </span>
                    {previewAuthor && (
                      <span className="inline-flex items-center gap-1 font-roboto text-[10px] font-semibold text-zinc-700 truncate">
                        <User
                          size={10}
                          strokeWidth={2}
                          aria-hidden="true"
                          focusable="false"
                          className="text-zinc-600 shrink-0"
                        />
                        <span className="truncate">{previewAuthor}</span>
                      </span>
                    )}
                  </div>
                  {previewTimestamp && (
                    <span className="font-numeric font-medium text-zinc-600 text-[9.5px] tabular-nums shrink-0">
                      {formatDateTimeShort(previewTimestamp)}
                    </span>
                  )}
                </div>
                <p className="font-notes text-[11.5px] font-medium leading-snug text-zinc-800 line-clamp-2">
                  {previewNote}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Panel Pinned: Jerarquía + Ubicación + Cola completa de notas */}
        <div
          aria-hidden={!slots.showPinnedBody}
          className={`grid transition-[grid-template-rows,opacity] ${IDLE_SMOOTH_EASE} min-h-0 ${
            slots.showPinnedBody ? 'grid-rows-[1fr] opacity-100 flex-1' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden min-h-0 flex flex-col gap-1.5">
            <div className="pl-5 flex items-center gap-1.5 text-[11.5px] leading-tight flex-wrap shrink-0">
              <span className={`text-[9.5px] font-mono font-extrabold uppercase ${tierMeta.badgeTextClass}`}>
                {tierMeta.label}
              </span>
              <span className="text-zinc-400">·</span>
              <MapPin size={10} strokeWidth={2} aria-hidden="true" className="text-zinc-600 shrink-0" />
              <span className="font-extrabold text-zinc-950">{displayZone}</span>
              <span className="text-zinc-400">|</span>
              <span className="font-bold text-zinc-800 font-mono">{displayBox}</span>
            </div>

            <div className="pl-5 flex-1 min-h-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {renderAllComments()}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Hover */}
      <div
        aria-hidden={!slots.showHoverFooterHint}
        className={`grid transition-[grid-template-rows,opacity] ${IDLE_SMOOTH_EASE} shrink-0 ${
          slots.showHoverFooterHint ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="pl-5 pt-1 flex items-center justify-between text-[10px] font-medium text-zinc-600 border-t border-zinc-200/80">
            <span>Clic para fijar y ver notas</span>
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Footer Pinned: Input + Nota... */}
      <div
        aria-hidden={!slots.showPinnedNoteInput}
        className={`grid transition-[grid-template-rows,opacity] ${IDLE_SMOOTH_EASE} shrink-0 ${
          slots.showPinnedNoteInput ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-hidden min-h-0 pl-5 pt-1">
          <input
            type="text"
            tabIndex={dataDependencies.allowNoteInputFocus ? 0 : -1}
            draggable={false}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            value={noteText}
            disabled={isSubmitting || item.is_temp}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={handleKeyDownNote}
            placeholder="+ Nota..."
            aria-label={`Ingresar nota para unidad ${item.tractor_plate || item.semi_plate || 'seleccionada'}`}
            className="w-full bg-transparent border-0 border-b border-zinc-300 hover:border-zinc-500 focus:border-zinc-950 text-[11px] text-zinc-900 placeholder:text-zinc-500 placeholder:italic placeholder:text-[10px] pb-0.5 outline-none transition-colors disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
};
