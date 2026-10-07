import { Info } from 'lucide-react';
import { useSubscriptionPlans } from '@/hooks/useSubscriptionPlans';

/** Shows each active plan's consultant-rate discount and ticket carry-over rule, as set by the admin. */
export default function PlanTermsNote() {
  const { data: plans } = useSubscriptionPlans();
  if (!plans || plans.length === 0) return null;
  return (
    <div className="max-w-5xl mx-auto mt-10 rounded-2xl border border-border/60 bg-card/80 p-5 text-sm">
      <p className="flex items-center gap-2 font-semibold text-foreground mb-3">
        <Info className="w-4 h-4 text-primary" aria-hidden="true" /> Plan terms
      </p>
      <ul className="grid gap-2 md:grid-cols-3">
        {plans.map((p: any) => (
          <li key={p.id} className="text-muted-foreground">
            <span className="font-medium text-foreground">{p.name}:</span>{' '}
            {Number(p.rate_discount_percent) > 0 ? `${p.rate_discount_percent}% off consultant hourly rates. ` : ''}
            {p.tickets_roll_over
              ? 'Unused tickets carry over to the next month.'
              : 'Unused tickets are not carried over to the next month.'}
          </li>
        ))}
      </ul>
    </div>
  );
}
