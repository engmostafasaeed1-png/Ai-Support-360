import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarOff, Gauge, Info, Loader2, Timer, Trash2, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AssignmentPolicyNote from '@/components/consultant/AssignmentPolicyNote';
import MySuccessCard from '@/components/consultant/MySuccessCard';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import {
  addUnavailablePeriod, disputeNoResponse, MY_RESPONSIVENESS_KEY, removeUnavailablePeriod, setCapacity,
  useMyResponsiveness, useUnavailablePeriods, type MyEvent, type Split,
} from '@/hooks/useResponsiveness';
import { EXCLUSION_LABEL, formatMinutes, LEVEL_LABEL, LEVEL_TONE } from '@/lib/responsivenessFormat';
import { canDispute, type RespMetrics } from '../../../supabase/functions/_shared/responsiveness';
import { cn } from '@/lib/utils';

type WindowKey = 'd30' | 'd90' | 'all';
type ScopeKey = keyof Split;

const KIND_LABEL: Record<MyEvent['kind'], [string, string]> = {
  request: ['Assignment request', 'طلب تعيين'],
  bid: ['Bid invitation', 'دعوة لتقديم عرض'],
  critical: ['Critical alert', 'تنبيه حرج'],
  chat: ['Client message', 'رسالة عميل'],
};

const OUTCOME_LABEL: Record<MyEvent['outcome'], [string, string]> = {
  pending: ['Waiting for your answer', 'بانتظار ردك'],
  responded: ['Answered', 'تم الرد'],
  no_response: ['No response', 'لا يوجد رد'],
  withdrawn: ['Withdrawn or taken by someone else (not counted)', 'سُحب أو أخذه غيرك (غير محتسب)'],
  voided: ['Removed after your dispute (not counted)', 'أُزيل بعد اعتراضك (غير محتسب)'],
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** "My responsiveness": full statistics, trend, every counted / not-counted request, disputes, vacations and capacity. */
export default function ResponsivenessPage() {
  const { t, i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const L = (pair: [string, string]) => (ar ? pair[1] : pair[0]);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: profile } = useConsultantProfile();
  const consultantId = (profile as { id?: string } | null | undefined)?.id ?? null;
  const my = useMyResponsiveness();
  const periods = useUnavailablePeriods(consultantId);
  const [win, setWin] = useState<WindowKey>('d90');
  const [scope, setScope] = useState<ScopeKey>('main');
  const [disputeFor, setDisputeFor] = useState<MyEvent | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [why, setWhy] = useState('');

  useEffect(() => { if (my.data) setCap(my.data.capacity == null ? '' : String(my.data.capacity)); }, [my.data]);

  // Deep link from the popup / e-mail: highlight the event, open the dispute dialog when asked.
  const focusId = params.get('event');
  useEffect(() => {
    if (!my.data || !focusId) return;
    const ev = my.data.events.find((e) => e.id === focusId);
    if (!ev) return;
    document.getElementById(`resp-event-${ev.id}`)?.scrollIntoView({ block: 'center' });
    if (params.get('dispute') === '1' && canDispute(ev, Date.now(), my.data.settings.dispute_days)) setDisputeFor(ev);
  }, [my.data, focusId, params]);

  const metrics: RespMetrics | undefined = my.data?.stats?.[win]?.[scope];
  const trend = useMemo(() => (my.data?.stats?.trend ?? []).map((w) => ({
    week: w.week.slice(5), rate: w.rate ?? 0, counted: w.counted,
  })), [my.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: MY_RESPONSIVENESS_KEY });

  const submitDispute = async () => {
    if (!disputeFor) return;
    const text = reason.trim();
    if (text.length < 10 || text.length > 500) { toast.error(t('responsiveness.dispute_length', 'Please write 10 to 500 characters.')); return; }
    setBusy(true);
    try {
      await disputeNoResponse(disputeFor.id, text);
      toast.success(t('responsiveness.dispute_sent', 'Dispute sent. An administrator will review it.'));
      setDisputeFor(null); setReason('');
      params.delete('dispute'); setParams(params, { replace: true });
      refresh();
    } catch (e) {
      toast.error((e as Error).message || t('responsiveness.dispute_failed', 'The dispute could not be sent.'));
    } finally { setBusy(false); }
  };

  const saveCapacity = async () => {
    const v = cap.trim() === '' ? null : Number(cap);
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 50)) { toast.error(t('responsiveness.capacity_range', 'Enter a whole number from 1 to 50, or leave it empty for no limit.')); return; }
    try { await setCapacity(v); toast.success(t('responsiveness.capacity_saved', 'Capacity saved.')); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const addPeriod = async () => {
    if (!consultantId || !start || !end) return;
    const s = new Date(start); const e = new Date(end);
    if (!(e > s)) { toast.error(t('responsiveness.period_order', 'The end must be after the start.')); return; }
    try {
      await addUnavailablePeriod(consultantId, s.toISOString(), e.toISOString(), why.trim());
      setStart(''); setEnd(''); setWhy('');
      toast.success(t('responsiveness.period_saved', 'Period saved. Requests that arrive then are not counted.'));
      periods.refetch();
    } catch (err) { toast.error((err as Error).message); }
  };

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(ar ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

  if (my.isLoading) {
    return <div className="space-y-4 p-4 sm:p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (my.isError || !my.data) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-foreground">{t('responsiveness.page_title', 'My responsiveness')}</h1>
        <Card><CardContent className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('responsiveness.not_ready', 'Responsiveness statistics are not switched on yet. Nothing is counted until the platform turns them on.')}
        </CardContent></Card>
        <MySuccessCard />
        <AssignmentPolicyNote />
      </div>
    );
  }

  const d = my.data;
  const s = d.summary;
  const level = s.public_level;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">{t('responsiveness.page_title', 'My responsiveness')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('responsiveness.page_intro', 'How quickly you answer requests, critical alerts and client messages. Only requests that arrive while you are available count.')}
          </p>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold', LEVEL_TONE[level])} data-testid="my-level">
          <Gauge className="h-4 w-4" aria-hidden="true" />{L(LEVEL_LABEL[level])}
        </span>
      </header>
      <MySuccessCard />

      <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground" role="note">
        {d.publicOn
          ? t('responsiveness.public_on', 'Clients see only your level, median reply time and response rate, never individual requests. Declines are never shown.')
          : t('responsiveness.public_off', 'Clients do not see your responsiveness yet. It is shown only after the platform switches it on.')}
        {' '}
        {s.counted_90d < d.settings.min_sample
          ? t('responsiveness.min_sample', 'You have {{n}} of {{min}} counted requests in 90 days: until then your level is "New" and nothing affects your card or ranking.', { n: s.counted_90d, min: d.settings.min_sample })
          : t('responsiveness.recovery', 'Your level uses the last 90 days, so it recovers automatically as good answers replace old ones.')}
      </div>

      <section aria-labelledby="resp-summary" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="resp-summary" className="text-lg font-semibold text-foreground">{t('responsiveness.summary', 'Statistics')}</h2>
          <div className="flex flex-wrap gap-2">
            <Tabs value={win} onValueChange={(v) => setWin(v as WindowKey)}>
              <TabsList aria-label={t('responsiveness.window', 'Period')}>
                <TabsTrigger value="d30">{t('responsiveness.d30', '30 days')}</TabsTrigger>
                <TabsTrigger value="d90">{t('responsiveness.d90', '90 days')}</TabsTrigger>
                <TabsTrigger value="all">{t('responsiveness.all', 'All time')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={scope} onValueChange={(v) => setScope(v as ScopeKey)}>
              <TabsList aria-label={t('responsiveness.scope', 'Type')}>
                <TabsTrigger value="main">{t('responsiveness.scope_main', 'Requests')}</TabsTrigger>
                <TabsTrigger value="critical">{t('responsiveness.scope_critical', 'Critical')}</TabsTrigger>
                <TabsTrigger value="chat">{t('responsiveness.scope_chat', 'Client chat')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        {metrics ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t('responsiveness.rate', 'Response rate')} value={metrics.rate == null ? '–' : `${metrics.rate}%`} hint={t('responsiveness.rate_hint', '{{a}} of {{b}} counted', { a: metrics.responded, b: metrics.counted })} />
              <Stat label={t('responsiveness.median', 'Median reply')} value={formatMinutes(metrics.median, ar)} />
              <Stat label={t('responsiveness.avg', 'Average reply')} value={formatMinutes(metrics.avg, ar)} />
              <Stat label={t('responsiveness.p90', '90 % answered within')} value={formatMinutes(metrics.p90, ar)} />
              <Stat label={t('responsiveness.received', 'Received')} value={String(metrics.received)} />
              <Stat label={t('responsiveness.counted', 'Counted')} value={String(metrics.counted)} />
              <Stat label={t('responsiveness.not_counted', 'Not counted')} value={String(metrics.not_counted)} hint={t('responsiveness.not_counted_hint', 'Outside your availability or removed')} />
              <Stat label={t('responsiveness.no_response', 'No response')} value={String(metrics.no_response)} />
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t('responsiveness.buckets', 'Reply times')}</p>
              <ul className="grid grid-cols-5 gap-2 text-center text-xs">
                {([['lt15', '< 15 min'], ['lt60', '< 1 h'], ['lt240', '< 4 h'], ['lt1440', '< 24 h'], ['later', 'Later']] as const).map(([k, label]) => (
                  <li key={k} className="rounded-lg bg-muted/40 p-2">
                    <span className="block text-base font-bold text-foreground">{metrics.buckets?.[k] ?? 0}</span>
                    <span className="text-muted-foreground">{t(`responsiveness.bucket_${k}`, label)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">{t('responsiveness.no_data', 'No data yet.')}</p>}
      </section>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('responsiveness.trend', 'Response rate per week (requests)')}</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 w-full" role="img" aria-label={t('responsiveness.trend_aria', 'Weekly response rate for the last 12 weeks')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} reversed={ar} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} orientation={ar ? 'right' : 'left'} />
                <ChartTooltip formatter={(v: number, _n, p) => [`${v}% (${(p?.payload as { counted?: number })?.counted ?? 0})`, t('responsiveness.rate', 'Response rate')]} />
                <Bar dataKey="rate" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('responsiveness.events', 'Requests in the last 90 days')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {d.events.length === 0 && <p className="text-sm text-muted-foreground">{t('responsiveness.no_events', 'No requests yet.')}</p>}
          <ul className="space-y-2">
            {d.events.map((e) => {
              const mins = e.responded_at ? (Date.parse(e.responded_at) - Date.parse(e.received_at)) / 60_000 : null;
              const disputable = canDispute(e, Date.now(), d.settings.dispute_days);
              const notCounted = !e.counted || e.outcome === 'voided' || e.outcome === 'withdrawn';
              return (
                <li key={e.id} id={`resp-event-${e.id}`} className={cn('rounded-xl border p-3 text-sm', focusId === e.id ? 'border-primary ring-2 ring-primary/20' : 'border-border/60')}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground"><bdi>{e.ticket_title || L(KIND_LABEL[e.kind])}</bdi></p>
                      <p className="text-xs text-muted-foreground">
                        {L(KIND_LABEL[e.kind])}{e.is_critical && e.kind !== 'critical' ? ` · ${t('responsiveness.critical', 'Critical')}` : ''} · {fmtDate(e.received_at)}
                      </p>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', e.outcome === 'no_response' && e.counted ? 'bg-destructive/10 text-destructive' : e.outcome === 'responded' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                      {L(OUTCOME_LABEL[e.outcome])}{mins != null ? ` · ${formatMinutes(mins, ar)}` : ''}
                    </span>
                  </div>
                  {!e.counted && e.excluded_reason && (
                    <p className="mt-1 text-xs text-success">{L(EXCLUSION_LABEL[e.excluded_reason])}</p>
                  )}
                  {e.counted && !notCounted && <p className="mt-1 text-xs text-muted-foreground">{t('responsiveness.counted_note', 'Counted in your statistics')}</p>}
                  {e.dispute_status && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.dispute_status === 'pending' ? t('responsiveness.dispute_pending', 'Dispute under review')
                        : e.dispute_status === 'upheld' ? t('responsiveness.dispute_upheld', 'Dispute accepted: removed from your statistics')
                          : t('responsiveness.dispute_rejected', 'Dispute not accepted')}
                      {e.dispute_note ? ` – ${e.dispute_note}` : ''}
                    </p>
                  )}
                  {disputable && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => setDisputeFor(e)}>
                      {t('responsiveness.dispute', 'Dispute this no-response')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <CalendarOff className="h-4 w-4 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">{t('responsiveness.periods', 'Vacation or pause')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('responsiveness.periods_hint', 'Mark a period in advance. Requests that arrive during it are not counted. Your weekly hours come from your availability in the calendar.')}</p>
            <ul className="space-y-1.5">
              {(periods.data ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                  <span className="min-w-0">{fmtDate(p.starts_at)} – {fmtDate(p.ends_at)}{p.reason ? <> · <bdi>{p.reason}</bdi></> : null}</span>
                  {Date.parse(p.starts_at) > Date.now() && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('responsiveness.period_remove', 'Remove period')}
                      onClick={async () => { try { await removeUnavailablePeriod(p.id); periods.refetch(); } catch (err) { toast.error((err as Error).message); } }}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="period-start" className="text-xs">{t('responsiveness.period_start', 'From')}</Label>
                <Input id="period-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="period-end" className="text-xs">{t('responsiveness.period_end', 'Until')}</Label>
                <Input id="period-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="period-why" className="text-xs">{t('responsiveness.period_reason', 'Note (optional, only you and admins see it)')}</Label>
              <Input id="period-why" maxLength={120} value={why} onChange={(e) => setWhy(e.target.value)} /></div>
            <Button size="sm" onClick={addPeriod} disabled={!start || !end || !consultantId}>{t('responsiveness.period_add', 'Add period')}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Users className="h-4 w-4 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">{t('responsiveness.capacity', 'Capacity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('responsiveness.capacity_hint', 'The most tickets you work on at the same time. While you are at this number, new requests are not counted. You have {{n}} active now.', { n: d.activeTickets })}</p>
            <div className="flex items-end gap-2">
              <div className="space-y-1"><Label htmlFor="capacity" className="text-xs">{t('responsiveness.capacity_label', 'Active tickets (empty = no limit)')}</Label>
                <Input id="capacity" inputMode="numeric" className="w-32" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
              <Button size="sm" variant="outline" onClick={saveCapacity}>{t('common.save', 'Save')}</Button>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><Timer className="h-3.5 w-3.5" aria-hidden="true" />{t('responsiveness.improve_title', 'How to improve')}</p>
              <ul className="list-disc space-y-0.5 ps-4">
                <li>{t('responsiveness.improve_1', 'Accept or decline every request within the time limit; a decline counts as a response.')}</li>
                <li>{t('responsiveness.improve_2', 'Keep your weekly availability and time zone up to date.')}</li>
                <li>{t('responsiveness.improve_3', 'Mark vacations in advance and set your capacity so busy periods are not counted.')}</li>
                <li>{t('responsiveness.improve_4', 'Switch on push or Telegram alerts so you see requests quickly.')}</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <AssignmentPolicyNote />

      <Dialog open={!!disputeFor} onOpenChange={(o) => { if (!o) { setDisputeFor(null); params.delete('dispute'); setParams(params, { replace: true }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('responsiveness.dispute_title', 'Dispute a no-response')}</DialogTitle>
            <DialogDescription>
              {t('responsiveness.dispute_desc', 'Tell us briefly why it should not count, for example a technical failure or a request sent outside your stated hours. You can dispute within {{d}} days, once per request.', { d: d.settings.dispute_days })}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="dispute-reason" className="text-xs">{t('responsiveness.dispute_reason', 'Reason')}</Label>
          <Textarea id="dispute-reason" value={reason} maxLength={500} rows={4} onChange={(e) => setReason(e.target.value)} aria-describedby="dispute-count" />
          <p id="dispute-count" className="text-end text-[11px] text-muted-foreground">{reason.trim().length}/500</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeFor(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={submitDispute} disabled={busy || reason.trim().length < 10}>
              {busy && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden="true" />}{t('responsiveness.dispute_send', 'Send dispute')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
