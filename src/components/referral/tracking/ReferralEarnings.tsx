import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, Bell, ChevronsUpDown, Download, Landmark, Search, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatRate, LINE_STATUS_LABEL, thresholdProgress, tierFor, type LineStatus, type Tier } from '@/lib/referrals';
import {
  calcText, DEFAULT_LINE_FILTER, earningsSummary, filterLines, LINE_FILTER_STATES, LINE_PERIODS, lineCalc, lineState, monthChange, monthlySeries,
  pageOf, rewardLinesCsv, sortLines, type LineFilter, type LineSortKey, type ReferralPayoutRow, type RewardLine,
} from '@/lib/referralTracking';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;
const STATE_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground', held: 'bg-warning/15 text-warning', available: 'bg-success/15 text-success',
  in_payout: 'bg-primary/10 text-primary', paid: 'bg-success/15 text-success', reversed: 'bg-destructive/10 text-destructive',
};
const PERIOD_TEXT: Record<string, string> = { all: 'All time', month: 'This month', last_month: 'Last month', '3m': 'Last 3 months', year: 'This year' };
const FILTER_TEXT: Record<string, string> = { all: 'All states', pending: 'Pending', held: 'On hold', available: 'Available', paid: 'Paid', reversed: 'Reversed' };

interface Props {
  lines: RewardLine[];
  loading: boolean;
  /** false = referral-tracking.sql not applied: older history rows without hours, references or release dates. */
  detailed: boolean;
  payouts: ReferralPayoutRow[];
  payoutsAvailable: boolean;
  tiers: Tier[];
  tierCount: number;
  minPayout: number;
  payoutDetails: boolean;
  money: (v: number, cur?: string) => string;
  date: (iso: string | null | undefined) => string;
  month: (iso: string) => string;
}

export default function ReferralEarnings({ lines, loading, detailed, payouts, payoutsAvailable, tiers, tierCount, minPayout, payoutDetails, money, date, month }: Props) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language?.startsWith('ar');
  const [filter, setFilter] = useState<LineFilter>(DEFAULT_LINE_FILTER);
  const [sort, setSort] = useState<{ key: LineSortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);

  const summary = useMemo(() => earningsSummary(lines), [lines]);
  const main = summary[0] ?? { currency: 'USD', pending: 0, nextRelease: null, held: 0, available: 0, paid: 0, reversed: 0, lifetime: 0, thisMonth: 0, lastMonth: 0 };
  const series = useMemo(() => monthlySeries(lines, main.currency, 12).map((m) => ({ ...m, label: month(`${m.month}-01T00:00:00Z`) })), [lines, main.currency, month]);
  const refs = useMemo(() => [...new Map(lines.filter((l) => l.ref_key).map((l) => [l.ref_key as string, l.referred_name ?? '-'])).entries()], [lines]);
  const shown = useMemo(() => sortLines(filterLines(lines, filter), sort.key, sort.dir), [lines, filter, sort]);
  const pg = pageOf(shown, page, PAGE_SIZE);
  const tier = tierFor(tierCount, tiers);
  const tierPct = tier.next ? Math.min(100, Math.round(((tierCount - tier.min) / (tier.next.min - tier.min)) * 100)) : 100;
  const change = monthChange(main.thisMonth, main.lastMonth);
  const progress = thresholdProgress(main.available, minPayout);
  const nextPayout = payouts.find((p) => p.status !== 'completed' && p.status !== 'failed');

  const set = (patch: Partial<LineFilter>) => { setFilter((f) => ({ ...f, ...patch })); setPage(1); };
  const sortBy = (key: LineSortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const csv = () => {
    const blob = new Blob(['\ufeff' + rewardLinesCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `referral-rewards-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const stateLabel = (l: RewardLine) => {
    const st = lineState(l);
    const base = t(`refz.ls_${st.key}`, LINE_STATUS_LABEL[st.key as LineStatus] ?? st.key);
    if (st.until) return `${base} · ${t('reft.until', 'available {{date}}', { date: date(st.until) })}`;
    if (st.reason) return `${base} · ${t(`reft.hold_${st.reason}`, { review: 'under review', dispute: 'client dispute', cap: 'above the monthly limit' }[st.reason])}`;
    return base;
  };
  const calcLine = (l: RewardLine) => {
    const c = lineCalc(l);
    const f = calcText(c, (v) => money(v, l.currency), t('reft.fee', 'Fee'));
    if (l.kind === 'reversal') return t('refz.k_reversal', 'Reversal (refund or correction)');
    if (l.kind === 'adjustment') return t('refz.k_adjust', 'Adjustment by AI Support 360');
    return `${c.hours != null ? `${t('reft.hours_n', '{{n}} h approved', { n: c.hours })} → ` : ''}${f ?? '-'}`;
  };
  const SortBtn = ({ k, children }: { k: LineSortKey; children: string }) => (
    <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      aria-label={t('reft.sort_by', 'Sort by {{col}}', { col: children })}>
      {children}
      {sort.key === k ? (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />) : <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
    </button>
  );

  if (loading) return <div className="space-y-3"><Skeleton className="h-28 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div>;

  const cards: Array<[string, number, string]> = [
    [t('refz.pending', 'Pending'), main.pending, main.nextRelease ? t('reft.next_release', 'Next available {{date}}', { date: date(main.nextRelease) }) : t('reft.pending_hint', 'Waiting for the hold period')],
    [t('reft.held', 'On hold'), main.held, t('reft.held_hint', 'Released after review or when a dispute ends')],
    [t('refz.available', 'Available'), main.available, t('refz.available_hint', 'Paid with the next payout run once it reaches {{min}}', { min: money(minPayout, main.currency) })],
    [t('refz.paid', 'Paid'), main.paid, t('refz.paid_hint', 'Transferred to your bank account')],
    [t('reft.reversed', 'Reversed'), main.reversed, t('reft.reversed_hint', 'Refunds, chargebacks and corrections')],
    [t('refz.lifetime', 'Lifetime'), main.lifetime, t('refz.lifetime_hint', 'Everything earned, after any reversals')],
  ];

  return (
    <div className="space-y-5">
      {!detailed && (
        <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">{t('reft.basic_mode', 'Detailed lines (hours, references and release dates) appear here soon. Totals below are already correct.')}</p>
      )}

      <section aria-labelledby="reft-sum-h" className="space-y-3">
        <h2 id="reft-sum-h" className="flex items-center gap-2 text-base font-semibold"><Wallet className="h-4 w-4 text-primary" aria-hidden="true" />{t('refz.earnings', 'Your earnings')} ({main.currency})</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {cards.map(([label, v, hint]) => (
            <Card key={label} className="rounded-2xl"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('mt-1 text-lg font-bold tabular-nums', v < 0 && 'text-destructive')}>{money(v, main.currency)}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
            </CardContent></Card>
          ))}
        </div>
        {summary.length > 1 && (
          <p className="text-xs text-muted-foreground">{t('reft.other_cur', 'Other currencies')}: {summary.slice(1).map((s) => `${money(s.lifetime, s.currency)} ${t('refz.lifetime', 'Lifetime').toLowerCase()}`).join(' · ')}</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="rounded-2xl"><CardContent className="space-y-1 p-4 text-sm">
            <p className="text-xs text-muted-foreground">{t('reft.month_vs', 'This month vs last month')}</p>
            <p className="font-semibold tabular-nums">{money(main.thisMonth, main.currency)} <span className="font-normal text-muted-foreground">/ {money(main.lastMonth, main.currency)}</span></p>
            <p className={cn('text-xs', change == null ? 'text-muted-foreground' : change >= 0 ? 'text-success' : 'text-destructive')}>
              {change == null ? t('reft.month_none', 'Nothing to compare yet') : t('reft.month_change', '{{sign}}{{n}} % compared with last month', { sign: change > 0 ? '+' : '', n: change })}
            </p>
          </CardContent></Card>
          <Card className="rounded-2xl"><CardContent className="space-y-2 p-4 text-sm">
            <p className="text-xs text-muted-foreground">{t('reft.tier_now', 'Current tier')}</p>
            <p className="font-semibold">{tier.name} · {formatRate(tier.rate)} %</p>
            {tier.next ? <>
              <Progress value={tierPct} aria-label={t('refz.tier_progress', 'Progress to the next tier')} />
              <p className="text-xs text-muted-foreground">{t('refz.tier_next', '{{needed}} more verified referred consultants to reach {{name}} ({{rate}} %) for new rewards.', { needed: tier.needed, name: tier.next.name, rate: formatRate(tier.next.rate) })}</p>
            </> : <p className="text-xs text-muted-foreground">{t('refz.tier_top', 'You are in the highest tier.')}</p>}
          </CardContent></Card>
        </div>
      </section>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('reft.chart', 'Rewards per month and running total')} ({main.currency})</CardTitle></CardHeader>
        <CardContent>
          <div className="h-60" role="img" aria-label={t('reft.chart_aria', 'Bar chart of net rewards per month with a line for the running total')}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} reversed={rtl} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} orientation={rtl ? 'right' : 'left'} />
                <Tooltip formatter={(v: number) => money(v, main.currency)} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12 }} />
                <Legend />
                <Bar dataKey="earned" name={t('reft.s_month', 'Net per month')} fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                <Line dataKey="cumulative" name={t('reft.s_total', 'Running total')} stroke="hsl(var(--success))" strokeWidth={2} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>{t('reft.chart', 'Rewards per month and running total')}</caption>
            <thead><tr><th>{t('reft.month', 'Month')}</th><th>{t('reft.s_month', 'Net per month')}</th><th>{t('reft.s_total', 'Running total')}</th></tr></thead>
            <tbody>{series.map((m) => <tr key={m.month}><td>{m.label}</td><td>{money(m.earned, main.currency)}</td><td>{money(m.cumulative, main.currency)}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('reft.lines', 'Reward lines')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-end">
            <div className="space-y-1">
              <Label htmlFor="reft-period" className="text-xs">{t('refz.calc_period', 'Period')}</Label>
              <Select value={filter.period} onValueChange={(v) => set({ period: v as LineFilter['period'] })}>
                <SelectTrigger id="reft-period" className="rounded-xl md:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{LINE_PERIODS.map((p) => <SelectItem key={p} value={p}>{t(`reft.period_${p}`, PERIOD_TEXT[p])}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reft-status" className="text-xs">{t('refz.h_status', 'Status')}</Label>
              <Select value={filter.status} onValueChange={(v) => set({ status: v as LineFilter['status'] })}>
                <SelectTrigger id="reft-status" className="rounded-xl md:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{LINE_FILTER_STATES.map((x) => <SelectItem key={x} value={x}>{t(`reft.fs_${x}`, FILTER_TEXT[x])}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reft-ref" className="text-xs">{t('refz.c_name', 'Consultant')}</Label>
              <Select value={filter.refKey} onValueChange={(v) => set({ refKey: v })}>
                <SelectTrigger id="reft-ref" className="rounded-xl md:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('refz.calc_all_referred', 'All referred consultants')}</SelectItem>
                  {refs.map(([k, n]) => <SelectItem key={k} value={k}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reft-search" className="text-xs">{t('reft.search', 'Search')}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="reft-search" value={filter.search} onChange={(e) => set({ search: e.target.value })} className="rounded-xl ps-8 md:w-48"
                  placeholder={t('reft.search_ph', 'Name or reference')} />
              </div>
            </div>
            <Button variant="outline" size="sm" className="col-span-2 rounded-xl md:ms-auto" onClick={csv} disabled={shown.length === 0}>
              <Download className="me-1 h-4 w-4" aria-hidden="true" />{t('reft.csv', 'CSV ({{n}} rows)', { n: shown.length })}
            </Button>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">{t('reft.lines_empty', 'No rewards yet. A reward appears when a colleague you referred is paid for approved work after your referral became active.')}</p>
          ) : shown.length === 0 ? (
            <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">{t('reft.lines_none', 'No lines match these filters.')}</p>
          ) : (
            <>
              {/* Phones: one card per line */}
              <ul className="space-y-2 md:hidden">
                {pg.items.map((l, i) => (
                  <li key={`${l.line_ref ?? l.created_at}-${i}`} className="space-y-1 rounded-xl border border-border/60 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium" dir="auto">{l.referred_name ?? '-'}</span>
                      <span className={cn('font-semibold tabular-nums', l.amount < 0 && 'text-destructive')}>{money(l.amount, l.currency)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{date(l.created_at)}{l.engagement_ref ? ` · ${l.engagement_ref}` : ''}{l.line_ref ? ` · ${l.line_ref}` : ''}</p>
                    <p className="text-xs" dir="auto">{calcLine(l)}</p>
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px]', STATE_TONE[lineState(l).key])}>{stateLabel(l)}</span>
                  </li>
                ))}
              </ul>
              {/* Larger screens: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th scope="col" className="py-2 text-start"><SortBtn k="date">{t('refz.h_date', 'Date')}</SortBtn></th>
                      <th scope="col" className="py-2 text-start font-medium">{t('refz.c_name', 'Consultant')}</th>
                      <th scope="col" className="py-2 text-start font-medium">{t('refz.calc_engagement', 'Engagement')}</th>
                      <th scope="col" className="py-2 text-start"><SortBtn k="fee">{t('refz.calc_formula', 'Calculation')}</SortBtn></th>
                      <th scope="col" className="py-2 text-end"><SortBtn k="amount">{t('refz.h_amount', 'Your reward')}</SortBtn></th>
                      <th scope="col" className="py-2 text-start"><SortBtn k="status">{t('refz.h_status', 'Status')}</SortBtn></th>
                      <th scope="col" className="py-2 text-start font-medium">{t('reft.payout_col', 'Payout')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.items.map((l, i) => (
                      <tr key={`${l.line_ref ?? l.created_at}-${i}`} className="border-b border-border/50 align-top">
                        <td className="py-2 text-xs">{date(l.created_at)}{l.line_ref && <div className="font-mono text-muted-foreground" dir="ltr">{l.line_ref}</div>}</td>
                        <td className="py-2" dir="auto">{l.referred_name ?? '-'}</td>
                        <td className="py-2 font-mono text-xs" dir="ltr">{l.engagement_ref ?? '-'}</td>
                        <td className="py-2 text-xs" dir="auto">{calcLine(l)}{l.tier_name && <div className="text-muted-foreground">{l.tier_name}</div>}</td>
                        <td className={cn('py-2 text-end font-semibold tabular-nums', l.amount < 0 && 'text-destructive')}>{money(l.amount, l.currency)}</td>
                        <td className="py-2"><span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px]', STATE_TONE[lineState(l).key])}>{stateLabel(l)}</span></td>
                        <td className="py-2 font-mono text-xs" dir="ltr">{l.payout_ref ?? (l.paid_at ? date(l.paid_at) : '-')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="flex items-center justify-between gap-2 text-xs" aria-label={t('reft.pages', 'Pages')}>
                <span className="text-muted-foreground">{t('reft.page_of', 'Page {{p}} of {{n}} · {{total}} lines', { p: pg.page, n: pg.pages, total: pg.total })}</span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" className="rounded-xl" disabled={pg.page <= 1} onClick={() => setPage(pg.page - 1)}>{t('reft.prev', 'Previous')}</Button>
                  <Button variant="outline" size="sm" className="rounded-xl" disabled={pg.page >= pg.pages} onClick={() => setPage(pg.page + 1)}>{t('reft.next_page', 'Next')}</Button>
                </span>
              </nav>
            </>
          )}
          <p className="text-[11px] text-muted-foreground">{t('reft.privacy', 'For privacy you see the fee of each line, never your colleague\'s hourly rate, client or ticket. "Engagement #" stays the same for the same piece of work.')}</p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4 text-primary" aria-hidden="true" />{t('reft.payouts', 'Payouts')}</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t('refz.calc_next', 'Next payout')}</p>
              <p className="font-semibold">{nextPayout?.due_by ? `${date(nextPayout.due_by)} · ${money(nextPayout.amount, nextPayout.currency)}` : progress.reached ? t('reft.next_run', 'With the next payout run') : t('refz.calc_next_none', 'When your available rewards reach {{min}}', { min: money(minPayout, main.currency) })}</p>
            </div>
            <div className="space-y-1.5 rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t('reft.avail_now', 'Available now')}</p>
              <p className="font-semibold tabular-nums">{money(main.available, main.currency)}</p>
              <Progress value={progress.percent} aria-label={t('refz.calc_threshold_aria', 'Progress to the payout minimum')} />
            </div>
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t('reft.min_payout', 'Minimum payout')}</p>
              <p className="font-semibold tabular-nums">{money(minPayout, main.currency)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t('reft.method', 'Payout method')}</p>
              <p className={cn('font-semibold', payoutDetails ? 'text-success' : 'text-warning')}>{payoutDetails ? t('reft.method_ok', 'Bank details added') : t('reft.method_missing', 'Bank details missing')}</p>
              <Link to="/consultant/earnings" className="text-xs text-primary underline-offset-2 hover:underline">{payoutDetails ? t('reft.method_view', 'View payout details') : t('refr.c_payout_btn', 'Add bank details')}</Link>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('reft.payout_history', 'Payout history')}</h3>
            {!payoutsAvailable ? (
              <p className="text-xs text-muted-foreground">{t('reft.payouts_soon', 'Your referral payout history appears here soon. Paid amounts are already included in the totals above.')}</p>
            ) : payouts.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('reft.payouts_empty', 'No referral payouts yet. The first one is made when your available rewards reach the minimum.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr className="border-b border-border">
                    <th scope="col" className="py-1.5 text-start font-medium">{t('reft.ref_no', 'Reference')}</th>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('refz.h_date', 'Date')}</th>
                    <th scope="col" className="py-1.5 text-end font-medium">{t('reft.amount', 'Amount')}</th>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('refz.h_status', 'Status')}</th>
                    <th scope="col" className="py-1.5 text-start font-medium">{t('reft.paid_on', 'Paid on')}</th>
                  </tr></thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.payout_ref} className="border-b border-border/50">
                        <td className="py-1.5 font-mono" dir="ltr">{p.payout_ref}{p.bank_reference && <div className="text-muted-foreground">{p.bank_reference}</div>}</td>
                        <td className="py-1.5">{date(p.created_at)}</td>
                        <td className="py-1.5 text-end tabular-nums">{money(p.amount, p.currency)}</td>
                        <td className="py-1.5">{t(`reft.po_${p.status}`, { pending: 'Scheduled', processing: 'Processing', completed: 'Paid', failed: 'Failed' }[p.status] ?? p.status)}{p.due_by && p.status !== 'completed' ? ` · ${date(p.due_by)}` : ''}</td>
                        <td className="py-1.5">{date(p.paid_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-border/60 p-3 text-xs text-muted-foreground">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              {t('reft.notices', 'You get a notice when a colleague signs up, is verified, when your referral becomes active or expires, and for your first reward.')}{' '}
              <Link to="/consultant/settings" className="text-primary underline-offset-2 hover:underline">{t('reft.notice_settings', 'Notification settings')}</Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
