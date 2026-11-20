import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, User, UserCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { UnitLicensePlate } from './UnitLicensePlate';

export interface OperarioAssignableItem {
  id: string;
  nombre_usuario: string;
  rol?: string;
  box_id?: string | null;
}

export interface OperariosAssignDropdownCardProps {
  open: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  tractorPlate?: string | null;
  semiPlate?: string | null;
  nUte?: string | null;
  availableUsuarios: OperarioAssignableItem[];
  selectedUserIds: string[];
  onCommitUsuarios: (nextUserIds: string[]) => Promise<void>;
  theme: 'light' | 'dark';
  boxes?: Array<{ id: string; box_name: string }>;
  selectedBoxId?: string | null;
  allowEmptyBox?: boolean;
  onCommitBox?: (nextBoxId: string | null) => Promise<void>;
}

type SyncStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 450;

export const OperariosAssignDropdownCard: React.FC<OperariosAssignDropdownCardProps> = ({
  open,
  anchorRef,
  onClose,
  tractorPlate,
  semiPlate,
  nUte,
  availableUsuarios,
  selectedUserIds,
  onCommitUsuarios,
  theme,
  boxes,
  selectedBoxId,
  allowEmptyBox = false,
  onCommitBox,
}) => {
  const [draftIds, setDraftIds] = useState<string[]>(selectedUserIds);
  const [draftBoxId, setDraftBoxId] = useState<string>(selectedBoxId || '');
  const [isSavingBox, setIsSavingBox] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [portalPos, setPortalPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  }>({ left: 16, top: 64, width: 304 });

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const draftIdsRef = useRef<string[]>(selectedUserIds);
  const lastCommittedIdsRef = useRef<string[]>(selectedUserIds);
  const isDirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const queuedCommitRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitUsuariosRef = useRef(onCommitUsuarios);
  const onCloseRef = useRef(onClose);

  onCommitUsuariosRef.current = onCommitUsuarios;
  onCloseRef.current = onClose;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sincronización desde props únicamente cuando no hay ediciones locales pendientes ni en vuelo
  useEffect(() => {
    if (!isDirtyRef.current && !inFlightRef.current) {
      draftIdsRef.current = selectedUserIds;
      lastCommittedIdsRef.current = selectedUserIds;
      setDraftIds(selectedUserIds);
    }
  }, [selectedUserIds]);

  useEffect(() => {
    if (!isSavingBox) {
      setDraftBoxId(selectedBoxId || '');
    }
  }, [selectedBoxId, isSavingBox]);

  // Reiniciar estado visual al abrir
  useEffect(() => {
    if (open) {
      if (!isDirtyRef.current && !inFlightRef.current) {
        draftIdsRef.current = selectedUserIds;
        lastCommittedIdsRef.current = selectedUserIds;
        setDraftIds(selectedUserIds);
        setSyncStatus('idle');
      }
      setDraftBoxId(selectedBoxId || '');
    }
  }, [open, selectedUserIds, selectedBoxId]);

  const executeCommit = useCallback(async () => {
    if (inFlightRef.current) {
      queuedCommitRef.current = true;
      return;
    }

    inFlightRef.current = true;
    if (mountedRef.current) setSyncStatus('saving');

    try {
      let keepGoing = true;
      while (keepGoing) {
        queuedCommitRef.current = false;
        const payloadIds = [...draftIdsRef.current];
        isDirtyRef.current = false;
        await onCommitUsuariosRef.current(payloadIds);
        lastCommittedIdsRef.current = payloadIds;
        keepGoing = queuedCommitRef.current;
      }

      if (mountedRef.current && !isDirtyRef.current) {
        setSyncStatus('saved');
      }
    } catch (err) {
      isDirtyRef.current = false;
      queuedCommitRef.current = false;
      const revertIds = [...lastCommittedIdsRef.current];
      draftIdsRef.current = revertIds;
      if (mountedRef.current) {
        setDraftIds(revertIds);
        setSyncStatus('error');
      }
      toast.error(err instanceof Error ? err.message : 'Error guardando operarios');
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (isDirtyRef.current || queuedCommitRef.current) {
      void executeCommit();
    }
  }, [executeCommit]);

  // Flush automático al desmontar si quedaron cambios en el micro-buffer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (isDirtyRef.current || queuedCommitRef.current) {
        const finalIds = [...draftIdsRef.current];
        isDirtyRef.current = false;
        queuedCommitRef.current = false;
        void onCommitUsuariosRef.current(finalIds).catch((err) => {
          toast.error(err instanceof Error ? err.message : 'Error guardando operarios');
        });
      }
    };
  }, []);

  const handleCloseWithFlush = useCallback(() => {
    flush();
    onCloseRef.current();
  }, [flush]);

  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      flush();
    }
    prevOpenRef.current = open;
  }, [open, flush]);

  const handleToggleUser = (uid: string) => {
    const current = draftIdsRef.current;
    const nextIds = current.includes(uid)
      ? current.filter((id) => id !== uid)
      : [...current, uid];

    draftIdsRef.current = nextIds;
    setDraftIds(nextIds);
    isDirtyRef.current = true;
    setSyncStatus('pending');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void executeCommit();
    }, DEBOUNCE_MS);
  };

  const handleBoxChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!onCommitBox) return;
    const nextVal = e.target.value;
    const prevVal = draftBoxId;
    setDraftBoxId(nextVal);
    setIsSavingBox(true);
    try {
      await onCommitBox(nextVal ? nextVal : null);
    } catch (err) {
      setDraftBoxId(prevVal);
      toast.error(err instanceof Error ? err.message : 'Error actualizando box');
    } finally {
      if (mountedRef.current) setIsSavingBox(false);
    }
  };

  // Posicionamiento del portal relativo al trigger con clamp de viewport
  const updatePosition = useCallback(() => {
    if (!anchorRef?.current || typeof window === 'undefined') return;
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(304, vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow < 280 && spaceAbove > spaceBelow) {
      setPortalPos({
        left,
        bottom: Math.max(8, vh - rect.top + 6),
        width,
      });
    } else {
      setPortalPos({
        left,
        top: Math.max(8, Math.min(rect.bottom + 6, vh - 120)),
        width,
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    if (!open || !anchorRef) return;
    updatePosition();
    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open, anchorRef, updatePosition]);

  // Cierre con Escape o clic fuera (ejecuta flush() del micro-buffer antes de cerrar)
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCloseWithFlush();
        anchorRef?.current?.focus?.();
      }
    };

    const handleMouseDownOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (dropdownRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      handleCloseWithFlush();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleMouseDownOutside, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleMouseDownOutside, true);
    };
  }, [open, anchorRef, handleCloseWithFlush]);

  const sortedUsuarios = useMemo(() => {
    return [...availableUsuarios].sort((a, b) =>
      a.nombre_usuario.localeCompare(b.nombre_usuario, 'es', { sensitivity: 'base' })
    );
  }, [availableUsuarios]);

  if (!open) return null;

  const isDark = theme === 'dark';
  const showBoxSelector = Boolean(boxes && boxes.length > 0 && onCommitBox);

  const cardElement = (
    <div
      ref={dropdownRef}
      role="dialog"
      aria-label="Asignar operarios disponibles en la zona"
      style={
        anchorRef
          ? {
              position: 'fixed',
              left: `${portalPos.left}px`,
              ...(portalPos.top !== undefined ? { top: `${portalPos.top}px` } : {}),
              ...(portalPos.bottom !== undefined ? { bottom: `${portalPos.bottom}px` } : {}),
              width: `${portalPos.width}px`,
              zIndex: 90,
            }
          : undefined
      }
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`${anchorRef ? '' : 'w-[288px] sm:w-[304px]'} rounded-xl p-4 border select-none transition-colors ${
        isDark
          ? 'bg-[#0E131E] border-[#263042] text-[#F8FAFC] shadow-2xl'
          : 'bg-white border-zinc-300 text-[#0F172A] shadow-xl'
      }`}
    >
      {/* Header Patentes + Cerrar */}
      <div
        className={`flex items-start justify-between gap-2 pb-3 border-b ${
          isDark ? 'border-[#1E2530]' : 'border-zinc-200'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {tractorPlate && <UnitLicensePlate plate={tractorPlate} label="Tractor" size="sm" />}
          {semiPlate && <UnitLicensePlate plate={semiPlate} label="Semi" size="sm" />}
          {!tractorPlate && !semiPlate && (
            <span
              className={`font-mono text-xs font-bold px-2 py-1 rounded border ${
                isDark
                  ? 'bg-[#141A26] border-[#263042] text-zinc-100'
                  : 'bg-zinc-100 border-zinc-300 text-zinc-900'
              }`}
            >
              UTE {nUte || 'S/N'}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleCloseWithFlush}
          aria-label="Cerrar asignación"
          className={`w-8 h-8 max-sm:w-11 max-sm:h-11 -mr-1.5 -mt-1.5 rounded-lg inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            isDark
              ? 'text-zinc-400 hover:text-white hover:bg-white/10 focus-visible:ring-[#10B981] focus-visible:ring-offset-[#0E131E]'
              : 'text-slate-600 hover:text-[#0F172A] hover:bg-slate-100 focus-visible:ring-[#2563EB] focus-visible:ring-offset-white'
          }`}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
        </button>
      </div>

      {/* Selector opcional de Box del Sector (exclusivo /taller encargado_zona) */}
      {showBoxSelector && (
        <div className="pt-3">
          <label
            htmlFor="operarios-card-box-select"
            className={`block text-[11px] font-bold uppercase tracking-wider mb-1 ${
              isDark ? 'text-zinc-400' : 'text-slate-600'
            }`}
          >
            Box del Sector
          </label>
          <select
            id="operarios-card-box-select"
            value={draftBoxId}
            disabled={isSavingBox}
            onChange={handleBoxChange}
            aria-label="Seleccionar box del sector"
            className={`w-full h-9 px-2.5 rounded-lg border text-[13px] outline-none cursor-pointer transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-1 ${
              isDark
                ? 'bg-[#141A26] border-[#263042] text-zinc-100 focus-visible:ring-[#10B981]'
                : 'bg-white border-[#CBD5E1] text-[#0F172A] focus-visible:ring-[#2563EB]'
            }`}
          >
            {allowEmptyBox && <option value="">Sin Box</option>}
            {boxes!.map((b) => (
              <option key={b.id} value={b.id}>
                {b.box_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Título Bold */}
      <h3
        className={`pt-3 pb-2 text-[14px] leading-[20px] font-bold tracking-tight ${
          isDark ? 'text-[#F8FAFC]' : 'text-[#0F172A]'
        }`}
      >
        Asignar operario/s:
      </h3>

      {/* Lista de usuarios disponibles en la zona (Solo Checkboxes + Micro-Buffer 450 ms) */}
      {sortedUsuarios.length === 0 ? (
        <p
          className={`py-4 text-center text-[13px] font-normal italic ${
            isDark ? 'text-zinc-400' : 'text-slate-600'
          }`}
        >
          Sin operarios disponibles en esta zona.
        </p>
      ) : (
        <div className="max-h-[220px] overflow-y-auto -mx-1 px-1 space-y-1">
          {sortedUsuarios.map((u) => {
            const isChecked = draftIds.includes(u.id);
            return (
              <label
                key={u.id}
                className={`min-h-[40px] max-sm:min-h-[44px] px-2.5 py-2 rounded-lg flex items-center justify-between gap-2.5 cursor-pointer transition-colors ${
                  isDark
                    ? isChecked
                      ? 'bg-emerald-500/10 hover:bg-emerald-500/15'
                      : 'hover:bg-white/5'
                    : isChecked
                    ? 'bg-emerald-50/80 hover:bg-emerald-50'
                    : 'hover:bg-slate-50'
                }`}
              >
                {/* Icono flat de usuario a la izquierda */}
                {isChecked ? (
                  <UserCheck
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    focusable="false"
                    className={`shrink-0 ${isDark ? 'text-[#10B981]' : 'text-emerald-700'}`}
                  />
                ) : (
                  <User
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    focusable="false"
                    className={`shrink-0 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}
                  />
                )}

                {/* Nombre Regular */}
                <span
                  className={`flex-1 min-w-0 truncate text-[14px] max-sm:text-[16px] leading-[20px] font-normal ${
                    isDark ? 'text-zinc-100' : 'text-[#0F172A]'
                  }`}
                >
                  {u.nombre_usuario}
                </span>

                {/* Checkbox derecho (20x20px visual + foco WCAG 2.2 SC 2.4.7 + contraste >= 3:1 SC 1.4.11) */}
                <span className="relative inline-flex items-center justify-center shrink-0">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleUser(u.id)}
                    aria-label={`Asignar a ${u.nombre_usuario}`}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`w-5 h-5 rounded-[4px] border-[1.5px] inline-flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 ${
                      isDark
                        ? 'peer-focus-visible:ring-[#10B981] peer-focus-visible:ring-offset-[#0E131E]'
                        : 'peer-focus-visible:ring-[#2563EB] peer-focus-visible:ring-offset-white'
                    } ${
                      isChecked
                        ? isDark
                          ? 'bg-[#00A86B] border-[#00A86B] text-white'
                          : 'bg-[#059669] border-[#059669] text-white'
                        : isDark
                        ? 'bg-[#141A26] border-[#94A3B8] text-transparent'
                        : 'bg-white border-[#64748B] text-transparent'
                    }`}
                  >
                    <Check size={14} strokeWidth={2.5} aria-hidden="true" focusable="false" />
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* Footer compacto de sincronización (Opción C · sin botones Editar/Cancelar/Confirmar) */}
      <div
        aria-live="polite"
        className={`mt-3 pt-2.5 border-t flex items-center justify-between gap-2 text-[11px] font-medium ${
          isDark ? 'border-[#1E2530] text-zinc-400' : 'border-zinc-200 text-slate-600'
        }`}
      >
        <span className="tabular-nums">
          {draftIds.length} {draftIds.length === 1 ? 'asignado' : 'asignados'}
        </span>
        <span className="inline-flex items-center gap-1">
          {syncStatus === 'pending' && <span>Pendiente...</span>}
          {syncStatus === 'saving' && (
            <>
              <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" focusable="false" />
              <span>Guardando...</span>
            </>
          )}
          {syncStatus === 'saved' && (
            <span className={isDark ? 'text-emerald-400' : 'text-emerald-700'}>Guardado</span>
          )}
          {syncStatus === 'error' && (
            <span className={isDark ? 'text-rose-400' : 'text-rose-600'}>Error al guardar</span>
          )}
        </span>
      </div>
    </div>
  );

  if (anchorRef && typeof document !== 'undefined') {
    return createPortal(cardElement, document.body);
  }

  return cardElement;
};
