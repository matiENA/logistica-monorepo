import React, { useEffect } from 'react';
import { ArrowRightLeft, CheckCircle2, Loader2, LogIn, X } from 'lucide-react';

export type TallerConfirmMoveKind = 'TERMINADO' | 'MOVIMIENTO_BOX' | 'CAMBIO_ZONA';

export interface TallerConfirmMoveModalProps {
  open: boolean;
  kind: TallerConfirmMoveKind;
  title: string;
  unitLabel: string;
  sourceBoxName?: string | null;
  targetBoxName?: string | null;
  estadoAplicar: string;
  rowEffectNote?: string | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const TallerConfirmMoveModal: React.FC<TallerConfirmMoveModalProps> = ({
  open,
  kind,
  title,
  unitLabel,
  sourceBoxName,
  targetBoxName,
  estadoAplicar,
  rowEffectNote,
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isSubmitting, onCancel]);

  if (!open) return null;

  const HeaderIcon =
    kind === 'TERMINADO'
      ? CheckCircle2
      : kind === 'CAMBIO_ZONA'
      ? ArrowRightLeft
      : LogIn;

  const estadoToneClass =
    kind === 'TERMINADO'
      ? 'text-zinc-100'
      : estadoAplicar.includes('AFUERA')
      ? 'text-amber-300'
      : 'text-emerald-300';

  const hasDistinctBoxes = Boolean(
    sourceBoxName && targetBoxName && sourceBoxName !== targetBoxName
  );
  const singleBoxName = targetBoxName || sourceBoxName || null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => {
        if (!isSubmitting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="taller-confirm-title"
        aria-describedby="taller-confirm-desc"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] bg-[#0E131E] border border-[#334155] rounded-2xl p-5 shadow-2xl text-[#F3F4F6]"
      >
        <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-[#1E2530]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#141A26] border border-[#334155] inline-flex items-center justify-center shrink-0 text-[#10B981]">
              <HeaderIcon size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
            </div>
            <h2
              id="taller-confirm-title"
              className="text-base font-bold text-white leading-snug truncate"
            >
              {title}
            </h2>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            aria-label="Cerrar confirmación"
            className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg border border-transparent bg-transparent hover:bg-white/5 text-zinc-300 hover:text-white inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E131E]"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
          </button>
        </div>

        <div id="taller-confirm-desc" className="mt-4">
          <div className="bg-[#141A26] border border-[#263042] rounded-xl p-3.5 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-300 shrink-0">Unidad</span>
              <span className="font-bold text-white font-numeric text-right truncate">
                {unitLabel}
              </span>
            </div>

            {(hasDistinctBoxes || singleBoxName) && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-300 shrink-0">Box</span>
                {hasDistinctBoxes ? (
                  <span className="text-right truncate">
                    <span className="font-bold text-white">{sourceBoxName}</span>{' '}
                    <span className="text-zinc-400" aria-hidden="true">
                      →
                    </span>{' '}
                    <span className="font-bold text-white">{targetBoxName}</span>
                  </span>
                ) : (
                  <span className="font-bold text-white text-right truncate">
                    {singleBoxName}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-300 shrink-0">Estado a aplicar</span>
              <span className={`font-bold text-right uppercase tracking-wide ${estadoToneClass}`}>
                {estadoAplicar}
              </span>
            </div>
          </div>

          {rowEffectNote && (
            <p className="mt-3 text-xs text-zinc-300 leading-relaxed">{rowEffectNote}</p>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="h-11 sm:h-10 px-4 rounded-lg border border-[#475569] bg-transparent hover:bg-white/5 active:scale-[0.98] text-zinc-100 text-base sm:text-sm font-semibold inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E131E]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className="h-11 sm:h-10 px-4 rounded-lg border border-transparent bg-[#047857] hover:bg-[#059669] active:scale-[0.98] text-white text-base sm:text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E131E]"
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
                <span>Aplicando...</span>
              </>
            ) : (
              <span>Confirmar</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
