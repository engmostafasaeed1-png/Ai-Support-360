// The price of consultant work, as the client pays it:
//   consultant fee   = billable hours x the hourly rate that the client approved
//   + service fee    = a percentage of the fee (the portal)
//   + processing fee = a percentage of the fee (the payment provider)
//   = subtotal; + VAT on the subtotal = the total
// The database makes the same calculation when the client approves a timesheet (function pricing_breakdown). Every part is rounded
// to cents in the same order, half up, so a figure that is shown before the approval is the figure of the invoice.
// Pure functions without database access.

export interface FeePercents {
  serviceFeePercent: number;
  processingFeePercent: number;
  /** the VAT of today; when set it wins over the VAT that is passed to a calculation */
  vatPercent?: number;
}

export interface PricingTerms extends FeePercents {
  vatPercent: number;
  /** the subscription plans are offered (switched off in the pay-per-timesheet model) */
  plansEnabled: boolean;
  /** online card payment is switched on */
  cardsEnabled: boolean;
}

export interface PriceBreakdown {
  /** the fee of the consultant */
  base: number;
  serviceFeePercent: number;
  serviceFee: number;
  processingFeePercent: number;
  processingFee: number;
  /** service fee + processing fee */
  fees: number;
  /** fee + both fees: the amount that the VAT is calculated on */
  subtotal: number;
  vatPercent: number;
  vat: number;
  total: number;
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** An amount in cents, rounded half up on the written decimals (not on the binary value: 16.665 is 1667 cents). */
function toCents(amount: number): number {
  const text = Math.abs(amount).toFixed(6);
  const [whole, fraction] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2));
  return Number(fraction[2]) >= 5 ? cents + 1 : cents;
}

/** cents x percent / 100, rounded half up, with whole numbers only. */
function percentOfCents(cents: number, percent: number): number {
  const hundredths = Math.round(toNumber(percent) * 100);
  return Math.floor((2 * cents * hundredths + 10000) / 20000);
}

export function priceBreakdown(base: number, terms: { serviceFeePercent: number; processingFeePercent: number; vatPercent: number }): PriceBreakdown {
  const baseCents = toCents(Math.max(0, toNumber(base)));
  const serviceCents = percentOfCents(baseCents, terms.serviceFeePercent);
  const processingCents = percentOfCents(baseCents, terms.processingFeePercent);
  const subtotalCents = baseCents + serviceCents + processingCents;
  const vatCents = percentOfCents(subtotalCents, terms.vatPercent);
  return {
    base: baseCents / 100,
    serviceFeePercent: toNumber(terms.serviceFeePercent),
    serviceFee: serviceCents / 100,
    processingFeePercent: toNumber(terms.processingFeePercent),
    processingFee: processingCents / 100,
    fees: (serviceCents + processingCents) / 100,
    subtotal: subtotalCents / 100,
    vatPercent: toNumber(terms.vatPercent),
    vat: vatCents / 100,
    total: (subtotalCents + vatCents) / 100,
  };
}

/** The terms as the database function pricing_terms() returns them. null when a percentage is not set: nothing is made up. */
export function parseTerms(data: unknown): PricingTerms | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const read = (key: string): number | null => {
    const v = d[key];
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const service = read('service_fee_percent');
  const processing = read('processing_fee_percent');
  const vat = read('vat_percent');
  if (service === null || processing === null || vat === null) return null;
  return { serviceFeePercent: service, processingFeePercent: processing, vatPercent: vat, plansEnabled: d.plans_enabled === true, cardsEnabled: d.cards_enabled === true };
}

/** 10 -> "10%", 12.5 -> "12.5%" */
export function formatPercent(value: number | null | undefined): string {
  return `${Number(toNumber(value).toFixed(2))}%`;
}

/** The numbers saved with an invoice (a row of payments, or the same row after useClientPayments). null for an invoice that has no breakdown. */
export function paymentBreakdown(p: {
  pricing_model?: string | null;
  amount?: unknown;
  vat?: unknown;
  vat_amount?: unknown;
  base_amount?: unknown;
  service_fee_percent?: unknown;
  service_fee_amount?: unknown;
  processing_fee_percent?: unknown;
  processing_fee_amount?: unknown;
  vat_percent?: unknown;
}): PriceBreakdown | null {
  if (p.pricing_model !== 'v2' || p.base_amount == null || p.service_fee_amount == null || p.processing_fee_amount == null) return null;
  const base = toNumber(p.base_amount);
  const serviceFee = toNumber(p.service_fee_amount);
  const processingFee = toNumber(p.processing_fee_amount);
  return {
    base,
    serviceFeePercent: toNumber(p.service_fee_percent),
    serviceFee,
    processingFeePercent: toNumber(p.processing_fee_percent),
    processingFee,
    fees: Math.round((serviceFee + processingFee) * 100) / 100,
    subtotal: Math.round((base + serviceFee + processingFee) * 100) / 100,
    vatPercent: toNumber(p.vat_percent),
    vat: toNumber(p.vat_amount ?? p.vat),
    total: toNumber(p.amount),
  };
}
