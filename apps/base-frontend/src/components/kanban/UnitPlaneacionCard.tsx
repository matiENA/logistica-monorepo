import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Pin, User, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PlaneacionCard, ProcesoNota } from '../../types/planeacion';
import { agregarNotaProceso, fetchProcesoNotas } from '../../services/planeacionApi';
import { UnitLicensePlate } from '../common/UnitLicensePlate';

export interface UnitPlaneacionCardProps {
  card: PlaneacionCard;
  onPinChange?: (cardId: string, isPinned: boolean) => void;
  onNoteAdded?: (sync?: { procesoId: string; circuitoId?: string; notes: ProcesoNota[] }) => void;
  onUndoCard?: (card: PlaneacionCard) => void;
  /** Slot extensible para inyectar métricas/badges adicionales sin romper el layout base */
  extraRightSlot?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

const SMOOTH_EASE = 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';

type ZoneCardState = 'reposo' | 'hover' | 'pinned';

interface ZoneCardStateSpec {
  showPreviewNote: boolean;
  showPinnedComments: boolean;
  showNoteInput: boolean;
  showUndoButton: boolean;
  fetchFullNotesOnDemand: boolean;
}

const ZONE_CARD_STATE_SPEC: Record<ZoneCardState, ZoneCardStateSpec> = {
  reposo: {
    showPreviewNote: false,
    showPinnedComments: false,
    showNoteInput: false,
    showUndoButton: false,
    fetchFullNotesOnDemand: false,
  },
  hover: {
    showPreviewNote: true,
    showPinnedComments: false,
    showNoteInput: true,
    showUndoButton: true,
    fetchFullNotesOnDemand: false,
  },
  pinned: {
    showPreviewNote: false,
    showPinnedComments: true,
    showNoteInput: true,
    showUndoButton: true,
    fetchFullNotesOnDemand: true,
  },
};

function resolveZoneCardState(deps: {
  isPinned: boolean;
  isHovered: boolean;
  isInputFocused: boolean;
}): ZoneCardState {
  if (deps.isPinned) return 'pinned';
  if (deps.isHovered || deps.isInputFocused) return 'hover';
  return 'reposo';
}

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

/**
 * Card progresiva en 3 estados para /coordinacion (sección zonas):
 * - Estado 1 (Reposo): Patentes + Ubicación/Última + Timestamp + Zona/Box (sin preview de comentarios).
 * - Estado 2 (Hover / Focus en input): Transición suave de altura que revela el último comentario (si existe) y el input `+ Nota...`.
 * - Estado 3 (onClick · Fijada): Fill gris suave (#F1F2F4; amarillo #FDE68A mantenido en PREASIGNADO activo),
 *   indicador flat icon Pin top-right, cola completa de notas inline (C2 On-Demand si notes_count > 1) e input `+ Nota...`.
 */
export const UnitPlaneacionCard: React.FC<UnitPlaneacionCardProps> = ({
  card,
  onPinChange,
  onNoteAdded,
  onUndoCard,
  extraRightSlot,
  draggable = true,
  onDragStart,
}) => {
  const [noteText, setNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [fetchedNotes, setFetchedNotes] = useState<ProcesoNota[] | null>(null);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  const cardState = resolveZoneCardState({ isPinned, isHovered, isInputFocused });
  const stateSpec = ZONE_CARD_STATE_SPEC[cardState];

  const isDraggingRef = useRef(false);
  const isPinnedRef = useRef(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesListRef = useRef<HTMLDivElement | null>(null);
  const onPinChangeRef = useRef(onPinChange);
  onPinChangeRef.current = onPinChange;

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
      }
      if (isPinnedRef.current) {
        onPinChangeRef.current?.(card.proceso_id, false);
      }
    };
  }, [card.proceso_id]);

  const targetId = card.hold_id || card.proceso_id;
  const isPreasignadoHold = Boolean(card.hold_id || card.etapa_ciclo === 'PLANIFICADO_HOLD');
  const isUnfinalizedPreasignado = isPreasignadoHold && Boolean(card.en_proceso_activo);

  const lastZone = isPreasignadoHold
    ? card.ubicacion_actual_zone || card.salida_origen_zone || ''
    : '';
  const lastBox = isPreasignadoHold
    ? card.ubicacion_actual_box ||
      card.salida_origen_box ||
      (card.box_name && card.box_name !== 'Sin Box' ? card.box_name : '')
    : card.box_name || '';

  const totalNotesCount = Math.max(card.notes_count ?? 0, card.notes?.length ?? 0);
  const latestProcessNote =
    card.notes && card.notes.length > 0 ? card.notes[card.notes.length - 1] : null;
  const effectiveNotes = fetchedNotes ?? card.notes ?? [];
  const latestNoteSig = `${latestProcessNote?.id || ''}|${latestProcessNote?.edited_at || ''}|${latestProcessNote?.texto || ''}|${totalNotesCount}|${card.notes?.length ?? 0}`;

  // C2 On-Demand reactivo: al fijar (Estado 3) o mutar notas, cargar la cola completa si no vino entera en G1.
  useEffect(() => {
    if (!stateSpec.fetchFullNotesOnDemand) {
      setFetchedNotes(null);
      return;
    }
    const localCount = card.notes?.length ?? 0;
    if (totalNotesCount === 0 || localCount >= totalNotesCount) {
      setFetchedNotes(null);
      return;
    }

    let cancelled = false;
    setIsLoadingNotes(true);
    fetchProcesoNotas(targetId)
      .then((all) => {
        if (!cancelled) setFetchedNotes(all);
      })
      .catch(() => {
        // Fallback silencioso a las notas locales
      })
      .finally(() => {
        if (!cancelled) setIsLoadingNotes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stateSpec.fetchFullNotesOnDemand, targetId, latestNoteSig, totalNotesCount]);

  // Auto-scroll a la última nota cuando la card está fijada o se agrega una nota nueva
  const lastEffectiveNoteId =
    effectiveNotes.length > 0 ? effectiveNotes[effectiveNotes.length - 1]?.id : null;
  useEffect(() => {
    if (isPinned && notesListRef.current) {
      notesListRef.current.scrollTop = notesListRef.current.scrollHeight;
    }
  }, [isPinned, effectiveNotes.length, lastEffectiveNoteId]);

  const previewNote = latestProcessNote?.texto || card.ultima_tarea || null;

  const isCoordNote =
    !latestProcessNote?.usuario_id ||
    latestProcessNote?.location === 'Coordinación' ||
    latestProcessNote?.usuario === 'Coordinación' ||
    latestProcessNote?.usuario === 'coordinacion';

  const previewLocation = isCoordNote
    ? 'Coordinación'
    : (latestProcessNote?.location || card.salida_origen_box || card.box_name || 'Box');

  const previewAuthor = isCoordNote
    ? null
    : (latestProcessNote?.usuario || card.ultima_tarea_usuario || null);

  const previewTimestamp =
    latestProcessNote?.timestamp || card.ultima_tarea_at || null;

  const togglePin = () => {
    if (isDraggingRef.current) return;
    const next = !isPinned;
    isPinnedRef.current = next;
    setIsPinned(next);
    onPinChangeRef.current?.(card.proceso_id, next);
  };

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 90);
  };

  const handleKeyDownNote = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = noteText.trim();
      if (!trimmed || isSubmitting) return;

      setIsSubmitting(true);
      try {
        const res = await agregarNotaProceso(targetId, {
          texto: trimmed,
          usuarioId: null,
          location: 'Coordinación',
        });
        setNoteText('');
        toast.success('Nota registrada');
        if (res?.result?.notes) {
          if (isPinned) setFetchedNotes(res.result.notes);
          onNoteAdded?.({
            procesoId: targetId,
            circuitoId: res.result.circuitoId || card.circuito_id,
            notes: res.result.notes,
          });
        } else {
          onNoteAdded?.();
          if (isPinned) {
            const updated = await fetchProcesoNotas(targetId).catch(() => null);
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

  const handleDefaultDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    const payloadObj =
      card.etapa_ciclo === 'PLANIFICADO_HOLD' || card.hold_id || !card.llegada_at
        ? {
            type: 'CARD_HOLD',
            holdId: card.hold_id || card.proceso_id,
            unidadId: card.unidad_id,
            tractorId: card.tractor_id,
            semiId: card.semi_id,
            plate: card.tractor_plate || card.semi_plate || card.n_ute || 'Unidad',
            zoneId: card.zone_id,
            boxId: card.box_id || null,
          }
        : {
            type: 'CARD_PROCESO',
            procesoId: card.proceso_id,
            unidadId: card.unidad_id,
            tractorId: card.tractor_id,
            semiId: card.semi_id,
            plate: card.tractor_plate || card.semi_plate || card.n_ute || 'Unidad',
            boxId: card.box_id,
            boxName: card.box_name,
            zoneId: card.zone_id,
            zoneName: card.zone_name,
            salidaAt: card.salida_at,
            inicioAt: card.inicio_at,
            llegadaAt: card.llegada_at,
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
    setIsDragging(true);
    onDragStart?.(e);
  };

  const handleDragEndInternal = () => {
    (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = null;
    setIsDragging(false);
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 60);
  };

  const showNoteInput = stateSpec.showNoteInput;
  const showPreviewNote = stateSpec.showPreviewNote && Boolean(previewNote);
  const showPinnedComments = stateSpec.showPinnedComments;
  const canUndo = Boolean(onUndoCard) && !card.salida_at && !targetId.startsWith('temp_');
  const showUndoButton = canUndo && stateSpec.showUndoButton;

  const renderCommentItem = (opts: {
    key: string;
    loc: string;
    author: string | null;
    timestamp: string | null | undefined;
    text: string;
    isPreview?: boolean;
  }) => (
    <div key={opts.key} className="space-y-0.5 w-full min-w-0">
      <div className="flex items-center justify-between gap-2 leading-tight w-full">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-[11px] font-bold tracking-wide shrink-0 ${
              isUnfinalizedPreasignado ? 'text-[#78350F]' : 'text-[#B45309]'
            }`}
          >
            {opts.loc}
          </span>
          {opts.author && (
            <span
              className={`inline-flex items-center gap-1 font-roboto text-[10.5px] font-semibold truncate ${
                isUnfinalizedPreasignado ? 'text-zinc-900' : 'text-zinc-700'
              }`}
            >
              <User
                size={11}
                strokeWidth={2}
                aria-hidden="true"
                focusable="false"
                className={`shrink-0 ${
                  isUnfinalizedPreasignado ? 'text-amber-900' : 'text-zinc-600'
                }`}
              />
              <span className="truncate">{opts.author}</span>
            </span>
          )}
        </div>
        {opts.timestamp && (
          <span
            className={`font-numeric text-[10px] font-medium tabular-nums shrink-0 text-right ${
              isUnfinalizedPreasignado ? 'text-amber-950/85' : 'text-zinc-600'
            }`}
          >
            {formatDateTimeShort(opts.timestamp)}
          </span>
        )}
      </div>
      <p
        className={`font-notes text-[11.5px] font-medium leading-snug text-left [overflow-wrap:anywhere] ${
          opts.isPreview ? 'line-clamp-2' : 'whitespace-pre-wrap'
        } ${isUnfinalizedPreasignado ? 'text-zinc-950' : 'text-zinc-800'}`}
      >
        {opts.text}
      </p>
    </div>
  );

  const renderAllComments = () => {
    if (isLoadingNotes && effectiveNotes.length <= 1) {
      return (
        <div
          className={`flex items-center gap-1.5 py-2 text-[11px] ${
            isUnfinalizedPreasignado ? 'text-amber-950/80' : 'text-zinc-600'
          }`}
        >
          <Loader2
            size={13}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
            className="animate-spin shrink-0"
          />
          <span>Cargando notas...</span>
        </div>
      );
    }

    if (effectiveNotes.length === 0) {
      return (
        <p
          className={`text-[11px] italic py-1 ${
            isUnfinalizedPreasignado ? 'text-amber-950/70' : 'text-zinc-500'
          }`}
        >
          Sin notas registradas
        </p>
      );
    }

    return (
      <div
        ref={notesListRef}
        className={`max-h-[180px] overflow-y-auto no-scrollbar space-y-2 pt-1.5 border-t w-full ${
          isUnfinalizedPreasignado ? 'border-amber-400/70' : 'border-zinc-300/80'
        }`}
      >
        {effectiveNotes.map((note, idx) => {
          const isCoord =
            !note.usuario_id ||
            note.location === 'Coordinación' ||
            note.usuario === 'Coordinación' ||
            note.usuario === 'coordinacion';
          const noteLoc = isCoord
            ? 'Coordinación'
            : (note.location || card.salida_origen_box || card.box_name || 'Box');
          const noteAuthor = isCoord ? null : (note.usuario || null);

          return renderCommentItem({
            key: note.id || `${note.timestamp}-${idx}`,
            loc: noteLoc,
            author: noteAuthor,
            timestamp: note.timestamp,
            text: note.texto,
          });
        })}
      </div>
    );
  };

  return (
    <div
      data-drag-card="true"
      data-card-state={cardState}
      draggable={draggable}
      onDragStart={handleDefaultDragStart}
      onDragEnd={handleDragEndInternal}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={togglePin}
      role="button"
      tabIndex={0}
      aria-expanded={isPinned}
      aria-pressed={isPinned}
      aria-label={`Unidad ${card.tractor_plate || 'sin tractor'} / ${card.semi_plate || 'sin semi'} en ${card.box_name || 'Sin Box'}. Clic para ${isPinned ? 'desfijar' : 'fijar y ver notas'}.`}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          togglePin();
        }
      }}
      className={`group rounded-[6px] transform transition-[background-color,border-color,box-shadow,transform] ${SMOOTH_EASE} will-change-transform ${
        isDragging
          ? 'opacity-40 scale-[0.98]'
          : isPinned
          ? ''
          : 'hover:-translate-y-0.5 active:scale-[0.985]'
      } ${
        isUnfinalizedPreasignado
          ? isPinned
            ? 'bg-[#FDE68A] border-none ring-1 ring-amber-600/45 shadow-sm'
            : 'bg-[#FDE68A] border-none shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#FCD34D] hover:shadow-md'
          : isPinned
          ? 'bg-[#F1F2F4] border border-zinc-400/90 shadow-sm'
          : 'bg-white border border-zinc-300/90 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-zinc-500'
      } focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none p-2.5 cursor-pointer select-none flex flex-col`}
    >
      {/* Banda Superior 1:1: Patentes a la izquierda | Ubicación y datos relacionados a la derecha */}
      <div className="flex items-stretch justify-between gap-2.5 w-full min-w-0">
        {/* Columna Izquierda: Par de Patentes (Tractor arriba, Semi abajo) */}
        <div className="flex flex-col justify-center gap-1.5 shrink-0">
          {(card.tractor_plate || card.modalidad_tracking !== 'SOLO_SEMI') && (
            <UnitLicensePlate plate={card.tractor_plate} label="Tractor" size="sm" />
          )}
          {(card.semi_plate || card.modalidad_tracking !== 'SOLO_TRACTOR') && (
            <UnitLicensePlate plate={card.semi_plate} label="Semi" size="sm" />
          )}
        </div>

        {/* Columna Derecha 1:1: Ubicación + Timestamp + Pin Top-Right + Zona/Box */}
        <div className="flex flex-col justify-between min-w-0 flex-1 py-0.5 gap-1">
          {/* Header de Ubicación con Timestamp y Pin Top-Right */}
          <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <MapPin
                size={12}
                strokeWidth={2}
                aria-hidden="true"
                focusable="false"
                className={`shrink-0 ${
                  isUnfinalizedPreasignado ? 'text-[#78350F]' : 'text-zinc-600'
                }`}
              />
              <span
                className={`text-[9.5px] font-mono font-bold uppercase tracking-wider truncate ${
                  isUnfinalizedPreasignado ? 'text-[#78350F]' : 'text-zinc-600'
                }`}
              >
                {isPreasignadoHold ? 'ÚLTIMA UBICACIÓN' : 'UBICACIÓN'}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {card.salida_at ? (
                <span
                  className="text-[10.5px] font-numeric tabular-nums text-zinc-700 font-bold shrink-0"
                  title={`Salida / Finalizó: ${card.salida_at}`}
                >
                  {formatDateTimeShort(card.salida_at)}
                </span>
              ) : card.inicio_at ? (
                <span
                  className="text-[10.5px] font-numeric tabular-nums text-emerald-700 font-bold shrink-0"
                  title={`Inicio: ${card.inicio_at}`}
                >
                  {formatDateTimeShort(card.inicio_at)}
                </span>
              ) : card.llegada_at ? (
                <span
                  className={`text-[10.5px] font-numeric tabular-nums font-bold shrink-0 ${
                    isUnfinalizedPreasignado ? 'text-zinc-900' : 'text-amber-800'
                  }`}
                  title={`Preasignado / En espera: ${card.llegada_at}`}
                >
                  {formatDateTimeShort(card.llegada_at)}
                </span>
              ) : null}

              {isPinned && (
                <span
                  title="Card fijada · Clic para desfijar"
                  className={`inline-flex items-center justify-center shrink-0 ${
                    isUnfinalizedPreasignado ? 'text-amber-900' : 'text-zinc-700'
                  }`}
                >
                  <Pin
                    size={12}
                    strokeWidth={2}
                    aria-hidden="true"
                    focusable="false"
                    className="rotate-45"
                  />
                </span>
              )}

              {showUndoButton && (
                <button
                  type="button"
                  draggable={false}
                  onDragStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUndoCard?.(card);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  title="Deshacer card"
                  aria-label={`Deshacer card de unidad ${card.tractor_plate || card.semi_plate || 'seleccionada'}`}
                  className={`w-5 h-5 rounded inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
                    isUnfinalizedPreasignado
                      ? 'text-amber-950/70 hover:text-red-800 hover:bg-red-600/15'
                      : 'text-zinc-500 hover:text-red-700 hover:bg-red-100'
                  }`}
                >
                  <X size={12} strokeWidth={2.25} aria-hidden="true" focusable="false" />
                </button>
              )}
            </div>
          </div>

          {/* Explicitación: Tanto de Zona como Box (Escalón 1 de jerarquía en la card) */}
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px] leading-tight w-full min-w-0">
            <span
              className={`inline-flex items-baseline gap-1 min-w-0 max-w-full ${
                isUnfinalizedPreasignado ? 'text-[#78350F]' : 'text-zinc-600'
              }`}
            >
              <span className="text-[9.5px] font-mono font-bold uppercase shrink-0">ZONA:</span>
              <span className="font-extrabold truncate text-zinc-950">
                {lastZone || (isPreasignadoHold ? 'Sin Zona' : card.zone_name || 'Sin Zona')}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={`text-[10px] shrink-0 ${
                isUnfinalizedPreasignado ? 'text-[#78350F]/60' : 'text-zinc-400'
              }`}
            >
              |
            </span>
            <span
              className={`inline-flex items-baseline gap-1 min-w-0 max-w-full ${
                isUnfinalizedPreasignado ? 'text-[#78350F]' : 'text-zinc-600'
              }`}
            >
              <span className="text-[9.5px] font-mono font-bold uppercase shrink-0">BOX:</span>
              <span className="font-extrabold font-mono truncate text-zinc-950">
                {lastBox || 'Sin Box'}
              </span>
            </span>
          </div>

          {extraRightSlot}
        </div>
      </div>

      {/* Banda Inferior Full-Width (debajo de las patentes): Preview / Cola de Comentarios + Input */}
      <div
        aria-hidden={!showPreviewNote}
        className={`w-full grid transition-[grid-template-rows,opacity,margin] ${SMOOTH_EASE} ${
          showPreviewNote
            ? 'grid-rows-[1fr] opacity-100 mt-1.5'
            : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          {previewNote && (
            <div
              className={`w-full pt-1.5 border-t ${
                isUnfinalizedPreasignado ? 'border-amber-300/80' : 'border-zinc-200/80'
              }`}
            >
              {renderCommentItem({
                key: `preview-${latestProcessNote?.id || 'latest'}`,
                loc: previewLocation,
                author: previewAuthor,
                timestamp: previewTimestamp,
                text: previewNote,
                isPreview: true,
              })}
            </div>
          )}
        </div>
      </div>

      {/* Estado 3 (onClick · Fijada): Cola completa de notas inline a ancho completo */}
      <div
        aria-hidden={!showPinnedComments}
        className={`w-full grid transition-[grid-template-rows,opacity,margin] ${SMOOTH_EASE} ${
          showPinnedComments
            ? 'grid-rows-[1fr] opacity-100 mt-1.5'
            : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-hidden min-h-0">{renderAllComments()}</div>
      </div>

      {/* Estado 2 (Hover) y Estado 3 (Fijada): Stroke inferior full-width para ingreso directo de notas */}
      <div
        aria-hidden={!showNoteInput}
        className={`w-full grid transition-[grid-template-rows,opacity,padding] ${SMOOTH_EASE} ${
          showNoteInput
            ? 'grid-rows-[1fr] opacity-100 pt-1.5'
            : 'grid-rows-[0fr] opacity-0 pt-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-hidden min-h-0">
          <input
            type="text"
            tabIndex={showNoteInput ? 0 : -1}
            draggable={false}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            value={noteText}
            disabled={isSubmitting}
            onChange={(e) => setNoteText(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onKeyDown={handleKeyDownNote}
            placeholder="+ Nota..."
            aria-label={`Ingresar nota para unidad ${card.tractor_plate || card.semi_plate || 'seleccionada'}`}
            className={`w-full bg-transparent border-0 border-b ${
              isUnfinalizedPreasignado
                ? 'border-amber-500/80 hover:border-amber-700 focus:border-zinc-950 text-zinc-900 placeholder:text-zinc-700/70'
                : 'border-zinc-300 hover:border-zinc-500 focus:border-zinc-950 text-zinc-800 placeholder:text-zinc-500'
            } text-[11px] placeholder:italic placeholder:text-[10px] pb-0.5 outline-none transition-colors disabled:opacity-50`}
          />
        </div>
      </div>
    </div>
  );
};
