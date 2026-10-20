import { describe, expect, it } from 'vitest';
import {
  clarifyingQuestions, errorCodesIn, extractTicketSignals, hardFilter, matchInputsHash, modulesIn, rankConsultants, readMatchWeights,
  MATCH_WEIGHT_DEFAULTS, subModulesIn, tcodesIn, weightsVersion,
} from '../../supabase/functions/_shared/ticketMatch';
import { FIXTURE_CONSULTANTS, FIXTURE_TICKETS } from '@/test/fixtures/matchFixtures';

describe('golden cases: the right consultant ranks first', () => {
  for (const t of FIXTURE_TICKETS.filter(x => x.expectTop !== '*')) {
    it(t.name, () => {
      const out = rankConsultants(t, FIXTURE_CONSULTANTS);
      expect(out.ranked[0]?.consultant_id).toBe(t.expectTop);
      const ids = out.ranked.map(r => r.consultant_id);
      for (const id of t.mustExclude ?? []) expect(ids).not.toContain(id);
      // never: unverified or disabled accounts
      expect(ids).not.toContain('c12');
      expect(ids).not.toContain('c14');
    });
  }
});

describe('hard filters', () => {
  const fi = FIXTURE_TICKETS[0];
  const s = extractTicketSignals(fi);
  const byId = (id: string) => FIXTURE_CONSULTANTS.find(c => c.id === id)!;
  it('excludes unverified, disabled, wrong area, wrong language', () => {
    expect(hardFilter(byId('c12'), fi, s)).toBe('not_verified');
    expect(hardFilter(byId('c14'), fi, s)).toBe('inactive');
    expect(hardFilter(byId('c05'), fi, s)).toBe('no_area_overlap');
    expect(hardFilter(byId('c15'), fi, s)).toBe('language');
    expect(hardFilter(byId('c01'), fi, s, new Set(['c01']))).toBe('excluded');
  });
  it('critical tickets keep only consultants who are online', () => {
    const critical = FIXTURE_TICKETS.find(t => t.urgency === 'critical')!;
    expect(hardFilter(byId('c07'), critical, extractTicketSignals(critical))).toBe('cannot_respond');
  });
});

describe('field changes move the ranking', () => {
  it('changing the country from Saudi Arabia to Egypt raises the Egypt FI consultant', () => {
    const t = { ...FIXTURE_TICKETS[0], industry: null, description: 'Month-end close fails with error F5 702 in FB50.' };
    const score = (country: string) => rankConsultants({ ...t, country }, FIXTURE_CONSULTANTS).ranked.find(r => r.consultant_id === 'c02')!.score;
    expect(score('Egypt')).toBeGreaterThan(score('Saudi Arabia'));
  });
  it('a budget lifts the consultant within budget closer to the top', () => {
    const t = FIXTURE_TICKETS.find(x => x.budget_max_rate)!;
    const gap = (budget: number | null) => { const r = rankConsultants({ ...t, budget_max_rate: budget }, FIXTURE_CONSULTANTS).ranked; const s = (id: string) => r.find(x => x.consultant_id === id)!.score; return s('c01') - s('c02'); };
    expect(gap(60)).toBeLessThan(gap(null));
  });
  it('a budget below the rate lowers the expensive consultant', () => {
    const t = FIXTURE_TICKETS[0];
    const score = (budget: number | null) => rankConsultants({ ...t, budget_max_rate: budget }, FIXTURE_CONSULTANTS).ranked.find(r => r.consultant_id === 'c01')!.score;
    expect(score(50)).toBeLessThan(score(200));
  });
  it('the description text changes the modules (no areas chosen)', () => {
    expect(extractTicketSignals({ description: 'ME21N purchase order' }).modules).toContain('MM');
    expect(extractTicketSignals({ description: 'VA01 sales order pricing' }).modules).toContain('SD');
  });
});

describe('language codes', () => {
  it('treats language names and codes the same', async () => {
    const { langCode } = await import('../../supabase/functions/_shared/ticketMatch');
    expect(langCode('English')).toBe('en');
    expect(langCode('ar')).toBe('ar');
    expect(langCode(' Arabic ')).toBe('ar');
  });
});

describe('extraction', () => {
  it('maps the three module vocabularies to the same code', () => {
    expect(modulesIn('SAP FI')).toContain('FI');
    expect(modulesIn('FI - Accounts Payable (FI-AP)')).toContain('FI');
    expect(modulesIn('SAP FI/CO')).toEqual(expect.arrayContaining(['FI', 'CO']));
    expect(modulesIn('SAP FICO')).toContain('FI');
    expect(subModulesIn('FI - Accounts Payable (FI-AP)')).toContain('FI-AP');
  });
  it('finds T-codes, error messages and Arabic terms', () => {
    expect(tcodesIn('Run F110 and ME21N, then MIGO')).toEqual([{ code: 'F110', module: 'FI' }, { code: 'ME21N', module: 'MM' }, { code: 'MIGO', module: 'MM' }]);
    expect(tcodesIn('We use S4 and WIN10')).toEqual([]);
    expect(errorCodesIn('error F5 702 and message M7021')).toEqual([{ code: 'F5 702', module: 'FI' }, { code: 'M7 021', module: 'MM' }]);
    expect(modulesIn('مشكلة في المشتريات')).toContain('MM');
    expect(modulesIn('الرواتب')).toContain('HCM');
  });
  it('asks clarifying questions only for vague tickets', () => {
    expect(clarifyingQuestions({ description: 'System not working' })).toEqual(['module', 'error', 'country']);
    expect(clarifyingQuestions(FIXTURE_TICKETS[0])).toEqual([]);
  });
});

describe('weights and hashes', () => {
  it('reads tunable weights with bounds and defaults', () => {
    expect(readMatchWeights(null)).toEqual(MATCH_WEIGHT_DEFAULTS);
    expect(readMatchWeights('{"module": 80, "founding": -3, "bogus": 5}')).toMatchObject({ module: 50, founding: 0 });
    expect(readMatchWeights('not json')).toEqual(MATCH_WEIGHT_DEFAULTS);
    expect(Object.values(MATCH_WEIGHT_DEFAULTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('weights version and input hash are stable and change with inputs', () => {
    expect(weightsVersion(readMatchWeights(null))).toBe(weightsVersion({ ...MATCH_WEIGHT_DEFAULTS }));
    expect(weightsVersion({ ...MATCH_WEIGHT_DEFAULTS, module: 30 })).not.toBe(weightsVersion({ ...MATCH_WEIGHT_DEFAULTS }));
    const t = FIXTURE_TICKETS[0];
    expect(matchInputsHash(t)).toBe(matchInputsHash({ ...t }));
    expect(matchInputsHash({ ...t, country: 'Egypt' })).not.toBe(matchInputsHash(t));
  });
  it('setting a weight to 0 removes that criterion', () => {
    const r = rankConsultants(FIXTURE_TICKETS[0], FIXTURE_CONSULTANTS, { weights: { ...MATCH_WEIGHT_DEFAULTS, founding: 0 } });
    expect(r.ranked[0].breakdown.some(b => b.key === 'founding')).toBe(false);
  });
  it('gives at most 4 why-chips and a 0..100 score', () => {
    for (const r of rankConsultants(FIXTURE_TICKETS[0], FIXTURE_CONSULTANTS).ranked) {
      expect(r.chips.length).toBeLessThanOrEqual(4);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});
