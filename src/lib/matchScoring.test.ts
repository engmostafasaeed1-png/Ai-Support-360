import { describe, expect, it } from 'vitest';
import { MATCH_WEIGHTS, weightedMatch } from '../../supabase/functions/_shared/matchScoring';

describe('weighted consultant matching', () => {
  it('weights sum to 100 and expertise dominates', () => {
    expect(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(MATCH_WEIGHTS.skill_match_score + MATCH_WEIGHTS.experience_score).toBe(60);
  });
  it('recalculates totals instead of trusting AI totals', () => {
    expect(weightedMatch({ match_score: 100, skill_match_score: 80, experience_score: 60 }).match_score).toBe(43);
  });
  it('bounds invalid and missing scores', () => {
    const result = weightedMatch({ skill_match_score: 200, experience_score: -10, interview_score: NaN, availability_score: '100' });
    expect(result.match_score).toBe(35);
    expect(result.score_breakdown.every(x => x.score >= 0 && x.score <= 100)).toBe(true);
  });
  it('returns an auditable breakdown', () => {
    const result = weightedMatch(Object.fromEntries(Object.keys(MATCH_WEIGHTS).map(key => [key, 100])));
    expect(result.match_score).toBe(100);
    expect(result.score_breakdown.reduce((sum, x) => sum + x.contribution, 0)).toBe(100);
  });
});