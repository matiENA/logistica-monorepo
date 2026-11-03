import React from 'react';
import { useDashStore } from '../../store/useDashStore';

interface ColumnSplitterProps {
  leftKey: string;
  rightKey: string;
}

export const ColumnSplitter: React.FC<ColumnSplitterProps> = ({ leftKey, rightKey }) => {
  const { modoCartelera, setColumnWidth } = useDashStore();

  if (modoCartelera) return null;

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();

    const leftCol = document.querySelector(`[data-cat="${leftKey}"]`) as HTMLElement;
    const rightCol = document.querySelector(`[data-cat="${rightKey}"]`) as HTMLElement;
    const container = document.getElementById('kanban-columns-wrapper');
    if (!leftCol || !rightCol || !container) return;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const containerWidth = container.getBoundingClientRect().width;
    const clientX = 'clientX' in e ? e.clientX : e.touches[0].clientX;
    const startX = clientX;

    const leftRect = leftCol.getBoundingClientRect();
    const rightRect = rightCol.getBoundingClientRect();
    const startLeftWidth = leftRect.width;
    const startRightWidth = rightRect.width;
    const combinedWidth = startLeftWidth + startRightWidth;

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX =
        'clientX' in moveEvent
          ? moveEvent.clientX
          : moveEvent.touches && moveEvent.touches[0]
          ? moveEvent.touches[0].clientX
          : startX;
      const deltaX = currentX - startX;

      const minWidth = 130;
      const newLeftWidth = Math.max(minWidth, Math.min(combinedWidth - minWidth, startLeftWidth + deltaX));
      const newRightWidth = combinedWidth - newLeftWidth;

      const baseWidth = containerWidth / 5;
      const leftFlex = Math.max(0.3, newLeftWidth / baseWidth);
      const rightFlex = Math.max(0.3, newRightWidth / baseWidth);

      leftCol.style.flex = `${leftFlex} 1 0%`;
      rightCol.style.flex = `${rightFlex} 1 0%`;

      setColumnWidth(leftKey, leftFlex);
      setColumnWidth(rightKey, rightFlex);
    };

    const onEnd = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
      data-left={leftKey}
      data-right={rightKey}
      className="col-splitter w-2.5 h-full cursor-col-resize shrink-0 flex items-center justify-center group z-20 hover:bg-indigo-500/20 active:bg-indigo-500/40 transition-colors rounded-full -mx-1"
      title="Arrastrar para ajustar proporción de columnas"
    >
      <div className="w-0.5 h-8 bg-slate-400/40 group-hover:bg-indigo-400 rounded-full transition-colors"></div>
    </div>
  );
};
