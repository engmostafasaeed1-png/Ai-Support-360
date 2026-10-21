/**
 * Feature W: the performance ring around a consultant's photo.
 * Outer arc = pure client rating (0-5 → 0-100 %), inner arc = responsiveness score (0-100 %).
 * Honest by construction: no reviews → no rating arc, below the minimum sample or with responsiveness private → no number.
 * Pure and shared by the React ring, the map popup and the tests.
 */
import type { RespLevel } from '../../supabase/functions/_shared/responsiveness';
import { formatMinutes, LEVEL_LABEL } from '@/lib/responsivenessFormat';
import {
  successCompactText, successLabel, successLines, successPillText, successView, SUCCESS_DEFAULTS,
  type SuccessCounts, type SuccessLevel, type SuccessSettings, type SuccessView,
} from '@/lib/successLevel';

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
  tier: ['AI Interview: {tier}', 'مقابلة الذكاء الاصطناعي: {tier}'],
  verified: ['Verified consultant', 'مستشار موثّق'],
  new: ['New', 'جديد'],
  open: ['{name}: performance details', '{name}: تفاصيل الأداء'],
  srRating: ['Client rating', 'تقييم العملاء'],
  srResp: ['Responsiveness', 'سرعة الاستجابة'],
  srSuccess: ['Requests and success', 'الطلبات والنجاح'],
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
  /** Requests + success statistics (state hidden while switched off or not readable). */
  success: SuccessView;
  /** Full text for aria-label and the popover. */
  text: string;
  /** Lines of the popover. */
  lines: string[];
  /** Compact label, e.g. "4.8 ★ | Fast reply". */
  label: string;
  /** Always-visible pills: "4.8 (23)" and "Fast reply - 18 min" (null while responsiveness is private). */
  pills: { rating: RingPill; resp: RingPill | null; success: SuccessPill | null; ai: { text: string; tier: RingTier } | null };
  /** Number for the tiny badge on xs/sm rings: "4.8" or "New". */
  short: string;
}

export interface RingPill { text: string; tone: RingTone; sr: string; dotted?: boolean }
/** "42 requests · 38 solved · 90 % (Gold)"; `compact` = medal text for small places ("90 %"); `label` = "Success: Gold". */
export interface SuccessPill { text: string; compact: string; level: SuccessLevel | null; sr: string; label: string | null }

export interface RingInput {
  rating: number | null | undefined;
  reviews: number | null | undefined;
  minReviews?: number;
  publicOn: boolean;
  resp?: RespInput | null;
  badge?: string | null;
  verified?: boolean;
  lang?: RingLang;
  /** Public success statistics (consultant_success_stats); counts undefined/null = not known, nothing is shown. */
  success?: { publicOn: boolean; counts: SuccessCounts | null | undefined; settings?: SuccessSettings } | null;
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
  const success = successView(i.success?.publicOn ?? false, i.success?.counts, i.success?.settings ?? SUCCESS_DEFAULTS);
  lines.push(...successLines(success, lang, i.success?.settings ?? SUCCESS_DEFAULTS));
  if (tier) lines.push(tier === 'verified' ? pick(RING_STRINGS.verified, lang) : fill(pick(RING_STRINGS.tier, lang), { tier: pick(TIER_LABEL[tier], lang) }));

  const newWord = pick(RING_STRINGS.new, lang);
  const left = rating.state === 'none' ? newWord : `${fmtRating(rating.rating as number)} ★`;
  const right = resp.state === 'ok' && resp.level && resp.level !== 'new' ? pick(REPLY_LABEL[resp.level], lang)
    : resp.state === 'new' && rating.state !== 'none' ? newWord : null;
  const label = right ? `${left} | ${right}` : left;
  const ratingPill: RingPill = {
    text: rating.state === 'none' ? newWord : `${fmtRating(rating.rating as number)} (${rating.reviews})`,
    tone: rating.tone, sr: pick(RING_STRINGS.srRating, lang), dotted: rating.state === 'low',
  };
  const respPill: RingPill | null = resp.state === 'hidden' ? null : {
    text: resp.state === 'ok' && resp.level && resp.level !== 'new'
      ? `${pick(REPLY_LABEL[resp.level], lang)} - ${formatMinutes(resp.median, lang === 'ar')}` : newWord,
    tone: resp.tone, sr: pick(RING_STRINGS.srResp, lang),
  };
  const short = rating.state === 'none' ? newWord : fmtRating(rating.rating as number);
  const successText = successPillText(success, lang);
  const successPill: SuccessPill | null = successText == null ? null : {
    text: successText, compact: successCompactText(success, lang) ?? '', level: success.level, sr: pick(RING_STRINGS.srSuccess, lang),
    label: success.level ? successLabel(success.level, lang) : null,
  };
  return { rating, resp, tier, success, text: lines.join('; '), lines, label, pills: {
    rating: ratingPill, resp: respPill, success: successPill,
    ai: tier && tier !== 'verified' ? { text: fill(pick(RING_STRINGS.tier, lang), { tier: pick(TIER_LABEL[tier], lang) }), tier } : null,
  }, short };
}

// ---------------------------------------------------------------------------------------------------- geometry

export type RingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Pixel spec per size: outer / inner stroke, gap between the arcs, gap between photo and inner arc.
 * md is the reference (6 / 5 / 3 / 4 px); nothing is thinner than 3 px.
 */
export const RING_SIZES: Record<RingSize, { px: number; outerW: number; innerW: number; gap: number; photoGap: number; successW: number; successGap: number; text: string; chip: boolean; short: boolean; glow: number }> = {
  xs: { px: 36, outerW: 3, innerW: 3, gap: 1.5, photoGap: 2, successW: 2, successGap: 1, text: 'text-[8px]', chip: false, short: true, glow: 4 },
  sm: { px: 52, outerW: 4, innerW: 3.5, gap: 2, photoGap: 3, successW: 2.5, successGap: 1.5, text: 'text-[10px]', chip: true, short: true, glow: 4 },
  md: { px: 72, outerW: 6, innerW: 5, gap: 3, photoGap: 4, successW: 3, successGap: 2, text: 'text-sm', chip: true, short: false, glow: 6 },
  lg: { px: 96, outerW: 7, innerW: 6, gap: 3.5, photoGap: 4.5, successW: 3.5, successGap: 2, text: 'text-lg', chip: true, short: false, glow: 7 },
  xl: { px: 136, outerW: 8, innerW: 7, gap: 4, photoGap: 5, successW: 4, successGap: 2.5, text: 'text-3xl sm:text-4xl', chip: true, short: false, glow: 8 },
};

/** Thin outline (card colour) under the arcs, so they stand out on photos and maps. */
export const RING_OUTLINE = 1;

export interface RingGeometry { px: number; c: number; outerR: number; innerR: number; outerW: number; innerW: number; photoR: number; successR: number | null; successW: number }

/** With `withSuccess` a thin third band sits outside the rating arc (same box size, slightly smaller photo). */
export function ringGeometry(size: RingSize, withSuccess = false): RingGeometry {
  const s = RING_SIZES[size];
  const c = s.px / 2;
  const successR = withSuccess ? c - RING_OUTLINE - s.successW / 2 : null;
  const outerR = successR != null ? successR - s.successW / 2 - s.successGap - s.outerW / 2 : c - RING_OUTLINE - s.outerW / 2;
  const innerR = outerR - s.outerW / 2 - s.gap - s.innerW / 2;
  const photoR = innerR - s.innerW / 2 - s.photoGap;
  return { px: s.px, c, outerR, innerR, outerW: s.outerW, innerW: s.innerW, photoR, successR, successW: s.successW };
}

const f3 = (n: number) => Math.round(n * 1000) / 1000;

/** Point on the circle at `pct` % (0 = 12 o'clock, clockwise). */
export function pointAt(pct: number, r: number, cx = 50, cy = 50): [number, number] {
  const a = (Math.max(0, Math.min(100, pct)) / 100) * 2 * Math.PI;
  return [f3(cx + r * Math.sin(a)), f3(cy - r * Math.cos(a))];
}

/** Arc from `from` % to `to` % (clockwise). */
export function arcRange(from: number, to: number, r: number, cx = 50, cy = 50): string {
  const a = Math.max(0, Math.min(100, from));
  const b = Math.min(Math.max(a, to), a + 99.99, 100);
  if (b - a <= 0) return '';
  const [x1, y1] = pointAt(a, r, cx, cy);
  const [x2, y2] = pointAt(Math.min(b, 99.99), r, cx, cy);
  return `M ${x1} ${y1} A ${f3(r)} ${f3(r)} 0 ${b - a > 50 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * SVG path of an arc that starts at 12 o'clock and runs clockwise for `pct` % of the circle.
 * Drawn as a path (not a rotated circle), so it is the same in left-to-right and right-to-left pages.
 */
export function arcPath(pct: number, r: number, cx = 50, cy = 50): string {
  return pct > 0 ? arcRange(0, pct, r, cx, cy) : '';
}

/** Short pieces of the arc, each with its place (0-1) in the two-stop gradient, so the colour runs along the arc. */
export function arcSegments(pct: number, r: number, cx = 50, cy = 50): Array<{ d: string; t: number }> {
  const p = Math.max(0, Math.min(100, pct));
  if (p <= 0) return [];
  const n = Math.max(2, Math.min(16, Math.ceil(p / 6)));
  const step = p / n;
  return Array.from({ length: n }, (_, i) => ({
    // A small overlap hides hairline seams between the pieces.
    d: arcRange(i * step, Math.min(p, (i + 1) * step + (i < n - 1 ? 0.4 : 0)), r, cx, cy),
    t: n === 1 ? 0 : (i + 0.5) / n,
  }));
}

/**
 * Stroke pattern, scaled to the stroke width: round dots and lighter below the minimum reviews,
 * dashes for low (red) values, solid otherwise. Colour is never the only signal.
 */
export function arcPattern(tone: RingTone, lowSample: boolean, w = 6): { dash: string | null; opacity: number } {
  if (lowSample) return { dash: `0.01 ${f3(w * 1.7)}`, opacity: 0.6 };
  if (tone === 'red') return { dash: `${f3(w * 0.9)} ${f3(w * 2)}`, opacity: 1 };
  return { dash: null, opacity: 1 };
}

/** Two gradient stops per tone, as design tokens (index.css): red→crimson, amber→orange, green→teal, gold→yellow. */
export const TONE_VARS: Record<RingTone, [string, string]> = {
  red: ['--ring-red-a', '--ring-red-b'],
  amber: ['--ring-amber-a', '--ring-amber-b'],
  green: ['--ring-green-a', '--ring-green-b'],
  gold: ['--ring-gold-a', '--ring-gold-b'],
  none: ['--ring-none', '--ring-none'],
};

/** CSS colour of a tone (first stop), e.g. for dots and the glow. */
export const TONE_COLOR: Record<RingTone, string> = {
  red: 'hsl(var(--ring-red-a))', amber: 'hsl(var(--ring-amber-a))', green: 'hsl(var(--ring-green-a))', gold: 'hsl(var(--ring-gold-a))', none: 'hsl(var(--ring-none))',
};

/** Colour at place t (0-1) between the two stops. */
export function toneMix(tone: RingTone, t: number): string {
  const [a, b] = TONE_VARS[tone];
  const pb = Math.round(Math.max(0, Math.min(1, t)) * 100);
  return `color-mix(in oklab, hsl(var(${a})) ${100 - pb}%, hsl(var(${b})) ${pb}%)`;
}

/** Faint tinted track (the empty part), in the arc's own colour. */
export function trackColor(tone: RingTone): string {
  return tone === 'none' ? 'hsl(var(--ring-none) / 0.22)' : `hsl(var(${TONE_VARS[tone][0]}) / 0.16)`;
}

/** Gradient for dots and legend swatches. */
export function toneGradient(tone: RingTone, angle = 135): string {
  const [a, b] = TONE_VARS[tone];
  return `linear-gradient(${angle}deg, hsl(var(${a})), hsl(var(${b})))`;
}
