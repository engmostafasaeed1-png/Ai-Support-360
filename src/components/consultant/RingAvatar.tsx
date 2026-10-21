import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Medal, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { arcPath, arcPattern, RING_GEOMETRY as G, TONE_COLOR, type RingSummary, type RingTier } from '@/lib/ringAvatar';

export type RingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Pixel size, initials text, corner chip and centre label per size. */
export const RING_SIZES: Record<RingSize, { px: number; text: string; chip: boolean; label: boolean }> = {
  xs: { px: 28, text: 'text-[9px]', chip: false, label: false },
  sm: { px: 40, text: 'text-xs', chip: true, label: false },
  md: { px: 56, text: 'text-sm', chip: true, label: false },
  lg: { px: 80, text: 'text-lg', chip: true, label: true },
  xl: { px: 128, text: 'text-3xl sm:text-4xl', chip: true, label: true },
};

const TIER_CLASS: Record<RingTier, string> = {
  gold: 'text-badge-gold', silver: 'text-badge-silver', bronze: 'text-badge-bronze', verified: 'text-success',
};

/** True once the element is near the screen (always true where IntersectionObserver is missing). */
function useInView<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Arc({ pct, r, w, tone, low, drawn, testId, kind }: {
  pct: number; r: number; w: number; tone: keyof typeof TONE_COLOR; low: boolean; drawn: boolean; testId: string; kind: string;
}) {
  const d = arcPath(pct, r);
  if (!d) return null;
  const { dash, opacity } = arcPattern(tone, low);
  // Solid arcs draw in (stroke offset); patterned arcs fade in. Both are instant with reduced motion.
  const style: CSSProperties = dash
    ? { opacity: drawn ? opacity : 0 }
    : { strokeDasharray: 100, strokeDashoffset: drawn ? 0 : 100, opacity };
  return (
    <path d={d} pathLength={dash ? undefined : 100} fill="none" stroke={TONE_COLOR[tone]} strokeWidth={w} strokeLinecap={dash ? 'butt' : 'round'}
      strokeDasharray={dash ?? undefined} style={style}
      className="motion-safe:transition-[stroke-dashoffset,opacity] motion-safe:duration-700 motion-safe:ease-out"
      data-testid={testId} data-kind={kind} data-tone={tone} data-pct={pct} data-pattern={dash ? (low ? 'low-sample' : 'low-value') : 'solid'} />
  );
}

export interface RingAvatarProps {
  name: string;
  initials?: string;
  avatarUrl?: string | null;
  size?: RingSize;
  summary: RingSummary;
  /** false inside another button or link: no popover, only the accessible text and a native tooltip. */
  interactive?: boolean;
  /** Small presence dot (bottom end), e.g. online status. */
  statusClass?: string;
  className?: string;
  /** Extra content under the text lines of the popover. */
  footer?: ReactNode;
}

/**
 * Consultant photo with a dual-arc performance ring (outer: client rating, inner: responsiveness).
 * Arcs start at 12 o'clock and run clockwise in both reading directions; colour is never the only signal.
 */
export default function RingAvatar({ name, initials, avatarUrl, size = 'md', summary, interactive = true, statusClass, className, footer }: RingAvatarProps) {
  const cfg = RING_SIZES[size];
  const [ref, inView] = useInView<HTMLSpanElement>();
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const pointer = useRef('');
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!inView || drawn) return;
    if (typeof requestAnimationFrame === 'undefined') { setDrawn(true); return; }
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [inView, drawn]);

  const fallback = initials || name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const { rating, resp, tier } = summary;
  const showPhoto = !!avatarUrl && failed !== avatarUrl;

  const visual = (
    <span ref={ref} className="relative block" style={{ width: cfg.px, height: cfg.px }} dir="ltr">
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className="absolute inset-0 h-full w-full overflow-visible" data-testid="ring-svg">
        <circle cx="50" cy="50" r={G.outerR} fill="none" stroke="hsl(var(--muted))" strokeWidth={G.outerW} data-testid="ring-track-outer" />
        {resp.state !== 'hidden' && <circle cx="50" cy="50" r={G.innerR} fill="none" stroke="hsl(var(--muted))" strokeWidth={G.innerW} data-testid="ring-track-inner" />}
        {inView && rating.state !== 'none' && (
          <Arc pct={rating.pct} r={G.outerR} w={G.outerW} tone={rating.tone} low={rating.state === 'low'} drawn={drawn} testId="ring-arc-rating" kind="rating" />
        )}
        {inView && resp.state === 'ok' && (
          <Arc pct={resp.pct} r={G.innerR} w={G.innerW} tone={resp.tone} low={false} drawn={drawn} testId="ring-arc-resp" kind="responsiveness" />
        )}
      </svg>
      <span className={cn('absolute flex items-center justify-center overflow-hidden rounded-full gradient-primary font-bold text-primary-foreground', cfg.text)}
        style={{ inset: `${G.photoInset}%` }}>
        {showPhoto
          ? <img src={avatarUrl as string} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(avatarUrl as string)} />
          : <span aria-hidden="true">{fallback}</span>}
      </span>
      {cfg.chip && tier && (
        <span className="absolute -top-0.5 -end-0.5 flex items-center justify-center rounded-full border border-border bg-card shadow-sm"
          style={{ width: Math.max(14, cfg.px * 0.26), height: Math.max(14, cfg.px * 0.26) }} data-testid="ring-tier" data-tier={tier}>
          {tier === 'verified'
            ? <ShieldCheck className={cn('h-[70%] w-[70%]', TIER_CLASS[tier])} aria-hidden="true" />
            : <Medal className={cn('h-[70%] w-[70%]', TIER_CLASS[tier])} aria-hidden="true" />}
        </span>
      )}
      {statusClass && <span aria-hidden="true" className={cn('absolute bottom-[6%] end-[6%] rounded-full border-2 border-card', statusClass)} style={{ width: Math.max(8, cfg.px * 0.15), height: Math.max(8, cfg.px * 0.15) }} />}
      {cfg.label && (
        <span data-testid="ring-label" dir="auto"
          className={cn('absolute inset-x-0 -bottom-2.5 mx-auto w-max max-w-[150%] whitespace-nowrap rounded-full border border-border bg-card px-2 py-0.5 font-semibold text-foreground shadow-card',
            size === 'xl' ? 'text-xs' : 'text-[10px]')}>
          {summary.label}
        </span>
      )}
    </span>
  );

  if (!interactive) {
    return <span role="img" aria-label={summary.text} title={summary.text} className={cn('inline-block shrink-0', className)} data-testid="ring-avatar" data-size={size}>{visual}</span>;
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <button ref={anchor} type="button" aria-label={summary.text} aria-expanded={open} data-testid="ring-avatar" data-size={size}
          className={cn('inline-block shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}
          onPointerDown={(e) => { pointer.current = e.pointerType; }}
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}
          onFocus={() => { if (!pointer.current) setOpen(true); }}
          onBlur={() => { pointer.current = ''; setOpen(false); }}
          onClick={() => { if (pointer.current === 'touch' || pointer.current === 'pen') setOpen((o) => !o); pointer.current = ''; }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          {visual}
        </button>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="top" sideOffset={8} onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => { if (anchor.current?.contains(e.target as Node)) e.preventDefault(); }}
          onFocusOutside={(e) => { if (anchor.current?.contains(e.target as Node)) e.preventDefault(); }}
          className="z-50 max-w-72 rounded-xl border border-border/60 bg-popover p-3 text-xs text-popover-foreground shadow-md" data-testid="ring-popover">
          <p className="mb-1 font-semibold">{name}</p>
          <ul className="space-y-1" dir="auto">
            {summary.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          {footer}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
