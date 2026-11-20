import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, MessageSquarePlus, StickyNote, User, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  PlaneacionCard,
  PlaneacionCatalog,
} from '../../types/planeacion';
import { actualizarHold, agregarNotaProceso } from '../../services/planeacionApi';
import { UnitLicensePlate } from '../common/UnitLicensePlate';
import { OperariosAssignDropdownCard } from '../common/OperariosAssignDropdownCard';

interface UnitPlaneacionDeployedModalProps {
  card: PlaneacionCard | null;
  catalog?: PlaneacionCatalog;
  onClose: () => void;
  onUpdated: () => void;
  onAssignUsuarios?: (card: PlaneacionCard, nextUserIds: string[]) => Promise<void>;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const UnitPlaneacionDeployedModal: React.FC<UnitPlaneacionDeployedModalProps> = ({
  card,
  catalog,
  onClose,
  onUpdated,
  onAssignUsuarios,
}) => {
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const assignBtnRef = useRef<HTMLButtonElement | null>(null);
  const notesContainerRef = useRef<HTMLDivElement | null>(null);

  const zoneUsuarios = useMemo(() => {
    if (!card || !catalog?.usuarios) return [];
    return catalog.usuarios.filter(
      (u) => u.rol !== 'coordinacion' && u.zone_id === card.zone_id
    );
  }, [card, catalog?.usuarios]);

  useEffect(() => {
    if (!card) return;
    setNoteText('');
  }, [card]);

  useEffect(() => {
    setIsAssignOpen(false);
  }, [card?.proceso_id]);

  useEffect(() => {
    if (notesContainerRef.current) {
      notesContainerRef.current.scrollTop = notesContainerRef.current.scrollHeight;
    }
  }, [card?.notes?.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAssignOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, isAssignOpen]);

  if (!card) return null;

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = noteText.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      if (card.hold_id || card.etapa_ciclo === 'PLANIFICADO_HOLD') {
        await actualizarHold(card.hold_id || card.proceso_id, {
          notaPlanificacion: trimmed,
        });
      } else {
        await agregarNotaProceso(card.proceso_id, {
          usuarioId: null,
          location: 'Coordinación',
          texto: trimmed,
        });
      }
      setNoteText('');
      toast.success('Nota registrada');
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error guardando nota');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[3px] flex items-center justify-center p-3 md:p-6"
      onClick={onClose}
    >
      <div
        className="relative bg-white text-zinc-950 border-[1.5px] border-zinc-900 rounded-[18px] shadow-[0_24px_60px_rgba(0,0,0,0.28)] w-full max-w-[680px] max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Deployed: Identificación limpia de la unidad */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4 bg-zinc-50/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            {/* Patentes */}
            <div className="flex items-center gap-1.5 shrink-0">
              {(card.tractor_plate || card.modalidad_tracking !== 'SOLO_SEMI') && (
                <UnitLicensePlate plate={card.tractor_plate} label="Tractor" size="sm" />
              )}
              {(card.semi_plate || card.modalidad_tracking !== 'SOLO_TRACTOR') && (
                <UnitLicensePlate plate={card.semi_plate} label="Semi" size="sm" />
              )}
            </div>

            {/* UTE */}
            {card.n_ute && (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-zinc-900 text-white shrink-0">
                UTE #{card.n_ute}
              </span>
            )}

            {/* Box y Zona */}
            <div className="flex items-center gap-1.5 text-xs shrink-0">
              <span className="font-bold text-[#F59E0B] tracking-wide">
                {(card.hold_id || card.etapa_ciclo === 'PLANIFICADO_HOLD')
                  ? (card.ubicacion_actual_box || card.salida_origen_box || card.box_name || 'Sin Box')
                  : (card.box_name || 'Sin Box')}
              </span>
              <span className="text-zinc-400 font-thin">·</span>
              <span className="text-zinc-600 font-medium">
                {(card.hold_id || card.etapa_ciclo === 'PLANIFICADO_HOLD')
                  ? `${card.ubicacion_actual_zone || card.salida_origen_zone || card.zone_name} → ${card.zone_name}`
                  : card.zone_name}
              </span>
            </div>

            {/* Contador de Notas */}
            <span className="text-[11px] font-mono text-zinc-500 bg-zinc-200/70 px-2 py-0.5 rounded-full shrink-0">
              {card.notes.length} {card.notes.length === 1 ? 'nota' : 'notas'}
            </span>

            {/* Trigger Dropdown Card de Operarios */}
            {onAssignUsuarios && (
              <div className="shrink-0">
                <button
                  ref={assignBtnRef}
                  type="button"
                  onClick={() => setIsAssignOpen((prev) => !prev)}
                  aria-expanded={isAssignOpen}
                  aria-haspopup="dialog"
                  aria-label="Asignar operarios disponibles en la zona"
                  className="h-8 px-2.5 rounded-lg bg-white hover:bg-slate-50 border border-[#CBD5E1] hover:border-[#94A3B8] text-[#0F172A] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1"
                >
                  <User size={14} strokeWidth={2} aria-hidden="true" focusable="false" className="text-emerald-700" />
                  <span>
                    Operarios
                    {card.usuarios_nombres.length > 0 ? ` (${card.usuarios_nombres.length})` : ''}
                  </span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                    focusable="false"
                    className={`transition-transform ${isAssignOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <OperariosAssignDropdownCard
                  open={isAssignOpen}
                  anchorRef={assignBtnRef}
                  onClose={() => setIsAssignOpen(false)}
                  tractorPlate={card.tractor_plate}
                  semiPlate={card.semi_plate}
                  nUte={card.n_ute}
                  availableUsuarios={zoneUsuarios}
                  selectedUserIds={card.usuarios_ids || []}
                  onCommitUsuarios={(nextIds) => onAssignUsuarios(card, nextIds)}
                  theme="light"
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="p-1.5 rounded-full text-zinc-500 hover:text-zinc-950 hover:bg-zinc-200/70 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chips limpios de operarios asignados (0 UUIDs) */}
        {card.usuarios_nombres.length > 0 && (
          <div className="px-6 py-2 border-b border-zinc-200/80 bg-white flex items-center gap-1.5 flex-wrap shrink-0">
            <span className="text-[11px] font-bold text-[#0F172A] mr-1">Asignados:</span>
            {card.usuarios_nombres.map((uname, idx) => (
              <span
                key={`${uname}-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[12px] font-normal text-zinc-900"
              >
                <User size={12} strokeWidth={1.75} aria-hidden="true" focusable="false" className="text-emerald-700" />
                <span>{uname}</span>
              </span>
            ))}
          </div>
        )}

        {/* Cuerpo Deployed: Solo las Notas del Proceso */}
        <div
          ref={notesContainerRef}
          className="p-6 overflow-y-auto flex-1 flex flex-col gap-3 min-h-[220px] max-h-[60vh]"
        >
          {card.notes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-400 gap-2">
              <StickyNote className="w-8 h-8 text-zinc-300 stroke-[1.5]" />
              <p className="text-xs italic">Sin notas registradas para esta unidad.</p>
            </div>
          ) : (
            card.notes.map((n, idx) => {
            const isCoord =
              !n.usuario_id ||
              n.location === 'Coordinación' ||
              n.usuario === 'Coordinación' ||
              n.usuario === 'coordinacion';
            const noteLocation = isCoord
              ? 'Coordinación'
              : (n.location || card.box_name || 'Box');
            const noteAuthor = isCoord ? null : n.usuario;

            return (
              <div
                key={`${n.timestamp}-${idx}`}
                className="bg-zinc-50/80 border border-zinc-200/90 rounded-xl p-3.5 flex flex-col gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
              >
                {/* Encabezado Normativo de Nota: [Ubicación (#F59E0B)] [Autor a la derecha si aplica] ... [Fecha Top Right] */}
                <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-bold text-[#F59E0B] tracking-wide shrink-0">
                      {noteLocation}
                    </span>
                    {noteAuthor && (
                      <span className="font-roboto font-thin text-zinc-600 truncate">
                        {noteAuthor}
                      </span>
                    )}
                  </div>
                  <span className="font-roboto font-thin text-zinc-500 text-[10px] tabular-nums shrink-0 text-right">
                    {formatDateTime(n.timestamp)}
                  </span>
                </div>

                {/* Texto de la Nota con tipografía Zilla Slab (font-notes) */}
                <p className="font-notes text-[13px] leading-snug text-zinc-800 whitespace-pre-wrap">
                  {n.texto}
                </p>
              </div>
            );
          })
          )}
        </div>

        {/* Formulario Inferior: Agregar nota operativa */}
        <div className="p-4 border-t border-zinc-200 bg-zinc-50/50 shrink-0">
          <form onSubmit={handleAddNote} className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Agregar nota operativa al proceso..."
              aria-label="Agregar nota operativa al proceso"
              disabled={saving}
              className="flex-1 px-3.5 py-2 text-xs border border-zinc-300 rounded-xl bg-white text-zinc-900 placeholder:text-zinc-400 placeholder:italic focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 disabled:opacity-50 transition-all"
            />
            <button
              type="submit"
              disabled={saving || !noteText.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-950 text-white text-xs font-bold hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all shadow-sm shrink-0"
            >
              {saving ? (
                <span className="text-xs">Guardando...</span>
              ) : (
                <>
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>Agregar</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
