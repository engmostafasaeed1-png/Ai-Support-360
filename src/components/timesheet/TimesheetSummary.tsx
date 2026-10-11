import { AlertTriangle, Clock, Percent, Receipt, Wallet, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ToneBadge } from '@/components/timesheet/StatusBadge';
import TimesheetProgress from '@/components/timesheet/TimesheetProgress';
import { usePricingTerms } from '@/hooks/usePricingTerms';
import { formatPercent } from '@/lib/pricing';
import { entryStatus, formatHours, formatMoney, planUsage, statusInfo, summarise, type SubmissionRow, type WorkLogRow } from '@/lib/timesheet';
import { STATUS_DOT, progressChip, type ProgressStep } from '@/lib/timesheetView';

export interface PlanInfo {
  plannedHours: number;
  plannedCost: number;
  currency: string;
  approved: boolean;
}

interface Props {
  logs: WorkLogRow[];
  submissions: SubmissionRow[];
  /** the VAT of the platform in percent (the invoice takes the VAT of the day of the approval) */
  vatPercent: number;
  currency: string;
  /** "50.00 USD per hour" when one approved rate applies to all the entries shown, else null */
  rateLabel: string | null;
  plan: PlanInfo | null;
  /** who looks at the numbers: the consultant sees the fee as their own, the client sees the total that is paid */
  audience?: 'client' | 'consultant';
  /** the five steps of the timesheet (rate, hours, submitted, approved, paid); shown at the top when given */
  steps?: ProgressStep[];
}

const GROUPS = [
  { key: 'open', label: 'Not sent yet' },
  { key: 'submitted', label: statusInfo('submitted').label },
  { key: 'changes_requested', label: statusInfo('changes_requested').label },
  { key: 'signed', label: statusInfo('signed').label },
  { key: 'draft', label: statusInfo('draft').label },
];

function Tile({ label, value, sub, icon: Icon, highlight = false }: { label: string; value: string; sub: string; icon: LucideIcon; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-card'}`}>
      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${highlight ? 'text-primary' : 'text-muted-foreground'}`}>
        <span className={`flex h-5 w-5 items-center justify-center rounded-md ${highlight ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
          <Icon className="h-3 w-3" aria-hidden="true" />
        </span>
        {label}
      </div>
      <p className={`mt-2 text-xl font-bold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** The overview of the timesheet: where it stands (five steps), the calculation (hours, fee, fees and VAT, total), the hours per status and the part of the approved plan that is used. */
export default function TimesheetSummary({ logs, submissions, vatPercent, currency, rateLabel, plan, audience = 'client', steps }: Props) {
  const { data: pricingTerms } = usePricingTerms();
  const fees = pricingTerms ?? undefined;
  const all = summarise(logs, vatPercent, fees);
  const rows = GROUPS.map(g => {
    const items = logs.filter(l => entryStatus(l, submissions) === g.key);
    return { ...g, count: items.length, summary: summarise(items, vatPercent, fees) };
  }).filter(r => r.count > 0);
  const usage = plan ? planUsage(plan.plannedHours, all.totalHours) : null;
  const vatLabel = String(Number(vatPercent) || 0);
  const feeNote = pricingTerms
    ? `${formatPercent(pricingTerms.serviceFeePercent)} service + ${formatPercent(pricingTerms.processingFeePercent)} payment fee + ${vatLabel}% VAT`
    : `VAT ${vatLabel}%`;
  const consultant = audience === 'consultant';
  const chip = steps && steps.length > 0 ? progressChip(steps) : null;

  return (
    <Card className="rounded-2xl border-border/50 shadow-sm" data-testid="timesheet-summary">
      <CardContent className="space-y-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Overview</p>
          {chip && <ToneBadge label={chip.label} tone={chip.tone} />}
        </div>

        {steps && steps.length > 0 && <TimesheetProgress steps={steps} />}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="summary-tiles">
          <Tile label="Hours" value={formatHours(all.totalHours)} sub={`${formatHours(all.billableHours)} billable`} icon={Clock} />
          <Tile
            label={consultant ? 'Your fee' : 'Consultant fee'}
            value={formatMoney(all.subtotal, currency)}
            sub={consultant ? 'you receive this in full' : 'billable hours x hourly rate'}
            icon={Wallet}
          />
          <Tile
            label="Fees and VAT"
            value={formatMoney(all.fees + all.vat, currency)}
            sub={consultant ? 'the client pays them on top' : feeNote}
            icon={Percent}
          />
          <Tile
            label={consultant ? 'The client pays' : 'Total you pay'}
            value={formatMoney(all.total, currency)}
            sub={consultant ? feeNote : 'fee + fees + VAT'}
            icon={Receipt}
            highlight
          />
        </div>

        {rateLabel && (
          <p className="text-xs text-muted-foreground">
            Hourly rate: <strong className="text-foreground">{rateLabel}</strong>. Amount = billable hours x hourly rate. Hours that are not billable cost nothing.
          </p>
        )}
        {all.pendingRateHours > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{formatHours(all.pendingRateHours)} wait for an approved hourly rate and are not in the amounts yet.</p>
          </div>
        )}

        {rows.length > 0 && all.totalHours > 0 && (
          <div data-testid="status-breakdown">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label="Hours by status">
              {rows.map(r => (
                <div key={r.key} className={STATUS_DOT[r.key] ?? 'bg-slate-400'} style={{ width: `${(r.summary.totalHours / all.totalHours) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {rows.map(r => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[r.key] ?? 'bg-slate-400'}`} aria-hidden="true" />
                  <span className="text-foreground">{r.label}</span>
                  <span className="ms-auto text-muted-foreground">{formatHours(r.summary.totalHours)} &middot; {formatMoney(r.summary.subtotal, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {usage && plan && (
          <div className="space-y-1.5 rounded-xl bg-muted/60 p-3" data-testid="plan-usage">
            <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs">
              <span className="text-muted-foreground">
                {plan.approved ? 'Approved plan' : 'Plan (not approved yet)'}: {formatHours(plan.plannedHours)} / {formatMoney(plan.plannedCost, plan.currency || currency)}
              </span>
              <span className={usage.over ? 'font-semibold text-red-700' : 'font-medium text-muted-foreground'}>{usage.percent}% of the hours used</span>
            </div>
            <Progress value={Math.min(100, usage.percent)} className="h-1.5" />
            {usage.over && (
              <p className="text-xs text-red-700">The hours are {formatHours(usage.overBy)} over the plan. The client sees this before answering.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
