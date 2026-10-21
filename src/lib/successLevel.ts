/**
 * Feature W addition: requests + success statistics and the Success level (Bronze, Silver, Gold, Platinum).
 * Counts come from the database (consultant_success_stats, docs/sql/success-stats.sql); this file only decides
 * what may be shown and how it reads. Whole-number maths, so Platinum means every request was solved and
 * the shown percentage is rounded down (99.9 % reads 99 %).
 * Never call a Success level just "Gold": every visible label carries the word "Success".
 */
export type SuccessLevel = 'bronze' | 'silver' | 'gold' | 'platinum';
/** hidden = switched off / not readable; new = below the minimum sample; none = below Bronze (counts only); ok = level shown. */
export type SuccessState = 'hidden' | 'new' | 'none' | 'ok';
export type SuccessLang = 'en' | 'ar';

export interface SuccessSettings { bronze: number; silver: number; gold: number; platinum: number; min_requests: number }
export const SUCCESS_DEFAULTS: SuccessSettings = { bronze: 60, silver: 80, gold: 85, platinum: 100, min_requests: 5 };
export const SUCCESS_LEVELS: SuccessLevel[] = ['bronze', 'silver', 'gold', 'platinum'];
export const SUCCESS_RANK: Record<SuccessLevel, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };

const int = (v: unknown, def: number, lo: number, hi: number) => {
  const n = typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi ? n : def;
};

/** Same validation as success_settings() in the database: thresholds must rise strictly, otherwise the defaults apply. */
export function parseSuccessSettings(raw: unknown): SuccessSettings {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const s: SuccessSettings = {
    bronze: int(o.bronze, 60, 1, 100), silver: int(o.silver, 80, 1, 100), gold: int(o.gold, 85, 1, 100),
    platinum: int(o.platinum, 100, 1, 100), min_requests: int(o.min_requests, 5, 1, 100),
  };
  if (!(s.bronze < s.silver && s.silver < s.gold && s.gold < s.platinum)) return { ...SUCCESS_DEFAULTS, min_requests: s.min_requests };
  return s;
}

/** Problems with an admin draft (empty = can be saved). */
export function successSettingsProblems(s: SuccessSettings): string[] {
  const out: string[] = [];
  for (const k of ['bronze', 'silver', 'gold', 'platinum'] as const) if (!Number.isInteger(s[k]) || s[k] < 1 || s[k] > 100) out.push(k);
  if (!Number.isInteger(s.min_requests) || s.min_requests < 1 || s.min_requests > 100) out.push('min_requests');
  if (!(s.bronze < s.silver && s.silver < s.gold && s.gold < s.platinum)) out.push('order');
  return out;
}

export function successLevelOf(total: number, solved: number, s: SuccessSettings = SUCCESS_DEFAULTS): 'new' | 'none' | SuccessLevel {
  if (!(total > 0) || total < s.min_requests) return 'new';
  const x = solved * 100;
  if (x >= s.platinum * total) return 'platinum';
  if (x >= s.gold * total) return 'gold';
  if (x >= s.silver * total) return 'silver';
  if (x >= s.bronze * total) return 'bronze';
  return 'none';
}

/** Shown percentage, rounded down. */
export function successPct(total: number, solved: number): number | null {
  return total > 0 ? Math.floor((solved * 100) / total) : null;
}

export interface SuccessCounts {
  requests_total: number;
  solved: number;
  not_solved: number;
  requests_12m: number;
  solved_12m: number;
}

export type SuccessProgress =
  | { kind: 'sample'; more: number }
  | { kind: 'next'; level: SuccessLevel; solved: number }
  | { kind: 'unreachable'; level: SuccessLevel }
  | { kind: 'max' };

/**
 * Honest distance to the next level, counting only solved requests in a row:
 * smallest k with (solved + k) / (total + k) ≥ threshold. Platinum (100 %) can not be reached once any request
 * ended unsolved, so that case says so instead of promising a number.
 */
export function successProgress(total: number, solved: number, s: SuccessSettings = SUCCESS_DEFAULTS): SuccessProgress {
  if (total < s.min_requests) return { kind: 'sample', more: s.min_requests - Math.max(0, total) };
  const now = successLevelOf(total, solved, s);
  if (now === 'platinum') return { kind: 'max' };
  const next: SuccessLevel = now === 'none' || now === 'new' ? 'bronze' : SUCCESS_LEVELS[SUCCESS_RANK[now]];
  const t = s[next];
  if (t >= 100) return solved < total ? { kind: 'unreachable', level: next } : { kind: 'max' };
  const k = Math.max(1, Math.ceil((t * total - 100 * solved) / (100 - t)));
  return { kind: 'next', level: next, solved: k };
}

export interface SuccessView {
  state: SuccessState;
  level: SuccessLevel | null;
  total: number;
  solved: number;
  notSolved: number;
  /** Only with a level (minimum sample reached and Bronze or better). */
  pct: number | null;
  total12: number;
  solved12: number;
  pct12: number | null;
  progress: SuccessProgress | null;
  minRequests: number;
}

const HIDDEN: SuccessView = { state: 'hidden', level: null, total: 0, solved: 0, notSolved: 0, pct: null, total12: 0, solved12: 0, pct12: null, progress: null, minRequests: SUCCESS_DEFAULTS.min_requests };

export function successView(publicOn: boolean, counts: SuccessCounts | null | undefined, s: SuccessSettings = SUCCESS_DEFAULTS): SuccessView {
  if (!publicOn || !counts) return { ...HIDDEN, minRequests: s.min_requests };
  const total = Math.max(0, Math.floor(counts.requests_total || 0));
  const solved = Math.min(total, Math.max(0, Math.floor(counts.solved || 0)));
  const notSolved = Math.max(0, Math.floor(counts.not_solved || 0));
  const total12 = Math.max(0, Math.floor(counts.requests_12m || 0));
  const solved12 = Math.min(total12, Math.max(0, Math.floor(counts.solved_12m || 0)));
  const lv = successLevelOf(total, solved, s);
  const lv12 = successLevelOf(total12, solved12, s);
  const state: SuccessState = lv === 'new' ? 'new' : lv === 'none' ? 'none' : 'ok';
  return {
    state, level: state === 'ok' ? lv as SuccessLevel : null, total, solved, notSolved,
    pct: state === 'ok' ? successPct(total, solved) : null,
    total12, solved12, pct12: lv12 !== 'new' && lv12 !== 'none' ? successPct(total12, solved12) : null,
    progress: successProgress(total, solved, s), minRequests: s.min_requests,
  };
}

// ---------------------------------------------------------------------------------------------------- texts (EN / AR)

export const SUCCESS_LEVEL_LABEL: Record<SuccessLevel, [string, string]> = {
  bronze: ['Bronze', 'برونزي'], silver: ['Silver', 'فضي'], gold: ['Gold', 'ذهبي'], platinum: ['Platinum', 'بلاتيني'],
};

export const SUCCESS_STRINGS = {
  label: ['Success: {level}', 'النجاح: {level}'],
  lineOk: ['Success level: {level} - {solved} of {total} requests solved ({pct} %) - last 12 months {pct12}', 'مستوى النجاح: {level} - تم حل {solved} من {total} طلبًا ({pct} ٪) - آخر 12 شهرًا {pct12}'],
  last12Pct: ['{pct} %', '{pct} ٪'],
  last12Counts: ['{solved} of {total} solved', 'تم حل {solved} من {total}'],
  lineNew: ['Success: New - {solved} of {total} requests solved', 'النجاح: جديد - تم حل {solved} من {total} طلبًا'],
  lineNewZero: ['Success: New - no finished requests yet', 'النجاح: جديد - لا توجد طلبات منتهية بعد'],
  lineNone: ['Success: {solved} of {total} requests solved', 'النجاح: تم حل {solved} من {total} طلبًا'],
  minNote: ['A Success level shows after {n} finished requests.', 'يظهر مستوى النجاح بعد {n} طلبات منتهية.'],
  noneNote: ['A Success level shows from {pct} % solved.', 'يظهر مستوى النجاح ابتداءً من {pct} ٪ من الطلبات المحلولة.'],
  pillOk: ['{total} requests · {solved} solved · {pct} % ({level})', 'الطلبات: {total} · المحلولة: {solved} · {pct} ٪ ({level})'],
  pillCounts: ['{total} requests · {solved} solved', 'الطلبات: {total} · المحلولة: {solved}'],
  pillNew: ['{total} requests · {solved} solved · New', 'الطلبات: {total} · المحلولة: {solved} · جديد'],
  new: ['New', 'جديد'],
  sr: ['Success', 'النجاح'],
  progressSample: ['{n} more finished requests until a Success level shows', '{n} طلبات منتهية أخرى حتى يظهر مستوى النجاح'],
  progressSampleOne: ['1 more finished request until a Success level shows', 'طلب منتهٍ واحد آخر حتى يظهر مستوى النجاح'],
  progressNext: ['{n} more solved requests in a row to reach Success: {level}', '{n} طلبات محلولة أخرى على التوالي للوصول إلى النجاح: {level}'],
  progressNextOne: ['1 more solved request to reach Success: {level}', 'طلب محلول واحد آخر للوصول إلى النجاح: {level}'],
  progressUnreachable: ['Success: {level} needs every request solved', 'النجاح: {level} يتطلب حل جميع الطلبات'],
  progressMax: ['Highest Success level reached', 'تم الوصول إلى أعلى مستوى نجاح'],
} as const;

const pick = (pair: readonly [string, string], lang: SuccessLang) => (lang === 'ar' ? pair[1] : pair[0]);
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

export const successLevelName = (level: SuccessLevel, lang: SuccessLang = 'en') => pick(SUCCESS_LEVEL_LABEL[level], lang);
/** "Success: Gold" (never just "Gold"). */
export const successLabel = (level: SuccessLevel, lang: SuccessLang = 'en') => fill(pick(SUCCESS_STRINGS.label, lang), { level: successLevelName(level, lang) });

/** Popover lines: the main line, then the minimum-sample (or Bronze) note. Empty while hidden. */
export function successLines(v: SuccessView, lang: SuccessLang = 'en', s: SuccessSettings = SUCCESS_DEFAULTS): string[] {
  if (v.state === 'hidden') return [];
  const note = fill(pick(SUCCESS_STRINGS.minNote, lang), { n: v.minRequests });
  if (v.state === 'new') {
    return [v.total === 0 ? pick(SUCCESS_STRINGS.lineNewZero, lang) : fill(pick(SUCCESS_STRINGS.lineNew, lang), { solved: v.solved, total: v.total }), note];
  }
  if (v.state === 'none') {
    return [fill(pick(SUCCESS_STRINGS.lineNone, lang), { solved: v.solved, total: v.total }), fill(pick(SUCCESS_STRINGS.noneNote, lang), { pct: s.bronze })];
  }
  const last12 = v.pct12 != null ? fill(pick(SUCCESS_STRINGS.last12Pct, lang), { pct: v.pct12 }) : fill(pick(SUCCESS_STRINGS.last12Counts, lang), { solved: v.solved12, total: v.total12 });
  return [fill(pick(SUCCESS_STRINGS.lineOk, lang), {
    level: successLevelName(v.level as SuccessLevel, lang), solved: v.solved, total: v.total, pct: v.pct ?? 0, pct12: last12,
  }), note];
}

/** One line under the name: "42 requests · 38 solved · 90 % (Gold)". */
export function successPillText(v: SuccessView, lang: SuccessLang = 'en'): string | null {
  if (v.state === 'hidden') return null;
  if (v.state === 'ok') return fill(pick(SUCCESS_STRINGS.pillOk, lang), { total: v.total, solved: v.solved, pct: v.pct ?? 0, level: successLevelName(v.level as SuccessLevel, lang) });
  if (v.state === 'new') return v.total === 0 ? pick(SUCCESS_STRINGS.new, lang) : fill(pick(SUCCESS_STRINGS.pillNew, lang), { total: v.total, solved: v.solved });
  return fill(pick(SUCCESS_STRINGS.pillCounts, lang), { total: v.total, solved: v.solved });
}

/** Small rings: only the medal and the percentage ("90 %"), "New", or "6/12" below Bronze. */
export function successCompactText(v: SuccessView, lang: SuccessLang = 'en'): string | null {
  if (v.state === 'hidden') return null;
  if (v.state === 'ok') return lang === 'ar' ? `${v.pct} ٪` : `${v.pct} %`;
  if (v.state === 'new') return pick(SUCCESS_STRINGS.new, lang);
  return `${v.solved}/${v.total}`;
}

export function successProgressText(p: SuccessProgress | null, lang: SuccessLang = 'en'): string | null {
  if (!p) return null;
  if (p.kind === 'sample') return p.more === 1 ? pick(SUCCESS_STRINGS.progressSampleOne, lang) : fill(pick(SUCCESS_STRINGS.progressSample, lang), { n: p.more });
  if (p.kind === 'max') return pick(SUCCESS_STRINGS.progressMax, lang);
  if (p.kind === 'unreachable') return fill(pick(SUCCESS_STRINGS.progressUnreachable, lang), { level: successLevelName(p.level, lang) });
  return fill(pick(p.solved === 1 ? SUCCESS_STRINGS.progressNextOne : SUCCESS_STRINGS.progressNext, lang), { n: p.solved, level: successLevelName(p.level, lang) });
}

// ---------------------------------------------------------------------------------------------------- colours

/** Own colour family (index.css): copper, steel, yellow, cool white/blue. Never the AI interview badge colours. */
export const SUCCESS_VARS: Record<SuccessLevel, [string, string]> = {
  bronze: ['--success-bronze-a', '--success-bronze-b'],
  silver: ['--success-silver-a', '--success-silver-b'],
  gold: ['--success-gold-a', '--success-gold-b'],
  platinum: ['--success-platinum-a', '--success-platinum-b'],
};
export const successColor = (level: SuccessLevel) => `hsl(var(${SUCCESS_VARS[level][0]}))`;
export const successGradient = (level: SuccessLevel, angle = 135) => {
  const [a, b] = SUCCESS_VARS[level];
  return level === 'platinum'
    ? `linear-gradient(${angle}deg, hsl(var(${a})), hsl(var(${b})) 55%, hsl(var(${a})))`
    : `linear-gradient(${angle}deg, hsl(var(${a})), hsl(var(${b})))`;
};
export const successMix = (level: SuccessLevel, t: number) => {
  const [a, b] = SUCCESS_VARS[level];
  const pb = Math.round(Math.max(0, Math.min(1, t)) * 100);
  return `color-mix(in oklab, hsl(var(${a})) ${100 - pb}%, hsl(var(${b})) ${pb}%)`;
};

// ---------------------------------------------------------------------------------------------------- directory

/** Sort keys: level rank (Platinum first), then rate, then more finished requests; New and hidden last. */
export function successSortValue(v: SuccessView | null | undefined): [number, number, number] {
  if (!v || v.state === 'hidden') return [-2, -1, 0];
  if (v.state !== 'ok') return [-1, -1, v.total];
  return [SUCCESS_RANK[v.level as SuccessLevel], v.pct ?? 0, v.total];
}

export function compareSuccessLevel(a: SuccessView | null | undefined, b: SuccessView | null | undefined): number {
  const x = successSortValue(a), y = successSortValue(b);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

export function compareSuccessRate(a: SuccessView | null | undefined, b: SuccessView | null | undefined): number {
  const x = successSortValue(a), y = successSortValue(b);
  const ra = x[0] > 0 ? x[1] : -1, rb = y[0] > 0 ? y[1] : -1;
  return rb - ra || y[2] - x[2];
}

export function meetsSuccessLevel(v: SuccessView | null | undefined, min: SuccessLevel | ''): boolean {
  if (!min) return true;
  return !!v && v.state === 'ok' && SUCCESS_RANK[v.level as SuccessLevel] >= SUCCESS_RANK[min];
}

export function meetsSuccessRate(v: SuccessView | null | undefined, min: number): boolean {
  if (!min) return true;
  return !!v && v.state === 'ok' && (v.pct ?? 0) >= min;
}
