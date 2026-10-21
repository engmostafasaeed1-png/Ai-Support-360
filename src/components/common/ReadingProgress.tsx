import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isLongPage, readingProgress } from '@/lib/scrollUtils';

/**
 * Slim reading-progress line (place it inside a positioned header). Shown only on long pages;
 * fills from the reading start edge, so it runs right-to-left in Arabic. Updates without re-rendering.
 */
export default function ReadingProgress({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [long, setLong] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const isLong = isLongPage(doc.scrollHeight, window.innerHeight);
      setLong(isLong);
      const p = readingProgress(window.scrollY, doc.scrollHeight, window.innerHeight);
      if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
      wrapRef.current?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    ro?.observe(document.body);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pathname, long]);

  if (!long) return null;
  return (
    <div
      ref={wrapRef}
      role="progressbar"
      aria-label={t('a11y.readingProgress', 'Reading progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden', className)}
    >
      <div ref={barRef} className="reading-progress-bar h-full w-full bg-gradient-to-r from-primary to-accent" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}
