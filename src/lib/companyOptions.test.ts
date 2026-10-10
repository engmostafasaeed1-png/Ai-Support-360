import { describe, it, expect } from 'vitest';
import { COMPANY_INDUSTRIES, COMPANY_SIZES, withCurrentOption } from './companyOptions';

describe('withCurrentOption', () => {
  it('keeps the list when the value is in it or empty', () => {
    expect(withCurrentOption(COMPANY_SIZES, '51-200')).toBe(COMPANY_SIZES);
    expect(withCurrentOption(COMPANY_SIZES, '')).toBe(COMPANY_SIZES);
    expect(withCurrentOption(COMPANY_INDUSTRIES, null)).toBe(COMPANY_INDUSTRIES);
  });
  it('adds an older value that is not in the list', () => {
    const list = withCurrentOption(COMPANY_INDUSTRIES, 'Oil & Gas');
    expect(list[list.length - 1]).toBe('Oil & Gas');
    expect(list).toHaveLength(COMPANY_INDUSTRIES.length + 1);
  });
});
