import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Compass, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fill } from '@/lib/i18nFill';
import { clampStep } from '@/lib/tour';

export type TourPlacement = 'top' | 'bottom' | 'start' | 'end' | 'center';

export interface TourStep {
  id: string;
  /** Value of a data-tour attribute. */
  target?: string;
  title: string;
  body: string;
  placement?: TourPlacement;
  route?: string;
  icon?: LucideIcon;
}

interface Props {
  steps: TourStep[];
  open: boolean;
  startAt?: number;
  onStep?: (i: number) => void;
  onFinish: () => void;
  onSkip: () => void;
}

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const CARD_W = 340;
const WAIT_MS = 1500;
const MOBILE_PX = 768;

const reducedMotion = () => {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; }
};

/** The element for a target, only when it is actually visible on screen. */
function findTarget(target?: string): HTMLElement | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape ? CSS.escape(target) : target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  return el;
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export default function ProductTour({ steps, open, startAt = 0, onStep, onFinish, onSkip }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const total = steps.length;
  const [index, setIndex] = useState(() => clampStep(startAt, total));
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const targetEl = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const smooth = !reducedMotion();
  const rtl = (typeof document !== 'undefined' && document.documentElement.dir === 'rtl') || i18n?.dir?.() === 'rtl';

  useEffect(() => { if (open) setIndex(clampStep(startAt, total)); }, [open, startAt, total]);

  const step = steps[index];

  // Remember and return the focus.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    return () => { returnFocus.current?.focus?.(); };
  }, [open]);

  useEffect(() => { if (open) primaryRef.current?.focus(); }, [open, index]);

  const measure = useCallback(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    const el = targetEl.current;
    if (!el || !el.isConnected) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) { setRect(null); return; }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  // Navigate when the step has a route, then wait up to 1.5 s for the target.
  useEffect(() => {
    if (!open || !step) return;
    targetEl.current = null;
    setRect(null);
    if (step.route && location.pathname !== step.route) navigate(step.route);
    if (!step.target || step.placement === 'center') return;
    let cancelled = false;
    const started = Date.now();
    const tick = () => {
      if (cancelled) return;
      const el = findTarget(step.target);
      if (el) {
        targetEl.current = el;
        try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' }); } catch { /* old browsers */ }
        measure();
        return;
      }
      if (Date.now() - started < WAIT_MS) timer = window.setTimeout(tick, 100);
    };
    let timer = window.setTimeout(tick, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, step?.id]);

  // Keep the cut-out on the element (resize, scroll, layout changes, route changes), rAF-throttled.
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; measure(); }); };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && targetEl.current) {
      ro = new ResizeObserver(schedule);
      ro.observe(targetEl.current);
    }
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [open, rect !== null, location.pathname, measure]);

  const go = useCallback((i: number) => {
    const n = clampStep(i, total);
    setIndex(n);
    onStep?.(n);
  }, [onStep, total]);

  const next = useCallback(() => {
    if (index >= total - 1) onFinish();
    else go(index + 1);
  }, [index, total, go, onFinish]);
  const back = useCallback(() => { if (index > 0) go(index - 1); }, [index, go]);

  // Esc = skip, arrows = next / back (mirrored in RTL).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onSkip(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); if (rtl) back(); else next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (rtl) next(); else back(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, next, back, onSkip, rtl]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!open || !step) return null;

  const isLast = index === total - 1;
  const mobile = vw < MOBILE_PX;
  const hole = rect && step.placement !== 'center'
    ? { x: rect.left - PAD, y: rect.top - PAD, w: rect.width + PAD * 2, h: rect.height + PAD * 2 }
    : null;

  // Card position next to the cut-out (desktop); centered when there is none; bottom sheet on phones.
  let style: React.CSSProperties = {};
  let centered = !hole;
  if (!mobile && hole) {
    const w = Math.min(CARD_W, vw - 24);
    const clampX = (x: number) => Math.min(Math.max(12, x), vw - w - 12);
    const clampY = (y: number) => Math.min(Math.max(12, y), vh - 260);
    let placement = step.placement ?? 'bottom';
    if (rtl && placement === 'start') placement = 'end';
    else if (rtl && placement === 'end') placement = 'start';
    if (placement === 'end') style = { top: clampY(hole.y), left: clampX(hole.x + hole.w + 12), width: w };
    else if (placement === 'start') style = { top: clampY(hole.y), left: clampX(hole.x - w - 12), width: w };
    else if (placement === 'top') style = { top: clampY(hole.y - 232), left: clampX(hole.x), width: w };
    else style = { top: clampY(hole.y + hole.h + 12), left: clampX(hole.x), width: w };
    centered = false;
  }

  const Icon = step.icon ?? Compass;
  const counter = fill(t('tour.step_of', 'Step {{n}} of {{total}}', { n: index + 1, total }), { n: index + 1, total });

  return (
    <div className="fixed inset-0 z-[100]" data-testid="product-tour">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true" onClick={(e) => e.stopPropagation()}>
        <defs>
          <mask id={`tour-mask-${titleId.replace(/:/g, '')}`}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="12" fill="black" data-testid="tour-cutout" />}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" className="fill-foreground/60" mask={`url(#tour-mask-${titleId.replace(/:/g, '')})`} />
      </svg>
      {hole && (
        <div
          aria-hidden="true"
          className={cn('pointer-events-none absolute rounded-xl ring-2 ring-primary shadow-[0_0_0_6px_hsl(var(--primary)/0.2)]', smooth && 'transition-all duration-300')}
          style={{ top: hole.y, left: hole.x, width: hole.w, height: hole.h }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={trapTab}
        data-placement={mobile ? 'sheet' : centered ? 'center' : 'anchored'}
        className={cn(
          'absolute bg-card text-card-foreground border border-border shadow-xl p-5 space-y-3',
          mobile ? 'inset-x-0 bottom-0 rounded-t-2xl' : 'rounded-2xl',
          !mobile && centered && 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(400px,calc(100vw-24px))]',
          smooth && 'transition-[top,left] duration-300',
        )}
        style={mobile || centered ? undefined : style}
      >
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Icon className="w-4 h-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-semibold text-foreground">{step.title}</h2>
            <p id={bodyId} className="mt-1 text-sm text-muted-foreground">{step.body}</p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label={t('tour.skip', 'Skip tour')}
            className="text-muted-foreground hover:text-foreground rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{counter}</span>
          <div className="flex items-center gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={cn('h-1.5 rounded-full', i === index ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30')} />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onSkip}>{t('tour.skip', 'Skip tour')}</Button>
            <Button variant="link" size="sm" className="px-0 text-xs text-muted-foreground" onClick={onSkip}>{t('tour.dont_show', "Don't show again")}</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={back} disabled={index === 0}>
              <ChevronLeft className="w-4 h-4 me-1 rtl:rotate-180" aria-hidden="true" />{t('tour.back', 'Back')}
            </Button>
            <Button ref={primaryRef} size="sm" onClick={next}>
              {isLast ? t('tour.finish', 'Finish') : t('tour.next', 'Next')}
              {!isLast && <ChevronRight className="w-4 h-4 ms-1 rtl:rotate-180" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="sr-only" aria-live="polite" role="status">
        {fill(t('tour.announce', 'Step {{n}} of {{total}}: {{title}}', { n: index + 1, total, title: step.title }), { n: index + 1, total, title: step.title })}
      </div>
    </div>
  );
}
