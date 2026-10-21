import { useId, type CSSProperties } from 'react';
import { Award } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SuccessPill } from '@/lib/ringAvatar';
import { SUCCESS_STAR_SLOTS, SUCCESS_VARS, successColor, type SuccessLevel } from '@/lib/successLevel';

/** Five-point star, solid (level stars are filled; the client-review star is an outline, so the two never look alike). */
export const STAR_POINTS = '12,1.8 15.1,8.4 22.2,9.2 16.9,14 18.4,21.1 12,17.5 5.6,21.1 7.1,14 1.8,9.2 8.9,8.4';

/**
 * Rosette + 4 level-star slots: Bronze 1 (copper), Silver 2 (steel), Gold 3 (yellow, soft shine), Platinum 4
 * (cool white-blue, shine); the remaining slots are faint so the scale is visible. Purely visual (aria-hidden):
 * callers give the accessible name. Stars fill from the reading start (right in Arabic).
 */
export function LevelStars({ level, size = 12, className }: { level: SuccessLevel | null; size?: number; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const filled = level ? { bronze: 1, silver: 2, gold: 3, platinum: 4 }[level] : 0;
  const shine = level === 'gold' || level === 'platinum';
  const [a, b] = level ? SUCCESS_VARS[level] : ['--muted-foreground', '--muted-foreground'];
  return (
    <span aria-hidden="true" data-testid="success-stars" data-level={level ?? 'none'} data-stars={filled}
      className={cn('inline-flex shrink-0 items-center gap-px', className)}>
      <Award className="me-0.5 shrink-0" style={{ width: size, height: size, color: level ? successColor(level) : 'hsl(var(--muted-foreground))' }} strokeWidth={2.4} />
      {Array.from({ length: SUCCESS_STAR_SLOTS }, (_, i) => {
        const on = i < filled;
        return (
          <svg key={i} viewBox="0 0 24 24" width={size} height={size} focusable="false" data-on={on ? 'true' : 'false'}
            className={cn('shrink-0', on && shine && 'success-star-shine')}
            style={on ? ({ '--star-glow': `hsl(var(${a}) / 0.55)` } as CSSProperties) : undefined}>
            {on && (
              <defs>
                <linearGradient id={`${uid}g${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={`hsl(var(${a}))`} />
                  <stop offset={level === 'platinum' ? '50%' : '100%'} stopColor={`hsl(var(${b}))`} />
                  {level === 'platinum' && <stop offset="100%" stopColor={`hsl(var(${a}))`} />}
                </linearGradient>
              </defs>
            )}
            <polygon points={STAR_POINTS} strokeLinejoin="round" strokeWidth={1.6}
              fill={on ? `url(#${uid}g${i})` : 'hsl(var(--muted-foreground) / 0.14)'}
              stroke={on ? `hsl(var(${a}))` : 'hsl(var(--muted-foreground) / 0.4)'} />
          </svg>
        );
      })}
    </span>
  );
}

/**
 * Success beside the name.
 * `stars` (xs/sm places): only the level stars, the percentage on hover/focus, full text as accessible name.
 * default/`lg`: stars + "Success: Gold" + counts pill "42 requests · 38 solved · 90 %".
 */
export default function SuccessStars({ pill, variant = 'full', large, className }: { pill: SuccessPill; variant?: 'full' | 'stars'; large?: boolean; className?: string }) {
  const lv = pill.level;
  if (variant === 'stars') {
    return (
      <span role="img" tabIndex={0} aria-label={pill.aria} title={pill.compact || pill.label} data-testid="success-stars-only" data-level={lv ?? 'none'}
        className={cn('inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
        <LevelStars level={lv} size={11} />
      </span>
    );
  }
  return (
    <span role="group" aria-label={pill.aria} data-testid="success-level" data-level={lv ?? 'none'} dir="auto"
      className={cn('inline-flex flex-wrap items-center whitespace-nowrap', large ? 'gap-2' : 'gap-1.5', className)}>
      <span className={cn('inline-flex items-center rounded-full border bg-card font-semibold text-foreground shadow-sm', large ? 'gap-1.5 px-3 py-1 text-sm' : 'gap-1 px-2 py-0.5 text-[11px]')}
        style={{ borderColor: lv ? `hsl(var(${SUCCESS_VARS[lv][0]}) / 0.6)` : 'hsl(var(--border))' }} data-testid="success-level-label">
        <LevelStars level={lv} size={large ? 14 : 11} />
        <span style={lv ? { color: successColor(lv) } : undefined} className={cn(!lv && 'text-muted-foreground')}>{pill.label}</span>
      </span>
      {pill.text && (
        <span data-testid="ring-pill-success" className={cn('inline-flex items-center rounded-full border border-border bg-card font-semibold text-foreground shadow-sm', large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]')}>
          {pill.text}
        </span>
      )}
    </span>
  );
}
