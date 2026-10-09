import { formatMoney } from '@/lib/timesheet';
import { formatPercent, type PriceBreakdown as Breakdown } from '@/lib/pricing';

interface Props {
  breakdown: Breakdown;
  currency: string;
  /** the consultant sees that the whole fee is theirs; the client sees what is added to it */
  audience?: 'client' | 'consultant';
  /** a calculation of today, not the numbers of an approved timesheet or of an invoice */
  estimate?: boolean;
  className?: string;
}

/** The lines of a price: the consultant fee, the platform service fee, the payment processing fee, the VAT and the total. */
export default function PriceBreakdown({ breakdown: b, currency, audience = 'client', estimate = false, className = '' }: Props) {
  const money = (n: number) => formatMoney(n, currency);
  const hasFees = b.serviceFee > 0 || b.processingFee > 0 || b.serviceFeePercent > 0 || b.processingFeePercent > 0;
  return (
    <div className={className}>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-xl border border-border/50 p-3 text-sm" data-testid="price-breakdown">
        <span className="text-muted-foreground">
          {audience === 'consultant' ? 'Your fee (hours x approved hourly rate)' : 'Consultant fee (hours x approved hourly rate)'}
        </span>
        <span className="text-right">{money(b.base)}</span>
        {hasFees && (
          <>
            <span className="text-muted-foreground">Platform service fee ({formatPercent(b.serviceFeePercent)})</span>
            <span className="text-right">{money(b.serviceFee)}</span>
            <span className="text-muted-foreground">Payment processing fee ({formatPercent(b.processingFeePercent)})</span>
            <span className="text-right">{money(b.processingFee)}</span>
          </>
        )}
        <span className="text-muted-foreground">
          VAT ({formatPercent(b.vatPercent)}
          {hasFees ? ' on the fee and both fees' : ''})
        </span>
        <span className="text-right">{money(b.vat)}</span>
        <span className="font-semibold">
          {audience === 'consultant' ? 'The client pays' : 'Total'}
          {estimate ? ' (estimate)' : ''}
        </span>
        <span className="text-right font-semibold">{money(b.total)}</span>
      </div>
      {audience === 'consultant' && b.base > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          You receive the whole fee of {money(b.base)} after the client has paid. The service fee and the payment processing fee are paid by the client on top of your fee.
        </p>
      )}
    </div>
  );
}
