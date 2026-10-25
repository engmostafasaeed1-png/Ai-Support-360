import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Activity, Download, FileText, MessageSquare, UserCheck, Workflow, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/formatters';
import { downloadText } from '@/lib/timesheetExport';
import { useTrackingTimeline } from '@/hooks/useTicketTracking';
import type { TrackingSettings } from '@/lib/ticketTracking';
import { actorText, eventText, filterTimeline, type TimelineFilter } from '@/lib/tracking/timelineText';
import { timelineCsv, timelinePdfBlob } from '@/lib/tracking/timelineExport';

const ICONS = { system: Workflow, manual: UserCheck, comment: MessageSquare } as const;
const FILTERS: TimelineFilter[] = ['all', 'system', 'manual', 'comment'];

/** One timeline (newest first) of automatic events, manual working status changes and comment milestones. */
export default function TrackingTimeline({ ticketId, ticketTitle, settings }: { ticketId: string; ticketTitle: string; settings: TrackingSettings }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { data, isLoading } = useTrackingTimeline(ticketId, true);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => filterTimeline(data ?? [], filter), [data, filter]);
  const ref = ticketId.slice(0, 8).toUpperCase();
  const tr = (k: string, o?: Record<string, unknown>) => String(t(k, o as never));

  const exportCsv = () => downloadText(`ticket-${ref}-timeline.csv`, timelineCsv(rows, tr, lang, settings));
  const exportPdf = async () => {
    setBusy(true);
    try {
      const blob = await timelinePdfBlob(rows, tr, lang, settings, { ticketTitle, ticketRef: ref });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `ticket-${ref}-timeline.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      toast.error(t('tracking.export.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('tracking.timeline.filter')}>
          {FILTERS.map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} className="h-7 rounded-full text-xs" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`tracking.timeline.f_${f}`)}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={exportCsv} reason={!rows.length && 'nothing_to_export'}><Download className="h-3.5 w-3.5" /> CSV</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={exportPdf} busy={busy} reason={!rows.length && 'nothing_to_export'}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Activity className="h-4 w-4" /> {t('tracking.timeline.empty')}</p>
      ) : (
        <ol className="relative space-y-3 border-s border-border ps-5">
          {rows.map((r, i) => {
            const Icon = ICONS[r.source] ?? Workflow;
            const { title, detail } = eventText(r, tr, lang, settings);
            return (
              <li key={`${r.event_at}-${r.kind}-${i}`} className="relative">
                <span className={cn('absolute -start-[29px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full border bg-background',
                  r.source === 'manual' ? 'border-accent text-accent' : r.source === 'comment' ? 'border-info text-info' : 'border-border text-muted-foreground')} aria-hidden>
                  <Icon className="h-3 w-3" />
                </span>
                <p className="text-sm text-foreground">{title}</p>
                {detail && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{detail}</p>}
                <p className="text-[11px] text-muted-foreground">
                  <time dateTime={r.event_at}>{formatDateTime(r.event_at, lang)}</time> · {actorText(tr, r.actor_role)} · {t(`tracking.source.${r.source}`)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
