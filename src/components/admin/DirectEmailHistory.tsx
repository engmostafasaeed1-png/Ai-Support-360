import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Mail, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callRpc, NotInstalledError } from '@/hooks/useUserAdmin';
import type { DirectChannel } from '@/lib/adminDirectEmail';
import DirectEmailReport from './DirectEmailReport';

interface SendRow {
  id: string; created_at: string; channel: DirectChannel; subject: string; important: boolean; requested: number; recipients: number; excluded: number;
  actor_name: string | null; sent: number; queued: number; skipped: number; failed: number; in_app: number;
}

/** History of direct admin e-mails (one row per send); opening a send shows the per-person result. */
export default function DirectEmailHistory() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<SendRow | null>(null);
  const list = useQuery({
    queryKey: ['ade-sends', q, from, to], retry: false,
    queryFn: async (): Promise<SendRow[] | null> => {
      try { return await callRpc<SendRow[]>('admin_direct_email_sends', { _p: { q: q.trim() || null, from: from || null, to: to || null, limit: 100 } }); }
      catch (e) { if (e instanceof NotInstalledError) return null; throw e; }
    },
  });
  const fmt = (d: string) => new Date(d).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const rows = list.data ?? [];

  return (
    <Card className="rounded-2xl">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" aria-hidden />{t('ade.history', 'Direct e-mails')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('ade.history_hint', 'Every "Send e-mail" from Admin › Users. Open one to see each person: sent, queued, skipped (with the reason) or failed.')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ade.search_subject', 'Search subject')} aria-label={t('ade.search_subject', 'Search subject')} />
          </div>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('amh.from', 'From')} />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('amh.to', 'To')} />
        </div>
        {list.data === null ? (
          <p className="text-sm text-muted-foreground">{t('ade.not_ready', 'Direct e-mail starts once the prepared database update (admin direct e-mail) is applied.')}</p>
        ) : list.error ? (
          <p className="text-sm text-destructive" role="alert">{(list.error as Error).message}</p>
        ) : !rows.length && !list.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('ade.history_empty', 'No direct e-mails yet.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('amh.date', 'Date')}</TableHead><TableHead>{t('amc.subject', 'Subject')}</TableHead><TableHead>{t('amh.channels', 'Channels')}</TableHead>
                  <TableHead className="text-end">{t('ade.people', 'People')}</TableHead><TableHead>{t('amh.status', 'E-mail status')}</TableHead><TableHead>{t('ade.by', 'Sent by')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(r.created_at)}</TableCell>
                    <TableCell className="max-w-[18rem] text-sm">
                      <button type="button" className="truncate text-start font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>{r.subject}</button>
                      {r.important && <span className="ms-1 text-[11px] text-warning">· {t('ame.important_short', 'important')}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{t(`ade.ch_${r.channel}`, r.channel)}</TableCell>
                    <TableCell className="text-end text-xs tabular-nums">{r.recipients}{r.excluded > 0 && <span className="text-muted-foreground"> ({t('ade.excluded_n', '{{n}} left out', { n: r.excluded })})</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {r.channel === 'in_app' ? t('ade.in_app_n', '{{n}} in-app', { n: r.in_app })
                        : t('ade.status_line', '{{sent}} sent · {{queued}} queued · {{skipped}} skipped · {{failed}} failed', { sent: r.sent, queued: r.queued, skipped: r.skipped, failed: r.failed })}
                    </TableCell>
                    <TableCell className="text-xs">{r.actor_name ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('ade.result', 'Result per person')}</DialogTitle>
            <DialogDescription>{open?.subject}</DialogDescription>
          </DialogHeader>
          {open && <DirectEmailReport sendId={open.id} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
