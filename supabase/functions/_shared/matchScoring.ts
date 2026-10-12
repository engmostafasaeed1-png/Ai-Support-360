/**
 * Weights of the match score (total 100). context_fit_score is computed by the server from the request context and the consultant profile
 * (see contextFit.ts); when the request states no context it is absent and the other weights are scaled up to 100.
 */
export const MATCH_WEIGHTS = {
  skill_match_score: 30,
  experience_score: 20,
  context_fit_score: 15,
  interview_score: 8,
  availability_score: 8,
  reliability_score: 6,
  satisfaction_score: 4,
  language_score: 5,
  trust_score: 4,
} as const;

export function weightedMatch(scores: Record<string, unknown>) {
  const hasContext = typeof scores.context_fit_score === 'number' && Number.isFinite(scores.context_fit_score);
  const activeTotal = Object.entries(MATCH_WEIGHTS).reduce((sum, [key, weight]) => sum + (key === 'context_fit_score' && !hasContext ? 0 : weight), 0);
  const scale = 100 / activeTotal;
  const breakdown = Object.entries(MATCH_WEIGHTS)
    .filter(([key]) => key !== 'context_fit_score' || hasContext)
    .map(([key, baseWeight]) => {
      const weight = Math.round(baseWeight * scale * 100) / 100;
      const value = scores[key];
      const score = typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : 0;
      return { key, weight, score, contribution: Math.round(score * weight) / 100 };
    });
  return { match_score: Math.round(breakdown.reduce((sum, item) => sum + item.contribution, 0)), score_breakdown: breakdown };
}

