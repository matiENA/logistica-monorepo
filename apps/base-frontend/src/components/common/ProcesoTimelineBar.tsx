import React, { useState } from 'react';
import type { CircuitoTimelineStep, ProcesoTimelineStatus } from '../../types/planeacion';

export interface ProcesoTimelineBarProps {
  steps: CircuitoTimelineStep[];
  theme: 'light' | 'dark';
  canReorder?: boolean;
  onReorder?: (orderedPreasignadoIds: string[]) => void;
  className?: string;
}

const TIMELINE_STEP_DRAG_MIME = 'application/x-proceso-timeline-step';

const STEP_STYLE_BY_THEME: Record<
  'light' | 'dark',
  Record<ProcesoTimelineStatus, string>
> = {
  light: {
    TERMINADO: 'bg-emerald-700 text-white font-bold',
    EN_CURSO: 'bg-blue-700 text-white font-normal',
    PREASIGNADO: 'bg-zinc-600 text-white font-normal',
  },
  dark: {
    TERMINADO: 'bg-emerald-800 text-emerald-50 font-bold',
    EN_CURSO: 'bg-blue-800 text-blue-50 font-normal',
    PREASIGNADO: 'bg-zinc-700 text-zinc-100 font-normal',
  },
};

const STATUS_LABEL: Record<ProcesoTimelineStatus, string> = {
  TERMINADO: 'Terminado',
  EN_CURSO: 'En curso',
  PREASIGNADO: 'Preasignado',
};

function getChevronClipPath(isFirst: boolean): string {
  // Flecha encastrada derecha (8px) y muesca izquierda (8px) salvo en el primer elemento
  return isFirst
    ? 'polygon(0% 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 0% 100%)'
    : 'polygon(0% 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 0% 100%, 8px 50%)';
}

/**
 * Timeline horizontal de procesos en forma de chevrones encastrados (tied bottom):
 * - Verde bold: procesos terminados
 * - Azul regular: proceso en curso
 * - Gris regular: procesos preasignados (reordenables exclusivamente por Coordinación)
 */
export const ProcesoTimelineBar: React.FC<ProcesoTimelineBarProps> = ({
  steps,
  theme,
  canReorder = false,
  onReorder,
  className = '',
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  if (!steps || steps.length === 0) return null;

  const preasignadoSteps = steps.filter((s) => s.status === 'PREASIGNADO');
  const canDragPreasignados = canReorder && Boolean(onReorder) && preasignadoSteps.length > 1;

  const commitMove = (fromProcesoId: string, toProcesoId: string) => {
    if (!onReorder || fromProcesoId === toProcesoId) return;
    const ids = preasignadoSteps.map((s) => s.proceso_id);
    const fromIdx = ids.indexOf(fromProcesoId);
    const toIdx = ids.indexOf(toProcesoId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder(next);
  };

  const handleKeyboardShift = (
    e: React.KeyboardEvent<HTMLDivElement>,
    step: CircuitoTimelineStep
  ) => {
    if (!canDragPreasignados || step.status !== 'PREASIGNADO') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

    e.preventDefault();
    e.stopPropagation();

    const ids = preasignadoSteps.map((s) => s.proceso_id);
    const idx = ids.indexOf(step.proceso_id);
    if (idx === -1) return;

    const targetIdx = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= ids.length) return;

    commitMove(step.proceso_id, ids[targetIdx]);
  };

  const themeMap = STEP_STYLE_BY_THEME[theme];

  return (
    <div
      role="list"
      aria-label="Timeline de procesos del circuito"
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center w-full overflow-x-auto no-scrollbar border-t ${
        theme === 'light'
          ? 'border-zinc-300/70 bg-black/[0.03]'
          : 'border-white/10 bg-black/25'
      } px-1.5 py-1 rounded-b-[5px] ${className}`}
    >
      <div className="flex items-center min-w-0 w-full">
        {steps.map((step, idx) => {
          const isFirst = idx === 0;
          const isPreasignado = step.status === 'PREASIGNADO';
          const isStepDraggable = canDragPreasignados && isPreasignado;
          const isBeingDragged = draggingId === step.proceso_id;
          const isDropTarget = dragOverId === step.proceso_id && draggingId !== step.proceso_id;

          return (
            <div
              key={step.proceso_id}
              role="listitem"
              tabIndex={isStepDraggable ? 0 : undefined}
              draggable={isStepDraggable}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => handleKeyboardShift(e, step)}
              onDragStart={(e) => {
                if (!isStepDraggable) {
                  e.preventDefault();
                  return;
                }
                e.stopPropagation();
                setDraggingId(step.proceso_id);
                try {
                  e.dataTransfer.setData(TIMELINE_STEP_DRAG_MIME, step.proceso_id);
                  e.dataTransfer.setData('text/plain', step.proceso_id);
                  e.dataTransfer.effectAllowed = 'move';
                } catch {
                  // ignore dataTransfer restrictions
                }
              }}
              onDragOver={(e) => {
                if (!isStepDraggable || !draggingId) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverId !== step.proceso_id) {
                  setDragOverId(step.proceso_id);
                }
              }}
              onDragLeave={(e) => {
                e.stopPropagation();
                if (dragOverId === step.proceso_id) {
                  setDragOverId(null);
                }
              }}
              onDrop={(e) => {
                if (!isStepDraggable) return;
                e.preventDefault();
                e.stopPropagation();
                const droppedId =
                  e.dataTransfer.getData(TIMELINE_STEP_DRAG_MIME) || draggingId;
                setDraggingId(null);
                setDragOverId(null);
                if (droppedId) {
                  commitMove(droppedId, step.proceso_id);
                }
              }}
              onDragEnd={(e) => {
                e.stopPropagation();
                setDraggingId(null);
                setDragOverId(null);
              }}
              style={{
                clipPath: getChevronClipPath(isFirst),
                zIndex: steps.length - idx,
              }}
              title={
                isStepDraggable
                  ? `${step.zone_name || 'Zona'} · ${STATUS_LABEL[step.status]} (Arrastrar o ←/→ para reordenar)`
                  : `${step.zone_name || 'Zona'} · ${STATUS_LABEL[step.status]}`
              }
              aria-label={`${step.zone_name || 'Zona'} (${STATUS_LABEL[step.status]})${
                isStepDraggable ? ' · Reordenable con flechas o arrastrando' : ''
              }`}
              className={`relative flex-1 min-w-[46px] h-[22px] flex items-center justify-center select-none transition-[opacity,transform,filter] duration-150 ${
                isFirst ? 'pl-2 pr-3 rounded-l-[3px]' : 'pl-3.5 pr-3 -ml-[5px]'
              } ${themeMap[step.status]} ${
                isStepDraggable
                  ? 'cursor-grab active:cursor-grabbing hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'
                  : 'cursor-default'
              } ${isBeingDragged ? 'opacity-45 scale-95' : ''} ${
                isDropTarget ? 'ring-2 ring-white/90 brightness-125' : ''
              }`}
            >
              <span className="text-[10px] leading-none tracking-tight truncate">
                {step.zone_name || 'Zona'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
