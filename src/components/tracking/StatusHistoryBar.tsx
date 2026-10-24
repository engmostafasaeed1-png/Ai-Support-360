import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { durations, stageDurations, statusDef, statusLabel, type DerivedStage, type TrackingSettings } from '@/lib/ticketTracking';
import type { TrackingEvent } from '@/lib/tracking/api';
import { BAR } from './trackingStyles';

export function formatDuration(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const h = ms / 3_600_000;
  if (h < 1) return t('tracking.dur.minutes', { n: Math.max(1, Math.round(ms / 60_000)) });
  if (h < 48) return t('tracking.dur.hours', { n: Math.round(h) });
  return t('tracking.dur.days', { n: Math.round(h / 24) });
}

const COURT_BAR: Record<string, string> = { client: 'bg-warning', consultant: 'bg-accent', both: 'bg-info', third_party: 'bg-muted-foreground/60', none: 'bg-border' };

/** Time in each working status and stage, and how long the ball was with the client vs the consultant. Display only:
 *  SLA calculations are not changed by this. */
export default function StatusHistoryBar({ events, settings, derived, closedAt }: { events: TrackingEvent[]; settings: TrackingSettings; derived: DerivedStage; closedAt: string | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const now = Date.now();
  const until = closedAt ? Date.parse(closedAt) : null;
  const d = useMemo(() => durations(events.map((e) => ({ at: e.at, to: e.to, by: e.by, responsible: e.responsible })), now, settings, until), [events, settings, now, until]);
  const stages = useMemo(() => stageDurations(derived.steps, until ?? now), [derived.steps, now, until]);
  const total = d.segments.reduce((a, s) => a + (s.to - s.from), 0);
  const courts = (['client', 'consultant', 'both', 'third_party'] as const).filter((c) => d.byCourt[c] > 0);
  const courtTotal = courts.reduce((a, c) => a + d.byCourt[c], 0);
  if (!total && !stages.length) return null;
  return (
    <div className="space-y-4">
      {total > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('tracking.history.working')}</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t('tracking.history.working')}>
            {d.segments.map((s, i) => (
              <span key={i} className={cn('h-full', BAR[statusDef(settings, s.key)?.color ?? 'muted'])} style={{ width: `${((s.to - s.from) / total) * 100}%` }}
                title={`${statusLabel(settings, s.key, lang)}: ${formatDuration(s.to - s.from, t)}`} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {Object.entries(d.byStatus).sort((a, b) => b[1] - a[1]).map(([k, ms]) => (
              <li key={k} className="inline-flex items-center gap-1">
                <span className={cn('h-2 w-2 rounded-full', BAR[statusDef(settings, k)?.color ?? 'muted'])} aria-hidden />
                {statusLabel(settings, k, lang)}: {formatDuration(ms, t)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {courtTotal > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('tracking.history.court')}</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t('tracking.history.court')}>
            {courts.map((c) => <span key={c} className={cn('h-full', COURT_BAR[c])} style={{ width: `${(d.byCourt[c] / courtTotal) * 100}%` }} />)}
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {courts.map((c) => (
              <li key={c} className="inline-flex items-center gap-1">
                <span className={cn('h-2 w-2 rounded-full', COURT_BAR[c])} aria-hidden />
                {t(`tracking.court.${c}`)}: {formatDuration(d.byCourt[c], t)} ({Math.round((d.byCourt[c] / courtTotal) * 100)}%)
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">{t('tracking.history.slaNote')}</p>
        </div>
      )}
      {stages.length > 1 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">{t('tracking.history.stages')}</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {stages.map((s) => <li key={s.key}>{t(`tracking.stage.${s.key}`)}: {formatDuration(s.ms, t)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
