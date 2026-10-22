import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { referralRpc, rpcMessage } from '@/hooks/useReferralProgram';
import { formatRate, MAN_DAY_HOURS, type Tier } from '@/lib/referrals';
import {
  realNumbersFromReferrals, SIM_MAX_MAN_DAYS, SIM_MAX_REFERRED, simDefaultRate, simMonths, simulateReferrals, type RealReferralRow, type SimSettings,
} from '@/lib/referralRules';

interface Props {
  settings: SimSettings;
  tiers: Tier[];
  defaults: { own_rate: number | null; platform_rate: number | null };
  money: (v: number) => string;
}

function Field({ id, label, value, min, max, step, onChange, suffix }: {
  id: string; label: string; value: number | ''; min: number; max: number; step: number; onChange: (v: number | '') => void; suffix?: string;
}) {
  const v = value === '' ? min : value;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">{label}</Label>
        <div className="flex items-center gap-1">
          <Input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={value} className="h-8 w-24 text-end tabular-nums"
            onChange={(e) => onChange(e.target.value === '' ? '' : Math.min(max, Math.max(min, Number(e.target.value))))} />
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
      </div>
      <Slider value={[Math.min(max, v)]} min={min} max={max} step={step} onValueChange={([x]) => onChange(x)} aria-label={label} />
    </div>
  );
}

/** Live, unsaved illustration of the reward rule (pure shared math in lib/referralRules, unit tested). */
export default function RulesSimulator({ settings, tiers, defaults, money }: Props) {
  const { t } = useTranslation();
  const maxMonths = simMonths(settings.months);
  const start = useMemo(() => ({ referred: 1, manDays: 10, hourly: simDefaultRate(defaults) ?? ('' as const), months: maxMonths, ramp: false }), [defaults, maxMonths]);
  const [referred, setReferred] = useState<number | ''>(start.referred);
  const [manDays, setManDays] = useState<number | ''>(start.manDays);
  const [hourly, setHourly] = useState<number | ''>(start.hourly);
  const [months, setMonths] = useState<number | ''>(start.months);
  const [ramp, setRamp] = useState(start.ramp);
  const [loading, setLoading] = useState(false);

  const r = simulateReferrals({ referred: Number(referred) || 0, manDays: Number(manDays) || 0, hourlyRate: Number(hourly) || 0, months: Number(months) || 1, rampUp: ramp }, { ...settings, tiers });
  const peak = Math.max(1, ...r.series.map((x) => x.cumulative));
  const hourlyMax = Math.max(500, Number(hourly) || 0);

  const reset = () => { setReferred(start.referred); setManDays(start.manDays); setHourly(start.hourly); setMonths(start.months); setRamp(start.ramp); };
  const useReal = async () => {
    setLoading(true);
    const { data, error } = await referralRpc('referral_calc_referrals', { _consultant: null, _from: null, _to: null, _status: null });
    setLoading(false);
    if (error) { toast.error(rpcMessage(error, t('refr.sim_real_failed', 'Your referral numbers could not be loaded.'))); return; }
    const real = realNumbersFromReferrals(((data ?? []) as RealReferralRow[]));
    setReferred(real.referred);
    setManDays(real.manDays);
    toast.success(t('refr.sim_real_done', 'Filled with your real referrals: {{n}} paying, {{d}} man-days a month on average.', { n: real.referred, d: real.manDays }));
  };

  const noteText: Record<string, string> = {
    min_invoice: t('refr.sim_n_min', 'Each invoice line here is below the minimum of {{v}} and would earn nothing.', { v: money(settings.minInvoice) }),
    cap_referrer: t('refr.sim_n_cap', 'Above {{v}} a month the reward would be held for review, not paid automatically.', { v: money(settings.monthlyCap ?? 0) }),
    cap_referred: t('refr.sim_n_cap_one', 'Above {{v}} a month per referred consultant the reward would be held for review.', { v: money(settings.monthlyCapReferred ?? 0) }),
    max_per_referred: t('refr.sim_n_max', 'Above {{v}} in total per referred consultant the reward would be held for review.', { v: money(settings.maxPerReferred ?? 0) }),
  };

  return (
    <div className="space-y-4">
      <div role="note" className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <span>{t('refr.sim_banner', 'Illustration only - not a promise or a guarantee; actual rewards depend on approved and paid work, reviews and holds.')}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border/60 p-4">
          <Field id="sim-n" label={t('refr.sim_in_n', 'Referred consultants (verified and paying)')} value={referred} min={0} max={SIM_MAX_REFERRED} step={1} onChange={setReferred} />
          <Field id="sim-d" label={t('refr.sim_in_d', 'Average man-days per consultant per month')} value={manDays} min={0} max={SIM_MAX_MAN_DAYS} step={0.5} onChange={setManDays} />
          <Field id="sim-h" label={t('refr.sim_in_h', 'Average hourly rate')} value={hourly} min={0} max={hourlyMax} step={1} onChange={setHourly} suffix="/h" />
          {hourly === '' && <p className="text-xs text-muted-foreground">{t('refr.sim_in_h_hint', 'Enter an hourly rate to see the amounts.')}</p>}
          <Field id="sim-m" label={t('refr.sim_in_m', 'Months in the window')} value={months} min={1} max={maxMonths} step={1} onChange={setMonths} />
          <p className="text-xs text-muted-foreground">{t('refr.sim_in_hours', 'Hours per man-day: {{h}} (fixed).', { h: MAN_DAY_HOURS })}</p>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="sim-ramp" className="text-xs">{t('refr.sim_in_ramp', 'Ramp-up: colleagues join gradually')}</Label>
            <Switch id="sim-ramp" checked={ramp} onCheckedChange={setRamp} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={useReal} disabled={loading}>
              {loading ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Sparkles className="me-1 h-4 w-4" />}{t('refr.sim_real', 'Use my real numbers')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}><RotateCcw className="me-1 h-4 w-4" />{t('refr.sim_reset', 'Reset')}</Button>
          </div>
        </div>

        <div className="space-y-3 rounded-xl bg-muted/40 p-4" aria-live="polite">
          <p className="text-sm font-medium">{t('refr.sim_tier', '{{name}}: {{rate}} % applied', { name: r.tier.name, rate: formatRate(r.tier.rate) })}</p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([
              [t('refr.sim_out_month', 'Monthly reward'), money(r.monthly)],
              [t('refr.sim_out_window', '{{m}}-month reward', { m: r.months }), money(r.windowTotal)],
              [t('refr.sim_out_per', 'Per referral (window)'), money(r.perReferralWindow)],
              [t('refr.sim_out_fee', 'Total fee base'), money(r.totalFeeBase)],
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-background p-2"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <p className="text-xs">
            {r.next
              ? t('refr.sim_next', '{{n}} more referrals to reach {{name}} ({{rate}} %). With {{min}} referrals you would earn {{monthly}} a month - {{extra}} of it from the higher rate.', {
                  n: r.next.needed, name: r.next.name, rate: formatRate(r.next.rate), min: r.next.min, monthly: money(r.next.monthlyAtNext), extra: money(r.next.extraMonthly) })
              : t('refr.sim_top', 'This is the highest tier.')}
          </p>
          <figure>
            <svg viewBox={`0 0 ${r.series.length * 20} 80`} className="h-24 w-full" role="img" aria-label={t('refr.sim_chart', 'Cumulative reward by month, up to {{v}}', { v: money(r.windowTotal) })}>
              {r.series.map((x, i) => {
                const hgt = (x.cumulative / peak) * 72;
                return <rect key={x.month} x={i * 20 + 3} y={78 - hgt} width={14} height={Math.max(hgt, 1)} rx={2} className="fill-primary" />;
              })}
            </svg>
            <figcaption className="sr-only">
              <table><thead><tr><th>{t('refr.sim_month', 'Month')}</th><th>{t('refr.sim_cum', 'Cumulative')}</th></tr></thead>
                <tbody>{r.series.map((x) => <tr key={x.month}><td>{x.month}</td><td>{money(x.cumulative)}</td></tr>)}</tbody></table>
            </figcaption>
          </figure>
          {r.notes.length > 0 && <ul className="space-y-1 text-xs text-warning">{r.notes.map((n) => <li key={n}>{noteText[n]}</li>)}</ul>}
          <div className="text-[11px] text-muted-foreground">
            <p className="font-medium">{t('refr.sim_assume', 'Assumptions')}</p>
            <ul className="list-disc ps-4">
              <li>{t('refr.sim_a1', 'Fee per consultant and month = {{d}} man-days x {{h}} h x {{rate}} = {{fee}}.', { d: Number(manDays) || 0, h: MAN_DAY_HOURS, rate: money(Number(hourly) || 0), fee: money(r.feePerReferralMonth) })}</li>
              <li>{t('refr.sim_a2', 'Every referred consultant is verified, active and paid every month; one invoice line a month.')}</li>
              <li>{ramp ? t('refr.sim_a3r', 'Ramp-up: colleagues join evenly over the months; the tier follows the number active that month.') : t('refr.sim_a3', 'All colleagues work from the first month.')}</li>
              <li>{t('refr.sim_a4', 'Rewards stay pending for the hold period before they are available; refunds, reviews and caps are not included.')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
