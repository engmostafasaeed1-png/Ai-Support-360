import { formatMoney, num, type RateRow } from '@/lib/timesheet';

/**
 * A rate that was approved (or proposed) with the critical reply surcharge says so: "Includes the critical reply surcharge: 100.00 USD + 30% per hour".
 * The database keeps the rate of the consultant (base_rate) and the surcharge (surcharge_percent) next to the hourly rate that is billed.
 * Returns null for an ordinary rate.
 */
export function rateSurchargeNote(rate: Pick<RateRow, 'currency' | 'base_rate' | 'surcharge_percent'> | null | undefined): string | null {
  const percent = num(rate?.surcharge_percent);
  const base = num(rate?.base_rate);
  if (!rate || percent <= 0 || base <= 0) return null;
  const shown = Number.isInteger(percent) ? String(percent) : String(Number(percent.toFixed(2)));
  return `Includes the critical reply surcharge: ${formatMoney(base, rate.currency)} + ${shown}% per hour`;
}
