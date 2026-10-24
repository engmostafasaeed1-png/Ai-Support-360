import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, FileText, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useArchTimeline } from '@/hooks/useArchitecture';
import { groupByDay } from '@/lib/architecture/listing';
import type { ArchTimelineRow } from '@/lib/architecture/api';

/** Event label: document actions and linked ticket stages (status names come from the ticket). */
function useLabel() {
  const { t } = useTranslation();
  return (r: ArchTimelineRow) => {
    if (r.action.startsWith('ticket_status:')) return t('arch.timeline.ticketStatus', { status: t(`arch.ticketStatus.${r.action.slice(14)}`, r.action.slice(14)) });
    return t(`arch.timeline.${r.action}`, r.action);
  };
}

/** Timeline tab: real events (documents created / versioned / approved / attached, linked ticket stages). */
export default function ArchTimelineReal({ search }: { search: string }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const label = useLabel();
  const { data, isLoading, error, refetch } = useArchTimeline(true);
  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error) {
    return <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-2">
      <p className="text-sm text-destructive" role="alert">{t('arch.list.error')}</p>
      <Button size="sm" variant="outline" onClick={() => void refetch()}>{t('arch.common.retry')}</Button>
    </CardContent></Card>;
  }
  const q = search.trim().toLowerCase();
  const rows = (data ?? []).filter((r) => !q || [r.doc_title, r.ticket_title, r.ticket_ref].some((x) => x?.toLowerCase().includes(q)));
  if (!rows.length) {
    return <Card className="rounded-2xl border-dashed"><CardContent className="p-8 text-center space-y-2">
      <Activity className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden />
      <p className="font-medium">{t('arch.timeline.empty')}</p>
      <p className="text-sm text-muted-foreground">{t('arch.timeline.emptyHint')}</p>
    </CardContent></Card>;
  }
  const time = (s: string) => new Date(s).toLocaleTimeString(ar ? 'ar' : 'en-GB', { timeStyle: 'short' });
  const day = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString(ar ? 'ar' : 'en-GB', { dateStyle: 'full' });
  return (
    <div className="space-y-5">
      {groupByDay(rows).map((g) => (
        <section key={g.day} aria-label={day(g.day)}>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">{day(g.day)}</h3>
          <ol className="relative border-s border-border ms-2 space-y-3">
            {g.rows.map((r, i) => (
              <li key={i} className="ms-4">
                <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border border-background bg-primary" aria-hidden />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  {r.kind === 'doc' ? <FileText className="h-3.5 w-3.5 text-primary" aria-hidden /> : <Ticket className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                  <span className="font-medium">{label(r)}{r.version ? ` · v${r.version}` : ''}</span>
                  {r.doc_id && <Link className="text-primary hover:underline truncate max-w-72" to={`/client/solution-architecture/${r.doc_id}`}>{r.doc_title}</Link>}
                  {r.ticket_id && <Link className="text-primary hover:underline truncate max-w-72" to={`/client/tickets/${r.ticket_id}`}>{r.ticket_ref} · {r.ticket_title}</Link>}
                  <span className="text-xs text-muted-foreground">{time(r.at)}{r.actor ? ` · ${r.actor}` : ''}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
