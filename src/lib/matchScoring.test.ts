import { describe, expect, it } from 'vitest';
import { MATCH_WEIGHTS, weightedMatch } from '../../supabase/functions/_shared/matchScoring';

describe('weighted consultant matching', () => {
  it('weights sum to 100 and expertise dominates', () => {
    expect(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(MATCH_WEIGHTS.skill_match_score + MATCH_WEIGHTS.experience_score + MATCH_WEIGHTS.context_fit_score).toBe(65);
  });
  it('recalculates totals instead of trusting AI totals (no request context: the other weights are scaled to 100)', () => {
    // skill 30 + experience 20 of 85 -> scaled: 80 x 35.29% + 60 x 23.53% = 28.24 + 14.12 = 42.35
    expect(weightedMatch({ match_score: 100, skill_match_score: 80, experience_score: 60 }).match_score).toBe(42);
  });
  it('bounds invalid and missing scores', () => {
    const result = weightedMatch({ skill_match_score: 200, experience_score: -10, interview_score: NaN, availability_score: '100' });
    // only skill counts: 100 x 30/85
    expect(result.match_score).toBe(35);
    expect(result.score_breakdown.every((x) => x.score >= 0 && x.score <= 100)).toBe(true);
  });
  it('returns an auditable breakdown that always adds up to 100 at the top', () => {
    const withContext = weightedMatch(Object.fromEntries(Object.keys(MATCH_WEIGHTS).map((key) => [key, 100])));
    expect(withContext.match_score).toBe(100);
    expect(withContext.score_breakdown).toHaveLength(9);
    const without = weightedMatch(Object.fromEntries(Object.keys(MATCH_WEIGHTS).filter((k) => k !== 'context_fit_score').map((key) => [key, 100])));
    expect(without.match_score).toBe(100);
    expect(without.score_breakdown).toHaveLength(8);
    expect(without.score_breakdown.some((x) => x.key === 'context_fit_score')).toBe(false);
    expect(Math.round(without.score_breakdown.reduce((sum, x) => sum + x.contribution, 0))).toBe(100);
  });
  it('lets the request context lift a consultant who knows the industry, segment and country', () => {
    const base = { skill_match_score: 70, experience_score: 70, interview_score: 70, availability_score: 70, reliability_score: 70, satisfaction_score: 70, language_score: 70, trust_score: 70 };
    const fit = weightedMatch({ ...base, context_fit_score: 100 }).match_score;
    const noFit = weightedMatch({ ...base, context_fit_score: 0 }).match_score;
    const unknown = weightedMatch(base).match_score;
    expect(fit).toBeGreaterThan(unknown);
    expect(noFit).toBeLessThan(unknown);
    expect(fit - noFit).toBe(15);
  });
});

