import React, { useEffect, useRef } from 'react';

interface AutoScrollSectorColumnProps {
  children: React.ReactNode;
  itemsCount: number;
  isSectorHovered?: boolean;
  isExternalPaused?: boolean;
  speed?: number; // Píxeles por segundo (por defecto: 28px/s para lectura descansada)
  pauseTopMs?: number; // Pausa al inicio (por defecto: 3500ms)
  pauseBottomMs?: number; // Pausa al llegar al final (por defecto: 3500ms)
  className?: string;
  ariaLabel?: string;
}

/**
 * Contenedor de auto-scroll independiente por sector para el tablero de Coordinación:
 * 1. Auto-scroll suave e independiente cuando las cards exceden la altura del viewport.
 * 2. Scroll manual completo (rueda del mouse o touch) sin barra visible ("sin barra").
 * 3. Desactivación instantánea del auto-scroll al colocar el cursor sobre el sector (hover).
 * 4. Suspensión al interactuar manualmente y reanudación automática tras inactividad.
 * 5. Cumplimiento WCAG 2.2.2 (Pause, Stop, Hide) y respeto a prefers-reduced-motion.
 */
export const AutoScrollSectorColumn: React.FC<AutoScrollSectorColumnProps> = ({
  children,
  itemsCount,
  isSectorHovered = false,
  isExternalPaused = false,
  speed = 28,
  pauseTopMs = 3500,
  pauseBottomMs = 3500,
  className = '',
  ariaLabel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveredRef = useRef(isSectorHovered);
  const isExternalPausedRef = useRef(isExternalPaused);
  const isUserInteractingRef = useRef(false);
  const isFocusedRef = useRef(false);
  const userInteractionTimeoutRef = useRef<number | null>(null);

  // Mantener referencias actualizadas sincronizadas con props
  useEffect(() => {
    isHoveredRef.current = isSectorHovered;
  }, [isSectorHovered]);

  useEffect(() => {
    isExternalPausedRef.current = isExternalPaused;
  }, [isExternalPaused]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Respeto estricto a accesibilidad: usuarios con prefers-reduced-motion no tienen autoscroll
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    let animId: number;
    let lastTimestamp = performance.now();
    let state: 'pause-top' | 'scrolling-down' | 'pause-bottom' = 'pause-top';
    let pauseUntil = performance.now() + pauseTopMs;

    const tick = (now: number) => {
      const dt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      if (!el) return;

      const maxScroll = el.scrollHeight - el.clientHeight;

      // Si las cards entran completas en pantalla sin desbordar, no hay nada que scrollear
      if (maxScroll <= 8) {
        animId = requestAnimationFrame(tick);
        return;
      }

      // Si el cursor está arriba del sector (hover), o el usuario está scrolleando manualmente,
      // o el modal está abierto, congelar el auto-scroll de inmediato
      if (
        isHoveredRef.current ||
        isExternalPausedRef.current ||
        isUserInteractingRef.current ||
        isFocusedRef.current
      ) {
        animId = requestAnimationFrame(tick);
        return;
      }

      // Durante los periodos de pausa (al inicio o al final) esperar
      if (now < pauseUntil) {
        animId = requestAnimationFrame(tick);
        return;
      }

      if (state === 'pause-top') {
        state = 'scrolling-down';
      } else if (state === 'scrolling-down') {
        el.scrollTop += speed * dt;

        // Si llegó al fondo de la columna
        if (el.scrollTop >= maxScroll - 2) {
          el.scrollTop = maxScroll;
          state = 'pause-bottom';
          pauseUntil = now + pauseBottomMs;
        }
      } else if (state === 'pause-bottom') {
        // Regreso suave al inicio
        el.scrollTo({ top: 0, behavior: 'smooth' });
        state = 'pause-top';
        pauseUntil = now + pauseTopMs;
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
      if (userInteractionTimeoutRef.current) {
        window.clearTimeout(userInteractionTimeoutRef.current);
      }
    };
  }, [itemsCount, speed, pauseTopMs, pauseBottomMs]);

  // Manejo de interacción manual (rueda o touch)
  const handleUserScrollInteraction = () => {
    isUserInteractingRef.current = true;
    if (userInteractionTimeoutRef.current) {
      window.clearTimeout(userInteractionTimeoutRef.current);
    }
    // Reanudar auto-scroll 4.5 segundos después de que el usuario deje de scrollear manualmente
    userInteractionTimeoutRef.current = window.setTimeout(() => {
      isUserInteractingRef.current = false;
    }, 4500);
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleUserScrollInteraction}
      onTouchStart={handleUserScrollInteraction}
      onTouchMove={handleUserScrollInteraction}
      onFocusCapture={() => {
        isFocusedRef.current = true;
      }}
      onBlurCapture={() => {
        isFocusedRef.current = false;
      }}
      tabIndex={0}
      aria-label={ariaLabel || 'Columna de unidades con desplazamiento automático y manual'}
      className={`flex-1 min-h-0 overflow-y-auto no-scrollbar outline-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {children}
    </div>
  );
};
