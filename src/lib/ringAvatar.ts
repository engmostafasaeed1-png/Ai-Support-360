/**
 * Feature W: the performance ring around a consultant's photo.
 * Outer arc = pure client rating (0-5 → 0-100 %), inner arc = responsiveness score (0-100 %).
 * Honest by construction: no reviews → no rating arc, below the minimum sample or with responsiveness private → no number.
 * Pure and shared by the React ring, the map popup and the tests.
 */
import type { RespLevel } from '../../supabase/functions/_shared/responsiveness';
import { formatMinutes, LEVEL_LABEL } from '@/lib/responsivenessFormat';

export type RingTone = 'red' | 'amber' | 'green' | 'gold' | 'none';
export type RingTier = 'gold' | 'silver' | 'bronze' | 'verified';
export type RingLang = 'en' | 'ar';

/** Default of the platform setting `rating_min_reviews`. */
export const RATING_MIN_REVIEWS_DEFAULT = 3;

/** Rating scale (1 decimal): red < 3.0, amber 3.0-3.9, green 4.0-4.5, gold ≥ 4.6. */
export function ratingTone(rating: number): RingTone {
  const r = Math.round(rating * 10) / 10;
  if (r >= 4.6) return 'gold';
  if (r >= 4.0) return 'green';
  if (r >= 3.0) return 'amber';
  return 'red';
}

/** The same scale for a percentage (3.0/5 = 60 %, 4.0/5 = 80 %, 4.6/5 = 92 %). */
export function pctTone(pct: number): RingTone {
  if (pct >= 92) return 'gold';
  if (pct >= 80) return 'green';
  if (pct >= 60) return 'amber';
  return 'red';
}

export interface RatingArc {
  /** none = no reviews (grey track, "New"); low = fewer than the minimum (dashed, lighter); ok = full arc. */
  state: 'none' | 'low' | 'ok';
  rating: number | null;
  reviews: number;
  pct: number;
  tone: RingTone;
}

export function ratingArc(rating: number | null | undefined, reviews: number | null | undefined, minReviews = RATING_MIN_REVIEWS_DEFAULT): RatingArc {
  const n = Math.max(0, Math.floor(Number(reviews) || 0));
  const r = Number(rating);
  if (n < 1 || !Number.isFinite(r) || r <= 0) return { state: 'none', rating: null, reviews: n, pct: 0, tone: 'none' };
  const value = Math.round(Math.min(5, r) * 10) / 10;
  return { state: n < Math.max(1, minReviews) ? 'low' : 'ok', rating: value, reviews: n, pct: Math.round((value / 5) * 1000) / 10, tone: ratingTone(value) };
}

export interface RespInput { level: RespLevel; median_minutes: number | null; response_rate: number | null }

export interface RespArc {
  /** hidden = owner keeps responsiveness private (no arc, nothing said); new = under the minimum sample; ok = scored. */
  state: 'hidden' | 'new' | 'ok';
  level: RespLevel | null;
  pct: number;
  tone: RingTone;
  median: number | null;
  rate: number | null;
}

/** Score band per public level, so the colour always agrees with the level clients read. */
const BANDS: Record<Exclude<RespLevel, 'new'>, [number, number]> = {
  excellent: [92, 100], good: [80, 91], fair: [60, 79], needs_improvement: [20, 59],
};

/** Speed 0-1 from the median reply (minutes): ≤ 15 → 1, 1 h → 0.9, 4 h → 0.75, 1 day → 0.5, 3 days or more → 0. */
export function speedFactor(median: number | null | undefined): number {
  if (median == null || !Number.isFinite(median)) return 0;
  const pts: Array<[number, number]> = [[15, 1], [60, 0.9], [240, 0.75], [1440, 0.5], [4320, 0]];
  if (median <= pts[0][0]) return 1;
  for (let i = 1; i < pts.length; i++) {
    const [m1, v1] = pts[i - 1];
    const [m2, v2] = pts[i];
    if (median <= m2) return v1 + ((median - m1) / (m2 - m1)) * (v2 - v1);
  }
  return 0;
}

/** Responsiveness score 0-100: 70 % answered share + 30 % speed, placed inside the band of the public level. */
export function responsivenessScore(r: RespInput): number | null {
  if (r.level === 'new') return null;
  const [lo, hi] = BANDS[r.level];
  const rate = Math.max(0, Math.min(100, r.response_rate ?? 0)) / 100;
  const raw = Math.max(0, Math.min(1, 0.7 * rate + 0.3 * speedFactor(r.median_minutes)));
  return Math.round(lo + (hi - lo) * raw);
}

export function respArc(publicOn: boolean, r: RespInput | null | undefined): RespArc {
  if (!publicOn) return { state: 'hidden', level: null, pct: 0, tone: 'none', median: null, rate: null };
  const score = r ? responsivenessScore(r) : null;
  if (!r || score == null) return { state: 'new', level: 'new', pct: 0, tone: 'none', median: null, rate: null };
  return { state: 'ok', level: r.level, pct: score, tone: pctTone(score), median: r.median_minutes, rate: r.response_rate };
}

export function ringTier(badge: string | null | undefined, verified?: boolean): RingTier | null {
  const b = (badge ?? '').toLowerCase();
  if (b === 'gold' || b === 'silver' || b === 'bronze') return b;
  if (b === 'verified' || verified) return 'verified';
  return null;
}

// ---------------------------------------------------------------------------------------------------- texts (EN / AR)

/** Every visible string of the ring, English and Arabic. */
export const RING_STRINGS = {
  ratingOk: ['Client rating {r} of 5 from {n} reviews', 'تقييم العملاء {r} من 5 من {n} تقييمات'],
  ratingOne: ['Client rating {r} of 5 from 1 review', 'تقييم العملاء {r} من 5 من تقييم واحد'],
  ratingLow: ['Client rating {r} of 5, based on {n} reviews', 'تقييم العملاء {r} من 5، بناءً على {n} تقييمات'],
  ratingLowOne: ['Client rating {r} of 5, based on 1 review', 'تقييم العملاء {r} من 5، بناءً على تقييم واحد'],
  ratingNone: ['Client rating: New, no reviews yet', 'تقييم العملاء: جديد، لا توجد تقييمات بعد'],
  respOk: ['Responsiveness: {level} - median reply {median}, {rate} % answered', 'سرعة الاستجابة: {level} - متوسط الرد {median}، تمت الإجابة على {rate} ٪'],
  respNew: ['Responsiveness: New, not enough requests yet', 'سرعة الاستجابة: جديد، لا توجد طلبات كافية بعد'],
  tier: ['Badge: {tier}', 'الشارة: {tier}'],
  new: ['New', 'جديد'],
  open: ['{name}: performance details', '{name}: تفاصيل الأداء'],
} as const;

export const TIER_LABEL: Record<RingTier, [string, string]> = {
  gold: ['Gold', 'ذهبية'], silver: ['Silver', 'فضية'], bronze: ['Bronze', 'برونزية'], verified: ['Verified', 'موثّق'],
};

/** Short reply word for the centre label. */
export const REPLY_LABEL: Record<Exclude<RespLevel, 'new'>, [string, string]> = {
  excellent: ['Fast reply', 'رد سريع'],
  good: ['Good reply', 'رد جيد'],
  fair: ['Steady reply', 'رد منتظم'],
  needs_improvement: ['Slower reply', 'رد أبطأ'],
};

const pick = (pair: readonly [string, string], lang: RingLang) => (lang === 'ar' ? pair[1] : pair[0]);
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const fmtRating = (r: number) => r.toFixed(1);

export interface RingSummary {
  rating: RatingArc;
  resp: RespArc;
  tier: RingTier | null;
  /** Full text for aria-label and the popover. */
  text: string;
  /** Lines of the popover. */
  lines: string[];
  /** Compact centre-bottom label for large sizes, e.g. "4.8 ★ | Fast reply". */
  label: string;
}

export interface RingInput {
  rating: number | null | undefined;
  reviews: number | null | undefined;
  minReviews?: number;
  publicOn: boolean;
  resp?: RespInput | null;
  badge?: string | null;
  verified?: boolean;
  lang?: RingLang;
}

export function ringSummary(i: RingInput): RingSummary {
  const lang = i.lang ?? 'en';
  const rating = ratingArc(i.rating, i.reviews, i.minReviews ?? RATING_MIN_REVIEWS_DEFAULT);
  const resp = respArc(i.publicOn, i.resp);
  const tier = ringTier(i.badge, i.verified);
  const lines: string[] = [];
  if (rating.state === 'none') lines.push(pick(RING_STRINGS.ratingNone, lang));
  else {
    const key = rating.state === 'ok' ? (rating.reviews === 1 ? 'ratingOne' : 'ratingOk') : (rating.reviews === 1 ? 'ratingLowOne' : 'ratingLow');
    lines.push(fill(pick(RING_STRINGS[key], lang), { r: fmtRating(rating.rating as number), n: rating.reviews }));
  }
  if (resp.state === 'new') lines.push(pick(RING_STRINGS.respNew, lang));
  if (resp.state === 'ok' && resp.level && resp.level !== 'new') {
    lines.push(fill(pick(RING_STRINGS.respOk, lang), {
      level: pick(LEVEL_LABEL[resp.level], lang), median: formatMinutes(resp.median, lang === 'ar'), rate: resp.rate ?? 0,
    }));
  }
  if (tier) lines.push(fill(pick(RING_STRINGS.tier, lang), { tier: pick(TIER_LABEL[tier], lang) }));

  const newWord = pick(RING_STRINGS.new, lang);
  const left = rating.state === 'none' ? newWord : `${fmtRating(rating.rating as number)} ★`;
  const right = resp.state === 'ok' && resp.level && resp.level !== 'new' ? pick(REPLY_LABEL[resp.level], lang)
    : resp.state === 'new' && rating.state !== 'none' ? newWord : null;
  const label = right ? `${left} | ${right}` : left;
  return { rating, resp, tier, text: lines.join('; '), lines, label };
}

// ---------------------------------------------------------------------------------------------------- geometry

/** viewBox 0 0 100 100. Outer arc = rating, inner arc = responsiveness. */
export const RING_GEOMETRY = { outerR: 45, innerR: 36, outerW: 6, innerW: 5, photoInset: 18 } as const;

/**
 * SVG path of an arc that starts at 12 o'clock and runs clockwise for `pct` % of the circle.
 * Drawn as a path (not a rotated circle), so it is the same in left-to-right and right-to-left pages.
 */
export function arcPath(pct: number, r: number, cx = 50, cy = 50): string {
  const p = Math.max(0, Math.min(100, pct));
  if (p <= 0) return '';
  const a = (Math.min(p, 99.99) / 100) * 2 * Math.PI;
  const x = cx + r * Math.sin(a);
  const y = cy - r * Math.cos(a);
  const large = p > 50 ? 1 : 0;
  const f = (n: number) => Math.round(n * 1000) / 1000;
  return `M ${f(cx)} ${f(cy - r)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(x)} ${f(y)}`;
}

/** Stroke pattern: dotted and lighter below the minimum reviews, dashed for low (red) values, solid otherwise. */
export function arcPattern(tone: RingTone, lowSample: boolean): { dash: string | null; opacity: number } {
  if (lowSample) return { dash: '1.5 3', opacity: 0.55 };
  if (tone === 'red') return { dash: '5 2.5', opacity: 1 };
  return { dash: null, opacity: 1 };
}

/** CSS colour of a tone through the design tokens (works in light and dark mode). */
export const TONE_COLOR: Record<RingTone, string> = {
  red: 'hsl(var(--destructive))',
  amber: 'hsl(var(--warning))',
  green: 'hsl(var(--success))',
  gold: 'hsl(var(--badge-gold))',
  none: 'hsl(var(--muted-foreground) / 0.35)',
};
