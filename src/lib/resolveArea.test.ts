import { describe, it, expect } from 'vitest';
import { resolveArea, ALL_SAP_AREAS } from './sapAreas';

describe('resolveArea', () => {
  it('finds an area by its name in any case', () => {
    expect(resolveArea('sap fi/co')).toBe('SAP FI/CO');
    expect(resolveArea('SuccessFactors Learning')).toBe('SuccessFactors Learning');
  });
  it('understands the short names', () => {
    expect(resolveArea('MM')).toBe('SAP MM');
    expect(resolveArea('FICO')).toBe('SAP FI/CO');
    expect(resolveArea('SAP S4HANA')).toBe('SAP S/4HANA');
  });
  it('returns null for an unknown text', () => {
    expect(resolveArea('my own thing')).toBeNull();
    expect(resolveArea('')).toBeNull();
  });
  it('only returns names of the master list', () => {
    for (const key of ['mm', 'sd', 'fi', 'basis', 'abap', 'btp', 'hcm', 'grc', 'bw']) {
      const name = resolveArea(key);
      expect(ALL_SAP_AREAS.some(a => a.name === name)).toBe(true);
    }
  });
});
