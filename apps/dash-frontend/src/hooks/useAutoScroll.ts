import { useEffect, useRef } from 'react';
import { useDashStore } from '../store/useDashStore';

export function useAutoScroll(
  target: string | React.RefObject<HTMLElement | null>,
  deps: any[] = []
) {
  const { modoCartelera } = useDashStore();
  const isPausedRef = useRef(false);
  const lastPauseTimeRef = useRef(0);

  useEffect(() => {
    if (!modoCartelera) return;

    const track = typeof target === 'string'
      ? document.getElementById(target)
      : target.current;

    if (!track) return;

    const pause = () => {
      isPausedRef.current = true;
      lastPauseTimeRef.current = Date.now();
    };

    const resume = () => {
      isPausedRef.current = false;
    };

    track.addEventListener('mouseenter', pause);
    track.addEventListener('mouseleave', resume);

    let touchPauseTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleTouchStart = () => {
      pause();
      if (touchPauseTimeout) clearTimeout(touchPauseTimeout);
    };
    const handleTouchEnd = () => {
      if (touchPauseTimeout) clearTimeout(touchPauseTimeout);
      touchPauseTimeout = setTimeout(resume, 3000);
    };

    track.addEventListener('touchstart', handleTouchStart, { passive: true });
    track.addEventListener('touchend', handleTouchEnd, { passive: true });

    const interval = setInterval(() => {
      if (!modoCartelera) return;
      if (isPausedRef.current && Date.now() - lastPauseTimeRef.current > 8000) {
        isPausedRef.current = false;
      }
      if (isPausedRef.current) return;

      const cards = Array.from(track.querySelectorAll('article')) as HTMLElement[];
      if (!cards || cards.length <= 1) return;

      const isHorizontal =
        track.classList.contains('overflow-x-auto') ||
        track.scrollWidth > track.clientWidth + 10;

      if (isHorizontal) {
        if (track.scrollWidth <= track.clientWidth + 5) return;
        const currentScroll = track.scrollLeft;
        let closestIndex = 0;
        let minDiff = Infinity;
        cards.forEach((card, idx) => {
          const diff = Math.abs(card.offsetLeft - track.offsetLeft - currentScroll);
          if (diff < minDiff) {
            minDiff = diff;
            closestIndex = idx;
          }
        });

        let nextIndex = closestIndex + 1;
        if (nextIndex >= cards.length || currentScroll + track.clientWidth >= track.scrollWidth - 10) {
          nextIndex = 0;
        }

        const targetCard = cards[nextIndex];
        if (targetCard) {
          track.scrollTo({ left: Math.max(0, targetCard.offsetLeft - track.offsetLeft), behavior: 'smooth' });
        }
      } else {
        if (track.scrollHeight <= track.clientHeight + 5) return;
        const currentScroll = track.scrollTop;
        let closestIndex = 0;
        let minDiff = Infinity;
        cards.forEach((card, idx) => {
          const diff = Math.abs(card.offsetTop - track.offsetTop - currentScroll);
          if (diff < minDiff) {
            minDiff = diff;
            closestIndex = idx;
          }
        });

        let nextIndex = closestIndex + 1;
        if (nextIndex >= cards.length || currentScroll + track.clientHeight >= track.scrollHeight - 10) {
          nextIndex = 0;
        }

        const targetCard = cards[nextIndex];
        if (targetCard) {
          track.scrollTo({ top: Math.max(0, targetCard.offsetTop - track.offsetTop), behavior: 'smooth' });
        }
      }
    }, 3000);

    return () => {
      clearInterval(interval);
      if (touchPauseTimeout) clearTimeout(touchPauseTimeout);
      track.removeEventListener('mouseenter', pause);
      track.removeEventListener('mouseleave', resume);
      track.removeEventListener('touchstart', handleTouchStart);
      track.removeEventListener('touchend', handleTouchEnd);
    };
  }, [target, modoCartelera, ...deps]);
}
