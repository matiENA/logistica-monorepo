import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CatalogUnitItem } from '../../hooks/usePlaneacionKanban';
import { UnitLicensePlate } from '../common/UnitLicensePlate';
import { IDLE_CARD_STATE_SPEC } from './idleDockStates';
import type { OriginRect } from './NewIngresoModal';

interface FlyingCardTransitionProps {
  unit: CatalogUnitItem;
  originRect: OriginRect;
  getTargetRect: () => OriginRect | null;
  onComplete: () => void;
}

const { widthPx: CARD_W, heightPx: CARD_H } = IDLE_CARD_STATE_SPEC['zoom-out'];

export const FlyingCardTransition: React.FC<FlyingCardTransitionProps> = ({
  unit,
  originRect,
  getTargetRect,
  onComplete,
}) => {
  const [phase, setPhase] = useState<'initial' | 'crafting' | 'flying'>('initial');
  const [flightDelta, setFlightDelta] = useState<{
    dx: number;
    dy: number;
    sx: number;
    sy: number;
  }>({ dx: 0, dy: 0, sx: 1, sy: 1 });

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const getTargetRectRef = useRef(getTargetRect);
  getTargetRectRef.current = getTargetRect;

  const startLeft = originRect.left + (originRect.width - CARD_W) / 2;
  const startTop = originRect.top + (originRect.height - CARD_H) / 2;

  useLayoutEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      const t = setTimeout(() => onCompleteRef.current(), 20);
      return () => clearTimeout(t);
    }

    let raf1 = 0;
    let raf2 = 0;
    let craftTimer: ReturnType<typeof setTimeout> | null = null;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setPhase('crafting');
      });
    });

    craftTimer = setTimeout(() => {
      const target = getTargetRectRef.current();
      if (target) {
        setFlightDelta({
          dx: target.left - startLeft,
          dy: target.top - startTop,
          sx: target.width / CARD_W,
          sy: target.height / CARD_H,
        });
      }
      setPhase('flying');

      doneTimer = setTimeout(() => {
        onCompleteRef.current();
      }, 430);
    }, 230);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (craftTimer) clearTimeout(craftTimer);
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [startLeft, startTop]);

  // Safety cleanup if component stays mounted longer than expected
  useEffect(() => {
    const safety = setTimeout(() => {
      onCompleteRef.current();
    }, 1200);
    return () => clearTimeout(safety);
  }, []);

  const transformStyle =
    phase === 'initial'
      ? 'translate3d(0px, 0px, 0) scale(1)'
      : phase === 'crafting'
      ? 'translate3d(0px, 0px, 0) scale(1.08)'
      : `translate3d(${flightDelta.dx}px, ${flightDelta.dy}px, 0) scale(${flightDelta.sx}, ${flightDelta.sy})`;

  const transitionStyle =
    phase === 'crafting'
      ? 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1), background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease'
      : phase === 'flying'
      ? 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 350ms ease, border-color 350ms ease'
      : 'none';

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: `${startLeft}px`,
        top: `${startTop}px`,
        width: `${CARD_W}px`,
        height: `${CARD_H}px`,
        zIndex: 70,
        pointerEvents: 'none',
        transformOrigin: 'top left',
        transform: transformStyle,
        transition: transitionStyle,
        willChange: 'transform',
      }}
      className={`rounded-lg px-2 py-1.5 flex flex-col items-center justify-center gap-[3px] select-none ${
        phase === 'initial'
          ? 'bg-transparent border border-transparent shadow-none'
          : phase === 'crafting'
          ? 'bg-white border border-zinc-300 shadow-xl ring-2 ring-emerald-600/45'
          : 'bg-white border border-zinc-300 shadow-md ring-1 ring-emerald-600/25'
      }`}
    >
      {unit.tractor_plate && (
        <UnitLicensePlate plate={unit.tractor_plate} label="Tractor" size="sm" />
      )}
      {unit.semi_plate && (
        <UnitLicensePlate plate={unit.semi_plate} label="Semi" size="sm" />
      )}
    </div>,
    document.body
  );
};
