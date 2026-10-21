import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Shield, ShieldCheck, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  arcPath, arcPattern, arcSegments, pointAt, ringGeometry, RING_OUTLINE, RING_SIZES, toneMix, TONE_COLOR, TONE_VARS, trackColor,
  type RingSize, type RingSummary, type RingTier, type RingTone,
} from '@/lib/ringAvatar';
import { successColor, successMix, SUCCESS_VARS, type SuccessLevel } from '@/lib/successLevel';

export type { RingSize } from '@/lib/ringAvatar';
export { RING_SIZES } from '@/lib/ringAvatar';

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

/**
 * One arc: card-coloured outline, then the gradient arc (short pieces, so the colour runs along the arc),
 * round caps, a soft glow and a tiny end dot. Revealed by a mask that draws in from 12 o'clock.
 */
function Arc({ pct, r, c, w, tone, low, drawn, glow, maskId, testId, kind }: {
  pct: number; r: number; c: number; w: number; tone: RingTone; low: boolean; drawn: boolean; glow: number; maskId: string; testId: string; kind: string;
}) {
  const d = arcPath(pct, r, c, c);
  if (!d) return null;
  const { dash, opacity } = arcPattern(tone, low, w);
  const [sx, sy] = pointAt(0, r, c, c);
  const [ex, ey] = pointAt(Math.min(pct, 99.99), r, c, c);
  const [a] = TONE_VARS[tone];
  const groupStyle = { '--ring-glow-color': `hsl(var(${a}) / 0.5)`, '--ring-glow-blur': `${glow}px` } as CSSProperties;
  return (
    <>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={-20} y={-20} width={c * 2 + 40} height={c * 2 + 40}>
        <path d={d} fill="none" stroke="white" strokeWidth={w + 16} strokeLinecap="round" pathLength={100}
          strokeDasharray="100 102" strokeDashoffset={drawn ? 0 : 101} className="ring-draw" />
      </mask>
      <g mask={`url(#${maskId})`} data-testid={testId} data-kind={kind} data-tone={tone} data-pct={pct}
        data-pattern={dash ? (low ? 'low-sample' : 'low-value') : 'solid'}>
        <path d={d} fill="none" stroke="hsl(var(--card))" strokeWidth={w + RING_OUTLINE * 2} strokeLinecap="round"
          strokeDasharray={dash ?? undefined} />
        <g className={cn(!low && 'ring-glow')} style={groupStyle}>
          {dash ? (
            <path d={d} fill="none" stroke={TONE_COLOR[tone]} strokeWidth={w} strokeLinecap="round" strokeDasharray={dash} opacity={opacity} />
          ) : (
            <>
              {arcSegments(pct, r, c, c).map((s, i) => (
                <path key={i} d={s.d} fill="none" stroke={TONE_COLOR[tone]} style={{ stroke: toneMix(tone, s.t) }} strokeWidth={w} strokeLinecap="butt" />
              ))}
              <circle cx={sx} cy={sy} r={w / 2} fill={TONE_COLOR[tone]} style={{ fill: toneMix(tone, 0) }} />
              <circle cx={ex} cy={ey} r={w / 2} fill={TONE_COLOR[tone]} style={{ fill: toneMix(tone, 1) }} />
            </>
          )}
        </g>
        {!dash && <circle cx={ex} cy={ey} r={Math.max(0.9, w * 0.2)} fill="hsl(var(--card))" opacity={drawn ? 0.95 : 0} className="ring-dot" data-testid={`${testId}-end`} />}
      </g>
    </>
  );
}

/** Thin third band: success rate, coloured by the Success level (copper, steel, yellow, platinum shine). */
function SuccessArc({ pct, r, c, w, level, drawn, maskId }: { pct: number; r: number; c: number; w: number; level: SuccessLevel; drawn: boolean; maskId: string }) {
  const d = arcPath(pct, r, c, c);
  if (!d) return null;
  const [ex, ey] = pointAt(Math.min(pct, 99.99), r, c, c);
  const [sx, sy] = pointAt(0, r, c, c);
  const glow = { '--ring-glow-color': `hsl(var(${SUCCESS_VARS[level][0]}) / 0.55)`, '--ring-glow-blur': `${level === 'platinum' ? 5 : 3}px` } as CSSProperties;
  return (
    <>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={-20} y={-20} width={c * 2 + 40} height={c * 2 + 40}>
        <path d={d} fill="none" stroke="white" strokeWidth={w + 12} strokeLinecap="round" pathLength={100}
          strokeDasharray="100 102" strokeDashoffset={drawn ? 0 : 101} className="ring-draw" />
      </mask>
      <g mask={`url(#${maskId})`} data-testid="ring-arc-success" data-kind="success" data-level={level} data-pct={pct}>
        <path d={d} fill="none" stroke="hsl(var(--card))" strokeWidth={w + RING_OUTLINE * 2} strokeLinecap="round" />
        <g className="ring-glow" style={glow}>
          {arcSegments(pct, r, c, c).map((sg, i) => (
            <path key={i} d={sg.d} fill="none" stroke={successColor(level)} style={{ stroke: successMix(level, level === 'platinum' ? Math.abs(0.5 - sg.t) * 2 : sg.t) }} strokeWidth={w} />
          ))}
          <circle cx={sx} cy={sy} r={w / 2} fill={successColor(level)} style={{ fill: successMix(level, level === 'platinum' ? 1 : 0) }} />
          <circle cx={ex} cy={ey} r={w / 2} fill={successColor(level)} style={{ fill: successMix(level, 1) }} />
        </g>
      </g>
    </>
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
  const success = summary.success;
  const g = ringGeometry(size, !!success && success.state !== 'hidden');
  const uid = useId().replace(/:/g, '');
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
  const inset = g.c - g.photoR;

  const visual = (
    <span ref={ref} className="relative block motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:group-hover/ring:scale-[1.03] motion-safe:group-focus-visible/ring:scale-[1.03]"
      style={{ width: g.px, height: g.px }} dir="ltr">
      <svg viewBox={`0 0 ${g.px} ${g.px}`} aria-hidden="true" focusable="false" className="absolute inset-0 h-full w-full overflow-visible" data-testid="ring-svg">
        {g.successR != null && <circle cx={g.c} cy={g.c} r={g.successR} fill="none" stroke={success.level ? `hsl(var(${SUCCESS_VARS[success.level][0]}) / 0.18)` : trackColor('none')} strokeWidth={g.successW} data-testid="ring-track-success" />}
        <circle cx={g.c} cy={g.c} r={g.outerR} fill="none" stroke={trackColor(rating.tone)} strokeWidth={g.outerW} data-testid="ring-track-outer" />
        {resp.state !== 'hidden' && <circle cx={g.c} cy={g.c} r={g.innerR} fill="none" stroke={trackColor(resp.tone)} strokeWidth={g.innerW} data-testid="ring-track-inner" />}
        {inView && rating.state !== 'none' && (
          <Arc pct={rating.pct} r={g.outerR} c={g.c} w={g.outerW} tone={rating.tone} low={rating.state === 'low'} drawn={drawn} glow={cfg.glow}
            maskId={`${uid}o`} testId="ring-arc-rating" kind="rating" />
        )}
        {inView && resp.state === 'ok' && (
          <Arc pct={resp.pct} r={g.innerR} c={g.c} w={g.innerW} tone={resp.tone} low={false} drawn={drawn} glow={cfg.glow}
            maskId={`${uid}i`} testId="ring-arc-resp" kind="responsiveness" />
        )}
        {inView && g.successR != null && success.state === 'ok' && success.level && success.pct != null && (
          <SuccessArc pct={success.pct} r={g.successR} c={g.c} w={g.successW} level={success.level} drawn={drawn} maskId={`${uid}s`} />
        )}
      </svg>
      <span className={cn('absolute flex items-center justify-center overflow-hidden rounded-full gradient-primary font-bold text-primary-foreground', cfg.text)}
        style={{ inset }}>
        {showPhoto
          ? <img src={avatarUrl as string} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(avatarUrl as string)} />
          : <span aria-hidden="true">{fallback}</span>}
      </span>
      {cfg.chip && tier && (
        <span className="absolute -top-0.5 -end-0.5 flex items-center justify-center rounded-full border border-border bg-card shadow-sm"
          style={{ width: Math.max(16, g.px * 0.24), height: Math.max(16, g.px * 0.24) }} data-testid="ring-tier" data-tier={tier}>
          {tier === 'verified'
            ? <ShieldCheck className={cn('h-[70%] w-[70%]', TIER_CLASS[tier])} aria-hidden="true" />
            : <Shield className={cn('h-[70%] w-[70%]', TIER_CLASS[tier])} style={{ fill: 'currentColor', fillOpacity: 0.2 }} aria-hidden="true" />}
        </span>
      )}
      {cfg.chip && success.state === 'ok' && success.level && (
        <span className={cn('absolute -bottom-0.5 -start-0.5 flex items-center justify-center rounded-full bg-card shadow-sm', success.level === 'platinum' && 'ring-medal-shine')}
          style={{ width: Math.max(16, g.px * 0.24), height: Math.max(16, g.px * 0.24), border: `1.5px solid ${successColor(success.level)}` }}
          data-testid="ring-medal" data-level={success.level}>
          <Trophy className="h-[64%] w-[64%]" style={{ color: `hsl(var(${SUCCESS_VARS[success.level][1]}))`, fill: successColor(success.level), fillOpacity: 0.35 }} aria-hidden="true" />
        </span>
      )}
      {statusClass && <span aria-hidden="true" className={cn('absolute bottom-[8%] end-[4%] rounded-full border-2 border-card', statusClass)} style={{ width: Math.max(9, g.px * 0.14), height: Math.max(9, g.px * 0.14) }} />}
      {cfg.short && (
        <span aria-hidden="true" data-testid="ring-short"
          className="absolute inset-x-0 -bottom-1.5 mx-auto w-max rounded-full border border-border bg-card px-1 text-[9px] font-bold leading-[14px] text-foreground shadow-sm">
          {summary.short}
        </span>
      )}
    </span>
  );

  if (!interactive) {
    return <span role="img" aria-label={summary.text} title={summary.text} className={cn('group/ring inline-block shrink-0', className)} data-testid="ring-avatar" data-size={size}>{visual}</span>;
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <button ref={anchor} type="button" aria-label={summary.text} aria-expanded={open} data-testid="ring-avatar" data-size={size}
          className={cn('group/ring inline-block shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}
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
