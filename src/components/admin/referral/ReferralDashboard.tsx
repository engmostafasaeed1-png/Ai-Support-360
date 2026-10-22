import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, Coins, Gift, RefreshCw, Send, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { cn } from '@/lib/utils';
import {
  dashCurrencies, dueState, forecastSeries, invitationSeries, invitationsSent, lastMonths, rewardSeries, totalsFor, type ReferralDashboard as Dash,
} from '@/lib/referralDashboard';

const DUE_CLASS: Record<string, string> = {
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
  today: 'border-warning/50 bg-warning/15 text-foreground',
  soon: 'border-warning/40 bg-warning/10 text-foreground',
  later: 'border-border text-muted-foreground',
  none: 'border-border text-muted-foreground',
};

/** Admin › Referrals › Dashboard: invitations sent, rewards issued, payout dates and a monthly forecast (database aggregates). */
export default function ReferralDashboard() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const loc = ar ? 'ar' : 'en-GB';
  const q = useQuery({
    queryKey: ['refadmin', 'dashboard'],
    retry: false,
    queryFn: async () => {
      const { data, error } = await safeRpc<Dash>('admin_referral_dashboard', { _months: 6 });
      if (error) throw Object.assign(new Error(error.message), { missing: isMissingRpc(error) });
      return data as Dash;
    },
  });
  const d = q.data;
  const currencies = useMemo(() => dashCurrencies(d), [d]);
  const [cur, setCur] = useState<string | null>(null);
  const currency = cur && currencies.includes(cur) ? cur : currencies[0];

  const money = (v: number, c = currency) => new Intl.NumberFormat(loc, { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(v || 0);
  const num = (v: number) => new Intl.NumberFormat(loc).format(v || 0);
  const date = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(loc, { month: 'short', year: '2-digit', timeZone: 'UTC' });

  if (q.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>;
  if (q.error || !d) {
    return (
      <Card className="rounded-2xl"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="alert">
        <span>{t('rdash.error', 'The dashboard could not be loaded.')}</span>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="me-1 h-4 w-4" />{t('rdash.retry', 'Try again')}</Button>
      </CardContent></Card>
    );
  }

  const months12 = lastMonths(12);
  const inv = invitationsSent(d);
  const tot = totalsFor(d, currency);
  const invSeries = invitationSeries(d, months12).map((r) => ({ ...r, label: monthLabel(r.month) }));
  const rewSeries = rewardSeries(d, currency, months12).map((r) => ({ ...r, label: monthLabel(r.month) }));
  const fcSeries = forecastSeries(d, currency).map((r) => ({ ...r, label: monthLabel(r.month) }));
  const approved = d.forecast.approved_work.find((a) => a.currency === currency);
  const waiting = d.payouts.waiting.find((w) => w.currency === currency);
  const upcoming = d.payouts.upcoming;

  const kpis = [
    { icon: Send, label: t('rdash.k_invites', 'Invitations sent'), value: num(inv.total),
      hint: t('rdash.k_invites_hint', '{{a}} launch announcement · {{b}} Refer & earn invitation', { a: num(inv.announcement), b: num(inv.invitation) }) },
    { icon: Gift, label: t('rdash.k_rewards', 'Rewards issued'), value: money(tot.issued),
      hint: t('rdash.k_rewards_hint', '{{n}} reward lines · {{r}} referrers · {{rev}} reversed', { n: num(tot.lines), r: num(tot.referrers), rev: money(tot.reversed) }) },
    { icon: Coins, label: t('rdash.k_paid', 'Paid out'), value: money(tot.paid),
      hint: t('rdash.k_paid_hint', '{{a}} available · {{p}} pending hold · {{h}} on hold', { a: money(tot.available + tot.in_payout), p: money(tot.pending), h: money(tot.held) }) },
    { icon: CalendarClock, label: t('rdash.k_next', 'Next payout due'), value: date(d.payouts.next_due),
      hint: d.payouts.overdue ? t('rdash.k_overdue', '{{n}} overdue', { n: d.payouts.overdue }) : t('rdash.k_upcoming', '{{n}} referral payouts waiting', { n: upcoming.length }),
      alert: d.payouts.overdue > 0 },
  ];

  const axis = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };
  const tooltip = { contentStyle: { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('rdash.updated', 'Live figures from the database · updated {{t}}', { t: new Date(d.generated_at).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) })}</p>
        <div className="flex items-center gap-2">
          {currencies.length > 1 && (
            <Select value={currency} onValueChange={setCur}>
              <SelectTrigger className="h-8 w-24" aria-label={t('rdash.currency', 'Currency')}><SelectValue /></SelectTrigger>
              <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn('me-1 h-4 w-4', q.isFetching && 'animate-spin')} />{t('rdash.refresh', 'Refresh')}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className={cn('rounded-2xl', k.alert && 'border-destructive/40')}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><k.icon className="h-4 w-4" aria-hidden />{k.label}</div>
              <p className="mt-1 text-2xl font-bold tabular-nums">{k.value}</p>
              <p className={cn('mt-1 text-xs', k.alert ? 'text-destructive' : 'text-muted-foreground')}>{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('rdash.c_invites', 'Invitations sent per month')}</CardTitle></CardHeader>
          <CardContent>
            <div className="h-56" role="img" aria-label={t('rdash.c_invites_aria', 'Bar chart of invitations sent in the last 12 months')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={invSeries} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={axis} reversed={ar} /><YAxis tick={axis} allowDecimals={false} orientation={ar ? 'right' : 'left'} />
                  <Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="announcement" stackId="a" name={t('rdash.s_announcement', 'Launch announcement')} fill="hsl(var(--refer-from))" isAnimationActive={false} />
                  <Bar dataKey="invitation" stackId="a" name={t('rdash.s_invitation', 'Refer & earn invitation')} fill="hsl(var(--refer-to))" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {(d.invitations.invitation?.skipped ?? 0) > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('rdash.inv_skipped', '{{n}} people were skipped by the eligibility rules in invitation sends.', { n: d.invitations.invitation?.skipped })}</p>}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('rdash.c_rewards', 'Rewards earned and paid per month')}</CardTitle></CardHeader>
          <CardContent>
            <div className="h-56" role="img" aria-label={t('rdash.c_rewards_aria', 'Bar chart of rewards earned and paid in the last 12 months')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rewSeries} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={axis} reversed={ar} /><YAxis tick={axis} orientation={ar ? 'right' : 'left'} />
                  <Tooltip {...tooltip} formatter={(v: number) => money(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="earned" name={t('rdash.s_earned', 'Earned')} fill="hsl(var(--success))" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="paid" name={t('rdash.s_paid', 'Paid')} fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="reversed" name={t('rdash.s_reversed', 'Reversed')} fill="hsl(var(--destructive))" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" aria-hidden />{t('rdash.c_forecast', 'Monthly earnings forecast (next 6 months)')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="h-60" role="img" aria-label={t('rdash.c_forecast_aria', 'Bar chart of expected referral rewards for the next 6 months')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fcSeries} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={axis} reversed={ar} /><YAxis tick={axis} orientation={ar ? 'right' : 'left'} />
                <Tooltip {...tooltip} formatter={(v: number) => money(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="maturing" name={t('rdash.s_maturing', 'Already earned, hold ends')} fill="hsl(var(--success))" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="trend" name={t('rdash.s_trend', 'Estimate (3-month average)')} fill="hsl(var(--muted-foreground) / 0.45)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <p className="rounded-xl bg-success/10 p-3"><strong className="block text-foreground">{t('rdash.f_maturing', 'Already earned')}</strong>{t('rdash.f_maturing_hint', 'Reward lines whose {{d}}-day hold ends in that month. They can still be reversed if a client payment is refunded.', { d: d.settings.hold_days })}</p>
            <p className="rounded-xl bg-muted p-3"><strong className="block text-foreground">{t('rdash.f_trend', 'Estimate')}</strong>{t('rdash.f_trend_hint', 'Average of new rewards in the last 3 full months. A trend, not a promise.')}</p>
            <p className="rounded-xl border border-dashed border-border p-3"><strong className="block text-foreground">{t('rdash.f_approved', 'Approved work, not paid yet')}</strong>
              {approved ? t('rdash.f_approved_v', '{{r}} expected from {{n}} client-approved timesheets ({{f}} fee). Timing depends on when clients pay.', { r: money(approved.expected_reward), n: approved.timesheets, f: money(approved.expected_fee) })
                : t('rdash.f_approved_none', 'Nothing waiting for client payment right now.')}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('rdash.c_payouts', 'Referral payout dates')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {waiting && (
            <p className="text-xs text-muted-foreground">{t('rdash.waiting', 'Not grouped into a payout yet: {{a}} for {{r}} referrers ready for the next payout run; {{b}} for {{s}} referrers below the {{m}} minimum.',
              { a: money(waiting.ready_amount), r: waiting.ready, b: money(waiting.below_amount), s: waiting.below_minimum, m: money(d.settings.min_payout) })}</p>
          )}
          {upcoming.length === 0 ? <p className="text-muted-foreground">{t('rdash.no_upcoming', 'No referral payouts are waiting.')}</p> : (
            <div className="overflow-x-auto">
              <Table aria-label={t('rdash.t_upcoming', 'Upcoming referral payouts')}>
                <TableHeader><TableRow>
                  <TableHead>{t('rdash.h_referrer', 'Referrer')}</TableHead><TableHead className="text-end">{t('rdash.h_amount', 'Amount')}</TableHead>
                  <TableHead>{t('rdash.h_status', 'Status')}</TableHead><TableHead>{t('rdash.h_due', 'Due by')}</TableHead>
                </TableRow></TableHeader>
                <TableBody>{upcoming.map((p) => {
                  const s = dueState(p.due_by);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{p.referrer}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(Number(p.amount), p.currency)}</TableCell>
                      <TableCell>{t(`rdash.st_${p.status}`, p.status)}</TableCell>
                      <TableCell><Badge variant="outline" className={cn('text-xs', DUE_CLASS[s])}>{date(p.due_by)}{s === 'overdue' ? ` · ${t('rdash.overdue', 'overdue')}` : ''}</Badge></TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            </div>
          )}
          {d.payouts.recent.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs">{t('rdash.recent', 'Recent referral payouts ({{n}})', { n: d.payouts.recent.length })}</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {d.payouts.recent.map((p) => <li key={p.id}>{p.referrer} · {money(Number(p.amount), p.currency)} · {p.status === 'failed' ? t('rdash.st_failed', 'failed') : t('rdash.paid_on', 'paid {{d}}', { d: date(p.paid_at) })}</li>)}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
