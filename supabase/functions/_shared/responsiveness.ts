/**
 * Feature M: consultant responsiveness statistics.
 * Pure rules shared by the portal (chip, blended rating, My responsiveness, admin page), the responsiveness-run edge
 * function, the matcher and the tests. docs/sql/responsiveness.sql computes the same numbers inside the database
 * (responsiveness_exclusion, responsiveness_metrics, responsiveness_level, responsiveness_public_level, ...);
 * the browser never computes a consultant's official statistics, it only displays them.
 */

export type RespKind = 'request' | 'bid' | 'critical' | 'chat';
export type RespOutcome = 'pending' | 'responded' | 'no_response' | 'withdrawn' | 'voided';
export type RespExclusion = 'outside_hours' | 'unavailable_period' | 'busy' | 'capacity';
export type RespLevel = 'excellent' | 'good' | 'fair' | 'needs_improvement' | 'new';
export type RespScope = 'main' | 'critical' | 'chat';

export interface RespSettings {
  /** Counted requests (last 90 days) before anything becomes public: level, blended rating, ranking. */
  min_sample: number;
  /** Response rate (%) below which the indicator shows "Needs improvement" (after the minimum sample). */
  rate_threshold: number;
  /** Warnings before the indicator becomes visible: warning 1 of N ... N of N, then the badge. */
  warnings: number;
  /** Share (%) of the responsiveness stars in the overall displayed rating. */
  review_weight: number;
  excellent_median: number; excellent_rate: number;
  good_median: number; good_rate: number;
  fair_median: number;
  /** Minutes a client chat message waits before it counts as unanswered (chat split only). */
  chat_window: number;
  /** Days after a no-response in which the consultant may dispute it. */
  dispute_days: number;
  /** Hours used when a consultant has no availability slots (with the declared working week). */
  default_start: string; default_end: string;
}

export const RESP_DEFAULTS: RespSettings = {
  min_sample: 5, rate_threshold: 60, warnings: 2, review_weight: 15,
  excellent_median: 60, excellent_rate: 90, good_median: 240, good_rate: 80, fair_median: 1440,
  chat_window: 1440, dispute_days: 7, default_start: '08:00', default_end: '20:00',
};

const RANGES: Record<Exclude<keyof RespSettings, 'default_start' | 'default_end'>, [number, number]> = {
  min_sample: [1, 100], rate_threshold: [0, 100], warnings: [1, 5], review_weight: [0, 50],
  excellent_median: [1, 10080], excellent_rate: [0, 100], good_median: [1, 10080], good_rate: [0, 100], fair_median: [1, 10080],
  chat_window: [60, 10080], dispute_days: [1, 30],
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Reads `platform_settings.responsiveness_settings`; bad values fall back to the defaults (a whole group when its order breaks). */
export function readRespSettings(raw: unknown): RespSettings {
  let o: unknown = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  const src = (o && typeof o === 'object' && !Array.isArray(o) ? o : {}) as Record<string, unknown>;
  const out = { ...RESP_DEFAULTS };
  (Object.keys(RANGES) as Array<keyof typeof RANGES>).forEach((k) => {
    const v = src[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    const [lo, hi] = RANGES[k];
    if (Number.isInteger(n) && n >= lo && n <= hi) out[k] = n;
  });
  for (const k of ['default_start', 'default_end'] as const) if (typeof src[k] === 'string' && HHMM.test(src[k] as string)) out[k] = src[k] as string;
  if (!(out.excellent_median < out.good_median && out.good_median < out.fair_median)) {
    Object.assign(out, { excellent_median: RESP_DEFAULTS.excellent_median, good_median: RESP_DEFAULTS.good_median, fair_median: RESP_DEFAULTS.fair_median });
  }
  if (!(out.excellent_rate >= out.good_rate && out.good_rate >= out.rate_threshold)) {
    Object.assign(out, { excellent_rate: RESP_DEFAULTS.excellent_rate, good_rate: RESP_DEFAULTS.good_rate, rate_threshold: RESP_DEFAULTS.rate_threshold });
  }
  if (out.default_start >= out.default_end) Object.assign(out, { default_start: RESP_DEFAULTS.default_start, default_end: RESP_DEFAULTS.default_end });
  return out;
}

/** Problems an administrator must fix before saving (same rules as readRespSettings). */
export function respSettingsProblems(s: RespSettings): string[] {
  const p: string[] = [];
  (Object.keys(RANGES) as Array<keyof typeof RANGES>).forEach((k) => {
    const [lo, hi] = RANGES[k];
    if (!Number.isInteger(s[k]) || s[k] < lo || s[k] > hi) p.push(`${k}: ${lo}-${hi}`);
  });
  if (!(s.excellent_median < s.good_median && s.good_median < s.fair_median)) p.push('median order');
  if (!(s.excellent_rate >= s.good_rate && s.good_rate >= s.rate_threshold)) p.push('rate order');
  if (!HHMM.test(s.default_start) || !HHMM.test(s.default_end) || s.default_start >= s.default_end) p.push('default hours');
  return p;
}

// ---------------------------------------------------------------- availability (fairness rule)

export interface AvailabilitySlot { day_of_week: number | null; specific_date: string | null; start_time: string; end_time: string }
export interface AvailabilityInput {
  at: number;
  timezone?: string | null;
  slots: AvailabilitySlot[];
  workingWeek?: string | null;
  /** Periods marked unavailable in advance (vacation / pause). */
  periods: Array<{ starts_at: string; ends_at: string }>;
  status?: string | null;
  activeTickets?: number;
  maxActive?: number | null;
  settings?: RespSettings;
}

function localParts(at: number, tz: string): { dow: number; date: string; time: string } {
  let zone = tz;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { zone = 'Asia/Riyadh'; }
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dow, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

const t8 = (s: string) => (s.length === 5 ? `${s}:00` : s.slice(0, 8));
const inside = (time: string, start: string, end: string) => time >= t8(start) && (t8(end) <= t8(start) || time < t8(end));
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export const WORKING_DAYS: Record<string, number[]> = {
  'Sunday to Thursday': [0, 1, 2, 3, 4],
  'Monday to Friday': [1, 2, 3, 4, 5],
  'Flexible (both)': [0, 1, 2, 3, 4, 5],
};

/**
 * Why a request that arrived at `at` is NOT counted (null = the consultant was available, so it counts).
 * Order: vacation/pause period, marked busy, capacity reached, outside declared hours.
 * Declared hours: weekly slots and one-date slots (within 30 days); without any, the working week (default Sunday to
 * Thursday) between the default hours, in the consultant's time zone (default Asia/Riyadh).
 */
export function availabilityExclusion(i: AvailabilityInput): RespExclusion | null {
  const s = i.settings ?? RESP_DEFAULTS;
  if (i.periods.some((p) => i.at >= Date.parse(p.starts_at) && i.at < Date.parse(p.ends_at))) return 'unavailable_period';
  if (i.status === 'busy') return 'busy';
  if (i.maxActive != null && (i.activeTickets ?? 0) >= i.maxActive) return 'capacity';
  const { dow, date, time } = localParts(i.at, i.timezone || 'Asia/Riyadh');
  const declared = i.slots.filter((sl) => !sl.specific_date || dayDiff(sl.specific_date, date) <= 30);
  if (declared.length) {
    const ok = declared.some((sl) => (sl.specific_date ? sl.specific_date === date : sl.day_of_week === dow) && inside(time, sl.start_time, sl.end_time));
    return ok ? null : 'outside_hours';
  }
  const days = WORKING_DAYS[i.workingWeek ?? ''] ?? WORKING_DAYS['Sunday to Thursday'];
  return days.includes(dow) && inside(time, s.default_start, s.default_end) ? null : 'outside_hours';
}

// ---------------------------------------------------------------- metrics

export interface RespEvent {
  kind: RespKind;
  received_at: string;
  responded_at?: string | null;
  outcome: RespOutcome;
  counted: boolean;
  is_critical?: boolean | null;
}

export interface RespBuckets { lt15: number; lt60: number; lt240: number; lt1440: number; later: number }
export interface RespMetrics {
  received: number; counted: number; not_counted: number; responded: number; no_response: number;
  rate: number | null; median: number | null; avg: number | null; p90: number | null; buckets: RespBuckets;
}

export const inScope = (e: Pick<RespEvent, 'kind' | 'is_critical'>, scope: RespScope) =>
  scope === 'main' ? e.kind === 'request' || e.kind === 'bid'
    : scope === 'critical' ? e.kind === 'critical' || ((e.kind === 'request' || e.kind === 'bid') && e.is_critical === true)
      : e.kind === 'chat';

/** Postgres percentile_cont (linear interpolation). */
export function percentileCont(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const DAY = 86_400_000;

/**
 * Metrics of one split over a window (days; null = all time) counted on the arrival time.
 * Counted = available on arrival, answered or expired; withdrawn requests are left out entirely; voided ones (upheld
 * dispute) and requests outside availability are "not counted". A decline in time is a response.
 */
export function computeMetrics(events: RespEvent[], now: number, windowDays: number | null, scope: RespScope = 'main'): RespMetrics {
  const since = windowDays == null ? -Infinity : now - windowDays * DAY;
  const list = events.filter((e) => inScope(e, scope) && e.outcome !== 'withdrawn' && Date.parse(e.received_at) >= since);
  const counted = list.filter((e) => e.counted && (e.outcome === 'responded' || e.outcome === 'no_response'));
  const responded = counted.filter((e) => e.outcome === 'responded');
  const mins = responded
    .map((e) => Math.max(0, (Date.parse(e.responded_at ?? e.received_at) - Date.parse(e.received_at)) / 60_000))
    .sort((a, b) => a - b);
  const r = (v: number | null) => (v == null ? null : Math.round(v));
  const buckets: RespBuckets = { lt15: 0, lt60: 0, lt240: 0, lt1440: 0, later: 0 };
  for (const m of mins) buckets[m < 15 ? 'lt15' : m < 60 ? 'lt60' : m < 240 ? 'lt240' : m < 1440 ? 'lt1440' : 'later'] += 1;
  return {
    received: list.length,
    counted: counted.length,
    not_counted: list.filter((e) => !e.counted || e.outcome === 'voided').length,
    responded: responded.length,
    no_response: counted.length - responded.length,
    rate: counted.length ? Math.round((100 * responded.length) / counted.length) : null,
    median: r(percentileCont(mins, 0.5)),
    avg: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    p90: r(percentileCont(mins, 0.9)),
    buckets,
  };
}

/** Level of the last-90-days main split (before visibility rules). */
export function levelFor(m: Pick<RespMetrics, 'counted' | 'rate' | 'median'>, s: RespSettings = RESP_DEFAULTS): RespLevel {
  if (m.counted < s.min_sample) return 'new';
  const rate = m.rate ?? 0;
  const med = m.median ?? Infinity;
  if (med < s.excellent_median && rate >= s.excellent_rate) return 'excellent';
  if (med < s.good_median && rate >= s.good_rate) return 'good';
  if (med < s.fair_median && rate >= s.rate_threshold) return 'fair';
  return 'needs_improvement';
}

/**
 * What clients may see. "Needs improvement" appears only after the warnings ran out (no-response number warnings+1
 * in 30 days, default the 3rd) or when the rate is below the threshold; otherwise the indicator never drops below Fair.
 * Below the minimum sample it is always "New".
 */
export function publicLevel(level: RespLevel, m90: Pick<RespMetrics, 'counted' | 'rate'>, noResponse30: number, s: RespSettings = RESP_DEFAULTS): RespLevel {
  if (level === 'new' || m90.counted < s.min_sample) return 'new';
  if (noResponse30 >= s.warnings + 1 || (m90.rate ?? 0) < s.rate_threshold) return 'needs_improvement';
  if (level === 'needs_improvement') return 'fair';
  return level;
}

/** Computed review stars (1-5) for the level; null for "New". */
export function starsFor(level: RespLevel, rate: number | null): number | null {
  switch (level) {
    case 'excellent': return 5;
    case 'good': return 4;
    case 'fair': return 3;
    case 'needs_improvement': return (rate ?? 0) < 30 ? 1 : 2;
    default: return null;
  }
}

export interface BlendInput {
  clientRating: number | null | undefined;
  reviewCount: number;
  stars: number | null | undefined;
  level: RespLevel | null | undefined;
  publicOn: boolean;
  settings?: Pick<RespSettings, 'review_weight'>;
}
export interface BlendResult {
  /** Overall displayed rating; null when there are no client reviews (responsiveness alone never makes a rating). */
  overall: number | null;
  client: number | null;
  responsiveness: number | null;
  clientWeight: number;
  responsivenessWeight: number;
  applied: boolean;
}

/** Overall rating = client reviews blended with the responsiveness stars (default 85 / 15), only after the minimum sample. Client stars are never changed. */
export function blendedRating(i: BlendInput): BlendResult {
  const client = i.reviewCount > 0 && i.clientRating != null && Number.isFinite(i.clientRating) ? Math.max(0, Math.min(5, i.clientRating)) : null;
  const w = Math.max(0, Math.min(50, i.settings?.review_weight ?? RESP_DEFAULTS.review_weight)) / 100;
  const usable = i.publicOn && i.level != null && i.level !== 'new' && i.stars != null;
  const resp = usable ? (i.stars as number) : null;
  if (client == null) return { overall: null, client: null, responsiveness: resp, clientWeight: 100, responsivenessWeight: 0, applied: false };
  if (resp == null || w === 0) return { overall: client, client, responsiveness: resp, clientWeight: 100, responsivenessWeight: 0, applied: false };
  const overall = Math.round((client * (1 - w) + resp * w) * 100) / 100;
  return { overall, client, responsiveness: resp, clientWeight: Math.round((1 - w) * 100), responsivenessWeight: Math.round(w * 100), applied: true };
}

// ---------------------------------------------------------------- warnings and disputes

export type NoticeKind = 'counted' | 'not_counted' | `warning_${number}` | 'badge_visible' | 'dispute_upheld' | 'dispute_rejected';

/** Notice for a counted no-response, given how many counted no-responses (incl. this one) the last 30 days hold. */
export function noticeForNoResponse(countedNoResponse30: number, warnings: number = RESP_DEFAULTS.warnings): NoticeKind {
  const n = Math.max(1, Math.floor(countedNoResponse30));
  if (n <= warnings) return `warning_${n}`;
  if (n === warnings + 1) return 'badge_visible';
  return 'counted';
}

export interface DisputeCandidate {
  kind: RespKind;
  outcome: RespOutcome;
  counted: boolean;
  resolved_at?: string | null;
  received_at: string;
  dispute_status?: string | null;
}

/** Only a counted no-response on a request or bid invitation, once, within the dispute window. */
export function canDispute(e: DisputeCandidate, now: number, days: number = RESP_DEFAULTS.dispute_days): boolean {
  if (!(e.kind === 'request' || e.kind === 'bid') || e.outcome !== 'no_response' || !e.counted || e.dispute_status) return false;
  const from = Date.parse(e.resolved_at ?? e.received_at);
  return Number.isFinite(from) && now - from <= days * DAY;
}

/** An upheld dispute: the event leaves the statistics (outcome voided) but stays visible to the consultant. */
export function voidEvent<T extends RespEvent>(e: T): T {
  return { ...e, outcome: 'voided' };
}

export const LEVEL_ORDER: RespLevel[] = ['excellent', 'good', 'fair', 'needs_improvement', 'new'];

/** Ranking fit of a public level (matching criterion `responsiveness`). "New" is neutral so newcomers are not judged. */
export const LEVEL_FIT: Record<RespLevel, number> = { excellent: 1, good: 0.75, fair: 0.45, needs_improvement: 0.1, new: 0.6 };

export const isLevel = (v: unknown): v is RespLevel => typeof v === 'string' && (LEVEL_ORDER as string[]).includes(v);

/** Run safety for the edge function: repeat calls within 8 minutes of the previous run are ignored. */
export const RESP_RUN_GUARD_MS = 8 * 60_000;
export function respRunGuarded(lastRunAt: number | null, now: number): boolean {
  return lastRunAt != null && now - lastRunAt >= 0 && now - lastRunAt < RESP_RUN_GUARD_MS;
}
