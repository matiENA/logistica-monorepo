export type IdleDockState = 'zoom-out' | 'hover' | 'pinned';
export type IdleCardState = 'zoom-out' | 'hover' | 'pinned';

export interface IdleDockStateDependencies {
  isHovered: boolean;
  hasPinned: boolean;
  isDraggingCard: boolean;
}

export interface IdleCardStateDependencies {
  dockState: IdleDockState;
  isCardPinned: boolean;
}

export interface IdleDockStateSpec {
  heightPx: number;
  heightClass: string;
  surfaceClass: string;
  dependsOn: readonly ('isHovered' | 'hasPinned' | 'isDraggingCard')[];
}

export interface IdleCardStateSpec {
  widthPx: number;
  heightPx: number;
  sizeClass: string;
  headerLayoutClass: string;
  platesGroupGapClass: string;
  plateSize: 'sm';
  surfaceStandardClass: string;
  surfacePreasignadoClass: string;
  surfaceFreedClass: string;
  slots: {
    showGrip: boolean;
    showHoverMetadata: boolean;
    showHoverNotePreview: boolean;
    showPinnedHeaderMeta: boolean;
    showPinnedBody: boolean;
    showPinnedNoteInput: boolean;
  };
  dataDependencies: {
    fetchFullNotesOnDemand: boolean;
    allowNoteInputFocus: boolean;
  };
}

export const IDLE_SMOOTH_EASE =
  'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';

export const IDLE_TAB_AUTO_CYCLE_MS = 4500;

/**
 * Declaración de estados y dependencias del contenedor horizontal (Dock).
 * - zoom-out: reposo sin hover, sin cards fijadas y sin arrastre activo.
 * - hover: cursor sobre el dock o drag activo, sin cards fijadas.
 * - pinned: al menos una card fijada (prioridad sobre hover y zoom-out).
 */
export const IDLE_DOCK_STATE_SPEC: Record<IdleDockState, IdleDockStateSpec> = {
  'zoom-out': {
    heightPx: 132,
    heightClass: 'h-[132px]',
    surfaceClass: 'border-zinc-400/80 bg-zinc-200/30',
    dependsOn: [],
  },
  hover: {
    heightPx: 212,
    heightClass: 'h-[212px]',
    surfaceClass: 'border-zinc-500/90 bg-zinc-200/50',
    dependsOn: ['isHovered', 'isDraggingCard'],
  },
  pinned: {
    heightPx: 302,
    heightClass: 'h-[302px]',
    surfaceClass: 'border-zinc-500/90 bg-zinc-200/50',
    dependsOn: ['hasPinned'],
  },
};

/**
 * Declaración de estados, dimensiones en px, tokens WCAG 2.2 (borde uniforme 1px sin barra lateral)
 * y dependencias de slots/datos para cada card dentro del dock.
 */
export const IDLE_CARD_STATE_SPEC: Record<IdleCardState, IdleCardStateSpec> = {
  'zoom-out': {
    widthPx: 120,
    heightPx: 72,
    sizeClass: 'w-[120px] h-[72px] px-[7px] py-1.5',
    headerLayoutClass: 'gap-0',
    platesGroupGapClass: 'gap-0',
    plateSize: 'sm',
    surfaceStandardClass:
      'bg-white border-zinc-300/90 shadow-2xs hover:border-zinc-500 hover:shadow-sm',
    surfacePreasignadoClass:
      'bg-[#FDE68A] border-amber-400/80 shadow-xs hover:bg-[#FCD34D]',
    surfaceFreedClass:
      'animate-card-freed border-[#047857]/80 shadow-2xs hover:border-[#047857] hover:shadow-sm',
    slots: {
      showGrip: false,
      showHoverMetadata: false,
      showHoverNotePreview: false,
      showPinnedHeaderMeta: false,
      showPinnedBody: false,
      showPinnedNoteInput: false,
    },
    dataDependencies: {
      fetchFullNotesOnDemand: false,
      allowNoteInputFocus: false,
    },
  },
  hover: {
    widthPx: 308,
    heightPx: 148,
    sizeClass: 'w-[308px] h-[148px] p-2.5',
    headerLayoutClass: 'justify-between gap-2',
    platesGroupGapClass: 'gap-1.5',
    plateSize: 'sm',
    surfaceStandardClass:
      'bg-white border-zinc-300/90 shadow-2xs hover:border-zinc-500 hover:shadow-sm',
    surfacePreasignadoClass:
      'bg-[#FDE68A] border-amber-400/80 shadow-xs hover:bg-[#FCD34D]',
    surfaceFreedClass: 'bg-[#DCFCE7] border-[#047857] shadow-xs',
    slots: {
      showGrip: true,
      showHoverMetadata: true,
      showHoverNotePreview: true,
      showPinnedHeaderMeta: false,
      showPinnedBody: false,
      showPinnedNoteInput: false,
    },
    dataDependencies: {
      fetchFullNotesOnDemand: false,
      allowNoteInputFocus: false,
    },
  },
  pinned: {
    widthPx: 336,
    heightPx: 238,
    sizeClass: 'w-[336px] h-[238px] p-2.5',
    headerLayoutClass: 'justify-between gap-2',
    platesGroupGapClass: 'gap-1.5',
    plateSize: 'sm',
    surfaceStandardClass: 'bg-[#F1F2F4] border-zinc-400/90 shadow-sm',
    surfacePreasignadoClass:
      'bg-[#FDE68A] border-amber-500/70 ring-1 ring-amber-600/45 shadow-sm',
    surfaceFreedClass:
      'bg-[#D1FAE5] border-[#047857] ring-1 ring-emerald-700/40 shadow-sm',
    slots: {
      showGrip: true,
      showHoverMetadata: false,
      showHoverNotePreview: false,
      showPinnedHeaderMeta: true,
      showPinnedBody: true,
      showPinnedNoteInput: true,
    },
    dataDependencies: {
      fetchFullNotesOnDemand: true,
      allowNoteInputFocus: true,
    },
  },
};

export function resolveIdleDockState(deps: IdleDockStateDependencies): IdleDockState {
  if (deps.hasPinned) return 'pinned';
  if (deps.isHovered || deps.isDraggingCard) return 'hover';
  return 'zoom-out';
}

export function resolveIdleCardState(deps: IdleCardStateDependencies): IdleCardState {
  if (deps.isCardPinned) return 'pinned';
  if (deps.dockState === 'hover' || deps.dockState === 'pinned') return 'hover';
  return 'zoom-out';
}
