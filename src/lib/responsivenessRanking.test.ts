import { describe, it, expect } from 'vitest';
import { countLevels, formatPoints, rankingEffect, rankingEffectTable, responsivenessShare } from './responsivenessRanking';
import { MATCH_WEIGHT_DEFAULTS, scoreConsultant, extractTicketSignals, type MatchConsultant, type MatchTicket } from '../../supabase/functions/_shared/ticketMatch';

describe('client responsiveness ranking effect', () => {
  it('responsiveness decides about 2.9 of the 100 match points with the default weights (3 of 103)', () => {
    expect(responsivenessShare()).toBe(2.91);
  });

  it('a "New" consultant is neutral: neither raised nor lowered', () => {
    expect(rankingEffect('new').vsNew).toBe(0);
  });

  it('orders the effect Excellent > Good > New > Fair > Needs improvement', () => {
    const v = (l: Parameters<typeof rankingEffect>[0]) => rankingEffect(l).vsNew;
    expect(v('excellent')).toBeGreaterThan(v('good'));
    expect(v('good')).toBeGreaterThan(v('new'));
    expect(v('new')).toBeGreaterThan(v('fair'));
    expect(v('fair')).toBeGreaterThan(v('needs_improvement'));
    expect(v('excellent')).toBe(1.17);
    expect(v('needs_improvement')).toBe(-1.46);
  });

  it('shows no effect when the administrator sets the responsiveness weight to 0', () => {
    const w = { ...MATCH_WEIGHT_DEFAULTS, responsiveness: 0 };
    expect(rankingEffectTable(w).every((r) => r.points === 0 && r.vsNew === 0)).toBe(true);
  });

  it('matches the points the shared matcher actually adds on a fully described ticket', () => {
    const t: MatchTicket = {
      title: 'FI posting error', description: 'GL account posting error in S/4HANA', sap_modules: ['FI'], urgency: 'high', preferred_language: 'en',
      industry: 'Retail', customer_segment: 'enterprise', country: 'Egypt', deployment: 'cloud', work_mode: 'remote', timezone: 'UTC+2', budget_max_rate: 100,
    } as MatchTicket;
    const base = { id: 'c1', skills: [{ module: 'FI', years: 5 }], rating: 4, total_reviews: 3 } as unknown as MatchConsultant;
    const s = extractTicketSignals(t);
    const part = (lvl: 'excellent' | 'new') => scoreConsultant({ ...base, responsiveness_level: lvl }, t, s).breakdown.find((b) => b.key === 'responsiveness');
    const ex = part('excellent');
    expect(ex).toBeDefined();
    expect(ex!.contribution).toBeCloseTo(ex!.weight * 1, 2);
    expect(part('new')!.contribution).toBeCloseTo(ex!.weight * 0.6, 2);
  });

  it('formats points with a sign and counts levels', () => {
    expect(formatPoints(1.17)).toBe('+1.2');
    expect(formatPoints(-1.46)).toBe('\u22121.5');
    expect(formatPoints(0)).toBe('0');
    expect(countLevels(['a', 'b', 'c'], (id) => (id === 'a' ? 'excellent' : 'new'))).toEqual({ excellent: 1, good: 0, fair: 0, needs_improvement: 0, new: 2 });
  });
});
