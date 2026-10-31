import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { callRpc } from '@/hooks/useUserAdmin';
import { REASON_TEXT, reportCounts, reportCsv, reportPending, rowStatus, type DirectReport, type RowStatus } from '@/lib/adminDirectEmail';

const TONE: Record<RowStatus, string> = {
  sent: 'bg-success/10 text-success border-success/30', queued: 'bg-info/10 text-info border-info/30', later: 'bg-info/10 text-info border-info/30',
  skipped: 'bg-muted text-muted-foreground', failed: 'bg-destructive/10 text-destructive border-destructive/30', in_app: 'bg-primary/10 text-primary border-primary/30',
};
const STATUS_EN: Record<RowStatus, string> = { sent: 'Sent', queued: 'Queued', later: 'Queued (sends later)', skipped: 'Skipped', failed: 'Failed', in_app: 'In-app' };

export const useDirectReport = (sendId: string | null, initial?: DirectReport) => useQuery({
  queryKey: ['ade-report', sendId], enabled: !!sendId, initialData: initial,
  queryFn: () => callRpc<DirectReport>('admin_direct_email_report', { _send: sendId }),
  // Keeps the result screen live while e-mails wait in the queue.
  refetchInterval: (q) => (q.state.data && reportPending(q.state.data.rows) ? 8000 : false),
});

/** Per-person result of one direct send: Sent / Queued / Skipped (reason) / Failed, filter, search and CSV export. */
export default function DirectEmailReport({ sendId, initial }: { sendId: string; initial?: DirectReport }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const q = useDirectReport(sendId, initial);
  const [filter, setFilter] = useState<RowStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const data = q.data;
  const channel = data?.send.channel ?? 'both';
  const counts = useMemo(() => reportCounts(data?.rows ?? [], channel), [data, channel]);
  const reason = (r: string) => t(`ade.r_${r}`, t(`ame.r_${r}`, REASON_TEXT[r] ?? r));
  const status = (s: RowStatus) => t(`ade.st_${s}`, STATUS_EN[s]);
  const rows = (data?.rows ?? []).filter((r) => (filter === 'all' || rowStatus(r, channel) === filter)
    && (!search.trim() || `${r.name ?? ''} ${r.email ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const fmt = (d: string) => new Date(d).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  function exportCsv() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + reportCsv(rows, channel, reason)], { type: 'text/csv;charset=utf-8' }));
    a.download = `admin-email-${sendId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (q.isLoading && !data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('ade.loading_report', 'Loading the result…')}</p>;
  if (q.error && !data) return <p className="text-sm text-destructive" role="alert">{(q.error as Error).message}</p>;
  if (!data) return null;
  const shown: RowStatus[] = channel === 'in_app' ? ['in_app', 'skipped'] : ['sent', 'queued', 'later', 'skipped', 'failed'];

  return (
    <section className="space-y-3" aria-live="polite">
      <div className="rounded-xl border border-border/60 p-3 text-sm">
        <p className="font-semibold">{data.send.subject}</p>
        <p className="text-xs text-muted-foreground">
          {fmt(data.send.created_at)} · {data.send.actor_name ?? '—'} · {t(`ade.ch_${channel}`, channel)}
          {data.send.important && <> · <span className="text-warning">{t('ame.important_short', 'important')}</span></>}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-5">
        {shown.map((s) => (
          <button key={s} type="button" onClick={() => setFilter(filter === s ? 'all' : s)} aria-pressed={filter === s}
            className={cn('rounded-xl border p-2 transition-colors', TONE[s], filter === s && 'ring-2 ring-ring')}>
            <dt className="text-[11px]">{status(s)}</dt><dd className="text-lg font-bold tabular-nums">{counts[s]}</dd>
          </button>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input className="ps-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('ade.search_people', 'Search name or e-mail')} aria-label={t('ade.search_people', 'Search name or e-mail')} />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as RowStatus | 'all')}>
          <SelectTrigger className="w-44" aria-label={t('amh.status', 'E-mail status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('amh.all_status', 'Any e-mail status')}</SelectItem>
            {shown.map((s) => <SelectItem key={s} value={s}>{status(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" busy={q.isFetching} onClick={() => q.refetch()}><RefreshCw className="me-1 h-4 w-4" />{t('um.refresh', 'Refresh')}</Button>
        <Button size="sm" variant="outline" reason={!rows.length && 'nothing_to_export'} onClick={exportCsv}><Download className="me-1 h-4 w-4" />{t('amh.export', 'Export CSV')}</Button>
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('amh.recipient', 'Recipient')}</TableHead><TableHead>{t('ade.language', 'Language')}</TableHead>
              <TableHead>{t('ade.in_app', 'In-app')}</TableHead><TableHead>{t('amh.status', 'E-mail status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const s = rowStatus(r, channel);
              return (
                <TableRow key={r.user_id}>
                  <TableCell className="text-sm"><p className="font-medium">{r.name || '—'}</p><p className="text-xs text-muted-foreground" dir="ltr">{r.email ?? '—'}</p></TableCell>
                  <TableCell className="text-xs">{r.lang === 'ar' ? 'العربية' : 'English'}</TableCell>
                  <TableCell className="text-xs">{r.in_app ? (r.read ? t('amh.read_yes', 'Read') : t('ade.delivered', 'Delivered')) : '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('font-normal', TONE[s])}>{status(s)}</Badge>
                    {s === 'later' && r.send_after && <p className="mt-0.5 text-[11px] text-muted-foreground">{t('ade.after', 'After {{time}}', { time: fmt(r.send_after) })}</p>}
                    {r.reason && s !== 'sent' && <p className={cn('mt-0.5 text-[11px]', r.reason === 'no_email' ? 'font-medium text-warning' : 'text-muted-foreground')}>{reason(r.reason)}</p>}
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">{t('amh.empty', 'No messages match these filters.')}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
