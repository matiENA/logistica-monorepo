import React, { useEffect, useRef } from 'react';

interface AutoScrollColumnProps {
  children: React.ReactNode;
  itemsCount: number;
  isHovered: boolean;
  isPaused?: boolean;
  className?: string;
  ariaLabel?: string;
}

export const AutoScrollColumn: React.FC<AutoScrollColumnProps> = ({
  children,
  itemsCount,
  isHovered,
  isPaused = false,
  className = '',
  ariaLabel,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const directionRef = useRef<1 | -1>(1);
  const pauseUntilRef = useRef<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId: number;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;

      if (!isHovered && !isPaused && now > pauseUntilRef.current) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll > 4) {
          const delta = (dt / 1000) * 18 * directionRef.current;
          el.scrollTop += delta;

          if (el.scrollTop >= maxScroll - 1 && directionRef.current === 1) {
            directionRef.current = -1;
            pauseUntilRef.current = now + 1800;
          } else if (el.scrollTop <= 1 && directionRef.current === -1) {
            directionRef.current = 1;
            pauseUntilRef.current = now + 1800;
          }
        }
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isHovered, isPaused, itemsCount]);

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      className={`flex-1 min-h-0 overflow-y-auto no-scrollbar ${className}`}
    >
      {children}
    </div>
  );
};
