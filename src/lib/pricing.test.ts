import { describe, expect, it } from 'vitest';
import { formatPercent, parseTerms, paymentBreakdown, priceBreakdown } from './pricing';

const terms = { serviceFeePercent: 10, processingFeePercent: 5, vatPercent: 15 };

describe('priceBreakdown', () => {
  it('adds the service fee, the processing fee and the VAT on top of the consultant fee', () => {
    expect(priceBreakdown(300, terms)).toEqual({
      base: 300,
      serviceFeePercent: 10,
      serviceFee: 30,
      processingFeePercent: 5,
      processingFee: 15,
      fees: 45,
      subtotal: 345,
      vatPercent: 15,
      vat: 51.75,
      total: 396.75,
    });
  });

  it('rounds every part to cents, half up, like the database', () => {
    const a = priceBreakdown(33.33, terms);
    expect([a.serviceFee, a.processingFee, a.subtotal, a.vat, a.total]).toEqual([3.33, 1.67, 38.33, 5.75, 44.08]);
    const b = priceBreakdown(175, terms);
    expect([b.serviceFee, b.processingFee, b.subtotal, b.vat, b.total]).toEqual([17.5, 8.75, 201.25, 30.19, 231.44]);
  });

  it('rounds the fee itself to cents first (41.6625 -> 41.66)', () => {
    const b = priceBreakdown(41.6625, terms);
    expect([b.base, b.serviceFee, b.processingFee, b.vat, b.total]).toEqual([41.66, 4.17, 2.08, 7.19, 55.1]);
  });

  it('rounds the written decimals, not the binary value (16.665 -> 16.67)', () => {
    expect(priceBreakdown(16.665, { serviceFeePercent: 0, processingFeePercent: 0, vatPercent: 0 }).base).toBe(16.67);
  });

  it('works with percentages that have decimals', () => {
    const b = priceBreakdown(200, { serviceFeePercent: 12.5, processingFeePercent: 2.5, vatPercent: 5 });
    expect([b.serviceFee, b.processingFee, b.vat, b.total]).toEqual([25, 5, 11.5, 241.5]);
  });

  it('without fees only the VAT is added', () => {
    const b = priceBreakdown(100, { serviceFeePercent: 0, processingFeePercent: 0, vatPercent: 14 });
    expect([b.fees, b.vat, b.total]).toEqual([0, 14, 114]);
  });

  it('treats zero, negative and non-numeric amounts as zero', () => {
    expect(priceBreakdown(0, terms).total).toBe(0);
    expect(priceBreakdown(-5, terms).total).toBe(0);
    expect(priceBreakdown(Number.NaN, terms).total).toBe(0);
  });

  it('handles the largest amount', () => {
    expect(priceBreakdown(10_000_000, terms).total).toBe(13_225_000);
  });

  it('the parts always add up to the total', () => {
    for (let i = 1; i <= 500; i++) {
      const b = priceBreakdown(i * 7.37 + (i % 13) * 0.01, terms);
      expect(Math.round((b.base + b.serviceFee + b.processingFee + b.vat) * 100)).toBe(Math.round(b.total * 100));
    }
  });
});

describe('parseTerms', () => {
  it('reads the answer of the database', () => {
    expect(parseTerms({ service_fee_percent: 10, processing_fee_percent: '5', vat_percent: 15, plans_enabled: false, cards_enabled: true })).toEqual({
      serviceFeePercent: 10,
      processingFeePercent: 5,
      vatPercent: 15,
      plansEnabled: false,
      cardsEnabled: true,
    });
  });

  it('returns null when a percentage is not set, so that nothing is made up', () => {
    expect(parseTerms({ service_fee_percent: 10, processing_fee_percent: null, vat_percent: 15 })).toBeNull();
    expect(parseTerms(null)).toBeNull();
    expect(parseTerms('x')).toBeNull();
  });
});

describe('paymentBreakdown', () => {
  it('shows the saved numbers of a v2 invoice', () => {
    const b = paymentBreakdown({
      pricing_model: 'v2',
      amount: '396.75',
      vat_amount: '51.75',
      base_amount: '300.00',
      service_fee_percent: '10.00',
      service_fee_amount: '30.00',
      processing_fee_percent: '5.00',
      processing_fee_amount: '15.00',
      vat_percent: '15.00',
    });
    expect(b).toMatchObject({ base: 300, serviceFee: 30, processingFee: 15, fees: 45, subtotal: 345, vat: 51.75, total: 396.75, vatPercent: 15 });
  });

  it('reads the VAT of the client payments list too', () => {
    const b = paymentBreakdown({ pricing_model: 'v2', amount: 132.25, vat: 17.25, base_amount: 100, service_fee_amount: 10, processing_fee_amount: 5, service_fee_percent: 10, processing_fee_percent: 5, vat_percent: 15 });
    expect(b?.vat).toBe(17.25);
  });

  it('returns null for an old invoice', () => {
    expect(paymentBreakdown({ pricing_model: 'legacy', amount: 114, vat_amount: 14 })).toBeNull();
    expect(paymentBreakdown({ amount: 114 })).toBeNull();
  });
});

describe('formatPercent', () => {
  it('writes percentages without trailing zeros', () => {
    expect(formatPercent(10)).toBe('10%');
    expect(formatPercent(12.5)).toBe('12.5%');
    expect(formatPercent(null)).toBe('0%');
  });
});
