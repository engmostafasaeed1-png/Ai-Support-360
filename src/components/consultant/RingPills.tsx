import { Shield, Star, Trophy, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneGradient, TONE_COLOR, type RingPill, type RingSummary, type SuccessPill } from '@/lib/ringAvatar';
import { successColor, successGradient, SUCCESS_VARS } from '@/lib/successLevel';

/**
 * The ring's numbers without hovering: "★ 4.8 (23)", "⚡ Fast reply - 18 min" and "🏆 42 requests · 38 solved · 90 % (Gold)".
 * `sm` = one line under the name on cards; `lg` = larger pills next to the name on the profile header;
 * `xs` = small places: only the medal and the percentage.
 */
export default function RingPills({ summary, size = 'sm', className }: { summary: RingSummary; size?: 'xs' | 'sm' | 'lg'; className?: string }) {
  const { rating, resp, success } = summary.pills;
  if (size === 'xs') {
    return success ? <div className={cn('flex items-center', className)} data-testid="ring-pills"><SuccessChip pill={success} compact /></div> : null;
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="ring-pills">
      <Pill pill={rating} size={size} kind="rating" />
      {resp && <Pill pill={resp} size={size} kind="responsiveness" />}
      {success && <SuccessChip pill={success} large={size === 'lg'} />}
      {size === 'lg' && summary.pills.ai && (
        <span data-testid="ring-pill-ai" data-tier={summary.pills.ai.tier} dir="auto"
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-sm font-semibold text-foreground shadow-sm">
          <Shield aria-hidden="true" className={cn('h-4 w-4', AI_CLASS[summary.pills.ai.tier])} style={{ fill: 'currentColor', fillOpacity: 0.2 }} />
          {summary.pills.ai.text}
        </span>
      )}
    </div>
  );
}

const AI_CLASS: Record<string, string> = { gold: 'text-badge-gold', silver: 'text-badge-silver', bronze: 'text-badge-bronze', verified: 'text-success' };

function Pill({ pill, size, kind }: { pill: RingPill; size: 'sm' | 'lg'; kind: 'rating' | 'responsiveness' }) {
  const Icon = kind === 'rating' ? Star : Zap;
  const lg = size === 'lg';
  return (
    <span data-testid={`ring-pill-${kind}`} data-tone={pill.tone} dir="auto"
      className={cn('inline-flex items-center whitespace-nowrap rounded-full border border-border bg-card font-semibold text-foreground shadow-sm',
        lg ? 'gap-1.5 px-3 py-1 text-sm' : 'gap-1 px-2 py-0.5 text-[11px]')}>
      <span aria-hidden="true" className={cn('shrink-0 rounded-full', lg ? 'h-2.5 w-2.5' : 'h-2 w-2', pill.dotted && 'outline-dotted outline-1 outline-offset-1 outline-muted-foreground')}
        style={{ background: toneGradient(pill.tone) }} />
      <Icon aria-hidden="true" className={cn('shrink-0', lg ? 'h-4 w-4' : 'h-3 w-3')} style={{ color: TONE_COLOR[pill.tone], fill: kind === 'rating' ? TONE_COLOR[pill.tone] : 'none' }} />
      <span className="sr-only">{pill.sr}: </span>
      <span>{pill.text}</span>
    </span>
  );
}

/** Success chip with a trophy in the Success colour family (separate from the AI interview shield). */
export function SuccessChip({ pill, compact, large, className }: { pill: SuccessPill; compact?: boolean; large?: boolean; className?: string }) {
  const lv = pill.level;
  return (
    <span data-testid="ring-pill-success" data-level={lv ?? 'none'} dir="auto"
      className={cn('inline-flex items-center whitespace-nowrap rounded-full border bg-card font-semibold text-foreground shadow-sm',
        large ? 'gap-1.5 px-3 py-1 text-sm' : 'gap-1 px-2 py-0.5 text-[11px]', lv === 'platinum' && 'ring-medal-shine', className)}
      style={{ borderColor: lv ? successColor(lv) : 'hsl(var(--border))' }}>
      {lv && <span aria-hidden="true" className={cn('shrink-0 rounded-full', large ? 'h-2.5 w-2.5' : 'h-2 w-2')} style={{ background: successGradient(lv) }} />}
      <Trophy aria-hidden="true" className={cn('shrink-0', large ? 'h-4 w-4' : 'h-3 w-3')}
        style={lv ? { color: `hsl(var(${SUCCESS_VARS[lv][1]}))`, fill: successColor(lv), fillOpacity: 0.35 } : { color: 'hsl(var(--muted-foreground))' }} />
      <span className="sr-only">{pill.sr}: </span>
      <span>{compact ? pill.compact : pill.text}</span>
      {compact && pill.label && <span className="sr-only"> ({pill.label})</span>}
    </span>
  );
}
