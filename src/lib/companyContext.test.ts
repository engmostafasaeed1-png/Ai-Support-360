import { describe, it, expect } from 'vitest';
import { companyContextFields } from './companyContext';

describe('companyContextFields', () => {
  it('saves the chosen customer segment and country', () => {
    expect(companyContextFields('Mid-market company', 'Saudi Arabia')).toEqual({ customer_segment: 'Mid-market company', country: 'Saudi Arabia' });
  });
  it('saves null when not specified', () => {
    expect(companyContextFields('', '')).toEqual({ customer_segment: null, country: null });
  });
});
