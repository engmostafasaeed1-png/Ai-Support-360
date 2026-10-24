import { useTranslation } from 'react-i18next';
import { Check, Minus, ArrowRight, PauseCircle, Ban, RotateCcw, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/formatters';
import type { DerivedStage, ViewerRole } from '@/lib/ticketTracking';
import { actorText } from '@/lib/tracking/timelineText';
import { STAGE_DOT } from './trackingStyles';

/** The automatic 10-step pipeline (read-only) with timestamps, who triggered each step and what happens next. */
export default function StageStepper({ derived, role }: { derived: DerivedStage; role: ViewerRole | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const next = derived.next;
  const mine = next.actor === role || (next.actor === 'both' && (role === 'client' || role === 'consultant'));
  return (
    <div className="space-y-3">
      <ol className="flex snap-x gap-1 overflow-x-auto pb-2" aria-label={t('tracking.stepperLabel')}>
        {derived.steps.map((s, i) => (
          <li key={s.key} className="min-w-[84px] flex-1 snap-start" aria-current={s.state === 'current' ? 'step' : undefined}>
            <div className="flex items-center gap-1">
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold', STAGE_DOT[s.state])} aria-hidden>
                {s.state === 'done' ? <Check className="h-3.5 w-3.5" /> : s.state === 'skipped' ? <Minus className="h-3.5 w-3.5" /> : i + 1}
              </span>
              {i < derived.steps.length - 1 && <span className={cn('h-0.5 flex-1 rounded', s.state === 'done' ? 'bg-success/60' : 'bg-border')} aria-hidden />}
            </div>
            <p className={cn('mt-1.5 text-[11px] leading-tight', s.state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {t(`tracking.stage.${s.key}`)}
            </p>
            <p className="sr-only">{t(`tracking.state.${s.state}`)}</p>
            <p className="text-[10px] leading-tight text-muted-foreground">
              {s.state === 'done' ? (s.at ? formatDateTime(s.at, lang) : t('tracking.timeNotRecorded'))
                : s.state === 'skipped' ? t(s.key === 'confirmed' ? 'tracking.notUsed' : 'tracking.state.skipped')
                : s.state === 'current' ? t('tracking.state.current') : ''}
            </p>
            {s.state === 'done' && s.by && s.by !== 'system' && <p className="text-[10px] leading-tight text-muted-foreground">{actorText(t, s.by)}</p>}
          </li>
        ))}
      </ol>

      {derived.side.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {derived.side.map((s) => {
            const Icon = s.kind === 'on_hold' ? PauseCircle : s.kind === 'cancelled' ? Ban : s.kind === 'reopened' ? RotateCcw : ShieldAlert;
            return (
              <span key={s.kind + ('by' in s ? s.by : '')} className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[11px] text-foreground">
                <Icon className="h-3 w-3 text-warning" aria-hidden />
                {s.kind === 'blocked' ? t(`tracking.side.blocked_${s.by}`) : t(`tracking.side.${s.kind}`)}
              </span>
            );
          })}
        </div>
      )}

      <p className={cn('flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs', mine ? 'bg-accent/10 text-foreground' : 'bg-muted/60 text-muted-foreground')} role="status">
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 rtl:rotate-180" aria-hidden />
        <span>
          {mine && <strong className="me-1">{t('tracking.yourTurn')}</strong>}
          {t(`tracking.next.${next.key}`, { who: actorText(t, next.actor) })}
        </span>
      </p>
    </div>
  );
}
