import React, { useState } from 'react';
import { MapPin, User } from 'lucide-react';
import { toast } from 'sonner';
import type { PlaneacionCard } from '../../types/planeacion';
import { actualizarHold, agregarNotaProceso, getActiveSessionUser } from '../../services/planeacionApi';
import { UnitLicensePlate } from '../common/UnitLicensePlate';

export interface UnitPlaneacionCardProps {
  card: PlaneacionCard;
  onClick: (card: PlaneacionCard) => void;
  onNoteAdded?: () => void;
  /** Slot extensible para inyectar métricas/badges adicionales sin romper el layout base */
  extraRightSlot?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
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
 * Estado COLLAPSED (Mapeo de primera instancia):
 * Muestra el par de chapas patentes (Tractor / Semi),
 * el Box actual, la última tarea/nota registrada con fecha en thin con opacidad,
 * y un stroke inferior minimalista para ingreso directo de notas.
 * Cero código superfluo: suprime zona actual y separadores por redundancia.
 */
export const UnitPlaneacionCard: React.FC<UnitPlaneacionCardProps> = ({
  card,
  onClick,
  onNoteAdded,
  extraRightSlot,
  draggable = true,
  onDragStart,
}) => {
  const [noteText, setNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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

  const latestProcessNote =
    card.notes && card.notes.length > 0 ? card.notes[card.notes.length - 1] : null;
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
    : (latestProcessNote?.usuario || card.ultima_tarea_usuario || (card.usuarios_nombres && card.usuarios_nombres[0]) || null);

  const previewTimestamp =
    latestProcessNote?.timestamp || card.ultima_tarea_at || null;

  const handleKeyDownNote = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = noteText.trim();
      if (!trimmed || isSubmitting) return;

      setIsSubmitting(true);
      try {
        if (card.etapa_ciclo === 'PLANIFICADO_HOLD' || !card.llegada_at) {
          await actualizarHold(card.proceso_id, {
            notaPlanificacion: trimmed,
          });
        } else {
          await agregarNotaProceso(card.proceso_id, {
            texto: trimmed,
            usuarioId: null,
            location: 'Coordinación',
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

  const handleDefaultDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
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
  };

  return (
    <div
      draggable={draggable}
      onDragStart={handleDefaultDragStart}
      onDragEnd={handleDragEndInternal}
      onClick={() => onClick(card)}
      role="button"
      tabIndex={0}
      aria-label={`Unidad ${card.tractor_plate || 'sin tractor'} / ${card.semi_plate || 'sin semi'} en ${card.box_name || 'Sin Box'}. Clic para desplegar detalle.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(card);
        }
      }}
      className={`group rounded-[6px] transform transition-all duration-150 ease-out will-change-transform ${
        isDragging ? 'opacity-40 scale-[0.98]' : 'hover:-translate-y-0.5 active:scale-[0.985]'
      } ${
        isUnfinalizedPreasignado
          ? 'bg-[#FDE68A] border-none shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#FCD34D] hover:shadow-md'
          : 'bg-white border border-zinc-300/90 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-zinc-500'
      } focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none p-2.5 cursor-grab active:cursor-grabbing select-none flex items-start justify-between gap-2.5`}
    >
      {/* Columna Izquierda: Par de Patentes (Tractor arriba, Semi abajo) */}
      <div className="flex flex-col gap-1.5 shrink-0">
        {(card.tractor_plate || card.modalidad_tracking !== 'SOLO_SEMI') && (
          <UnitLicensePlate plate={card.tractor_plate} label="Tractor" size="sm" />
        )}
        {(card.semi_plate || card.modalidad_tracking !== 'SOLO_TRACTOR') && (
          <UnitLicensePlate plate={card.semi_plate} label="Semi" size="sm" />
        )}
      </div>

      {/* Columna Derecha: Box actual (location: empty = Sin Box) + Timestamps Top Right + Última tarea/nota + Input stroke al fondo */}
      <div className="flex flex-col justify-start items-start min-w-0 flex-1 self-stretch py-0.5 gap-1.5">
        <div
          className="flex items-center justify-between gap-1.5 text-[12px] leading-tight text-zinc-950 font-extrabold w-full"
          title={
            isPreasignadoHold
              ? lastZone && lastBox
                ? `Última ubicación: ${lastZone} · ${lastBox}`
                : lastBox
                ? `Última ubicación: ${lastBox}`
                : 'Sin Box (Preasignado)'
              : card.box_name
              ? `Box actual: ${card.box_name}`
              : 'Sin Box'
          }
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin
              className={`w-3.5 h-3.5 shrink-0 ${
                isUnfinalizedPreasignado
                  ? 'text-[#78350F]'
                  : lastBox || card.box_name
                  ? 'text-zinc-900'
                  : 'text-zinc-400'
              }`}
            />
            {isPreasignadoHold ? (
              lastZone && lastBox ? (
                <span className="truncate">
                  <span
                    className={`uppercase font-mono text-[10px] font-bold tracking-tight ${
                      isUnfinalizedPreasignado ? 'text-[#78350F]' : 'text-zinc-500'
                    }`}
                  >
                    {lastZone}
                  </span>
                  <span
                    className={`mx-1 ${
                      isUnfinalizedPreasignado ? 'text-[#78350F]/70' : 'text-zinc-400'
                    }`}
                  >
                    ·
                  </span>
                  <span
                    className={
                      isUnfinalizedPreasignado
                        ? 'text-zinc-950 font-extrabold'
                        : 'text-zinc-900 font-extrabold'
                    }
                  >
                    {lastBox}
                  </span>
                </span>
              ) : lastBox ? (
                <span className="truncate">{lastBox}</span>
              ) : (
                <span
                  className={`truncate font-normal italic ${
                    isUnfinalizedPreasignado ? 'text-zinc-800' : 'text-zinc-400'
                  }`}
                >
                  Sin Box
                </span>
              )
            ) : card.box_name ? (
              <span className="truncate">{card.box_name}</span>
            ) : (
              <span className="truncate font-normal italic text-zinc-400">Sin Box</span>
            )}
          </div>
          {card.salida_at ? (
            <span
              className="text-[10px] font-numeric tabular-nums text-zinc-700 font-bold shrink-0"
              title={`Salida / Finalizó: ${card.salida_at}`}
            >
              {formatDateTimeShort(card.salida_at)}
            </span>
          ) : card.inicio_at ? (
            <span
              className="text-[10px] font-numeric tabular-nums text-emerald-700 font-bold shrink-0"
              title={`Inicio: ${card.inicio_at}`}
            >
              {formatDateTimeShort(card.inicio_at)}
            </span>
          ) : (
            card.llegada_at ? (
              <span
                className={`text-[10px] font-numeric tabular-nums font-bold shrink-0 ${
                  isUnfinalizedPreasignado ? 'text-zinc-900' : 'text-amber-800'
                }`}
                title={`Preasignado / En espera: ${card.llegada_at}`}
              >
                {formatDateTimeShort(card.llegada_at)}
              </span>
            ) : null
          )}
        </div>

        {/* Última tarea/nota registrada en JSON */}
        {previewNote && (
          <div className={`w-full space-y-0.5 pt-1 ${isUnfinalizedPreasignado ? 'border-t border-amber-300/80' : 'border-t border-zinc-200/80'}`}>
            <div className="flex items-center justify-between gap-2 text-[10px] leading-tight">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`font-bold tracking-wide shrink-0 ${isUnfinalizedPreasignado ? 'text-[#78350F]' : 'text-[#F59E0B]'}`}>
                  {previewLocation}
                </span>
                {previewAuthor && (
                  <span className={`inline-flex items-center gap-1 font-roboto text-[10px] truncate ${
                    isUnfinalizedPreasignado ? 'text-zinc-900 font-medium' : 'font-thin text-zinc-600'
                  }`}>
                    <User className={`w-3 h-3 shrink-0 ${
                      isUnfinalizedPreasignado ? 'text-[#1E40AF]' : 'text-zinc-500'
                    }`} />
                    <span className="truncate">{previewAuthor}</span>
                  </span>
                )}
              </div>
              {previewTimestamp && (
                <span className={`font-roboto text-[9px] tabular-nums shrink-0 text-right ${
                  isUnfinalizedPreasignado ? 'text-zinc-800/90 font-medium' : 'font-thin text-zinc-500/80'
                }`}>
                  {formatDateTimeShort(previewTimestamp)}
                </span>
              )}
            </div>
            <p className={`font-notes text-[11px] leading-snug line-clamp-2 ${
              isUnfinalizedPreasignado ? 'text-zinc-900 font-medium' : 'text-zinc-700'
            }`}>
              {previewNote}
            </p>
          </div>
        )}

        {/* Stroke at the bottom indicativo de input de texto para notas */}
        <div
          className="w-full mt-auto pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
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
            aria-label={`Ingresar nota para unidad ${card.tractor_plate || card.semi_plate || 'seleccionada'}`}
            className={`w-full bg-transparent border-0 border-b ${
              isUnfinalizedPreasignado
                ? 'border-amber-400/80 hover:border-amber-600 focus:border-zinc-950 text-zinc-900 placeholder:text-zinc-700/60'
                : 'border-zinc-200/90 hover:border-zinc-400 focus:border-zinc-950 text-zinc-800 placeholder:text-zinc-400/80'
            } text-[11px] placeholder:italic placeholder:text-[10px] pb-0.5 outline-none transition-colors disabled:opacity-50`}
          />
        </div>

        {extraRightSlot}
      </div>
    </div>
  );
};
