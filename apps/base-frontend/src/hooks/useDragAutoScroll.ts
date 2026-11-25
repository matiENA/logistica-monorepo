import { useCallback, useEffect, useRef, useState } from 'react';

export interface DragAutoScrollOptions {
  horizontal?: boolean;
  vertical?: boolean;
  /** Máxima distancia desde el borde en px donde se activa el auto-scroll */
  edgePx?: number;
  /** Distancia mínima desde el borde en px cuando se usa edgeRatio */
  minEdgePx?: number;
  /** Proporción del ancho/alto del contenedor usada como zona disparadora (ej. 1.5/9) */
  edgeRatio?: number;
  /** Velocidad máxima en px/s cuando el puntero alcanza el borde */
  maxSpeedPxPerSec?: number;
  /** Márgenes externos opcionales para cubrir headers o paddings del contenedor */
  topAllowancePx?: number;
  bottomAllowancePx?: number;
  leftAllowancePx?: number;
  rightAllowancePx?: number;
}

interface RegisteredTarget {
  el: HTMLElement;
  getOptions: () => DragAutoScrollOptions;
}

const DEFAULT_HORIZONTAL_EDGE_PX = 180;
const DEFAULT_HORIZONTAL_MIN_EDGE_PX = 110;
const DEFAULT_HORIZONTAL_EDGE_RATIO = 1.5 / 9;
const DEFAULT_VERTICAL_EDGE_PX = 104;
const DEFAULT_MAX_SPEED_PX_SEC = 620;
const DRAG_GRACE_MS = 95;
const DRAG_ACTIVATION_MOVE_PX = 5;

const targets = new Map<HTMLElement, RegisteredTarget>();
const subPixelRemainders = new Map<HTMLElement, { rx: number; ry: number }>();
const dragListeners = new Set<(dragging: boolean) => void>();

let globalListenersAttached = false;
let isCardDragging = false;
let activeDragSourceEl: HTMLElement | null = null;
let dragStartedAt = 0;
let dragOriginX = 0;
let dragOriginY = 0;
let pointerX = 0;
let pointerY = 0;
let pointerInsideWindow = false;
let pointerMovedEnough = false;
let rafId: number | null = null;
let lastFrameTime = 0;

function notifyDragState(next: boolean) {
  if (isCardDragging === next) return;
  isCardDragging = next;
  for (const listener of dragListeners) {
    listener(next);
  }
}

function stopRafLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastFrameTime = 0;
}

function cleanupActiveSourceListener() {
  if (activeDragSourceEl) {
    activeDragSourceEl.removeEventListener('dragend', handleSourceDragEnd);
    activeDragSourceEl = null;
  }
}

function finishDrag() {
  cleanupActiveSourceListener();
  pointerInsideWindow = false;
  pointerMovedEnough = false;
  subPixelRemainders.clear();
  stopRafLoop();
  notifyDragState(false);
}

function handleSourceDragEnd() {
  finishDrag();
}

function computeEdgeSpeedRatio(distanceFromEdge: number, edgeSize: number): number {
  if (edgeSize <= 0) return 0;
  const clamped = Math.max(0, Math.min(edgeSize, distanceFromEdge));
  const linear = 1 - clamped / edgeSize;
  if (linear <= 0) return 0;
  return linear * (0.25 + 0.75 * linear);
}

function canScrollInDirection(
  el: HTMLElement,
  axis: 'x' | 'y',
  direction: -1 | 1
): boolean {
  if (axis === 'x') {
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    if (maxScrollLeft <= 2) return false;
    return direction < 0 ? el.scrollLeft > 1 : el.scrollLeft < maxScrollLeft - 1;
  }
  const maxScrollTop = el.scrollHeight - el.clientHeight;
  if (maxScrollTop <= 2) return false;
  return direction < 0 ? el.scrollTop > 1 : el.scrollTop < maxScrollTop - 1;
}

function pickDeepestCandidates(
  candidates: Array<{ el: HTMLElement; delta: number }>
): Array<{ el: HTMLElement; delta: number }> {
  if (candidates.length <= 1) return candidates;
  return candidates.filter(
    (item) =>
      !candidates.some((other) => other.el !== item.el && item.el.contains(other.el))
  );
}

function applyScrollWithRemainder(el: HTMLElement, dx: number, dy: number) {
  const prev = subPixelRemainders.get(el) || { rx: 0, ry: 0 };
  let appliedX = 0;
  let appliedY = 0;

  if (dx !== 0) {
    const totalX = prev.rx + dx;
    const wholeX = totalX >= 0 ? Math.floor(totalX) : Math.ceil(totalX);
    prev.rx = totalX - wholeX;
    if (wholeX !== 0) {
      const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
      el.scrollLeft = Math.max(0, Math.min(maxX, el.scrollLeft + wholeX));
      appliedX = wholeX;
    }
  } else {
    prev.rx = 0;
  }

  if (dy !== 0) {
    const totalY = prev.ry + dy;
    const wholeY = totalY >= 0 ? Math.floor(totalY) : Math.ceil(totalY);
    prev.ry = totalY - wholeY;
    if (wholeY !== 0) {
      const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.max(0, Math.min(maxY, el.scrollTop + wholeY));
      appliedY = wholeY;
    }
  } else {
    prev.ry = 0;
  }

  subPixelRemainders.set(el, prev);
  return appliedX !== 0 || appliedY !== 0;
}

function stepDragAutoScroll(now: number) {
  if (!isCardDragging) {
    stopRafLoop();
    return;
  }

  if (!lastFrameTime) {
    lastFrameTime = now;
    rafId = requestAnimationFrame(stepDragAutoScroll);
    return;
  }

  const dtSec = Math.min(now - lastFrameTime, 48) / 1000;
  lastFrameTime = now;

  const graceElapsed = now - dragStartedAt >= DRAG_GRACE_MS || pointerMovedEnough;

  if (pointerInsideWindow && graceElapsed && dtSec > 0) {
    const horizontalCandidates: Array<{ el: HTMLElement; delta: number }> = [];
    const verticalCandidates: Array<{ el: HTMLElement; delta: number }> = [];

    for (const target of targets.values()) {
      const { el, getOptions } = target;
      if (!el.isConnected) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const opts = getOptions();
      const topAllow = opts.topAllowancePx ?? 0;
      const bottomAllow = opts.bottomAllowancePx ?? 0;
      const leftAllow = opts.leftAllowancePx ?? 0;
      const rightAllow = opts.rightAllowancePx ?? 0;

      if (
        pointerX < rect.left - leftAllow ||
        pointerX > rect.right + rightAllow ||
        pointerY < rect.top - topAllow ||
        pointerY > rect.bottom + bottomAllow
      ) {
        continue;
      }

      const maxSpeed = opts.maxSpeedPxPerSec ?? DEFAULT_MAX_SPEED_PX_SEC;

      if (opts.horizontal) {
        const ratioXTarget = opts.edgeRatio ?? DEFAULT_HORIZONTAL_EDGE_RATIO;
        const rawEdgeX = Math.min(
          opts.edgePx ?? DEFAULT_HORIZONTAL_EDGE_PX,
          Math.max(opts.minEdgePx ?? DEFAULT_HORIZONTAL_MIN_EDGE_PX, rect.width * ratioXTarget)
        );
        const edgeX = Math.min(rawEdgeX, Math.max(24, rect.width * 0.3));
        const distLeft = Math.max(0, pointerX - rect.left);
        const distRight = Math.max(0, rect.right - pointerX);

        let ratioX = 0;
        let dirX: -1 | 1 | 0 = 0;
        if (pointerX <= rect.left + edgeX) {
          ratioX = computeEdgeSpeedRatio(distLeft, edgeX);
          dirX = -1;
        } else if (pointerX >= rect.right - edgeX) {
          ratioX = computeEdgeSpeedRatio(distRight, edgeX);
          dirX = 1;
        }

        if (dirX !== 0 && ratioX > 0 && canScrollInDirection(el, 'x', dirX)) {
          horizontalCandidates.push({
            el,
            delta: dirX * ratioX * maxSpeed * dtSec,
          });
        }
      }

      if (opts.vertical) {
        const rawEdgeY = opts.edgeRatio
          ? Math.min(
              opts.edgePx ?? DEFAULT_VERTICAL_EDGE_PX,
              Math.max(opts.minEdgePx ?? 28, rect.height * opts.edgeRatio)
            )
          : opts.edgePx ?? DEFAULT_VERTICAL_EDGE_PX;
        const edgeY = Math.min(rawEdgeY, Math.max(22, rect.height * 0.28));
        const distTop = Math.max(0, pointerY - rect.top);
        const distBottom = Math.max(0, rect.bottom - pointerY);

        let ratioY = 0;
        let dirY: -1 | 1 | 0 = 0;
        if (pointerY <= rect.top + edgeY) {
          ratioY = computeEdgeSpeedRatio(distTop, edgeY);
          dirY = -1;
        } else if (pointerY >= rect.bottom - edgeY) {
          ratioY = computeEdgeSpeedRatio(distBottom, edgeY);
          dirY = 1;
        }

        if (dirY !== 0 && ratioY > 0 && canScrollInDirection(el, 'y', dirY)) {
          verticalCandidates.push({
            el,
            delta: dirY * ratioY * maxSpeed * dtSec,
          });
        }
      }
    }

    const activeX = pickDeepestCandidates(horizontalCandidates);
    const activeY = pickDeepestCandidates(verticalCandidates);

    const deltaMap = new Map<HTMLElement, { dx: number; dy: number }>();
    for (const item of activeX) {
      deltaMap.set(item.el, { dx: item.delta, dy: 0 });
    }
    for (const item of activeY) {
      const existing = deltaMap.get(item.el);
      if (existing) existing.dy = item.delta;
      else deltaMap.set(item.el, { dx: 0, dy: item.delta });
    }

    for (const [el, { dx, dy }] of deltaMap.entries()) {
      applyScrollWithRemainder(el, dx, dy);
    }
  }

  rafId = requestAnimationFrame(stepDragAutoScroll);
}

function handleWindowDragStart(e: DragEvent) {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const cardEl = target.closest('[data-drag-card="true"]') as HTMLElement | null;
  if (!cardEl) return;

  cleanupActiveSourceListener();
  activeDragSourceEl = cardEl;
  cardEl.addEventListener('dragend', handleSourceDragEnd, { once: true });

  dragStartedAt = performance.now();
  dragOriginX = e.clientX;
  dragOriginY = e.clientY;
  pointerX = e.clientX;
  pointerY = e.clientY;
  pointerInsideWindow = true;
  pointerMovedEnough = false;
  subPixelRemainders.clear();

  notifyDragState(true);
  if (rafId === null) {
    lastFrameTime = 0;
    rafId = requestAnimationFrame(stepDragAutoScroll);
  }
}

function handleWindowDragOver(e: DragEvent) {
  if (!isCardDragging) return;

  pointerX = e.clientX;
  pointerY = e.clientY;
  pointerInsideWindow = true;

  if (!pointerMovedEnough) {
    const dist = Math.hypot(pointerX - dragOriginX, pointerY - dragOriginY);
    if (dist >= DRAG_ACTIVATION_MOVE_PX) {
      pointerMovedEnough = true;
    }
  }
}

function handleWindowDragLeave(e: DragEvent) {
  if (!isCardDragging) return;
  if (e.relatedTarget === null && e.target === document.documentElement) {
    pointerInsideWindow = false;
  }
}

function handleWindowDropOrEnd() {
  if (!isCardDragging) return;
  finishDrag();
}

function handleWindowFallbackPointerActivity() {
  if (!isCardDragging) return;
  // Durante un drag HTML5 nativo, el navegador suprime mousemove/pointerdown.
  // Si se disparan, el drag ya terminó (ej. card desmontada antes de dragend).
  finishDrag();
}

function handleWindowKeyDown(e: KeyboardEvent) {
  if (isCardDragging && e.key === 'Escape') {
    finishDrag();
  }
}

function attachGlobalDragListeners() {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;

  window.addEventListener('dragstart', handleWindowDragStart, true);
  window.addEventListener('dragover', handleWindowDragOver, true);
  window.addEventListener('dragleave', handleWindowDragLeave, true);
  window.addEventListener('drop', handleWindowDropOrEnd, true);
  window.addEventListener('dragend', handleWindowDropOrEnd, true);
  window.addEventListener('blur', handleWindowDropOrEnd);
  window.addEventListener('mousemove', handleWindowFallbackPointerActivity, true);
  window.addEventListener('pointerdown', handleWindowFallbackPointerActivity, true);
  window.addEventListener('keydown', handleWindowKeyDown, true);
}

function detachGlobalDragListenersIfUnused() {
  if (!globalListenersAttached) return;
  if (targets.size > 0 || dragListeners.size > 0) return;
  globalListenersAttached = false;

  window.removeEventListener('dragstart', handleWindowDragStart, true);
  window.removeEventListener('dragover', handleWindowDragOver, true);
  window.removeEventListener('dragleave', handleWindowDragLeave, true);
  window.removeEventListener('drop', handleWindowDropOrEnd, true);
  window.removeEventListener('dragend', handleWindowDropOrEnd, true);
  window.removeEventListener('blur', handleWindowDropOrEnd);
  window.removeEventListener('mousemove', handleWindowFallbackPointerActivity, true);
  window.removeEventListener('pointerdown', handleWindowFallbackPointerActivity, true);
  window.removeEventListener('keydown', handleWindowKeyDown, true);
  finishDrag();
}

/**
 * Registra un contenedor scrollable (horizontal, vertical o ambos) para acompañar
 * el arrastre de cards de forma fluida (60fps por RAF sin re-renders en React).
 */
export function useDragAutoScroll<T extends HTMLElement = HTMLDivElement>(
  options: DragAutoScrollOptions
) {
  const nodeRef = useRef<T | null>(null);
  const optionsRef = useRef<DragAutoScrollOptions>(options);
  optionsRef.current = options;

  const setRef = useCallback((el: T | null) => {
    const prev = nodeRef.current;
    if (prev && prev !== el) {
      targets.delete(prev);
      subPixelRemainders.delete(prev);
    }

    nodeRef.current = el;

    if (el) {
      attachGlobalDragListeners();
      targets.set(el, {
        el,
        getOptions: () => optionsRef.current,
      });
    } else {
      detachGlobalDragListenersIfUnused();
    }
  }, []);

  useEffect(() => {
    return () => {
      const current = nodeRef.current;
      if (current) {
        targets.delete(current);
        subPixelRemainders.delete(current);
        nodeRef.current = null;
      }
      detachGlobalDragListenersIfUnused();
    };
  }, []);

  return { setRef, nodeRef };
}

/**
 * Suscribe un componente al estado global de arrastre de cards (`[data-drag-card="true"]`).
 * Solo dispara re-render cuando inicia o termina un arrastre (nunca durante el scroll).
 */
export function useIsCardDragging(): boolean {
  const [dragging, setDragging] = useState<boolean>(() => isCardDragging);

  useEffect(() => {
    attachGlobalDragListeners();
    setDragging(isCardDragging);
    dragListeners.add(setDragging);
    return () => {
      dragListeners.delete(setDragging);
      detachGlobalDragListenersIfUnused();
    };
  }, []);

  return dragging;
}
