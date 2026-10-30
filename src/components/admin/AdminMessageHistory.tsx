import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { safeRpc } from '@/lib/safeRpc';
import { historyCsv, type DeliveryStatus, type HistoryRow } from '@/lib/adminMessageEmail';
import { CATEGORY_UI } from '@/components/messages/MessageCard';
import { badgeFor, DECISION_COPY, DECISION_OUTCOMES, MESSAGE_CATEGORIES, MESSAGE_COPY, type DecisionOutcome } from '../../../supabase/functions/_shared/adminMessageEmail';

const isOutcome = (v: unknown): v is DecisionOutcome => (DECISION_OUTCOMES as readonly string[]).includes(String(v));

const TONE: Record<DeliveryStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = { queued: 'outline', sending: 'outline', sent: 'default', skipped: 'secondary', failed: 'destructive' };

/** Organised history of admin-to-person messages: filters, search, delivery and read state, CSV export. */
export default function AdminMessageHistory() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = useQuery({
    queryKey: ['admin-message-history', q, category, status, from, to],
    retry: false,
    queryFn: async (): Promise<HistoryRow[] | null> => {
      const { data, error } = await safeRpc<HistoryRow[]>('admin_message_history', { _p: { q: q.trim() || null, category: category === 'all' ? null : category, status: status === 'all' ? null : status, from: from || null, to: to || null, limit: 300 } });
      return error ? null : (data ?? []);
    },
  });
  const rows = query.data ?? [];
  const fmt = (d: string) => new Date(d).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  function exportCsv() {
    const blob = new Blob(['\uFEFF' + historyCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `admin-messages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('amh.title', 'Messages to people')}</CardTitle>
        <Button size="sm" variant="outline" reason={!rows.length && 'nothing_to_export'} onClick={exportCsv}><Download className="me-1 h-4 w-4" />{t('amh.export', 'Export CSV')}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('amh.search', 'Search subject or person')} aria-label={t('amh.search', 'Search subject or person')} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44" aria-label={t('amc.category', 'Category')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('amh.all_categories', 'All categories')}</SelectItem>
              {MESSAGE_CATEGORIES.map((k) => <SelectItem key={k} value={k}>{MESSAGE_COPY[lang].categories[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label={t('amh.status', 'E-mail status')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('amh.all_status', 'Any e-mail status')}</SelectItem>
              {(['queued', 'sent', 'skipped', 'failed'] as const).map((s) => <SelectItem key={s} value={s}>{t(`ame.st_${s}`, s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('amh.from', 'From')} />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('amh.to', 'To')} />
        </div>
        {query.data === null ? (
          <p className="text-sm text-muted-foreground">{t('ame.not_ready', 'Delivery status appears once the prepared database update is applied.')}</p>
        ) : !rows.length && !query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('amh.empty', 'No messages match these filters.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('amh.date', 'Date')}</TableHead><TableHead>{t('amh.recipient', 'Recipient')}</TableHead><TableHead>{t('amc.category', 'Category')}</TableHead>
                  <TableHead>{t('amc.subject', 'Subject')}</TableHead><TableHead>{t('amh.channels', 'Channels')}</TableHead><TableHead>{t('amh.status', 'E-mail status')}</TableHead><TableHead>{t('amh.read', 'Read in app')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const held = r.status === 'queued' && new Date(r.send_after) > new Date();
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(r.created_at)}</TableCell>
                      <TableCell className="text-sm">{r.recipient_name || '—'}{r.is_test && <Badge variant="outline" className="ms-1 text-[10px]">TEST</Badge>}</TableCell>
                      <TableCell><Badge variant="outline" className={cn('rounded-full text-[11px]', CATEGORY_UI[r.category]?.chip)}>{MESSAGE_COPY[lang].categories[r.category] ?? r.category}</Badge></TableCell>
                      <TableCell className="max-w-[18rem] truncate text-sm" title={r.subject ?? ''}>{isOutcome(r.decision) && <Badge variant="outline" className="me-1 rounded-full px-1.5 py-0 text-[10px]">{DECISION_COPY[lang].badges[badgeFor(r.decision)]}</Badge>}{r.subject || '—'}{r.important && <span className="ms-1 text-[11px] text-warning">· {t('ame.important_short', 'important')}</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.status === 'skipped' ? t('amh.in_app', 'In-app') : t('amh.in_app_email', 'In-app + e-mail')}</TableCell>
                      <TableCell>
                        <Badge variant={TONE[r.status] ?? 'outline'} className="font-normal">{held ? t('ame.st_held', 'Waiting (digest)') : t(`ame.st_${r.status}`, r.status)}</Badge>
                        {r.reason && r.status !== 'sent' && <p className={cn('mt-0.5 text-[11px]', r.reason === 'no_email' ? 'font-medium text-warning' : 'text-muted-foreground')}>{t(`ame.r_${r.reason}`, r.reason)}</p>}
                      </TableCell>
                      <TableCell className="text-xs">{r.is_read ? t('amh.read_yes', 'Read') : t('amh.read_no', 'Not yet')}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
