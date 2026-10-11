import { AlarmClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCriticalTerms } from '@/hooks/useCriticalService';
import { formatPercent, formatWindow, percentOptions, windowOptions, type CriticalChoice } from '@/lib/criticalService';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Props = {
  /** The urgency chosen in the form: the option is only offered for Critical. */
  urgency: string;
  value: CriticalChoice;
  onChange: (value: CriticalChoice) => void;
};

/**
 * The optional critical reply service in the request form. The client chooses the reply window and the surcharge (never below the standard
 * terms) and commits to them; the database alarms the consultants and applies the surcharge to the consultant who replies in time.
 */
export default function CriticalRequestOption({ urgency, value, onChange }: Props) {
  const termsQ = useCriticalTerms();
  const terms = termsQ.data;
  if (urgency !== 'critical' || !terms?.enabled) return null;

  const minutes = value.minutes ?? terms.minutes;
  const percent = value.percent ?? terms.surcharge_percent;
  // a change of a number asks for the commitment again
  const choose = (patch: Partial<CriticalChoice>) => onChange({ ...value, ...patch, agreed: false });

  return (
    <Card
      data-testid="critical-option"
      className={`rounded-xl border-2 ${value.on ? 'border-red-400 bg-red-50/60 dark:bg-red-950/20' : 'border-red-200'}`}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlarmClock className="h-4 w-4 text-red-600" /> Critical reply service
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {`Every verified consultant who covers your SAP area gets an alarm at once. A consultant who replies with a proposal within ${formatWindow(minutes)} earns +${formatPercent(percent)} on their hourly rate for this ticket. If nobody replies in time, no surcharge applies.`}
            </p>
          </div>
          <Switch
            checked={value.on}
            onCheckedChange={(on) => onChange({ ...value, on, agreed: false })}
            aria-label="Use the critical reply service"
          />
        </div>

        {value.on && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="critical-minutes" className="text-xs">Reply window</Label>
                <select
                  id="critical-minutes"
                  className={selectClass}
                  value={minutes}
                  onChange={(e) => choose({ minutes: Number(e.target.value) })}
                >
                  {windowOptions(terms.minutes, terms.max_minutes).map((m) => (
                    <option key={m} value={m}>{m === terms.minutes ? `${formatWindow(m)} (standard)` : formatWindow(m)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="critical-percent" className="text-xs">Surcharge for the consultant</Label>
                <select
                  id="critical-percent"
                  className={selectClass}
                  value={percent}
                  onChange={(e) => choose({ percent: Number(e.target.value) })}
                >
                  {percentOptions(terms.surcharge_percent, terms.max_surcharge_percent).map((p) => (
                    <option key={p} value={p}>{p === terms.surcharge_percent ? `+${formatPercent(p)} (standard)` : `+${formatPercent(p)}`}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A longer window and a higher surcharge give more consultants a reason to reply. You can still extend the time or raise the surcharge later, as long as no consultant is assigned.
            </p>
            <p className="text-xs text-muted-foreground">
              Your request is opened for bids, so verified consultants can read its title and description.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-background p-3">
              <Checkbox
                id="critical-agree"
                data-testid="critical-agree"
                className="mt-0.5"
                checked={value.agreed}
                onCheckedChange={(checked) => onChange({ ...value, agreed: checked === true })}
              />
              <Label htmlFor="critical-agree" className="text-xs font-normal leading-relaxed">
                {`I commit to this: if I accept a consultant who replied within ${formatWindow(minutes)}, ${formatPercent(percent)} is added to that consultant's hourly rate on this ticket and the invoice is calculated on the increased rate.`}
              </Label>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
