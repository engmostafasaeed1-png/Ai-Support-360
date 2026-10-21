import { Shield, Star, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneGradient, TONE_COLOR, type RingPill, type RingSummary } from '@/lib/ringAvatar';
import SuccessStars from './SuccessStars';

/**
 * The ring's numbers without hovering: "☆ 4.8 (23)" (one outlined yellow star = client reviews), "⚡ Fast reply - 18 min",
 * and the Success level as rosette + level stars + "Success: Gold" + "42 requests · 38 solved · 90 %".
 * `sm` = one line under the name on cards; `lg` = larger pills next to the name on the profile header;
 * `xs` = small places: only the level stars (percentage on hover).
 */
export default function RingPills({ summary, size = 'sm', className }: { summary: RingSummary; size?: 'xs' | 'sm' | 'lg'; className?: string }) {
  const { rating, resp, success } = summary.pills;
  if (size === 'xs') {
    return success ? <div className={cn('flex items-center', className)} data-testid="ring-pills"><SuccessStars pill={success} variant="stars" /></div> : null;
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="ring-pills">
      <Pill pill={rating} size={size} kind="rating" />
      {resp && <Pill pill={resp} size={size} kind="responsiveness" />}
      {success && <SuccessStars pill={success} large={size === 'lg'} />}
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
      {kind === 'rating'
        ? <Star aria-hidden="true" data-testid="review-star" className={cn('shrink-0', lg ? 'h-4 w-4' : 'h-3.5 w-3.5')} style={{ color: 'hsl(var(--review-star))', fill: 'none' }} strokeWidth={2.4} />
        : <Icon aria-hidden="true" className={cn('shrink-0', lg ? 'h-4 w-4' : 'h-3 w-3')} style={{ color: TONE_COLOR[pill.tone], fill: 'none' }} />}
      <span className="sr-only">{pill.sr}: </span>
      <span>{pill.text}</span>
    </span>
  );
}
