import { useTranslation } from 'react-i18next';
import { CalendarClock, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/formatters';
import { isOverdue, statusDef, statusLabel, type DerivedStage, type TrackingSettings, type WorkingRow } from '@/lib/ticketTracking';
import { CHIP, ICON, STATUS_ICONS } from './trackingStyles';
import { actorText } from '@/lib/tracking/timelineText';

const today = () => new Date().toISOString().slice(0, 10);

/** AUTOMATIC stage chip ("Stage: Rate approved by client"). Read-only, outlined so it never looks like the manual one. */
export function StageChip({ derived, className }: { derived: DerivedStage; className?: string }) {
  const { t } = useTranslation();
  const key = derived.side.some((s) => s.kind === 'cancelled') ? 'cancelled' : derived.current ?? 'closed';
  const label = key === 'cancelled' ? t('tracking.side.cancelled') : t(`tracking.stage.${key}`);
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground', className)}
      title={t('tracking.stageHint')}>
      <Workflow className="h-3 w-3 text-primary" aria-hidden />
      <span className="text-muted-foreground">{t('tracking.stageLabel')}:</span> {label}
      {derived.outcome && <span className="text-muted-foreground">· {t(`tracking.outcome.${derived.outcome}`)}</span>}
    </span>
  );
}

/** MANUAL working status chip ("Working status: Waiting for client information"). */
export function WorkingStatusChip({ working, settings, withMeta, className }: { working: WorkingRow | null | undefined; settings: TrackingSettings; withMeta?: boolean; className?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const key = working?.key ?? 'not_started';
  const def = statusDef(settings, key);
  const color = def?.color ?? 'muted';
  const Icon = STATUS_ICONS[def?.icon ?? 'circle'];
  const overdue = isOverdue(working?.expected_date, today());
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', CHIP[color])} title={t('tracking.workingHint')}>
        <Icon className={cn('h-3 w-3', ICON[color])} aria-hidden />
        <span className="text-muted-foreground">{t('tracking.workingLabel')}:</span> {statusLabel(settings, key, lang)}
      </span>
      {overdue && (
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
          <CalendarClock className="h-3 w-3 text-destructive" aria-hidden /> {t('tracking.overdue')}
        </span>
      )}
      {withMeta && working && working.set_by_role !== 'system' && (
        <span className="text-[11px] text-muted-foreground">
          {t('tracking.setBy', { who: actorText(t, working.set_by_role), when: formatRelativeTime(working.set_at, lang) })}
        </span>
      )}
    </span>
  );
}

