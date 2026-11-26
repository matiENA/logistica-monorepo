import React, { useEffect } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  Loader2,
  LogIn,
  RotateCcw,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { UnitLicensePlate } from '../common/UnitLicensePlate';

export type TallerConfirmMoveKind =
  | 'TERMINADO'
  | 'MOVIMIENTO_BOX'
  | 'CAMBIO_ZONA'
  | 'VOLVER_RESERVADO';

export interface TallerConfirmMoveModalProps {
  open: boolean;
  kind: TallerConfirmMoveKind;
  title: string;
  unitLabel: string;
  tractorPlate?: string | null;
  semiPlate?: string | null;
  sourceBoxName?: string | null;
  targetBoxName?: string | null;
  sourceUsers?: string[];
  targetUsers?: string[];
  sourceEncargado?: string | null;
  targetEncargado?: string | null;
  estadoAplicar: string;
  rowEffectNote?: string | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function normalizeUserNames(names?: string[] | null): string[] {
  if (!names || names.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function areUserListsEqual(a: string[], b: string[]): boolean {
  const setA = new Set(a.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const setB = new Set(b.map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}

export const TallerConfirmMoveModal: React.FC<TallerConfirmMoveModalProps> = ({
  open,
  kind,
  title,
  unitLabel,
  tractorPlate = null,
  semiPlate = null,
  sourceBoxName,
  targetBoxName,
  sourceUsers = [],
  targetUsers = [],
  sourceEncargado = null,
  targetEncargado = null,
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
      : kind === 'VOLVER_RESERVADO'
      ? RotateCcw
      : LogIn;

  const estadoToneClass =
    kind === 'TERMINADO'
      ? 'text-zinc-100'
      : kind === 'VOLVER_RESERVADO'
      ? 'text-blue-300'
      : estadoAplicar.includes('AFUERA')
      ? 'text-amber-300'
      : 'text-emerald-300';

  const hasDistinctBoxes = Boolean(
    sourceBoxName && targetBoxName && sourceBoxName !== targetBoxName
  );
  const singleBoxName = targetBoxName || sourceBoxName || null;

  const cleanTractorPlate = tractorPlate?.trim() || '';
  const cleanSemiPlate = semiPlate?.trim() || '';
  const hasPlates = Boolean(cleanTractorPlate || cleanSemiPlate);

  const normalizedSourceUsers = normalizeUserNames(sourceUsers);
  const normalizedTargetUsers = normalizeUserNames(targetUsers);
  const operariosChanged = !areUserListsEqual(normalizedSourceUsers, normalizedTargetUsers);

  const normSourceEncargado = sourceEncargado?.trim() || null;
  const normTargetEncargado = targetEncargado?.trim() || null;
  const encargadoChanged =
    (normSourceEncargado?.toLowerCase() ?? null) !== (normTargetEncargado?.toLowerCase() ?? null);

  const hasAnyUserChange = operariosChanged || encargadoChanged;
  const isReassignmentOrClear =
    (operariosChanged && normalizedSourceUsers.length > 0) ||
    (encargadoChanged && Boolean(normSourceEncargado));

  const changeArrowClass = isReassignmentOrClear
    ? 'text-amber-300 shrink-0'
    : 'text-emerald-300 shrink-0';

  const renderUserChip = (
    name: string,
    variant: 'keep' | 'before' | 'target' | 'encargado-static',
    isEncargadoChip = false
  ) => {
    const Icon = isEncargadoChip ? UserCheck : User;
    const toneClasses =
      variant === 'target'
        ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-200 font-semibold'
        : variant === 'encargado-static'
        ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300 font-medium'
        : variant === 'before'
        ? 'bg-[#0E131E] border-[#334155] text-zinc-300 font-medium'
        : 'bg-[#0E131E] border-[#334155] text-zinc-200 font-medium';
    const iconClass =
      variant === 'target'
        ? 'text-emerald-300 shrink-0'
        : variant === 'encargado-static'
        ? 'shrink-0'
        : variant === 'before'
        ? 'text-zinc-400 shrink-0'
        : 'text-[#10B981] shrink-0';

    return (
      <span
        key={`${variant}-${isEncargadoChip ? 'enc' : 'op'}-${name}`}
        className={`inline-flex items-center gap-1 max-w-full text-[11px] px-2 py-0.5 rounded border ${toneClasses}`}
      >
        <Icon size={11} strokeWidth={2} aria-hidden="true" focusable="false" className={iconClass} />
        <span className="truncate">{name}</span>
      </span>
    );
  };

  const renderUserTransitionRow = (opts: {
    label: string;
    beforeNames: string[];
    afterNames: string[];
    emptyAfterLabel: string;
    isEncargadoRow?: boolean;
  }) => (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
        {opts.label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {opts.beforeNames.length > 0 ? (
          opts.beforeNames.map((uname) => renderUserChip(uname, 'before', opts.isEncargadoRow))
        ) : (
          <span className="text-xs italic text-zinc-400">Sin asignar</span>
        )}
        <ArrowRight
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          focusable="false"
          className={changeArrowClass}
        />
        {opts.afterNames.length > 0 ? (
          opts.afterNames.map((uname) => renderUserChip(uname, 'target', opts.isEncargadoRow))
        ) : (
          <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200">
            {opts.emptyAfterLabel}
          </span>
        )}
      </div>
    </div>
  );

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
        className="w-full max-w-[460px] bg-[#0E131E] border border-[#334155] rounded-2xl p-5 shadow-2xl text-[#F3F4F6]"
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
            <X size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          </button>
        </div>

        <div id="taller-confirm-desc" className="mt-4">
          <div className="bg-[#141A26] border border-[#263042] rounded-xl p-3.5 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-300 shrink-0">Unidad</span>
              {hasPlates ? (
                <div
                  className="flex flex-wrap items-center justify-end gap-1.5 min-w-0"
                  aria-label={`Patentes ${unitLabel}`}
                >
                  {cleanTractorPlate && (
                    <UnitLicensePlate plate={cleanTractorPlate} label="Tractor" size="sm" />
                  )}
                  {cleanSemiPlate && (
                    <UnitLicensePlate plate={cleanSemiPlate} label="Semi" size="sm" />
                  )}
                </div>
              ) : (
                <span className="font-bold text-white font-numeric text-right truncate">
                  {unitLabel}
                </span>
              )}
            </div>

            {(hasDistinctBoxes || singleBoxName) && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-300 shrink-0">Box</span>
                {hasDistinctBoxes ? (
                  <span className="inline-flex items-center justify-end gap-1.5 min-w-0 flex-wrap text-right">
                    <span className="font-bold text-white font-numeric">{sourceBoxName}</span>
                    <ArrowRight
                      size={14}
                      strokeWidth={2}
                      aria-hidden="true"
                      focusable="false"
                      className="text-zinc-400 shrink-0"
                    />
                    <span className="font-bold text-emerald-300 font-numeric">
                      {targetBoxName}
                    </span>
                  </span>
                ) : (
                  <span className="font-bold text-white font-numeric text-right truncate">
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

            {!operariosChanged &&
              (normalizedSourceUsers.length > 0 || (!encargadoChanged && normSourceEncargado)) && (
                <div className="pt-2.5 border-t border-[#263042] flex items-start justify-between gap-3">
                  <span className="text-zinc-300 shrink-0">
                    {encargadoChanged ? 'Operarios' : 'Usuarios'}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
                    {normalizedSourceUsers.map((uname) => renderUserChip(uname, 'keep'))}
                    {!encargadoChanged &&
                      normSourceEncargado &&
                      renderUserChip(normSourceEncargado, 'encargado-static', true)}
                  </div>
                </div>
              )}
          </div>

          {hasAnyUserChange && (
            <div
              className={`mt-3 bg-[#141A26] rounded-xl p-3.5 space-y-2.5 border ${
                isReassignmentOrClear ? 'border-amber-500/40' : 'border-emerald-500/35'
              }`}
            >
              <div
                className={`flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider ${
                  isReassignmentOrClear ? 'text-amber-200' : 'text-emerald-200'
                }`}
              >
                <Users size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
                <span>Cambio de usuarios</span>
              </div>

              {operariosChanged &&
                renderUserTransitionRow({
                  label: 'Operarios',
                  beforeNames: normalizedSourceUsers,
                  afterNames: normalizedTargetUsers,
                  emptyAfterLabel: 'Sin usuarios',
                })}

              {encargadoChanged &&
                renderUserTransitionRow({
                  label: 'Encargado',
                  beforeNames: normSourceEncargado ? [normSourceEncargado] : [],
                  afterNames: normTargetEncargado ? [normTargetEncargado] : [],
                  emptyAfterLabel: 'Sin encargado',
                  isEncargadoRow: true,
                })}
            </div>
          )}

          {rowEffectNote && (
            <p
              className={
                kind === 'VOLVER_RESERVADO'
                  ? 'mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5 text-xs text-amber-200 leading-relaxed'
                  : 'mt-3 text-xs text-zinc-300 leading-relaxed'
              }
            >
              {rowEffectNote}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="h-11 sm:h-10 px-4 rounded-lg border border-[#64748B] bg-transparent hover:bg-white/5 active:scale-[0.98] text-zinc-100 text-base sm:text-sm font-semibold inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E131E]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className="h-11 sm:h-10 px-4 rounded-lg border border-transparent bg-[#047857] hover:bg-[#065F46] active:scale-[0.98] text-white text-base sm:text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E131E]"
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
