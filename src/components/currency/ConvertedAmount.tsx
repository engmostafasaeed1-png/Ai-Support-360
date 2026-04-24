import { useCurrency, formatMoney } from '@/contexts/CurrencyContext';
import { cn } from '@/lib/utils';

interface ConvertedAmountProps {
  amount: number;
  currency: string;
  className?: string;
  subClassName?: string;
  /** When true, shows only the converted value if conversion happens (hides original). Default: false. */
  hideOriginal?: boolean;
  /** Inline layout instead of stacked. Default: false. */
  inline?: boolean;
}

/**
 * Renders the original invoice amount and (when different from preferred currency)
 * the live FX-converted equivalent in the user's preferred currency.
 */
export function ConvertedAmount({
  amount,
  currency,
  className,
  subClassName,
  hideOriginal = false,
  inline = false,
}: ConvertedAmountProps) {
  const { preferred, convert, isLoading, isError } = useCurrency();
  const src = (currency || 'USD').toUpperCase();
  const sameCurrency = src === preferred;
  const converted = sameCurrency ? null : convert(amount, src);

  if (sameCurrency || hideOriginal === false) {
    return (
      <span className={cn(inline ? 'inline-flex items-baseline gap-1.5' : 'flex flex-col', className)}>
        <span>{formatMoney(amount, src)}</span>
        {!sameCurrency && (
          <span
            className={cn(
              'text-[11px] text-muted-foreground font-normal',
              inline && 'before:content-["≈"] before:mr-0.5',
              subClassName,
            )}
            title={`Converted from ${src} to ${preferred}`}
          >
            {converted !== null
              ? `${inline ? '' : '≈ '}${formatMoney(converted, preferred)}`
              : isLoading
              ? '…'
              : isError
              ? 'rate unavailable'
              : '—'}
          </span>
        )}
      </span>
    );
  }

  // hideOriginal && different currency
  return (
    <span className={className} title={`Original: ${formatMoney(amount, src)}`}>
      {converted !== null ? formatMoney(converted, preferred) : formatMoney(amount, src)}
    </span>
  );
}
