import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  GripVertical,
  Loader2,
  MapPin,
  Pin,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { UnitLicensePlate } from '../common/UnitLicensePlate';
import {
  agregarNotaProceso,
  fetchProcesoNotas,
  getSavedTallerUser,
} from '../../services/planeacionApi';
import type { EstadoBox, ProcesoNota } from '../../types/planeacion';

export type TallerColumnId = 'HOLD' | 'LLEGADA' | 'INICIO' | 'SALIDA';

export interface TallerCardItem {
  col: TallerColumnId;
  id: string;
  circuito_id?: string;
  unidad_id: string | null;
  tractor_id: string | null;
  semi_id: string | null;
  n_ute: string;
  tractor_plate: string;
  semi_plate: string;
  box_id: string | null;
  box_name: string;
  estado?: EstadoBox | null;
  zone_id: string;
  zone_name: string;
  orden?: number | null;
  nota_planificacion?: string | null;
  created_at?: string | null;
  llegada_at?: string | null;
  inicio_at?: string | null;
  salida_at?: string | null;
  usuarios_ids?: string[];
  usuarios_nombres: string[];
  encargado_id?: string | null;
  encargado_nombre?: string | null;
  encargado_at?: string | null;
  notes?: ProcesoNota[];
  notes_count?: number;
  salida_previa_at?: string | null;
  salida_origen_box?: string | null;
  salida_origen_zone?: string | null;
  ubicacion_actual_box?: string | null;
  ubicacion_actual_zone?: string | null;
  ultima_tarea?: string | null;
  ultima_tarea_usuario?: string | null;
  ultima_tarea_at?: string | null;
}

interface TallerUnitCardProps {
  item: TallerCardItem;
  isBusy: boolean;
  layout?: 'vertical' | 'horizontal';
  compact?: boolean;
  isContainerHovered?: boolean;
  onDeployChange?: (id: string, isDeployed: boolean) => void;
  onNoteAdded?: (sync?: { procesoId: string; circuitoId?: string; notes: ProcesoNota[] }) => void;
  onUndoCard?: (item: TallerCardItem) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, item: TallerCardItem) => void;
  onDragEnd: () => void;
}

const SMOOTH_EASE = 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';

type ZoneMatrixCardState = 'reposo' | 'hover' | 'pinned';

interface ZoneMatrixCardStateSpec {
  showPreviewNote: boolean;
  showAllNotes: boolean;
  showNoteInput: boolean;
  showUndoButton: boolean;
  fetchFullNotesOnDemand: boolean;
}

const ZONE_MATRIX_CARD_STATE_SPEC: Record<ZoneMatrixCardState, ZoneMatrixCardStateSpec> = {
  reposo: {
    showPreviewNote: false,
    showAllNotes: false,
    showNoteInput: false,
    showUndoButton: false,
    fetchFullNotesOnDemand: false,
  },
  hover: {
    showPreviewNote: true,
    showAllNotes: false,
    showNoteInput: false,
    showUndoButton: true,
    fetchFullNotesOnDemand: false,
  },
  pinned: {
    showPreviewNote: false,
    showAllNotes: true,
    showNoteInput: true,
    showUndoButton: true,
    fetchFullNotesOnDemand: true,
  },
};

function resolveZoneMatrixCardState(deps: {
  isPinned: boolean;
  isHovered: boolean;
}): ZoneMatrixCardState {
  if (deps.isPinned) return 'pinned';
  if (deps.isHovered) return 'hover';
  return 'reposo';
}

function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
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

function formatDiffMin(startIso: string | null | undefined, endIso: string | null | undefined): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 60000));
}

function formatDurationMin(mins: number | null): string {
  if (mins === null || mins === undefined) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export const TallerUnitCard: React.FC<TallerUnitCardProps> = ({
  item,
  isBusy,
  layout = 'vertical',
  compact = false,
  isContainerHovered = false,
  onDeployChange,
  onNoteAdded,
  onUndoCard,
  onDragStart,
  onDragEnd,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [fetchedNotes, setFetchedNotes] = useState<ProcesoNota[] | null>(null);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const isExpandedRef = useRef(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedNotesRef = useRef<ProcesoNota[] | null>(null);
  const notesListRef = useRef<HTMLDivElement | null>(null);
  const onDeployChangeRef = useRef(onDeployChange);
  onDeployChangeRef.current = onDeployChange;

  const updateFetchedNotes = (next: ProcesoNota[] | null) => {
    fetchedNotesRef.current = next;
    setFetchedNotes(next);
  };

  const isZoneMatrixCard = item.col === 'INICIO';
  const isCompactStage = item.col === 'HOLD' || item.col === 'LLEGADA' || item.col === 'SALIDA';
  const localCount = item.notes?.length ?? 0;
  const totalNotesCount = Math.max(item.notes_count ?? 0, localCount);
  const effectiveNotes =
    localCount >= totalNotesCount ? item.notes ?? [] : fetchedNotes ?? item.notes ?? [];
  const latestItemNote =
    item.notes && item.notes.length > 0 ? item.notes[item.notes.length - 1] : null;
  const latestNoteSig = `${latestItemNote?.id || ''}|${latestItemNote?.edited_at || ''}|${latestItemNote?.texto || ''}|${totalNotesCount}|${localCount}`;

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
      }
      if (isExpandedRef.current) {
        onDeployChangeRef.current?.(item.id, false);
      }
    };
  }, [item.id]);

  // C2 On-Demand reactivo: al desplegar o cuando cambia cualquier nota del circuito (alta, edición, borrado),
  // re-sincronizar la cola completa desde el primer comentario hasta el último.
  useEffect(() => {
    if (!isExpanded) {
      updateFetchedNotes(null);
      return;
    }
    if (totalNotesCount === 0) {
      updateFetchedNotes(null);
      return;
    }
    if (localCount >= totalNotesCount) {
      // Si el payload local ya trae todas las notas del circuito (ej. 0, 1 o recién sincronizado en memoria),
      // preservar fetchedNotesRef para evitar parpadeo y re-fetch cuando G1 Lite recorta item.notes a 1 ítem.
      return;
    }

    const cached = fetchedNotesRef.current;
    const cachedLast = cached && cached.length > 0 ? cached[cached.length - 1] : null;
    if (
      cached &&
      cached.length === totalNotesCount &&
      cachedLast?.id === latestItemNote?.id &&
      cachedLast?.edited_at === latestItemNote?.edited_at &&
      cachedLast?.texto === latestItemNote?.texto
    ) {
      return;
    }

    let cancelled = false;
    setIsLoadingNotes(true);
    fetchProcesoNotas(item.id)
      .then((all) => {
        if (!cancelled) updateFetchedNotes(all);
      })
      .catch(() => {
        // Fallback silencioso a las notas disponibles localmente
      })
      .finally(() => {
        if (!cancelled) setIsLoadingNotes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isExpanded, item.id, latestNoteSig, totalNotesCount, localCount]);

  // Auto-scroll al último comentario al expandir o recibir nuevas notas
  const lastEffectiveNoteId =
    effectiveNotes.length > 0 ? effectiveNotes[effectiveNotes.length - 1]?.id : null;
  useEffect(() => {
    if (isExpanded && notesListRef.current) {
      notesListRef.current.scrollTop = notesListRef.current.scrollHeight;
    }
  }, [isExpanded, effectiveNotes.length, lastEffectiveNoteId]);

  const setExpandedState = (next: boolean) => {
    isExpandedRef.current = next;
    setIsExpanded(next);
    onDeployChangeRef.current?.(item.id, next);
  };

  const toggleExpand = () => {
    if (isBusy || isDraggingRef.current) return;
    setExpandedState(!isExpanded);
  };

  const handleCardMouseEnter = () => {
    if (!isZoneMatrixCard) return;
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsCardHovered(true);
  };

  const handleCardMouseLeave = () => {
    if (!isZoneMatrixCard) return;
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      setIsCardHovered(false);
    }, 90);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpand();
    }
  };

  const handleDragStartInternal = (e: React.DragEvent<HTMLDivElement>) => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsCardHovered(false);
    isDraggingRef.current = true;
    setIsDragging(true);
    onDragStart(e, item);
  };

  const handleDragEndInternal = () => {
    setIsDragging(false);
    onDragEnd();
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 60);
  };

  const handleKeyDownNote = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = noteText.trim();
      if (!trimmed || isSubmitting) return;

      setIsSubmitting(true);
      try {
        const user = getSavedTallerUser();
        const res = await agregarNotaProceso(item.id, {
          texto: trimmed,
          usuarioId: user?.id,
          usuario: user?.nombre_usuario,
          location: item.box_name || user?.box_name || item.zone_name || 'Box',
        });
        setNoteText('');
        toast.success('Nota registrada');
        if (res?.result?.notes) {
          if (isExpanded) updateFetchedNotes(res.result.notes);
          onNoteAdded?.({
            procesoId: item.id,
            circuitoId: res.result.circuitoId || item.circuito_id,
            notes: res.result.notes,
          });
        } else {
          onNoteAdded?.();
          if (isExpanded) {
            const updated = await fetchProcesoNotas(item.id).catch(() => null);
            if (updated) updateFetchedNotes(updated);
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error registrando nota');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const colAccent =
    item.col === 'HOLD'
      ? 'border-amber-500/25 hover:border-amber-400/60'
      : item.col === 'LLEGADA'
      ? 'border-blue-500/25 hover:border-blue-400/60'
      : item.col === 'INICIO'
      ? 'border-emerald-500/25 hover:border-emerald-400/60'
      : 'border-zinc-700/60 hover:border-zinc-500/80';

  const latestProcessNote =
    item.notes && item.notes.length > 0 ? item.notes[item.notes.length - 1] : null;
  const isCoordNote = latestProcessNote
    ? !latestProcessNote.usuario_id ||
      latestProcessNote.location === 'Coordinación' ||
      latestProcessNote.usuario === null
    : false;
  const previewNote =
    latestProcessNote?.texto ||
    (item.col === 'HOLD' ? item.nota_planificacion : null) ||
    item.ultima_tarea ||
    item.nota_planificacion ||
    null;
  const previewLocation = latestProcessNote
    ? latestProcessNote.location ||
      (isCoordNote ? 'Coordinación' : item.salida_origen_box || item.box_name || 'Box')
    : item.nota_planificacion
    ? 'Coordinación'
    : item.salida_origen_box || item.box_name || 'Box';
  const previewAuthor = isCoordNote
    ? null
    : latestProcessNote?.usuario ||
      item.ultima_tarea_usuario ||
      (!item.nota_planificacion ? item.usuarios_nombres?.[0] : null) ||
      (item.ultima_tarea ? 'Mecánico' : null);
  const previewTimestamp = latestProcessNote?.timestamp || item.ultima_tarea_at || null;
  const salidaDurationMin =
    item.col === 'SALIDA' ? formatDiffMin(item.llegada_at, item.salida_at) : null;

  const ultimaZona =
    item.salida_origen_zone ||
    item.ubicacion_actual_zone ||
    (item.col !== 'HOLD' ? item.zone_name : null) ||
    'Sin Zona';

  const ultimoBox =
    item.salida_origen_box ||
    item.ubicacion_actual_box ||
    (item.col !== 'HOLD' ? item.box_name : null) ||
    'Sin Box';

  const stageTz =
    item.col === 'HOLD'
      ? item.salida_previa_at || item.ultima_tarea_at || item.created_at
      : item.col === 'LLEGADA'
      ? item.llegada_at
      : item.col === 'SALIDA'
      ? item.salida_at
      : item.inicio_at;

  const showBoxBadge = !compact && item.col !== 'INICIO' && Boolean(item.box_name);
  const hasEncargadoBadge = Boolean(
    item.encargado_nombre || item.encargado_id || item.encargado_at
  );
  const hasAssignedBadges =
    showBoxBadge || item.usuarios_nombres.length > 0 || hasEncargadoBadge;
  const canUndo = Boolean(onUndoCard) && item.col !== 'SALIDA' && !item.salida_at && !isBusy;

  const renderUndoButton = () => (
    <button
      type="button"
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onUndoCard?.(item);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      title="Deshacer card"
      aria-label={`Deshacer card de unidad ${item.tractor_plate || item.semi_plate || 'seleccionada'}`}
      className="w-5 h-5 rounded inline-flex items-center justify-center shrink-0 text-zinc-400 hover:text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
    >
      <X size={12} strokeWidth={2.25} aria-hidden="true" focusable="false" />
    </button>
  );

  const renderPlates = (stacked = false, plateSize: 'xs' | 'sm' = 'sm') => (
    <div
      className={
        stacked
          ? 'flex flex-col gap-1 shrink-0'
          : 'flex flex-wrap items-center gap-1.5 min-w-0'
      }
    >
      {(item.tractor_plate || !item.semi_plate) && item.tractor_plate && (
        <UnitLicensePlate plate={item.tractor_plate} label="Tractor" size={plateSize} />
      )}
      {item.semi_plate && (
        <UnitLicensePlate plate={item.semi_plate} label="Semi" size={plateSize} />
      )}
      {!item.tractor_plate && !item.semi_plate && (
        <span className="font-mono text-xs font-bold text-zinc-100">
          UTE {item.n_ute || 'S/N'}
        </span>
      )}
    </div>
  );

  const renderAssignedBadges = (className = '') => {
    if (!hasAssignedBadges) return null;

    return (
      <div
        className={`${className} flex items-center gap-1.5 flex-wrap min-w-0`}
        onClick={(e) => e.stopPropagation()}
      >
        {showBoxBadge && (
          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/5 border border-white/15 text-zinc-200">
            {item.box_name}
          </span>
        )}
        {item.usuarios_nombres.map((uname, idx) => (
          <span
            key={`${uname}-${idx}`}
            className="inline-flex items-center gap-1 max-w-full text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#141A26] border border-[#263042] text-zinc-200"
          >
            <User size={11} strokeWidth={2} aria-hidden="true" focusable="false" className="text-[#10B981] shrink-0" />
            <span className="truncate">{uname}</span>
          </span>
        ))}
        {hasEncargadoBadge && (
          <span
            className="inline-flex items-center gap-1 max-w-full text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
            title="Encargado de zona"
          >
            <UserCheck size={11} strokeWidth={2} aria-hidden="true" focusable="false" className="shrink-0" />
            <span className="truncate">{item.encargado_nombre || 'Encargado'}</span>
          </span>
        )}
      </div>
    );
  };

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
          <span className="text-[11px] font-bold text-[#F59E0B] tracking-wide shrink-0">
            {opts.loc}
          </span>
          {opts.author && (
            <span className="inline-flex items-center gap-1 font-roboto text-[10.5px] font-semibold text-zinc-200 truncate">
              <User
                size={11}
                strokeWidth={2}
                aria-hidden="true"
                focusable="false"
                className="text-zinc-400 shrink-0"
              />
              <span className="truncate">{opts.author}</span>
            </span>
          )}
        </div>
        {opts.timestamp && (
          <span className="font-numeric font-medium text-zinc-400 text-[10px] tabular-nums shrink-0 text-right">
            {formatDateTimeShort(opts.timestamp)}
          </span>
        )}
      </div>
      <p
        className={`font-notes text-[12px] font-medium text-zinc-100 text-left [overflow-wrap:anywhere] ${
          opts.isPreview ? 'leading-snug line-clamp-2' : 'leading-relaxed whitespace-pre-wrap'
        }`}
      >
        {opts.text}
      </p>
    </div>
  );

  const renderPreviewComment = (indentClass = '') => {
    if (!previewNote) return null;
    return (
      <div className={`${indentClass} w-full`}>
        {renderCommentItem({
          key: `preview-${latestProcessNote?.id || 'latest'}`,
          loc: previewLocation,
          author: previewAuthor,
          timestamp: previewTimestamp,
          text: previewNote,
          isPreview: true,
        })}
      </div>
    );
  };

  const renderAllComments = (maxHeightClass = 'max-h-[160px]') => {
    if (isLoadingNotes && effectiveNotes.length <= 1) {
      return (
        <div className="flex items-center gap-1.5 pt-1.5 pb-1 border-t border-white/10 w-full text-[11px] text-zinc-300">
          <Loader2 size={13} strokeWidth={2} className="animate-spin text-amber-400" />
          <span>Cargando comentarios...</span>
        </div>
      );
    }

    if (effectiveNotes.length === 0) {
      return (
        <p className="text-[11px] text-zinc-400 italic pt-1.5 pb-1 border-t border-white/10 w-full">
          Sin comentarios registrados
        </p>
      );
    }

    return (
      <div
        ref={notesListRef}
        className={`${maxHeightClass} overflow-y-auto space-y-2 no-scrollbar pt-1.5 border-t border-white/10 w-full`}
      >
        {effectiveNotes.map((note, idx) => {
          const isCoord =
            !note.usuario_id || note.location === 'Coordinación' || note.usuario === null;
          const noteLoc =
            note.location ||
            (isCoord ? 'Coordinación' : item.salida_origen_box || item.box_name || 'Box');
          const noteAuthor = isCoord
            ? null
            : note.usuario || item.usuarios_nombres?.[0] || 'Mecánico';
          return renderCommentItem({
            key: note.id || String(idx),
            loc: noteLoc,
            author: noteAuthor,
            timestamp: note.timestamp,
            text: note.texto,
          });
        })}
      </div>
    );
  };

  // ============================================================================
  // LAYOUT HORIZONTAL (PENDIENTE / HOLD) — Contenedor persistente con transición fluida
  // ============================================================================
  if (layout === 'horizontal') {
    const isZoomedOut = !isContainerHovered && !isExpanded;
    const showHoverPane = isContainerHovered && !isExpanded;

    return (
      <div
        data-drag-card="true"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        draggable={!isBusy}
        onClick={toggleExpand}
        onKeyDown={handleKeyDown}
        onDragStart={handleDragStartInternal}
        onDragEnd={handleDragEndInternal}
        className={`shrink-0 border rounded-xl flex flex-col justify-between overflow-hidden transition-[width,height,padding,border-color,background-color,transform] ${SMOOTH_EASE} select-none outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] ${
          isExpanded
            ? 'w-[330px] h-[244px] p-2.5 bg-[#1B2230] border-amber-400/60'
            : isContainerHovered
            ? `w-[290px] h-[160px] p-2.5 bg-[#0E131E] ${colAccent}`
            : `w-[146px] h-[68px] p-2 bg-[#0E131E] ${colAccent}`
        } ${
          isDragging ? 'opacity-40 scale-[0.98] ring-2 ring-amber-400/50 shadow-lg' : ''
        } ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
      >
        <div className="flex flex-col gap-1.5 w-full min-h-0 flex-1">
          {/* Header: Grip + Patentes | Hover: ÚLT. UBICACIÓN lateral | Deployed: tz + ChevronUp */}
          <div className="flex items-center justify-between gap-2 min-w-0 w-full shrink-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <GripVertical
                size={isZoomedOut ? 14 : 15}
                strokeWidth={2}
                aria-hidden="true"
                focusable="false"
                className="text-zinc-400 shrink-0 cursor-grab active:cursor-grabbing"
              />
              {renderPlates(!isExpanded, 'sm')}
            </div>

            {/* Bloque Hover lateral (ÚLTIMA UBICACIÓN + tz) */}
            <div
              aria-hidden={!showHoverPane}
              className={`flex flex-col justify-center min-w-0 self-stretch border-l border-white/10 transition-[max-width,opacity,padding] ${SMOOTH_EASE} overflow-hidden ${
                showHoverPane
                  ? 'flex-1 max-w-[160px] opacity-100 pl-2'
                  : 'max-w-0 opacity-0 pl-0 border-l-0 pointer-events-none'
              }`}
            >
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1 truncate">
                  <MapPin size={10} strokeWidth={2} aria-hidden="true" className="text-emerald-400 shrink-0" />
                  ÚLT. UBICACIÓN
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {stageTz && (
                    <span className="text-[9.5px] font-mono text-emerald-400 font-bold tabular-nums shrink-0">
                      {formatDateTimeShort(stageTz)}
                    </span>
                  )}
                  {canUndo && showHoverPane && renderUndoButton()}
                </div>
              </div>
              <div className="flex flex-col gap-0.5 mt-1">
                <div className="flex items-center gap-1 text-[12px] leading-tight">
                  <span className="text-[9.5px] font-mono font-bold text-zinc-400 uppercase">ZONA:</span>
                  <span className="font-extrabold text-white truncate" title={ultimaZona}>{ultimaZona}</span>
                </div>
                <div className="flex items-center gap-1 text-[12px] leading-tight">
                  <span className="text-[9.5px] font-mono font-bold text-zinc-400 uppercase">BOX:</span>
                  <span className="font-extrabold text-emerald-400 font-mono truncate" title={ultimoBox}>{ultimoBox}</span>
                </div>
              </div>
            </div>

            {/* Bloque Deployed header right (tz + Pin + X top-right) */}
            <div
              aria-hidden={!isExpanded}
              className={`flex items-center gap-1.5 shrink-0 transition-[max-width,opacity] ${SMOOTH_EASE} overflow-hidden ${
                isExpanded ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'
              }`}
            >
              {stageTz && (
                <span className="text-[10px] font-numeric tabular-nums text-emerald-300 font-bold">
                  {formatDateTimeShort(stageTz)}
                </span>
              )}
              <span
                title="Card fijada · Clic para desfijar"
                className="inline-flex items-center text-zinc-200 shrink-0"
              >
                <Pin size={12} strokeWidth={2} aria-hidden="true" focusable="false" className="rotate-45" />
              </span>
              {canUndo && isExpanded && renderUndoButton()}
            </div>
          </div>

          {/* Panel Hover inferior: Último comentario a ancho completo */}
          <div
            aria-hidden={!showHoverPane}
            className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} ${
              showHoverPane ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
            }`}
          >
            <div className="overflow-hidden min-h-0">
              {renderPreviewComment('mt-0.5')}
            </div>
          </div>

          {/* Panel Deployed: Ubicación + Badges + Todos los comentarios a ancho completo */}
          <div
            aria-hidden={!isExpanded}
            className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} min-h-0 ${
              isExpanded ? 'grid-rows-[1fr] opacity-100 flex-1' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
            }`}
          >
            <div className="overflow-hidden min-h-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[12px] leading-tight flex-wrap shrink-0">
                <MapPin size={10} strokeWidth={2} aria-hidden="true" className="text-emerald-400 shrink-0" />
                <span className="text-[9.5px] font-mono font-bold text-zinc-400 uppercase">ZONA:</span>
                <span className="font-extrabold text-white">{ultimaZona}</span>
                <span className="text-zinc-500">|</span>
                <span className="text-[9.5px] font-mono font-bold text-zinc-400 uppercase">BOX:</span>
                <span className="font-extrabold text-emerald-400 font-mono">{ultimoBox}</span>
              </div>

              {renderAssignedBadges('shrink-0')}

              <div className="flex-1 min-h-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {renderAllComments('max-h-[105px]')}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Hover (indicador dropdown sin contador de comentarios) */}
        <div
          aria-hidden={!showHoverPane}
          className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} shrink-0 ${
            showHoverPane ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="pt-1 flex items-center justify-between text-[10px] font-medium text-zinc-300 border-t border-white/10">
              <span>Desplegar detalles</span>
              <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* Footer Deployed (input + Nota... a ancho completo) */}
        <div
          aria-hidden={!isExpanded}
          className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} shrink-0 ${
            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="overflow-hidden min-h-0 pt-1">
            <input
              type="text"
              tabIndex={isExpanded ? 0 : -1}
              draggable={false}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              value={noteText}
              disabled={isSubmitting}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={handleKeyDownNote}
              placeholder="+ Nota..."
              aria-label={`Ingresar nota para unidad ${item.tractor_plate || item.semi_plate || 'seleccionada'}`}
              className="w-full bg-transparent border-0 border-b border-white/15 hover:border-white/30 focus:border-amber-400/80 text-[10.5px] text-zinc-100 placeholder:text-zinc-400 placeholder:italic placeholder:text-[10px] pb-0.5 outline-none transition-colors disabled:opacity-50"
            />
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT VERTICAL (RESERVADO, TERMINADO e INICIO / MAPA DE ZONA)
  // Contenedor persistente + acordeón CSS (0fr -> 1fr) para transiciones fluidas
  // ============================================================================
  const isZoomedOut = isCompactStage && !isContainerHovered && !isExpanded;
  const showLocationBlock = !compact && !isZoomedOut;
  const showBadgesBlock = hasAssignedBadges && (item.col === 'INICIO' || isExpanded);
  const zoneCardState = resolveZoneMatrixCardState({
    isPinned: isExpanded,
    isHovered: isCardHovered,
  });
  const zoneStateSpec = ZONE_MATRIX_CARD_STATE_SPEC[zoneCardState];
  const showZoneHoverPreview =
    isZoneMatrixCard && zoneStateSpec.showPreviewNote && Boolean(previewNote);
  const showSideHoverSummary = !isZoneMatrixCard && !isZoomedOut && !isExpanded;
  const showVerticalUndo =
    canUndo &&
    (isZoneMatrixCard
      ? zoneStateSpec.showUndoButton
      : item.col === 'LLEGADA' && !isZoomedOut);

  return (
    <div
      data-drag-card="true"
      data-card-state={isZoneMatrixCard ? zoneCardState : undefined}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-pressed={isExpanded}
      draggable={!isBusy}
      onClick={toggleExpand}
      onKeyDown={handleKeyDown}
      onMouseEnter={isZoneMatrixCard ? handleCardMouseEnter : undefined}
      onMouseLeave={isZoneMatrixCard ? handleCardMouseLeave : undefined}
      onDragStart={handleDragStartInternal}
      onDragEnd={handleDragEndInternal}
      className={`border rounded-xl transition-[padding,border-color,background-color,transform] ${SMOOTH_EASE} select-none outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] ${
        isZoomedOut ? 'px-1 py-1.5' : compact ? 'p-2.5' : 'p-3'
      } ${
        isExpanded ? 'bg-[#1B2230] border-zinc-500/70' : `bg-[#0E131E] ${colAccent}`
      } ${
        isDragging ? 'opacity-40 scale-[0.98] ring-2 ring-emerald-500/50 shadow-lg' : ''
      } ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
    >
      {/* Header persistente: Grip + Patentes a la izquierda | Timestamps al Top Right */}
      <div
        className={`flex justify-between min-w-0 ${
          isZoomedOut ? 'items-center gap-0.5' : 'items-start gap-2'
        }`}
      >
        <div
          className={`flex items-center min-w-0 ${
            isZoomedOut ? 'gap-0.5' : 'gap-1.5'
          }`}
        >
          <GripVertical
            size={isZoomedOut ? 12 : 15}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
            className="text-zinc-400 shrink-0 cursor-grab active:cursor-grabbing"
          />
          {renderPlates(isZoomedOut, isZoomedOut ? 'xs' : 'sm')}
        </div>

        <div
          aria-hidden={isZoomedOut}
          className={`flex items-center gap-1.5 shrink-0 font-numeric tabular-nums text-right transition-[max-width,opacity] ${SMOOTH_EASE} overflow-hidden ${
            isZoomedOut ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[140px] opacity-100'
          }`}
        >
          {item.col === 'HOLD' && stageTz && (
            <span className="text-[10px] text-emerald-300 font-bold">
              {formatDateTimeShort(stageTz)}
            </span>
          )}

          {item.col === 'LLEGADA' && item.llegada_at && (
            <span className="text-xs font-medium text-blue-300">
              {formatDateTimeShort(item.llegada_at)}
            </span>
          )}

          {item.col === 'INICIO' && item.inicio_at && (
            <span
              className="text-xs font-medium text-emerald-300"
              title={`Inicio: ${item.inicio_at}`}
            >
              {formatDateTimeShort(item.inicio_at)}
            </span>
          )}

          {item.col === 'SALIDA' && item.salida_at && (
            <span className="text-xs font-medium text-zinc-300">
              {formatDateTimeShort(item.salida_at)}
            </span>
          )}

          {isExpanded && (
            <span
              title="Card fijada · Clic para desfijar"
              className="inline-flex items-center text-zinc-200 shrink-0"
            >
              <Pin size={12} strokeWidth={2} aria-hidden="true" focusable="false" className="rotate-45" />
            </span>
          )}

          {showVerticalUndo && renderUndoButton()}
        </div>
      </div>

      {/* Última Ubicación (Hover / Deployed en RESERVADO y TERMINADO; omitida en Zona/Minimapa) */}
      {!compact && (
        <div
          aria-hidden={!showLocationBlock}
          className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} ${
            showLocationBlock
              ? 'grid-rows-[1fr] opacity-100'
              : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                <MapPin size={10} strokeWidth={2} aria-hidden="true" className="text-emerald-400 shrink-0" />
                ÚLTIMA UBICACIÓN
              </span>
              <div className="flex items-center gap-2 text-[12px] leading-tight flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <span className="text-[9.5px] font-mono font-bold text-zinc-400 uppercase">ZONA:</span>
                  <span className="font-extrabold text-white">{ultimaZona}</span>
                </span>
                <span className="text-zinc-500">|</span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-[9.5px] font-mono font-bold text-zinc-400 uppercase">BOX:</span>
                  <span className="font-extrabold text-emerald-400 font-mono">{ultimoBox}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Badges de asignación: renderizan únicamente cuando existen datos asignados */}
      {hasAssignedBadges && (
        <div
          aria-hidden={!showBadgesBlock}
          className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} ${
            showBadgesBlock
              ? 'grid-rows-[1fr] opacity-100'
              : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            {renderAssignedBadges('mt-2')}
          </div>
        </div>
      )}

      {/* Estado 2 (Hover) en Zona/Minimapa: solo último comentario si existe; otros estados mantienen resumen + acción */}
      {isZoneMatrixCard ? (
        <div
          aria-hidden={!showZoneHoverPreview}
          className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} ${
            showZoneHoverPreview
              ? 'grid-rows-[1fr] opacity-100'
              : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            {previewNote && (
              <div className="mt-2 pt-1.5 border-t border-white/10 w-full">
                {renderPreviewComment()}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          aria-hidden={!showSideHoverSummary}
          className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} ${
            showSideHoverSummary
              ? 'grid-rows-[1fr] opacity-100'
              : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            {renderPreviewComment('mt-2')}
            <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] font-medium text-zinc-300">
              <span>Ver todos los datos</span>
              <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
            </div>
          </div>
        </div>
      )}

      {/* Contenido Deployed: todos los timestamps (fuera de Zona/Minimapa) + todos los comentarios + input + Nota... a ancho completo */}
      <div
        aria-hidden={!isExpanded}
        className={`grid transition-[grid-template-rows,opacity] ${SMOOTH_EASE} ${
          isExpanded
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className={isZoneMatrixCard ? 'mt-2' : 'mt-2.5 space-y-2.5'}
            onClick={(e) => e.stopPropagation()}
          >
            {!isZoneMatrixCard && (item.llegada_at || item.inicio_at || item.salida_at) && (
              <div className="font-numeric tabular-nums text-[10px] font-medium text-zinc-300 flex flex-wrap gap-x-2.5 gap-y-0.5">
                {item.llegada_at && <span>Llegada: {formatDateTimeShort(item.llegada_at)}</span>}
                {item.inicio_at && <span>Inicio: {formatDateTimeShort(item.inicio_at)}</span>}
                {item.salida_at && <span>Salida: {formatDateTimeShort(item.salida_at)}</span>}
                {salidaDurationMin !== null && (
                  <span className="text-emerald-400 font-semibold">
                    Duración: {formatDurationMin(salidaDurationMin)}
                  </span>
                )}
              </div>
            )}

            {renderAllComments('max-h-[180px]')}
          </div>

          <div className="w-full mt-2 pt-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              tabIndex={isExpanded ? 0 : -1}
              draggable={false}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              value={noteText}
              disabled={isSubmitting}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={handleKeyDownNote}
              placeholder="+ Nota..."
              aria-label={`Ingresar nota para unidad ${item.tractor_plate || item.semi_plate || 'seleccionada'}`}
              className="w-full bg-transparent border-0 border-b border-white/15 hover:border-white/30 focus:border-[#10B981] text-[11px] text-zinc-100 placeholder:text-zinc-400 placeholder:italic placeholder:text-[10px] pb-0.5 outline-none transition-colors disabled:opacity-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
