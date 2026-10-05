export const MATCH_WEIGHTS = {
  skill_match_score: 35,
  experience_score: 25,
  interview_score: 10,
  availability_score: 10,
  reliability_score: 8,
  satisfaction_score: 5,
  language_score: 5,
  trust_score: 2,
} as const;

export function weightedMatch(scores: Record<string, unknown>) {
  const breakdown = Object.entries(MATCH_WEIGHTS).map(([key, weight]) => {
    const value = scores[key];
    const score = typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : 0;
    return { key, weight, score, contribution: Math.round(score * weight) / 100 };
  });
  return { match_score: Math.round(breakdown.reduce((sum, item) => sum + item.contribution, 0)), score_breakdown: breakdown };
}