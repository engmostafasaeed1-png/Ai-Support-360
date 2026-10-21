import { Star, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneGradient, TONE_COLOR, type RingPill, type RingSummary } from '@/lib/ringAvatar';

/**
 * The ring's numbers without hovering: "★ 4.8 (23)" and "⚡ Fast reply - 18 min", each with a colour-coded dot.
 * `sm` = one line under the name on cards; `lg` = larger pills next to the name on the profile header.
 */
export default function RingPills({ summary, size = 'sm', className }: { summary: RingSummary; size?: 'sm' | 'lg'; className?: string }) {
  const { rating, resp } = summary.pills;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="ring-pills">
      <Pill pill={rating} size={size} kind="rating" />
      {resp && <Pill pill={resp} size={size} kind="responsiveness" />}
    </div>
  );
}

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
