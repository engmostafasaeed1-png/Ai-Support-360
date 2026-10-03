import { describe, it, expect } from 'vitest';
import {
  SAP_AREA_GROUPS,
  ALL_SAP_AREAS,
  OTHER_AREA,
  MAX_SAP_AREAS,
  MAX_AREA_NAME_LENGTH,
  areasSummary,
  areasOf,
  areaLabel,
  cleanAreaList,
  toggleArea,
  makeMainArea,
  filterAreaGroups,
  isOtherArea,
  hasArea,
} from './sapAreas';

// The 22 module names the New Request screen offered before the master list. Tickets already use them.
const LEGACY_MODULES = [
  'SAP S/4HANA', 'SAP FI/CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP QM', 'SAP PM/EAM', 'SAP PS', 'SAP EWM', 'SAP TM',
  'SAP Ariba', 'SuccessFactors', 'SAP BTP/CPI', 'SAP Fiori/UX', 'SAP Analytics Cloud', 'SAP Basis', 'SAP Security/GRC',
  'ABAP Development', 'Integrations/APIs', 'Data Migration', 'AMS Support', 'Health Check/Advisory',
];

describe('master list of SAP areas', () => {
  it('still offers every module name the app offered before', () => {
    const names = ALL_SAP_AREAS.map(x => x.name);
    for (const legacy of LEGACY_MODULES) expect(names).toContain(legacy);
  });

  it('has no duplicate and no blank name (any capitals)', () => {
    const seen = new Set<string>();
    for (const area of ALL_SAP_AREAS) {
      expect(area.name.trim()).not.toBe('');
      const key = area.name.toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('keeps every name and hint within what the database and the screen can take', () => {
    for (const area of ALL_SAP_AREAS) {
      expect(area.name.length).toBeLessThanOrEqual(MAX_AREA_NAME_LENGTH);
      expect(area.name).toBe(area.name.trim());
      expect(area.hint.trim().length).toBeGreaterThan(0);
    }
  });

  it('has groups with unique ids and at least 150 areas in total', () => {
    const ids = SAP_AREA_GROUPS.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of SAP_AREA_GROUPS) expect(g.areas.length).toBeGreaterThan(0);
    expect(ALL_SAP_AREAS.length).toBeGreaterThanOrEqual(150);
  });

  it('does not contain "Other" (the picker adds it)', () => {
    expect(ALL_SAP_AREAS.some(x => isOtherArea(x.name))).toBe(false);
  });
});

describe('areasSummary', () => {
  it('joins the names', () => {
    expect(areasSummary(['SAP FI/CO', 'SAP MM'])).toBe('SAP FI/CO, SAP MM');
  });

  it('is empty for no area', () => {
    expect(areasSummary([])).toBe('');
  });

  it('never exceeds 100 characters and says how many are left out', () => {
    const twelve = LEGACY_MODULES.slice(0, MAX_SAP_AREAS);
    const s = areasSummary(twelve);
    expect(s.length).toBeLessThanOrEqual(100);
    expect(s.startsWith('SAP S/4HANA')).toBe(true);
    expect(s).toMatch(/ \+\d+ more$/);
  });

  it('shows the name typed for "Other"', () => {
    expect(areasSummary(['SAP MM', 'Other'], 'Cash application')).toBe('SAP MM, Other: Cash application');
  });

  it('cuts a single very long name', () => {
    expect(areasSummary(['x'.repeat(150)]).length).toBe(100);
  });
});

describe('areasOf', () => {
  it('uses the list of a new ticket', () => {
    expect(areasOf({ sap_module: 'SAP MM', sap_modules: ['SAP MM', 'SAP SD'] })).toEqual(['SAP MM', 'SAP SD']);
  });

  it('falls back to the single module of an older ticket', () => {
    expect(areasOf({ sap_module: 'SAP PS', sap_modules: [] })).toEqual(['SAP PS']);
    expect(areasOf({ sap_module: 'SAP PS' })).toEqual(['SAP PS']);
    expect(areasOf({ sap_module: 'SAP PS', sap_modules: null })).toEqual(['SAP PS']);
  });

  it('is empty when there is nothing', () => {
    expect(areasOf({ sap_module: '' })).toEqual([]);
    expect(areasOf({})).toEqual([]);
  });
});

describe('choosing areas', () => {
  it('adds an area at the end and removes it on the second click', () => {
    const one = toggleArea([], 'SAP MM');
    const two = toggleArea(one, 'SAP SD');
    expect(two).toEqual(['SAP MM', 'SAP SD']);
    expect(toggleArea(two, 'sap mm')).toEqual(['SAP SD']);
  });

  it('refuses a 13th area', () => {
    const twelve = Array.from({ length: MAX_SAP_AREAS }, (_, i) => `Area ${i + 1}`);
    expect(toggleArea(twelve, 'One more')).toEqual(twelve);
    expect(toggleArea(twelve, 'Area 3')).toHaveLength(MAX_SAP_AREAS - 1);
  });

  it('makes another area the main (first) one', () => {
    expect(makeMainArea(['A', 'B', 'C'], 'C')).toEqual(['C', 'A', 'B']);
    expect(makeMainArea(['A', 'B', 'C'], 'A')).toEqual(['A', 'B', 'C']);
    expect(makeMainArea(['A', 'B'], 'missing')).toEqual(['A', 'B']);
  });

  it('cleans a list the way the database does', () => {
    expect(cleanAreaList(['  SAP   FI ', 'sap fi', '', 'SAP CO', 'SAP CO '])).toEqual(['SAP FI', 'SAP CO']);
  });

  it('finds an area whatever the capitals', () => {
    expect(hasArea(['SAP MM'], 'sap mm')).toBe(true);
    expect(hasArea(['SAP MM'], 'SAP SD')).toBe(false);
  });

  it('labels "Other" with the typed name only', () => {
    expect(areaLabel('Other', ' MES integration ')).toBe('Other: MES integration');
    expect(areaLabel('Other', '')).toBe(OTHER_AREA);
    expect(areaLabel('SAP MM', 'ignored')).toBe('SAP MM');
  });
});

describe('searching the list', () => {
  it('returns everything for an empty search', () => {
    expect(filterAreaGroups(SAP_AREA_GROUPS, '   ')).toHaveLength(SAP_AREA_GROUPS.length);
  });

  it('finds areas by what they cover, in any capitals', () => {
    const found = filterAreaGroups(SAP_AREA_GROUPS, 'PAYROLL').flatMap(g => g.areas.map(x => x.name));
    expect(found).toContain('SuccessFactors Employee Central Payroll');
    expect(found).toContain('SAP HCM Payroll');
  });

  it('needs every word of the search', () => {
    const found = filterAreaGroups(SAP_AREA_GROUPS, 'payroll cloud').flatMap(g => g.areas.map(x => x.name));
    expect(found).toContain('SuccessFactors Employee Central Payroll');
    expect(found).not.toContain('SAP HCM Payroll');
  });

  it('returns nothing when nothing matches', () => {
    expect(filterAreaGroups(SAP_AREA_GROUPS, 'zzzzqqqq')).toEqual([]);
  });
});
