/**
 * Client responsiveness dashboard: how a consultant's public responsiveness level moves their match score.
 * Uses the same weights and level fits as the shared matcher (ticketMatch.scoreConsultant), on a fully described
 * ticket where every criterion is scored, so the numbers shown to clients equal what the matcher adds.
 */
import { MATCH_WEIGHT_DEFAULTS, type MatchWeights } from '../../supabase/functions/_shared/ticketMatch';
import { LEVEL_FIT, LEVEL_ORDER, type RespLevel } from '../../supabase/functions/_shared/responsiveness';

export interface RankingEffect {
  /** Share (%) of the 100-point match score that responsiveness can decide. */
  sharePct: number;
  /** Points this level adds to the match score. */
  points: number;
  /** Points compared with a consultant who is still "New" (neutral). Positive = ranked higher. */
  vsNew: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function responsivenessShare(weights: MatchWeights = MATCH_WEIGHT_DEFAULTS): number {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return total > 0 ? round2((weights.responsiveness * 100) / total) : 0;
}

export function rankingEffect(level: RespLevel, weights: MatchWeights = MATCH_WEIGHT_DEFAULTS): RankingEffect {
  const share = responsivenessShare(weights);
  return {
    sharePct: share,
    points: round2(share * LEVEL_FIT[level]),
    vsNew: round2(share * (LEVEL_FIT[level] - LEVEL_FIT.new)),
  };
}

/** Every level with its effect, best first ("New" last). */
export function rankingEffectTable(weights: MatchWeights = MATCH_WEIGHT_DEFAULTS): Array<{ level: RespLevel } & RankingEffect> {
  return LEVEL_ORDER.map((level) => ({ level, ...rankingEffect(level, weights) }));
}

/** "+1.2", "−1.5" or "0" (one decimal, real minus sign). */
export function formatPoints(n: number): string {
  const v = Math.round(n * 10) / 10;
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(1)}`;
}

export interface LevelCounts { excellent: number; good: number; fair: number; needs_improvement: number; new: number }

export function countLevels(ids: string[], levelOf: (id: string) => RespLevel): LevelCounts {
  const out: LevelCounts = { excellent: 0, good: 0, fair: 0, needs_improvement: 0, new: 0 };
  for (const id of ids) out[levelOf(id)] += 1;
  return out;
}
