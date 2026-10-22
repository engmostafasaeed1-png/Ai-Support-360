import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, Download, FileText, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { referralRpc } from '@/hooks/useReferralProgram';
import {
  formatRate, formulaText, parseTiers, tierFor, LINE_STATUS_LABEL, round2, statementCsv, thresholdProgress, type CalcLine, type LineStatus,
} from '@/lib/referrals';
import { exportReferralStatementPdf } from '@/lib/referralStatementPdf';
import { cn } from '@/lib/utils';

type Row = Record<string, unknown>;
interface RefRow {
  ref_key: string; referred_name: string; activation_status: string; first_paid_at: string | null; window_ends_at: string | null; currency: string;
  approved_hours: number; man_days: number; fee_base: number; rate_min: number; rate_percent: number; reward_earned: number; reversed: number; net: number;
  pending: number; available: number; paid: number;
}
interface Statement { id: string; period_month: string; generated_at: string; summary: Row; lines: CalcLine[] }

const num = (v: unknown) => Number(v) || 0;

function useCalc<T>(key: unknown[], fn: string, args: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ['refcalc', ...key],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await referralRpc(fn, args);
      if (error) throw new Error(error.message);
      return data as T;
    },
  });
}

function useFmt() {
  const { i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const locale = ar ? 'ar-EG' : 'en-US';
  return useMemo(() => ({
    lang: (ar ? 'ar' : 'en') as 'en' | 'ar',
    money: (v: number | null | undefined, cur = 'USD') => {
      if (v == null) return '-';
      try { return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(v); } catch { return `${Number(v).toFixed(2)} ${cur}`; }
    },
    date: (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) : '-'),
    dateTime: (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '-'),
    month: (iso: string) => new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(new Date(iso)),
    monthLong: (iso: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(iso)),
  }), [ar, locale]);
}

const PERIODS = ['all', 'month', '3m', 'year'] as const;
function periodRange(p: string): { from: string | null; to: string | null } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: null };
  if (p === '3m') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: null };
  if (p === 'year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: null };
  return { from: null, to: null };
}

/**
 * "Referral calculations": every number comes from the database (referral_calc_* RPCs) and recalculates on every read.
 * consultantId set = administrator view of that consultant (read-only).
 */
export default function ReferralCalculations({ consultantId = null, code = '' }: { consultantId?: string | null; code?: string }) {
  const { t } = useTranslation();
  const f = useFmt();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [refKey, setRefKey] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const range = periodRange(period);
  const base = { _consultant: consultantId };
  const filt = { ...base, _from: range.from, _to: range.to, _status: status === 'all' ? null : status };

  const summary = useCalc<Row>(['summary', consultantId], 'referral_calc_summary', base);
  const refs = useCalc<RefRow[]>(['refs', consultantId, period, status], 'referral_calc_referrals', filt);
  const monthly = useCalc<Row[]>(['monthly', consultantId], 'referral_calc_monthly', { ...base, _months: 12 });
  const forecast = useCalc<Row[]>(['forecast', consultantId], 'referral_calc_forecast', base);
  const statements = useCalc<Statement[]>(['statements', consultantId], 'referral_calc_statements', base);
  const lines = useCalc<CalcLine[]>(['lines', consultantId, open, period, status], 'referral_calc_lines',
    { ...filt, _ref_key: open }, !!open);

  const s = summary.data ?? {};
  const settings = (s.settings ?? {}) as Row;
  const tiers = parseTiers(s.tiers ?? settings.tiers);
  const tierRow = (s.tier ?? {}) as Row;
  const tierCount = num(tierRow.count);
  const tier = tierFor(tierCount, tiers);
  const rate = tier.rate;
  const months = num(settings.months) || 12;
  const minPayout = num(settings.min_payout);
  const earnings = ((s.earnings ?? []) as Row[]);
  const availableNow = (s.available_now ?? {}) as Record<string, number>;
  const mainCur = String(earnings[0]?.currency ?? 'USD');
  const progress = thresholdProgress(num(availableNow[mainCur]), minPayout);
  const next = s.next_payout as Row | null | undefined;
  const referred = (s.referred ?? {}) as Row;

  const rows = (refs.data ?? []).filter((r) => refKey === 'all' || r.ref_key === refKey).map((r) => ({
    ...r, approved_hours: num(r.approved_hours), man_days: num(r.man_days), fee_base: num(r.fee_base), reward_earned: num(r.reward_earned),
    reversed: num(r.reversed), net: num(r.net), pending: num(r.pending), available: num(r.available), paid: num(r.paid), rate_percent: num(r.rate_percent), rate_min: num(r.rate_min ?? r.rate_percent),
  }));
  const totals = useMemo(() => {
    const m = new Map<string, RefRow>();
    for (const r of rows) {
      const tt = m.get(r.currency) ?? { ...r, ref_key: 'total', referred_name: '', approved_hours: 0, man_days: 0, fee_base: 0, reward_earned: 0, reversed: 0, net: 0, pending: 0, available: 0, paid: 0 };
      for (const k of ['approved_hours', 'man_days', 'fee_base', 'reward_earned', 'reversed', 'net', 'pending', 'available', 'paid'] as const) tt[k] = round2(tt[k] + r[k]);
      m.set(r.currency, tt);
    }
    return [...m.values()];
  }, [rows]);

  const chart = useMemo(() => {
    const byMonth = new Map<string, { month: string; earned: number; paid: number; expected?: number }>();
    for (const r of (monthly.data ?? [])) {
      if (String(r.currency) !== mainCur) continue;
      byMonth.set(String(r.month), { month: f.month(String(r.month)), earned: num(r.earned), paid: num(r.paid) });
    }
    const out = [...byMonth.values()];
    const fc = (forecast.data ?? []).find((x) => String(x.currency) === mainCur);
    if (fc && num(fc.expected_reward) > 0) {
      const d = new Date(); d.setMonth(d.getMonth() + 1, 1);
      out.push({ month: `${f.month(d.toISOString())} *`, earned: 0, paid: 0, expected: num(fc.expected_reward) });
    }
    return out;
  }, [monthly.data, forecast.data, mainCur, f]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['refcalc'] });

  const exportAll = async (kind: 'csv' | 'pdf', data?: CalcLine[], title?: string) => {
    let ls = data;
    if (!ls) {
      const { data: d, error } = await referralRpc('referral_calc_lines', { ...filt, _ref_key: refKey === 'all' ? null : refKey });
      if (error) return;
      ls = (d ?? []) as CalcLine[];
    }
    const name = title ?? (period === 'all' ? 'all-time' : period);
    if (kind === 'csv') {
      const blob = new Blob(['\ufeff' + statementCsv(ls)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `referral-statement-${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
      return;
    }
    exportReferralStatementPdf({
      title: t('refz.calc_statement', 'Referral statement'), period: name, consultantCode: code, generatedAt: f.dateTime(new Date().toISOString()), lang: f.lang, lines: ls,
      summary: earnings.flatMap((e) => [
        [t('refz.pending', 'Pending'), f.money(num(e.pending), String(e.currency))],
        [t('refz.available', 'Available'), f.money(num(e.available), String(e.currency))],
        [t('refz.paid', 'Paid'), f.money(num(e.paid), String(e.currency))],
        [t('refz.lifetime', 'Lifetime'), f.money(num(e.lifetime), String(e.currency))],
      ] as Array<[string, string]>),
    });
  };

  if (summary.isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-48 w-full rounded-2xl" /></div>;
  if (summary.error) return <Card className="rounded-2xl"><CardContent className="p-6 text-sm">{t('refz.calc_failed', 'The calculations could not be loaded.')} <Button variant="link" onClick={refresh}>{t('refz.retry', 'Try again')}</Button></CardContent></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t('refz.calc_auto', 'Calculated automatically from paid invoices - nothing is typed by hand.')}{' '}
          {t('refz.calc_updated', 'Last change: {{date}}', { date: f.dateTime(String(s.last_updated ?? s.generated_at ?? '')) || '-' })}
        </p>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={refresh}><RefreshCw className="w-4 h-4 me-1" />{t('refz.refresh', 'Refresh')}</Button>
      </div>

      {/* 1. Summary strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{t('refz.calc_referred', 'Referred consultants')}</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{num(referred.total)} / {num(referred.verified)} / {num(referred.paying)}</p>
          <p className="text-[11px] text-muted-foreground">{t('refz.calc_referred_hint', 'total / verified / paying')}</p>
        </CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{t('refz.calc_rule', 'Your reward rule')}</p>
          <p className="mt-1 text-lg font-bold">{formatRate(rate)} % · {t('refz.calc_months', '{{n}} months', { n: months })}</p>
          <p className="text-[11px] text-muted-foreground">{t('refz.calc_rule_hint', 'of the referred consultant\'s fee, from their first paid ticket')}</p>
          <p className="text-[11px] text-muted-foreground">{tier.next
            ? t('refz.calc_tier', '{{name}} ({{n}} verified). {{needed}} more for {{next}} ({{rate}} %).', { name: tier.name, n: tierCount, needed: tier.needed, next: tier.next.name, rate: formatRate(tier.next.rate) })
            : t('refz.calc_tier_top', '{{name}} ({{n}} verified), the highest tier.', { name: tier.name, n: tierCount })}</p>
        </CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4 space-y-1">
          {(earnings.length ? earnings : [{ currency: 'USD', pending: 0, available: 0, paid: 0, lifetime: 0 }]).map((e) => (
            <div key={String(e.currency)} className="grid grid-cols-2 gap-x-2 text-xs">
              <span className="text-muted-foreground">{t('refz.pending', 'Pending')}</span><span className="text-end tabular-nums">{f.money(num(e.pending), String(e.currency))}</span>
              <span className="text-muted-foreground">{t('refz.available', 'Available')}</span><span className="text-end tabular-nums">{f.money(num(e.available), String(e.currency))}</span>
              <span className="text-muted-foreground">{t('refz.paid', 'Paid')}</span><span className="text-end tabular-nums">{f.money(num(e.paid), String(e.currency))}</span>
              <span className="font-medium">{t('refz.lifetime', 'Lifetime')}</span><span className="text-end font-semibold tabular-nums">{f.money(num(e.lifetime), String(e.currency))}</span>
            </div>
          ))}
        </CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground">{t('refz.calc_next', 'Next payout')}</p>
          <p className="text-sm font-semibold">
            {next?.date
              ? `${f.date(String(next.date))}${next.kind === 'estimated' ? ` (${t('refz.calc_estimated', 'estimated')})` : ''}`
              : t('refz.calc_next_none', 'When your available rewards reach {{min}}', { min: f.money(minPayout, mainCur) })}
          </p>
          <Progress value={progress.percent} aria-label={t('refz.calc_threshold_aria', 'Progress to the payout minimum')} />
          <p className="text-[11px] text-muted-foreground">
            {t('refz.calc_threshold', '{{have}} of {{min}} available', { have: f.money(num(availableNow[mainCur]), mainCur), min: f.money(minPayout, mainCur) })}
          </p>
        </CardContent></Card>
      </div>

      {/* 5. Filters + exports */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t('refz.calc_period', 'Period')}</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p} value={p}>{t(`refz.period_${p}`, { all: 'All time', month: 'This month', '3m': 'Last 3 months', year: 'This year' }[p])}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('refz.h_status', 'Status')}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('refz.calc_all_states', 'All states')}</SelectItem>
              {(['pending', 'available', 'paid', 'reversed'] as const).map((x) => <SelectItem key={x} value={x}>{t(`refz.ls_${x}`, LINE_STATUS_LABEL[x as LineStatus])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('refz.c_name', 'Consultant')}</Label>
          <Select value={refKey} onValueChange={setRefKey}>
            <SelectTrigger className="w-44 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('refz.calc_all_referred', 'All referred consultants')}</SelectItem>
              {[...new Map((refs.data ?? []).map((r) => [r.ref_key, r.referred_name])).entries()].map(([k, n]) => <SelectItem key={k} value={k}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="ms-auto flex gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void exportAll('csv')}><Download className="w-4 h-4 me-1" />CSV</Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void exportAll('pdf')}><FileText className="w-4 h-4 me-1" />PDF</Button>
        </div>
      </div>

      {/* 2 + 3. Per referred consultant, with drill-down */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('refz.calc_table', 'Calculation per referred consultant')}</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {refs.isLoading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t('refz.list_empty', 'No one has signed up with your code yet.')}</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8"><span className="sr-only">{t('refz.calc_details', 'Details')}</span></TableHead>
                <TableHead>{t('refz.c_name', 'Consultant')}</TableHead>
                <TableHead>{t('refz.c_status', 'Status')}</TableHead>
                <TableHead>{t('refz.c_first', 'First paid ticket')}</TableHead>
                <TableHead>{t('refz.calc_window', 'Window ends')}</TableHead>
                <TableHead className="text-end">{t('refz.calc_mandays', 'Man-days')}</TableHead>
                <TableHead className="text-end">{t('refz.calc_fee', 'Fee base')}</TableHead>
                <TableHead className="text-end">{t('refz.calc_rate', 'Rate')}</TableHead>
                <TableHead className="text-end">{t('refz.calc_earned', 'Reward earned')}</TableHead>
                <TableHead className="text-end">{t('refz.calc_reversed', 'Reversed')}</TableHead>
                <TableHead className="text-end">{t('refz.calc_net', 'Net')}</TableHead>
                <TableHead>{t('refz.calc_state', 'State')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isOpen = open === r.ref_key;
                  return (
                    <Fragment key={`${r.ref_key}-${r.currency}`}>
                      <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.ref_key)}>
                        <TableCell>
                          <button type="button" aria-expanded={isOpen} aria-label={t('refz.calc_show_lines', 'Show invoice lines for {{name}}', { name: r.referred_name })}
                            onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : r.ref_key); }}>
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium" dir="auto">{r.referred_name}</TableCell>
                        <TableCell className="text-xs capitalize">{t(`refz.act_${r.activation_status}`, r.activation_status)}</TableCell>
                        <TableCell className="text-xs">{f.date(r.first_paid_at)}</TableCell>
                        <TableCell className="text-xs">{f.date(r.window_ends_at)}</TableCell>
                        <TableCell className="text-end tabular-nums">{r.man_days}</TableCell>
                        <TableCell className="text-end tabular-nums">{f.money(r.fee_base, r.currency)}</TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">{r.rate_min && r.rate_min !== r.rate_percent ? `${formatRate(r.rate_min)}-${formatRate(r.rate_percent)}` : formatRate(r.rate_percent)} %</TableCell>
                        <TableCell className="text-end tabular-nums">{f.money(r.reward_earned, r.currency)}</TableCell>
                        <TableCell className={cn('text-end tabular-nums', r.reversed < 0 && 'text-destructive')}>{f.money(r.reversed, r.currency)}</TableCell>
                        <TableCell className="text-end font-semibold tabular-nums">{f.money(r.net, r.currency)}</TableCell>
                        <TableCell className="text-[11px] whitespace-nowrap">
                          <div>{t('refz.pending', 'Pending')} {f.money(r.pending, r.currency)}</div>
                          <div>{t('refz.available', 'Available')} {f.money(r.available, r.currency)}</div>
                          <div>{t('refz.paid', 'Paid')} {f.money(r.paid, r.currency)}</div>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={12} className="bg-muted/30 p-3">
                            {lines.isLoading ? <Skeleton className="h-12 w-full" /> : (lines.data ?? []).length === 0 ? (
                              <p className="text-sm text-muted-foreground">{t('refz.calc_no_lines', 'No invoice lines yet for this consultant in the chosen period.')}</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <Table>
                                  <TableHeader><TableRow>
                                    <TableHead>{t('refz.h_date', 'Date')}</TableHead>
                                    <TableHead>{t('refz.calc_engagement', 'Engagement')}</TableHead>
                                    <TableHead className="text-end">{t('refz.calc_hours', 'Approved hours')}</TableHead>
                                    <TableHead className="text-end">{t('refz.calc_mandays', 'Man-days')}</TableHead>
                                    <TableHead>{t('refz.calc_formula', 'Calculation')}</TableHead>
                                    <TableHead>{t('refz.calc_invoice', 'Client invoice')}</TableHead>
                                    <TableHead>{t('refz.calc_release', 'Payout released')}</TableHead>
                                    <TableHead>{t('refz.calc_state', 'State')}</TableHead>
                                  </TableRow></TableHeader>
                                  <TableBody>
                                    {(lines.data ?? []).map((l, i) => (
                                      <TableRow key={`${l.created_at}-${i}`}>
                                        <TableCell className="text-xs">{f.date(l.created_at)}</TableCell>
                                        <TableCell className="text-xs font-mono" dir="ltr">{l.engagement_ref ?? '-'}</TableCell>
                                        <TableCell className="text-end text-xs tabular-nums">{l.approved_hours ?? '-'}</TableCell>
                                        <TableCell className="text-end text-xs tabular-nums">{l.man_days ?? '-'}</TableCell>
                                        <TableCell className="text-xs" dir="ltr">
                                          {l.kind === 'reward' && l.fee_amount != null
                                            ? formulaText(num(l.fee_amount), num(l.rate_percent), num(l.amount), (v) => f.money(v, l.currency))
                                            : `${l.kind === 'reversal' ? t('refz.k_reversal', 'Reversal (refund or correction)') : t('refz.k_adjust', 'Adjustment by AI Support 360')}: ${f.money(num(l.amount), l.currency)}`}
                                          {l.note && <div className="text-muted-foreground">{l.note}</div>}
                                        </TableCell>
                                        <TableCell className="text-xs">{l.payment_status ? t(`refz.pay_${l.payment_status}`, l.payment_status) : '-'}{l.client_paid_at ? ` · ${f.date(l.client_paid_at)}` : ''}</TableCell>
                                        <TableCell className="text-xs">{l.payout_released_at ? f.date(l.payout_released_at) : '-'}</TableCell>
                                        <TableCell className="text-xs">{t(`refz.ls_${l.status}`, LINE_STATUS_LABEL[l.status as LineStatus] ?? l.status)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
              <TableFooter>
                {totals.map((tt) => (
                  <TableRow key={`total-${tt.currency}`}>
                    <TableCell />
                    <TableCell colSpan={4} className="font-semibold">{t('refz.calc_total', 'Total')} ({tt.currency})</TableCell>
                    <TableCell className="text-end tabular-nums">{tt.man_days}</TableCell>
                    <TableCell className="text-end tabular-nums">{f.money(tt.fee_base, tt.currency)}</TableCell>
                    <TableCell />
                    <TableCell className="text-end tabular-nums">{f.money(tt.reward_earned, tt.currency)}</TableCell>
                    <TableCell className="text-end tabular-nums">{f.money(tt.reversed, tt.currency)}</TableCell>
                    <TableCell className="text-end font-bold tabular-nums">{f.money(tt.net, tt.currency)}</TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 4. Monthly chart + honest forecast */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('refz.calc_chart', 'Earnings per month')} ({mainCur})</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64" role="img" aria-label={t('refz.calc_chart_aria', 'Bar chart of referral rewards earned and paid per month')}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} reversed={f.lang === 'ar'} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} orientation={f.lang === 'ar' ? 'right' : 'left'} />
                <Tooltip formatter={(v: number) => f.money(v, mainCur)} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12 }} />
                <Legend />
                <Bar dataKey="earned" name={t('refz.calc_series_earned', 'Earned')} fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="paid" name={t('refz.calc_series_paid', 'Paid')} fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="expected" name={t('refz.calc_series_expected', 'Expected, not guaranteed')} fill="hsl(var(--muted-foreground) / 0.4)" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" radius={[6, 6, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {(forecast.data ?? []).length
              ? t('refz.calc_forecast_note', '* Expected, not guaranteed: from timesheets the clients already approved but have not paid yet ({{n}} timesheet(s)). It counts only after the client pays.', { n: (forecast.data ?? []).reduce((a, x) => a + num(x.timesheets), 0) })
              : t('refz.calc_no_forecast', 'No forecast: there are no approved, unpaid timesheets right now.')}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {/* 5b. Monthly statements */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('refz.calc_statements', 'Monthly statements')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(statements.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('refz.calc_statements_empty', 'Your first statement is created automatically on the 1st of next month. You will get a notification.')}</p>
            ) : (statements.data ?? []).map((st) => (
              <div key={st.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 p-3 text-sm">
                <div>
                  <p className="font-medium">{f.monthLong(st.period_month)}</p>
                  <p className="text-xs text-muted-foreground">{t('refz.calc_statement_meta', '{{n}} line(s) · created {{date}}', { n: (st.lines ?? []).length, date: f.date(st.generated_at) })}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void exportAll('csv', st.lines ?? [], st.period_month.slice(0, 7))}>CSV</Button>
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void exportAll('pdf', st.lines ?? [], st.period_month.slice(0, 7))}>PDF</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
