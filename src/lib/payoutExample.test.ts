import { describe, expect, it } from 'vitest';
import { clampHours, clampRate, criticalRate, payoutExample, PAYOUT_TERMS } from './payoutExample';

describe('payoutExample', () => {
  it('the 50 USD/h x 8 h example: 400 / 40 / 20 / 69 / 529', () => {
    const b = payoutExample(50, 8);
    expect(b.base).toBe(400);
    expect(b.serviceFee).toBe(40);
    expect(b.processingFee).toBe(20);
    expect(b.vat).toBe(69);
    expect(b.total).toBe(529);
  });

  it('uses the current standard fees (10 %, 5 %, 15 %)', () => {
    expect(PAYOUT_TERMS).toEqual({ serviceFeePercent: 10, processingFeePercent: 5, vatPercent: 15 });
    const b = payoutExample(100, 1);
    expect(b.serviceFeePercent).toBe(10);
    expect(b.processingFeePercent).toBe(5);
    expect(b.vatPercent).toBe(15);
  });

  it('rounds every part to 2 decimals', () => {
    const b = payoutExample(33.33, 1);
    expect([b.base, b.serviceFee, b.processingFee, b.vat, b.total]).toEqual([33.33, 3.33, 1.67, 5.75, 44.08]);
  });

  it('clamps the rate to 1-1000 and the hours to 0.25-200', () => {
    expect(payoutExample(0, 8).base).toBe(8);
    expect(payoutExample(5000, 1).base).toBe(1000);
    expect(payoutExample(50, 0).base).toBe(12.5);
    expect(payoutExample(50, 500).base).toBe(10000);
    expect(payoutExample(Number.NaN, Number.NaN).base).toBe(0.25);
  });

  it('the parts always add up to the total the client pays', () => {
    for (const [rate, hours] of [[50, 8], [75.5, 3.25], [120, 40], [1, 0.25]] as const) {
      const b = payoutExample(rate, hours);
      expect(Math.round((b.base + b.serviceFee + b.processingFee + b.vat) * 100)).toBe(Math.round(b.total * 100));
    }
  });
});

describe('clampRate / clampHours', () => {
  it('clamps to the bounds', () => {
    expect(clampRate(0)).toBe(1);
    expect(clampRate(50)).toBe(50);
    expect(clampRate(1001)).toBe(1000);
    expect(clampHours(0)).toBe(0.25);
    expect(clampHours(8)).toBe(8);
    expect(clampHours(201)).toBe(200);
  });
});

describe('criticalRate', () => {
  it('raises the rate by 30 % (50 -> 65)', () => {
    expect(criticalRate(50)).toBe(65);
    expect(criticalRate(40)).toBe(52);
  });
});
