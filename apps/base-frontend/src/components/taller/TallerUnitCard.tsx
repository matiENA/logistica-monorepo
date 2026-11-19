import React, { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { UnitLicensePlate } from '../common/UnitLicensePlate';
import { actualizarHold, agregarNotaProceso, getSavedTallerUser } from '../../services/planeacionApi';
import type { ProcesoNota } from '../../types/planeacion';

export type TallerColumnId = 'HOLD' | 'LLEGADA' | 'INICIO' | 'SALIDA';

export interface TallerCardItem {
  col: TallerColumnId;
  id: string;
  unidad_id: string | null;
  tractor_id: string | null;
  semi_id: string | null;
  n_ute: string;
  tractor_plate: string;
  semi_plate: string;
  box_id: string | null;
  box_name: string;
  zone_id: string;
  zone_name: string;
  orden?: number | null;
  nota_planificacion?: string | null;
  llegada_at?: string | null;
  inicio_at?: string | null;
  salida_at?: string | null;
  usuarios_nombres: string[];
  notes?: ProcesoNota[];
  notes_count?: number;
  salida_previa_at?: string | null;
  salida_origen_box?: string | null;
  salida_origen_zone?: string | null;
  ultima_tarea?: string | null;
  ultima_tarea_usuario?: string | null;
  ultima_tarea_at?: string | null;
}

interface TallerUnitCardProps {
  item: TallerCardItem;
  nowMs: number;
  isBusy: boolean;
  layout?: 'vertical' | 'horizontal';
  isHoldExpanded?: boolean;
  onNoteAdded?: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, item: TallerCardItem) => void;
  onDragEnd: () => void;
}

function formatTimeHms(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
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

function formatElapsed(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '';
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return '';
  const diffMin = Math.max(0, Math.floor((nowMs - start) / 60000));
  if (diffMin < 60) return `${diffMin}m`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${h}h ${m}m`;
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
  nowMs,
  isBusy,
  layout = 'vertical',
  isHoldExpanded = false,
  onNoteAdded,
  onDragStart,
  onDragEnd,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const toggleExpand = () => {
    if (isBusy || isDraggingRef.current) return;
    setIsExpanded((prev) => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpand();
    }
  };

  const handleDragStartInternal = (e: React.DragEvent<HTMLDivElement>) => {
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
        if (item.col === 'HOLD') {
          await actualizarHold(item.id, {
            notaPlanificacion: trimmed,
          });
        } else {
          const user = getSavedTallerUser();
          await agregarNotaProceso(item.id, {
            texto: trimmed,
            usuarioId: user?.id,
            usuario: user?.nombre_usuario,
            location: item.box_name || 'Box',
          });
        }
        setNoteText('');
        toast.success('Nota registrada');
        onNoteAdded?.();
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
    ? (!latestProcessNote.usuario_id || latestProcessNote.location === 'Coordinación' || latestProcessNote.usuario === null)
    : false;
  const previewNote =
    latestProcessNote?.texto ||
    (item.col === 'HOLD' ? item.nota_planificacion : null) ||
    item.ultima_tarea ||
    item.nota_planificacion ||
    null;
  const previewLocation = latestProcessNote
    ? (latestProcessNote.location || (isCoordNote ? 'Coordinación' : (item.salida_origen_box || item.box_name || 'Box')))
    : (item.nota_planificacion ? 'Coordinación' : (item.salida_origen_box || item.box_name || 'Box'));
  const previewAuthor = isCoordNote
    ? null
    : (latestProcessNote?.usuario ||
       item.ultima_tarea_usuario ||
       (!item.nota_planificacion ? (item.usuarios_nombres && item.usuarios_nombres[0]) : null) ||
       (item.ultima_tarea ? 'Mecánico' : null));
  const previewTimestamp =
    latestProcessNote?.timestamp || item.ultima_tarea_at || null;
  const salidaDurationMin =
    item.col === 'SALIDA' ? formatDiffMin(item.llegada_at, item.salida_at) : null;

  if (layout === 'horizontal') {
    const isDockCollapsed = !isHoldExpanded;
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        draggable={!isBusy}
        onClick={toggleExpand}
        onKeyDown={handleKeyDown}
        onDragStart={handleDragStartInternal}
        onDragEnd={handleDragEndInternal}
        className={`w-[240px] ${
          isDockCollapsed ? 'h-[80px]' : 'h-[164px]'
        } shrink-0 bg-[#0E131E] border rounded-xl p-2 flex flex-col justify-between transition-all duration-300 ease-out select-none outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] will-change-transform translate-z-0 ${colAccent} ${
          isDragging ? 'opacity-40 scale-[0.98] ring-2 ring-amber-400/50 shadow-lg' : ''
        } ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
      >
        <div className={isDockCollapsed ? 'flex items-center justify-between gap-1.5 h-full w-full' : ''}>
          {/* Header de card horizontal: Grip + Patentes a la izquierda | Fecha salida previa al Top Right */}
          <div className={`flex ${isDockCollapsed ? 'items-center' : 'items-start'} justify-between gap-1.5 min-w-0 w-full`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <GripVertical
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                focusable="false"
                className="text-zinc-400 shrink-0 cursor-grab active:cursor-grabbing self-center"
              />
              <div className="flex flex-col gap-1 shrink-0">
                {item.tractor_plate && (
                  <UnitLicensePlate plate={item.tractor_plate} label="Tractor" size="sm" />
                )}
                {item.semi_plate && (
                  <UnitLicensePlate plate={item.semi_plate} label="Semi" size="sm" />
                )}
                {!item.tractor_plate && !item.semi_plate && (
                  <span className="font-mono text-xs font-bold text-zinc-100">UTE {item.n_ute || 'S/N'}</span>
                )}
              </div>
            </div>

            {item.salida_previa_at && (
              <div className={`flex flex-col items-end shrink-0 font-numeric tabular-nums text-right ${isDockCollapsed ? 'self-center' : ''}`}>
                <span className="text-[10px] text-emerald-300 font-bold" title={`Salida de: ${item.salida_origen_box || 'Box'}`}>
                  {formatDateTimeShort(item.salida_previa_at)}
                </span>
              </div>
            )}
          </div>

          {/* En estado expandido, mostrar aviso de Salida y Nota */}
          {!isDockCollapsed && (
            <>
              {/* Aviso de Salida de Box previo en horizontal */}
              {item.salida_previa_at && (
                <div className="mt-1.5 pl-5">
                  <span className="inline-flex items-center gap-1 font-numeric tabular-nums text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold truncate max-w-full">
                    Salida {item.salida_origen_box}
                  </span>
                </div>
              )}

              {/* Nota resumida si existe (author derecha de locación/box hex en amarillo) */}
              {previewNote && (
                <div className="mt-1.5 pl-5 space-y-0.5">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold text-[#F59E0B] tracking-wide shrink-0">
                        {previewLocation}
                      </span>
                      {previewAuthor && (
                        <span className="font-roboto font-thin text-zinc-300 truncate">
                          {previewAuthor}
                        </span>
                      )}
                    </div>
                    {previewTimestamp && (
                      <span className="font-roboto font-thin text-zinc-400/80 text-[9px] tabular-nums shrink-0 text-right">
                        {formatDateTimeShort(previewTimestamp)}
                      </span>
                    )}
                  </div>
                  <p className="font-notes text-[12px] leading-snug text-zinc-300 line-clamp-2">
                    {previewNote}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* En estado expandido, mostrar Input Stroke */}
        {!isDockCollapsed && (
          <div
            className="pl-5 pt-1 mt-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={noteText}
              disabled={isSubmitting}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={handleKeyDownNote}
              placeholder="+ Nota..."
              aria-label={`Ingresar nota para unidad ${item.tractor_plate || item.semi_plate || 'seleccionada'}`}
              className="w-full bg-transparent border-0 border-b border-white/10 hover:border-white/20 focus:border-amber-400/80 text-[10px] text-zinc-200 placeholder:text-zinc-500/70 placeholder:italic placeholder:text-[9px] pb-0.5 outline-none transition-colors disabled:opacity-50"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      draggable={!isBusy}
      onClick={toggleExpand}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStartInternal}
      onDragEnd={handleDragEndInternal}
      className={`bg-[#0E131E] border rounded-xl p-3.5 transition-all duration-200 select-none outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] will-change-transform translate-z-0 ${colAccent} ${
        isDragging ? 'opacity-40 scale-[0.98] ring-2 ring-emerald-500/50 shadow-lg' : ''
      } ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
    >
      {/* Header colapsado: Grip + Patentes a la izquierda | Timestamps / Fecha al Top Right */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
            className="text-zinc-400 shrink-0 cursor-grab active:cursor-grabbing"
          />
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {(item.tractor_plate || !item.semi_plate) && (
              <UnitLicensePlate plate={item.tractor_plate} label="Tractor" size="sm" />
            )}
            {item.semi_plate && (
              <UnitLicensePlate plate={item.semi_plate} label="Semi" size="sm" />
            )}
          </div>
        </div>

        {/* Top Right: Timestamps / Fecha (en lugar de cronómetro la fecha) */}
        <div className="flex flex-col items-end shrink-0 font-numeric tabular-nums text-right">
          {item.col === 'HOLD' && item.salida_previa_at && (
            <span className="text-[10px] text-emerald-300 font-bold">
              {formatDateTimeShort(item.salida_previa_at)}
            </span>
          )}

          {item.col === 'LLEGADA' && item.llegada_at && (
            <span className="text-xs font-medium text-blue-300">
              {formatDateTimeShort(item.llegada_at)}
            </span>
          )}

          {item.col === 'INICIO' && (
            <div className="flex flex-col items-end">
              <span className="text-xs font-medium text-emerald-300">
                {formatDateTimeShort(item.inicio_at)}
              </span>
              {item.llegada_at && (
                <span className="text-[10px] text-zinc-400">
                  {formatDateTimeShort(item.llegada_at)}
                </span>
              )}
            </div>
          )}

          {item.col === 'SALIDA' && item.salida_at && (
            <span className="text-xs font-medium text-zinc-300">
              {formatDateTimeShort(item.salida_at)}
            </span>
          )}
        </div>
      </div>

      {/* Tarea previa en HOLD */}
      {item.col === 'HOLD' && item.ultima_tarea && (
        <div className="mt-2.5 pl-6">
          <div className="text-[12px] font-notes text-zinc-300 italic bg-white/5 border border-white/10 rounded-lg p-2 leading-relaxed">
            <span className="font-semibold text-zinc-100 not-italic block text-[10px] font-numeric uppercase tracking-wider text-emerald-400 mb-0.5">
              Última tarea ({item.salida_origen_box}):
            </span>
            “{item.ultima_tarea}”
            {item.ultima_tarea_usuario && (
              <span className="block mt-1 text-[10px] font-numeric not-italic text-zinc-400">
                Por {item.ultima_tarea_usuario}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Nota resumida cuando está colapsada (author derecha de locación/box hex en amarillo) */}
      {previewNote && !isExpanded && (
        <div className="mt-2.5 pl-6 space-y-0.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-[#F59E0B] tracking-wide shrink-0">
                {previewLocation}
              </span>
              {previewAuthor && (
                <span className="font-roboto font-thin text-zinc-300 truncate">
                  {previewAuthor}
                </span>
              )}
            </div>
            {previewTimestamp && (
              <span className="font-roboto font-thin text-zinc-400/80 text-[10px] tabular-nums shrink-0 text-right">
                {formatDateTimeShort(previewTimestamp)}
              </span>
            )}
          </div>
          <p className="font-notes text-[13px] leading-snug text-zinc-300 line-clamp-2">
            {previewNote}
          </p>
        </div>
      )}

      {/* Contenido expandido al hacer click (sin UTE, comentarios limpios) */}
      {isExpanded && (
        <div className="mt-3.5 pl-6 space-y-3">
          {/* Metadata de timestamps descriptivos */}
          {(item.llegada_at || item.inicio_at || item.salida_at) && (
            <div className="font-numeric tabular-nums text-[11px] text-zinc-400 flex flex-wrap gap-x-3 gap-y-0.5">
              {item.llegada_at && <span>Llegada: {formatDateTimeShort(item.llegada_at)}</span>}
              {item.inicio_at && <span>Inicio: {formatDateTimeShort(item.inicio_at)}</span>}
              {item.salida_at && <span>Salida: {formatDateTimeShort(item.salida_at)}</span>}
            </div>
          )}

          {/* Comentarios JSONB: author derecha de locación/box hex en amarillo + timestamp al top right */}
          {(item.nota_planificacion || (item.notes && item.notes.length > 0)) && (
            <div className="space-y-2 pt-1 border-t border-white/5">
              {item.nota_planificacion &&
                !item.notes?.some((n) => n.texto?.trim() === item.nota_planificacion?.trim()) && (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold text-[#F59E0B] tracking-wide shrink-0">
                        Coordinación
                      </span>
                    </div>
                  </div>
                  <p className="font-notes text-[13px] leading-relaxed text-zinc-200">
                    {item.nota_planificacion}
                  </p>
                </div>
              )}
              {item.notes?.map((note, idx) => {
                const isCoord = !note.usuario_id || note.location === 'Coordinación' || note.usuario === null;
                const noteLoc = note.location || (isCoord ? 'Coordinación' : (item.salida_origen_box || item.box_name || 'Box'));
                const noteAuthor = isCoord ? null : (note.usuario || item.usuarios_nombres?.[0] || 'Mecánico');
                return (
                  <div key={note.id || idx} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-[#F59E0B] tracking-wide shrink-0">
                          {noteLoc}
                        </span>
                        {noteAuthor && (
                          <span className="font-roboto font-thin text-zinc-300 truncate">
                            {noteAuthor}
                          </span>
                        )}
                      </div>
                      {note.timestamp && (
                        <span className="font-roboto font-thin text-zinc-400/80 text-[10px] tabular-nums shrink-0 text-right">
                          {formatDateTimeShort(note.timestamp)}
                        </span>
                      )}
                    </div>
                    <p className="font-notes text-[13px] leading-relaxed text-zinc-200">
                      {note.texto}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stroke at the bottom que indica input de texto para ingresar notas */}
      <div
        className="w-full mt-2.5 pt-1 pl-6"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          value={noteText}
          disabled={isSubmitting}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={handleKeyDownNote}
          placeholder="+ Nota..."
          aria-label={`Ingresar nota para unidad ${item.tractor_plate || item.semi_plate || 'seleccionada'}`}
          className="w-full bg-transparent border-0 border-b border-white/10 hover:border-white/20 focus:border-[#10B981] text-[11px] text-zinc-200 placeholder:text-zinc-500/70 placeholder:italic placeholder:text-[10px] pb-0.5 outline-none transition-colors disabled:opacity-50"
        />
      </div>
    </div>
  );
};
