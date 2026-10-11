import { describe, it, expect } from 'vitest';
import { rateSurchargeNote } from './rateSurcharge';

describe('rateSurchargeNote', () => {
  it('says that a rate includes the critical reply surcharge, with the rate of the consultant', () => {
    expect(rateSurchargeNote({ currency: 'USD', base_rate: 100, surcharge_percent: 30 })).toBe('Includes the critical reply surcharge: 100.00 USD + 30% per hour');
  });

  it('keeps decimals of the percentage and numbers that arrive as text', () => {
    expect(rateSurchargeNote({ currency: 'EUR', base_rate: '87.5' as unknown as number, surcharge_percent: '12.50' as unknown as number })).toBe(
      'Includes the critical reply surcharge: 87.50 EUR + 12.5% per hour',
    );
  });

  it('says nothing for an ordinary rate', () => {
    expect(rateSurchargeNote({ currency: 'USD', base_rate: null, surcharge_percent: null })).toBeNull();
    expect(rateSurchargeNote({ currency: 'USD' })).toBeNull();
    expect(rateSurchargeNote({ currency: 'USD', base_rate: 100, surcharge_percent: 0 })).toBeNull();
    expect(rateSurchargeNote(null)).toBeNull();
    expect(rateSurchargeNote(undefined)).toBeNull();
  });
});
