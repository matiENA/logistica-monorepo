import { useEffect } from 'react';
import { useDashStore } from '../store/useDashStore';

export const DEFAULT_IDLE_CARTELERA_MS = 60_000;

const IGNORED_WAKE_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute',
  'MediaPlayPause',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
]);

function isEditableElementFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable;
}

/**
 * Cambia automáticamente a modo cartelera tras `idleMs` sin interacción del operador
 * y retorna al modo edición al primer clic/tap o tecla (Opción B, ignorando mousemove).
 */
export function useIdleCartelera(idleMs: number = DEFAULT_IDLE_CARTELERA_MS): void {
  const hasSession = useDashStore((s) => Boolean(s.sesion?.usuario));
  const modoCartelera = useDashStore((s) => s.modoCartelera);
  const modalNuevaAbierto = useDashStore((s) => s.modalNuevaAbierto);
  const overlayServiceAbierto = useDashStore((s) => s.overlayServiceAbierto);

  useEffect(() => {
    if (!hasSession) return;

    // 1. MODO EDICIÓN -> Cuenta regresiva de inactividad para pasar a Cartelera
    if (!modoCartelera) {
      if (modalNuevaAbierto || overlayServiceAbierto) return;

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let lastResetAt = 0;

      const schedule = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (document.hidden || isEditableElementFocused()) {
            schedule();
            return;
          }
          const st = useDashStore.getState();
          if (!st.sesion?.usuario || st.modoCartelera || st.modalNuevaAbierto || st.overlayServiceAbierto) {
            return;
          }
          st.setModoCartelera(true, { persistir: false, origen: 'idle' });
        }, idleMs);
      };

      const resetImmediate = () => {
        lastResetAt = Date.now();
        schedule();
      };

      const resetThrottled = () => {
        const now = Date.now();
        if (now - lastResetAt < 1000) return;
        lastResetAt = now;
        schedule();
      };

      const handleVisibilityChange = () => {
        if (!document.hidden) {
          resetImmediate();
        }
      };

      window.addEventListener('pointerdown', resetImmediate, { passive: true });
      window.addEventListener('keydown', resetImmediate, { passive: true });
      window.addEventListener('wheel', resetImmediate, { passive: true });
      window.addEventListener('touchstart', resetImmediate, { passive: true });
      window.addEventListener('scroll', resetThrottled, { capture: true, passive: true });
      window.addEventListener('mousemove', resetThrottled, { passive: true });
      document.addEventListener('visibilitychange', handleVisibilityChange);

      schedule();

      return () => {
        if (timeoutId) clearTimeout(timeoutId);
        window.removeEventListener('pointerdown', resetImmediate);
        window.removeEventListener('keydown', resetImmediate);
        window.removeEventListener('wheel', resetImmediate);
        window.removeEventListener('touchstart', resetImmediate);
        window.removeEventListener('scroll', resetThrottled, { capture: true });
        window.removeEventListener('mousemove', resetThrottled);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    // 2. MODO CARTELERA -> Despertar Opción B con clic/tap o tecla (ignora mousemove)
    const handleWakeClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-cartelera-control="true"], [data-cartelera-ignore="true"]')) {
        return;
      }
      const st = useDashStore.getState();
      if (!st.modoCartelera) return;
      e.stopPropagation();
      e.preventDefault();
      st.setModoCartelera(false, { persistir: st.modoCarteleraOrigen === 'manual', origen: 'manual' });
    };

    const handleWakeKeyDown = (e: KeyboardEvent) => {
      if (IGNORED_WAKE_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      const st = useDashStore.getState();
      if (!st.modoCartelera) return;
      st.setModoCartelera(false, { persistir: st.modoCarteleraOrigen === 'manual', origen: 'manual' });
    };

    window.addEventListener('click', handleWakeClick, true);
    window.addEventListener('keydown', handleWakeKeyDown);

    return () => {
      window.removeEventListener('click', handleWakeClick, true);
      window.removeEventListener('keydown', handleWakeKeyDown);
    };
  }, [hasSession, modoCartelera, modalNuevaAbierto, overlayServiceAbierto, idleMs]);
}
