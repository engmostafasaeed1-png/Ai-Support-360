import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { usePricingTerms } from '@/hooks/usePricingTerms';
import { formatPercent } from '@/lib/pricing';
import { entryStatus, formatHours, formatMoney, planUsage, statusInfo, summarise, type SubmissionRow, type WorkLogRow } from '@/lib/timesheet';

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
}

const GROUPS = [
  { key: 'open', label: 'Not sent yet' },
  { key: 'submitted', label: statusInfo('submitted').label },
  { key: 'changes_requested', label: statusInfo('changes_requested').label },
  { key: 'signed', label: statusInfo('signed').label },
  { key: 'draft', label: statusInfo('draft').label },
];

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border/50 p-3 text-center">
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** The calculation of the timesheet: hours, billable hours, amount (billable hours x approved rate), VAT, total, the part of the approved plan that is used. */
export default function TimesheetSummary({ logs, submissions, vatPercent, currency, rateLabel, plan, audience = 'client' }: Props) {
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
    ? `fee + ${formatPercent(pricingTerms.serviceFeePercent)} service + ${formatPercent(pricingTerms.processingFeePercent)} payment fee + ${vatLabel}% VAT`
    : `VAT ${vatLabel}%`;

  return (
    <Card className="rounded-2xl border-border/50" data-testid="timesheet-summary">
      <CardContent className="space-y-3 p-4">
        <p className="text-sm font-semibold text-foreground">Summary</p>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Hours" value={formatHours(all.totalHours)} sub={`${formatHours(all.billableHours)} billable`} />
          <Stat
            label={audience === 'consultant' ? 'Your fee' : 'Consultant fee'}
            value={formatMoney(all.subtotal, currency)}
            sub={audience === 'consultant' ? 'you receive this in full' : 'billable hours x hourly rate'}
          />
          <Stat label={audience === 'consultant' ? 'The client pays' : 'Total you pay'} value={formatMoney(all.total, currency)} sub={feeNote} />
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
        {rows.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border/40 text-xs">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 bg-muted/30 px-3 py-1.5 font-medium text-muted-foreground">
              <span>Status</span>
              <span className="text-right">Hours</span>
              <span className="text-right">Amount</span>
            </div>
            {rows.map(r => (
              <div key={r.key} className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-t border-border/40 px-3 py-1.5">
                <span>{r.label}</span>
                <span className="text-right">{formatHours(r.summary.totalHours)}</span>
                <span className="text-right">{formatMoney(r.summary.subtotal, currency)}</span>
              </div>
            ))}
          </div>
        )}
        {usage && plan && (
          <div className="space-y-1.5" data-testid="plan-usage">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {plan.approved ? 'Approved plan' : 'Plan (not approved yet)'}: {formatHours(plan.plannedHours)} / {formatMoney(plan.plannedCost, plan.currency || currency)}
              </span>
              <span className={usage.over ? 'font-semibold text-red-700' : 'text-muted-foreground'}>{usage.percent}% of the hours used</span>
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
