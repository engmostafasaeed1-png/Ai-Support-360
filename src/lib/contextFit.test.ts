import { describe, expect, it } from 'vitest';
import { contextFit, readRequestContext } from '../../supabase/functions/_shared/contextFit';
import {
  ALL_COUNTRIES, ALL_INDUSTRIES, ALL_LOCALIZATION_SOLUTIONS, ALL_SEGMENTS, ALL_VERTICALS, CUSTOMER_SEGMENTS, INDUSTRY_EXPERIENCE,
  LOCALIZATION_COUNTRIES, LOCALIZATION_SOLUTIONS, VERTICAL_SOLUTIONS, familyOf, regionOfCountry, segmentFamily,
} from '../../supabase/functions/_shared/profileTaxonomy';

const gulf = {
  industries: ['Oil & gas - downstream / refining', 'Utilities - electricity'],
  customer_segments: ['Sovereign-wealth-fund-owned companies (PIF, Mubadala, ADQ, QIA, KIA and similar)', 'Large listed enterprise'],
  vertical_solutions: ['SAP IS-Utilities (IS-U, billing and customer service)'],
  localization_countries: ['Saudi Arabia', 'United Arab Emirates'],
  onsite_countries: ['Qatar'],
  localization_solutions: ['Saudi Arabia ZATCA e-invoicing (FATOORA, phase 1 and 2)', 'Saudi payroll (GOSI, Mudad, WPS, Nitaqat/Saudization)'],
  project_types: ['Implementation (greenfield)', 'Application management (L2/L3 support)'],
};

describe('context fit between a request and a consultant', () => {
  it('is null when the request states nothing, so the matching ignores it', () => {
    expect(contextFit({}, gulf)).toEqual({ score: null, matches: [], gaps: [] });
    expect(contextFit({ industry: '  ', vertical_solutions: [], localization_solutions: ['Other'] }, gulf).score).toBeNull();
  });

  it('is 100 when every stated criterion matches exactly', () => {
    const r = contextFit({
      industry: 'Oil & gas - downstream / refining',
      customer_segment: 'Large listed enterprise',
      country: 'Saudi Arabia',
      project_type: 'Implementation (greenfield)',
      vertical_solutions: ['SAP IS-Utilities (IS-U, billing and customer service)'],
      localization_solutions: ['Saudi Arabia ZATCA e-invoicing (FATOORA, phase 1 and 2)'],
    }, gulf);
    expect(r.score).toBe(100);
    expect(r.gaps).toEqual([]);
    expect(r.matches).toHaveLength(6);
  });

  it('counts only the stated criteria and explains the gaps', () => {
    const r = contextFit({ industry: 'Banking - retail', country: 'Saudi Arabia' }, gulf);
    // industry 25 x 0 + country 20 x 1 over 45
    expect(r.score).toBe(44);
    expect(r.matches).toEqual(['Country: Saudi Arabia']);
    expect(r.gaps).toEqual(['Industry: Banking - retail']);
  });

  it('gives partial credit for the same industry family and for the same segment family', () => {
    expect(contextFit({ industry: 'Oil & gas - upstream' }, gulf).score).toBe(60);
    expect(contextFit({ customer_segment: 'Government ministries & authorities' }, gulf).score).toBe(50);
    expect(contextFit({ customer_segment: 'Small business (SME)' }, gulf).score).toBe(50);
    expect(contextFit({ customer_segment: 'Non-profit / NGO' }, gulf).score).toBe(0);
  });

  it('understands the industry of a client company profile (oil_gas, utilities...)', () => {
    expect(contextFit({ industry: 'oil_gas' }, gulf).score).toBe(90);
    expect(contextFit({ industry: 'utilities' }, gulf).score).toBe(90);
    expect(contextFit({ industry: 'banking' }, gulf).score).toBe(0);
    expect(contextFit({ industry: 'Oil & Gas' }, gulf).score).toBe(90);
  });

  it('prefers a localized country, then on-site ability, then the same region', () => {
    expect(contextFit({ country: 'United Arab Emirates' }, gulf).score).toBe(100);
    expect(contextFit({ country: 'Qatar' }, gulf).score).toBe(40);
    expect(contextFit({ country: 'Kuwait' }, gulf).score).toBe(25);
    expect(contextFit({ country: 'Germany' }, gulf).score).toBe(0);
  });

  it('scores the share of the requested solutions the consultant has', () => {
    const r = contextFit({ localization_solutions: ['Saudi Arabia ZATCA e-invoicing (FATOORA, phase 1 and 2)', 'India GST e-invoicing & e-way bill'] }, gulf);
    expect(r.score).toBe(50);
  });

  it('is case and space insensitive and ignores "Other"', () => {
    expect(contextFit({ country: '  saudi   arabia ' }, gulf).score).toBe(100);
    expect(contextFit({ vertical_solutions: ['Other', 'sap is-utilities (is-u, billing and customer service)'] }, gulf).score).toBe(100);
  });

  it('copes with a consultant without data', () => {
    expect(contextFit({ industry: 'Mining', country: 'Egypt' }, {}).score).toBe(0);
    expect(contextFit({ industry: 'Mining' }, { industries: null }).score).toBe(0);
  });

  it('reads a stored ticket_context safely', () => {
    expect(readRequestContext(null)).toEqual({ industry: null, customer_segment: null, country: null, project_type: null, vertical_solutions: [], localization_solutions: [] });
    const r = readRequestContext({ industry: ' Mining ', country: 7, vertical_solutions: ['a', 3, ' b '], extra: 'x', localization_solutions: 'oops' });
    expect(r.industry).toBe('Mining');
    expect(r.country).toBeNull();
    expect(r.vertical_solutions).toEqual(['a', 'b']);
    expect(r.localization_solutions).toEqual([]);
  });
});

describe('ready lists', () => {
  const all = [ALL_INDUSTRIES, ALL_SEGMENTS, ALL_VERTICALS, ALL_COUNTRIES, ALL_LOCALIZATION_SOLUTIONS];

  it('are long enough and have no duplicates inside a list', () => {
    expect(ALL_INDUSTRIES.length).toBeGreaterThanOrEqual(60);
    expect(ALL_SEGMENTS.length).toBeGreaterThanOrEqual(15);
    expect(ALL_VERTICALS.length).toBeGreaterThanOrEqual(50);
    expect(ALL_COUNTRIES.length).toBeGreaterThanOrEqual(100);
    expect(ALL_LOCALIZATION_SOLUTIONS.length).toBeGreaterThanOrEqual(50);
    for (const l of all) expect(new Set(l.map((x) => x.toLowerCase())).size).toBe(l.length);
  });

  it('every list ends with an "Other" entry and every label fits the database limit of 120 characters', () => {
    for (const groups of [INDUSTRY_EXPERIENCE, CUSTOMER_SEGMENTS, VERTICAL_SOLUTIONS, LOCALIZATION_COUNTRIES, LOCALIZATION_SOLUTIONS]) {
      expect(groups[groups.length - 1].items).toEqual(['Other']);
      for (const g of groups) for (const item of g.items) expect(item.length).toBeLessThanOrEqual(120);
    }
  });

  it('knows regions, segment families and industry families', () => {
    expect(regionOfCountry('Saudi Arabia')).toBe('GCC');
    expect(regionOfCountry('Germany')).toBe('Europe');
    expect(regionOfCountry('Atlantis')).toBeNull();
    expect(regionOfCountry('Other')).toBeNull();
    expect(segmentFamily('Small business (SME)')).toBe('Private sector');
    expect(segmentFamily('Government ministries & authorities')).toBe('Public sector');
    expect(familyOf('Oil & gas - upstream')).toBe('Oil & gas');
    expect(familyOf('Mining')).toBe('Mining');
  });
});

