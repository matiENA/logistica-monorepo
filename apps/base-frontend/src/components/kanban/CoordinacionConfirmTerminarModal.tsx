import React, { useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { UnitLicensePlate } from '../common/UnitLicensePlate';

export interface CoordinacionConfirmTerminarModalProps {
  open: boolean;
  unitLabel: string;
  tractorPlate?: string | null;
  semiPlate?: string | null;
  sourceStageLabel?: string | null;
  activeProcesosCount: number;
  holdsCount: number;
  finalizadosCount: number;
  affectedZones?: string[];
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const CoordinacionConfirmTerminarModal: React.FC<CoordinacionConfirmTerminarModalProps> = ({
  open,
  unitLabel,
  tractorPlate = null,
  semiPlate = null,
  sourceStageLabel = null,
  activeProcesosCount,
  holdsCount,
  finalizadosCount,
  affectedZones = [],
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      cancelBtnRef.current?.focus();
    });
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, isSubmitting, onCancel]);

  if (!open) return null;

  const cleanTractor = tractorPlate?.trim() || '';
  const cleanSemi = semiPlate?.trim() || '';
  const hasPlates = Boolean(cleanTractor || cleanSemi);
  const totalOpenInstances = activeProcesosCount + holdsCount;

  const summaryParts: string[] = [];
  if (activeProcesosCount > 0) {
    summaryParts.push(
      `${activeProcesosCount} proceso${activeProcesosCount === 1 ? '' : 's'} activo${activeProcesosCount === 1 ? '' : 's'}`
    );
  }
  if (holdsCount > 0) {
    summaryParts.push(
      `${holdsCount} preasignado${holdsCount === 1 ? '' : 's'}`
    );
  }
  if (finalizadosCount > 0) {
    summaryParts.push(
      `${finalizadosCount} finalizado${finalizadosCount === 1 ? '' : 's'}`
    );
  }

  return (
    <div
      className="fixed inset-0 z-[65] bg-[#EDEDED]/75 backdrop-blur-[3px] flex items-center justify-center p-4"
      onClick={() => {
        if (!isSubmitting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coord-terminar-title"
        aria-describedby="coord-terminar-desc"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] bg-white border border-zinc-400 rounded-2xl p-5 shadow-xl text-zinc-950"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-zinc-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-300 text-rose-700 inline-flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
            </div>
            <div className="min-w-0">
              <h2
                id="coord-terminar-title"
                className="text-sm font-extrabold tracking-wide text-zinc-950 uppercase font-mono truncate"
              >
                Finalizar circuito · Terminados
              </h2>
              <p className="text-[11px] text-zinc-600 truncate">
                Fin del flow del sitio en esta instancia
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            aria-label="Cerrar confirmación de terminado"
            className="w-11 h-11 sm:w-8 sm:h-8 rounded-full border border-transparent hover:border-zinc-300 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-950 inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          </button>
        </div>

        {/* Body */}
        <div id="coord-terminar-desc" className="mt-4 space-y-3">
          <div className="bg-[#F6F6F7] border border-zinc-300 rounded-xl p-3.5 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-mono font-bold uppercase text-zinc-600 shrink-0">
                Unidad
              </span>
              {hasPlates ? (
                <div
                  className="flex flex-wrap items-center justify-end gap-1.5 min-w-0"
                  aria-label={`Patentes ${unitLabel}`}
                >
                  {cleanTractor && (
                    <UnitLicensePlate plate={cleanTractor} label="Tractor" size="sm" />
                  )}
                  {cleanSemi && (
                    <UnitLicensePlate plate={cleanSemi} label="Semi" size="sm" />
                  )}
                </div>
              ) : (
                <span className="font-bold text-zinc-950 font-mono text-right truncate">
                  {unitLabel}
                </span>
              )}
            </div>

            {sourceStageLabel && (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-200/90">
                <span className="text-xs font-mono font-bold uppercase text-zinc-600 shrink-0">
                  Card arrastrada
                </span>
                <span className="text-xs font-bold text-zinc-900 text-right truncate">
                  {sourceStageLabel}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-200/90">
              <span className="text-xs font-mono font-bold uppercase text-zinc-600 shrink-0">
                Alcance del cierre
              </span>
              <span className="text-xs font-semibold text-zinc-900 text-right">
                {summaryParts.length > 0
                  ? summaryParts.join(' · ')
                  : 'Circuito completo en planta'}
              </span>
            </div>

            {affectedZones.length > 0 && (
              <div className="flex items-start justify-between gap-3 pt-2 border-t border-zinc-200/90">
                <span className="text-xs font-mono font-bold uppercase text-zinc-600 shrink-0 pt-0.5">
                  Zonas alcanzadas
                </span>
                <div className="flex flex-wrap justify-end gap-1 min-w-0">
                  {affectedZones.map((z) => (
                    <span
                      key={z}
                      className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-zinc-300 text-zinc-800"
                    >
                      {z}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-rose-300 bg-rose-50/80 px-3.5 py-2.5 text-xs text-rose-950 leading-relaxed">
            <p className="font-semibold">
              {totalOpenInstances > 1
                ? `Al confirmar, se finalizará el circuito completo y terminarán las ${totalOpenInstances} instancias relacionadas a esta unidad en el circuito actual.`
                : 'Al confirmar, se finalizará el circuito completo y terminarán todos los procesos relacionados a esta unidad en esta instancia.'}
            </p>
            <p className="mt-1 text-rose-900/90">
              La unidad pasará a <span className="font-mono font-bold">TERMINADOS</span>. Si vuelve a ingresar más adelante, iniciará un nuevo circuito normal sin preasignaciones ni procesos previos.
            </p>
          </div>
        </div>

        {/* Actions (WCAG 2.2 · btn-md Desktop 40px / Mobile 44px · >= 12px gap) */}
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            ref={cancelBtnRef}
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="h-11 sm:h-10 px-4 rounded-lg border border-zinc-400 bg-transparent hover:bg-zinc-100 active:scale-[0.98] text-zinc-900 text-base sm:text-sm font-semibold inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className="h-11 sm:h-10 px-4 rounded-lg border border-transparent bg-rose-700 hover:bg-rose-800 active:scale-[0.98] text-white text-base sm:text-sm font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2"
          >
            {isSubmitting ? (
              <>
                <Loader2
                  size={18}
                  strokeWidth={2}
                  aria-hidden="true"
                  focusable="false"
                  className="animate-spin"
                />
                <span>Finalizando...</span>
              </>
            ) : (
              <span>Confirmar Egreso</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
