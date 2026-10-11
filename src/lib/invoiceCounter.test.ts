import { describe, expect, it } from 'vitest';
import {
  MAX_COUNTER_NUMBER,
  describeGap,
  formatInvoiceNumber,
  parseCounterInput,
  toInvoiceCounterInfo,
  validateNextNumber,
  validateReason,
  yearOf,
} from './invoiceCounter';

const info = { year: 2026, next_number: 19, highest_used: 15, lowest_allowed_next: 16 };

describe('formatInvoiceNumber', () => {
  it('writes INV-year-number with at least six digits', () => {
    expect(formatInvoiceNumber(2026, 19)).toBe('INV-2026-000019');
    expect(formatInvoiceNumber(2026, 1)).toBe('INV-2026-000001');
    expect(formatInvoiceNumber(2027, 999999)).toBe('INV-2027-999999');
    expect(formatInvoiceNumber(2027, 1234567)).toBe('INV-2027-1234567');
  });
});

describe('yearOf', () => {
  it('reads the year of a date and falls back when the date is broken', () => {
    expect(yearOf('2026-10-11T12:15:20+00:00', 2000)).toBe(2026);
    expect(yearOf('', 2025)).toBe(2025);
    expect(yearOf('not a date', 2025)).toBe(2025);
  });
});

describe('parseCounterInput', () => {
  it('accepts whole numbers only', () => {
    expect(parseCounterInput('16')).toBe(16);
    expect(parseCounterInput('  16 ')).toBe(16);
    expect(parseCounterInput('0016')).toBe(16);
    for (const bad of ['', ' ', '1.5', '-3', 'abc', '1e3', '12345678']) {
      expect(parseCounterInput(bad)).toBeNull();
    }
  });
});

describe('validateNextNumber', () => {
  it('accepts a free number above the highest one on an invoice', () => {
    expect(validateNextNumber('16', info)).toBeNull();
    expect(validateNextNumber('25', info)).toBeNull();
    expect(validateNextNumber(String(MAX_COUNTER_NUMBER), info)).toBeNull();
  });

  it('refuses what the database would refuse', () => {
    expect(validateNextNumber('', info)).toMatch(/whole number/);
    expect(validateNextNumber('abc', info)).toMatch(/whole number/);
    expect(validateNextNumber('0', info)).toMatch(/1 to 999999/);
    expect(validateNextNumber('1000000', info)).toMatch(/1 to 999999/);
    expect(validateNextNumber('19', info)).toMatch(/already at this number/);
    expect(validateNextNumber('15', info)).toBe('The number must be at least 16: INV-2026-000015 is already used.');
    expect(validateNextNumber('3', info)).toMatch(/at least 16/);
  });

  it('allows any number from 1 when no invoice of the year exists', () => {
    const empty = { year: 2026, next_number: 5, highest_used: 0, lowest_allowed_next: 1 };
    expect(validateNextNumber('1', empty)).toBeNull();
    expect(validateNextNumber('5', empty)).toMatch(/already at this number/);
  });
});

describe('validateReason', () => {
  it('needs 5 to 300 characters', () => {
    expect(validateReason('abcd')).toMatch(/at least 5/);
    expect(validateReason('   abcd   ')).toMatch(/at least 5/);
    expect(validateReason(' abcde ')).toBeNull();
    expect(validateReason('x'.repeat(300))).toBeNull();
    expect(validateReason('x'.repeat(301))).toMatch(/at most 300/);
  });
});

describe('describeGap', () => {
  it('names the numbers that no invoice carries', () => {
    expect(describeGap(info)).toBe('No invoice has the numbers INV-2026-000016 to INV-2026-000018.');
    expect(describeGap({ ...info, next_number: 17 })).toBe('No invoice has the number INV-2026-000016.');
  });

  it('says nothing when the counter follows the highest number or is behind it', () => {
    expect(describeGap({ ...info, next_number: 16 })).toBeNull();
    expect(describeGap({ ...info, next_number: 5 })).toBeNull();
  });
});

describe('toInvoiceCounterInfo', () => {
  it('reads the answer of the database function', () => {
    const r = toInvoiceCounterInfo({
      year: 2026,
      next_number: 19,
      next_invoice_number: 'INV-2026-000019',
      highest_used: 15,
      lowest_allowed_next: 16,
      invoices_total: 2,
      history: [
        { changed_at: '2026-10-11T12:00:00+00:00', changed_by_name: 'Mostafa Saeed', old_next: 19, new_next: 16, reason: 'Close the gap' },
      ],
    });
    expect(r.next_invoice_number).toBe('INV-2026-000019');
    expect(r.lowest_allowed_next).toBe(16);
    expect(r.invoices_total).toBe(2);
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({ old_next: 19, new_next: 16, reason: 'Close the gap', changed_by_name: 'Mostafa Saeed' });
  });

  it('survives an empty or broken answer', () => {
    const r = toInvoiceCounterInfo(null);
    expect(r.next_number).toBe(0);
    expect(r.lowest_allowed_next).toBe(1);
    expect(r.history).toEqual([]);
    expect(toInvoiceCounterInfo({ history: 'x' }).history).toEqual([]);
    expect(toInvoiceCounterInfo({ history: [null, 5] }).history).toHaveLength(2);
  });
});
