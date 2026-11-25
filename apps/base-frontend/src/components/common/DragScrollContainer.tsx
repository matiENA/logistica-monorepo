import React from 'react';
import {
  useDragAutoScroll,
  type DragAutoScrollOptions,
} from '../../hooks/useDragAutoScroll';

export interface DragScrollContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    DragAutoScrollOptions {
  children: React.ReactNode;
}

export const DragScrollContainer: React.FC<DragScrollContainerProps> = ({
  children,
  horizontal = false,
  vertical = false,
  edgePx,
  minEdgePx,
  edgeRatio,
  maxSpeedPxPerSec,
  topAllowancePx,
  bottomAllowancePx,
  leftAllowancePx,
  rightAllowancePx,
  ...rest
}) => {
  const { setRef } = useDragAutoScroll<HTMLDivElement>({
    horizontal,
    vertical,
    edgePx,
    minEdgePx,
    edgeRatio,
    maxSpeedPxPerSec,
    topAllowancePx,
    bottomAllowancePx,
    leftAllowancePx,
    rightAllowancePx,
  });

  return (
    <div ref={setRef} {...rest}>
      {children}
    </div>
  );
};
