// The payout example of the public "For consultants" page: what the client pays and what the
// consultant receives, for an hourly rate and a number of hours. The percentages are the current
// standard fees (portal 10 %, payment processing 5 %, VAT 15 % on the fee plus both fees) and the
// calculation is the same one the invoice uses (priceBreakdown), so the example matches a real bill.
// Pure functions without database access.

import { priceBreakdown, type PriceBreakdown } from './pricing';

/** The current standard fees, as on the pricing page and the invoices. */
export const PAYOUT_TERMS = { serviceFeePercent: 10, processingFeePercent: 5, vatPercent: 15 } as const;

export const RATE_MIN = 1;
export const RATE_MAX = 1000;
export const HOURS_MIN = 0.25;
export const HOURS_MAX = 200;

/** The extra on the approved hourly rate for a fast critical reply that the client accepts. */
export const CRITICAL_RATE_BOOST = 0.3;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return RATE_MIN;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
}

export function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return HOURS_MIN;
  return Math.min(HOURS_MAX, Math.max(HOURS_MIN, hours));
}

/**
 * The full picture for a rate and hours: the consultant fee (base), the fees and the VAT that the
 * client pays on top, and the total the client pays. `base` is what the consultant receives.
 */
export function payoutExample(rate: number, hours: number): PriceBreakdown {
  return priceBreakdown(clampRate(rate) * clampHours(hours), PAYOUT_TERMS);
}

/** The raised hourly rate for an accepted fast critical reply (50 -> 65). */
export function criticalRate(rate: number): number {
  return Math.round(clampRate(rate) * (1 + CRITICAL_RATE_BOOST) * 100) / 100;
}
