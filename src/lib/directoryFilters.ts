// Consultant directory filters: one typed state, kept in the URL query string (shareable), applied to the loaded list,
// with counts per option and a "best match" ranking that reuses the deterministic ticket matcher.
import type { RespLevel } from '../../supabase/functions/_shared/responsiveness';
import type { ConsultantLive, WeeklySlot } from './consultantDirectory';
import { STATE_META } from './mapMarkers';
import { compareSuccessLevel, compareSuccessRate, meetsSuccessLevel, meetsSuccessRate, type SuccessLevel, type SuccessView } from './successLevel';
import {
  MODULES, MODULE_BY_CODE, modulesIn, subModulesIn, scoreConsultant, extractTicketSignals, tzOffsetHours, langCode,
  type Chip, type MatchConsultant, type MatchTicket,
} from '../../supabase/functions/_shared/ticketMatch';

export type SortKey = 'best_match' | 'rating' | 'responsiveness' | 'success_level' | 'success_rate' | 'rate_low' | 'rate_high' | 'experience' | 'availability' | 'credly_first';
/** Minimum Success level (Feature W); ignored while the success display is off. */
export type SuccessFilter = '' | SuccessLevel;
/** Minimum public responsiveness level (Feature W); ignored while responsiveness is private. */
export type RespFilter = '' | 'excellent' | 'good' | 'fair';
export type AvailFilter = 'any' | 'now' | 'week' | 'slot';
export type StatusFilter = 'all' | 'online' | 'busy' | 'offline';
export type TierFilter = '' | 'gold' | 'silver' | 'bronze' | 'verified';
export type Bounds = [south: number, west: number, north: number, east: number];

export interface DirectoryFilters {
  q: string;
  family: string;
  module: string;
  sub: string;
  role: string;
  skill: string;
  cert: string;
  years: number;
  industry: string;
  segment: string;
  country: string;
  vertical: string;
  deployment: string;
  workMode: string;
  lang: string;
  rateMin: number;
  rateMax: number;
  avail: AvailFilter;
  /** 0 = Sunday ... 6 = Saturday, with slotTime "HH:MM" in the viewer's time zone. */
  slotDay: number | null;
  slotTime: string;
  /** '' any, 'near' = within 2 hours of the viewer, or an IANA zone (within 2 hours of it). */
  tz: string;
  tier: TierFilter;
  rating: number;
  verified: boolean;
  founding: boolean;
  credly: boolean;
  completion: number;
  /** Maximum response time in minutes (0 = any). */
  response: number;
  status: StatusFilter;
  resp: RespFilter;
  success: SuccessFilter;
  /** Minimum shown success rate in % (0 = any); only consultants with a Success level qualify. */
  successRate: number;
  sort: SortKey;
  view: 'list' | 'map';
  bbox: Bounds | null;
}

export const RATE_MAX = 500;

export const DEFAULT_FILTERS: DirectoryFilters = {
  q: '', family: '', module: '', sub: '', role: '', skill: '', cert: '', years: 0, industry: '', segment: '', country: '', vertical: '',
  deployment: '', workMode: '', lang: '', rateMin: 0, rateMax: RATE_MAX, avail: 'any', slotDay: null, slotTime: '', tz: '', tier: '',
  rating: 0, verified: false, founding: false, credly: false, completion: 0, response: 0, status: 'all', resp: '', success: '', successRate: 0, sort: 'best_match', view: 'list', bbox: null,
};

/** URL names (short and stable; `industry` keeps working for older links). */
const PARAM: Record<keyof DirectoryFilters, string> = {
  q: 'q', family: 'area', module: 'module', sub: 'sub', role: 'role', skill: 'skill', cert: 'cert', years: 'years', industry: 'industry',
  segment: 'segment', country: 'country', vertical: 'vertical', deployment: 'deploy', workMode: 'mode', lang: 'lang', rateMin: 'rate_min',
  rateMax: 'rate_max', avail: 'avail', slotDay: 'day', slotTime: 'time', tz: 'tz', tier: 'tier', rating: 'rating', verified: 'verified',
  founding: 'founding', credly: 'credly', completion: 'completion', response: 'response', status: 'status', resp: 'resp', success: 'success', successRate: 'success_rate', sort: 'sort', view: 'view', bbox: 'bbox',
};

const TEXT_MAX = 120;
const text = (v: string | null) => (v ?? '').trim().slice(0, TEXT_MAX);
const num = (v: string | null, min: number, max: number, fallback: number) => {
  if (v === null || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = <T extends string>(v: string | null, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

export function parseFilters(params: URLSearchParams): DirectoryFilters {
  const g = (k: keyof DirectoryFilters) => params.get(PARAM[k]);
  const bbox = (g('bbox') ?? '').split(',').map(Number);
  const validBox = bbox.length === 4 && bbox.every(Number.isFinite) && bbox[0] < bbox[2] && Math.abs(bbox[0]) <= 90 && Math.abs(bbox[2]) <= 90;
  const day = g('slotDay');
  const time = text(g('slotTime'));
  const rateMin = num(g('rateMin'), 0, RATE_MAX, 0);
  return {
    q: text(g('q')), family: text(g('family')), module: text(g('module')), sub: text(g('sub')), role: text(g('role')), skill: text(g('skill')),
    cert: text(g('cert')), years: num(g('years'), 0, 40, 0), industry: text(g('industry')), segment: text(g('segment')), country: text(g('country')),
    vertical: text(g('vertical')), deployment: text(g('deployment')), workMode: text(g('workMode')), lang: text(g('lang')),
    rateMin, rateMax: Math.max(rateMin, num(g('rateMax'), 0, RATE_MAX, RATE_MAX)),
    avail: oneOf(g('avail'), ['any', 'now', 'week', 'slot'] as const, 'any'),
    slotDay: day !== null && /^[0-6]$/.test(day) ? Number(day) : null,
    slotTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '',
    tz: text(g('tz')), tier: oneOf(g('tier'), ['', 'gold', 'silver', 'bronze', 'verified'] as const, ''),
    rating: num(g('rating'), 0, 5, 0), verified: g('verified') === '1', founding: g('founding') === '1', credly: g('credly') === '1',
    completion: num(g('completion'), 0, 100, 0), response: num(g('response'), 0, 10080, 0),
    status: oneOf(g('status'), ['all', 'online', 'busy', 'offline'] as const, 'all'),
    resp: oneOf(g('resp'), ['', 'excellent', 'good', 'fair'] as const, ''),
    success: oneOf(g('success'), ['', 'bronze', 'silver', 'gold', 'platinum'] as const, ''),
    successRate: num(g('successRate'), 0, 100, 0),
    sort: oneOf(g('sort'), ['best_match', 'rating', 'responsiveness', 'success_level', 'success_rate', 'rate_low', 'rate_high', 'experience', 'availability', 'credly_first'] as const, 'best_match'),
    view: oneOf(g('view'), ['list', 'map'] as const, 'list'),
    bbox: validBox ? (bbox.map((n) => Math.round(n * 1000) / 1000) as Bounds) : null,
  };
}

/** Only values that differ from the defaults go in the URL, in a fixed order. */
export function serializeFilters(f: DirectoryFilters): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of Object.keys(PARAM) as Array<keyof DirectoryFilters>) {
    const v = f[key];
    const d = DEFAULT_FILTERS[key];
    if (key === 'bbox') { if (f.bbox) out.set(PARAM.bbox, f.bbox.map((n) => Math.round(n * 1000) / 1000).join(',')); continue; }
    if (v === d || v === null || v === '') continue;
    out.set(PARAM[key], typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return out;
}

/** Number of narrowing filters (not the sort, the view or the text search). */
export function countActive(f: DirectoryFilters): number {
  const skip = new Set<keyof DirectoryFilters>(['sort', 'view', 'q', 'slotDay', 'slotTime', 'rateMax']);
  let n = 0;
  for (const key of Object.keys(DEFAULT_FILTERS) as Array<keyof DirectoryFilters>) {
    if (skip.has(key)) continue;
    if (key === 'rateMin') { if (f.rateMin > 0 || f.rateMax < RATE_MAX) n++; continue; }
    if (key === 'bbox') { if (f.bbox) n++; continue; }
    if (f[key] !== DEFAULT_FILTERS[key]) n++;
  }
  return n;
}

// ---------------------------------------------------------------- predicates

export type DirectoryContext = {
  founding: ReadonlySet<string>; viewerOffset: number | null; now?: Date;
  /** Public responsiveness levels; null/absent while the owner keeps responsiveness private (the filter then does nothing). */
  respLevels?: ReadonlyMap<string, RespLevel> | null;
  /** Public success views; null/absent while the success display is off (the success filters then do nothing). */
  success?: ReadonlyMap<string, SuccessView> | null;
};
const RESP_RANK: Record<string, number> = { excellent: 3, good: 2, fair: 1 };

const lc = (s: string) => s.toLowerCase();
const codesOf = (c: ConsultantLive) => new Set([...(c.skills ?? [c.specialty]), ...(c.technologies ?? [])].flatMap(modulesIn));
const subsOf = (c: ConsultantLive) => new Set([...(c.skills ?? []), ...(c.technologies ?? [])].flatMap(subModulesIn));
const TIER_RANK: Record<string, number> = { gold: 4, silver: 3, bronze: 2, verified: 1 };

/** True when a weekly slot (consultant's local time) covers the viewer's chosen day and time. */
export function slotCovers(slots: WeeklySlot[] | undefined, consultantTz: string | null | undefined, day: number, time: string, viewerOffset: number | null): boolean {
  if (!slots?.length || !/^\d\d:\d\d$/.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  const cOff = tzOffsetHours(consultantTz);
  const shift = cOff !== null && viewerOffset !== null ? (cOff - viewerOffset) * 60 : 0;
  let minute = day * 1440 + h * 60 + m + shift;
  minute = ((minute % 10080) + 10080) % 10080;
  const d = Math.floor(minute / 1440);
  const hhmm = `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return slots.some((s) => s.day_of_week === d && s.start_time.slice(0, 5) <= hhmm && hhmm < s.end_time.slice(0, 5));
}

type Pred = (c: ConsultantLive, f: DirectoryFilters, x: DirectoryContext) => boolean;

/** One predicate per filter; the facet counts use every predicate except the one being counted. */
export const PREDICATES: Partial<Record<keyof DirectoryFilters, Pred>> = {
  q: (c, f) => {
    const q = lc(f.q);
    if (!q) return true;
    const hay = [c.name, c.place, ...(c.skills ?? [c.specialty]), ...(c.technologies ?? []), ...(c.certifications ?? []), ...(c.industries ?? [])].map(lc).join(' | ');
    if (hay.includes(q)) return true;
    const wanted = modulesIn(f.q);
    return wanted.length > 0 && wanted.some((w) => codesOf(c).has(w));
  },
  family: (c, f) => !f.family || [...codesOf(c)].some((code) => MODULE_BY_CODE.get(code)?.family === f.family),
  module: (c, f) => {
    if (!f.module) return true;
    const wanted = MODULE_BY_CODE.has(f.module) ? [f.module] : modulesIn(f.module);
    if (wanted.length === 0) return (c.skills ?? []).some((s) => lc(s) === lc(f.module));
    const have = codesOf(c);
    return wanted.some((w) => have.has(w));
  },
  sub: (c, f) => !f.sub || subsOf(c).has(f.sub),
  role: (c, f) => !f.role || (c.sap_roles ?? []).includes(f.role),
  skill: (c, f) => !f.skill || [...(c.skills ?? []), ...(c.technologies ?? [])].some((s) => lc(s) === lc(f.skill)),
  cert: (c, f) => !f.cert || (c.certifications ?? []).some((n) => lc(n).includes(lc(f.cert))),
  years: (c, f) => !f.years || (c.total_sap_years ?? 0) >= f.years,
  industry: (c, f) => !f.industry || (c.industries ?? []).includes(f.industry),
  segment: (c, f) => !f.segment || (c.customer_segments ?? []).includes(f.segment),
  country: (c, f) => !f.country || (c.localization_countries ?? []).includes(f.country) || lc(c.country) === lc(f.country),
  vertical: (c, f) => !f.vertical || (c.vertical_solutions ?? []).includes(f.vertical),
  deployment: (c, f) => !f.deployment || (c.deployment_experience ?? []).includes(f.deployment),
  workMode: (c, f) => !f.workMode || (c.work_modes ?? []).includes(f.workMode),
  lang: (c, f) => !f.lang || (c.languages ?? []).map(langCode).includes(langCode(f.lang)),
  rateMin: (c, f) => c.rate >= f.rateMin && (f.rateMax >= RATE_MAX || c.rate <= f.rateMax),
  avail: (c, f, x) => {
    if (f.avail === 'any') return true;
    if (f.avail === 'now') return c.status === 'available';
    if (f.avail === 'week') return c.status === 'available' || (c.slots?.length ?? 0) > 0;
    return f.slotDay === null || !f.slotTime ? true : slotCovers(c.slots, c.timezone, f.slotDay, f.slotTime, x.viewerOffset);
  },
  tz: (c, f, x) => {
    if (!f.tz) return true;
    const ref = f.tz === 'near' ? x.viewerOffset : tzOffsetHours(f.tz);
    const mine = tzOffsetHours(c.timezone);
    return ref !== null && mine !== null && Math.abs(ref - mine) <= 2;
  },
  tier: (c, f) => !f.tier || (TIER_RANK[lc(c.ai_interview_badge ?? '')] ?? 0) >= TIER_RANK[f.tier],
  rating: (c, f) => c.rating >= f.rating,
  verified: (c, f) => !f.verified || c.verification_status === 'verified',
  founding: (c, f, x) => !f.founding || x.founding.has(c.id),
  credly: (c, f) => !f.credly || c.credlyVerified,
  completion: (c, f) => (c.completion_percent ?? 0) >= f.completion,
  response: (c, f) => !f.response || (c.response_time_minutes > 0 && c.response_time_minutes <= f.response),
  resp: (c, f, x) => !f.resp || !x.respLevels || (RESP_RANK[x.respLevels.get(c.id) ?? ''] ?? 0) >= RESP_RANK[f.resp],
  success: (c, f, x) => !f.success || !x.success || meetsSuccessLevel(x.success.get(c.id), f.success),
  successRate: (c, f, x) => !f.successRate || !x.success || meetsSuccessRate(x.success.get(c.id), f.successRate),
  status: (c, f) => f.status === 'all' || (f.status === 'online' ? c.status === 'available' : c.status === f.status),
  bbox: (c, f) => {
    if (!f.bbox) return true;
    if (c.lat === null || c.lng === null) return false;
    const [s, w, n, e] = f.bbox;
    return c.lat >= s && c.lat <= n && (w <= e ? c.lng >= w && c.lng <= e : c.lng >= w || c.lng <= e);
  },
};

export function passes(c: ConsultantLive, f: DirectoryFilters, x: DirectoryContext, except?: keyof DirectoryFilters): boolean {
  for (const [key, pred] of Object.entries(PREDICATES) as Array<[keyof DirectoryFilters, Pred]>) {
    if (key === except) continue;
    if (!pred(c, f, x)) return false;
  }
  return true;
}

/** For each option of one filter: how many consultants would match if that option were chosen (other filters stay as they are). */
export function facetCounts<K extends keyof DirectoryFilters>(list: ConsultantLive[], f: DirectoryFilters, key: K, options: Array<DirectoryFilters[K]>, x: DirectoryContext): Map<DirectoryFilters[K], number> {
  const base = list.filter((c) => passes(c, f, x, key));
  const pred = PREDICATES[key];
  const out = new Map<DirectoryFilters[K], number>();
  for (const o of options) {
    const g = { ...f, [key]: o } as DirectoryFilters;
    out.set(o, pred ? base.filter((c) => pred(c, g, x)).length : base.length);
  }
  return out;
}

// ---------------------------------------------------------------- best match

/** The filters and the text search read as a request, so "best match" ranks with the same rules as ticket matching. */
export function filtersAsTicket(f: DirectoryFilters): MatchTicket {
  const areas = [f.module && (MODULE_BY_CODE.get(f.module)?.label ?? f.module), f.sub].filter(Boolean) as string[];
  return {
    title: f.q || null,
    description: [f.q, f.skill, f.cert].filter(Boolean).join(' ') || null,
    sap_modules: areas.length ? areas : null,
    industry: f.industry || null, customer_segment: f.segment || null, country: f.country || null,
    vertical_solutions: f.vertical ? [f.vertical] : null, deployment: f.deployment || null, work_mode: f.workMode || null,
    budget_max_rate: f.rateMax < RATE_MAX ? f.rateMax : null,
  };
}

export function toMatchConsultant(c: ConsultantLive, founding: ReadonlySet<string>, levels?: ReadonlyMap<string, RespLevel> | null): MatchConsultant {
  return {
    ...(levels ? { responsiveness_level: levels.get(c.id) ?? 'new' } : {}),
    id: c.id, verification_status: c.verification_status, availability_status: c.status,
    skills: (c.skills ?? [c.specialty]).map((m) => ({ module: m, years: c.total_sap_years ?? null })),
    certifications: (c.certifications ?? []).map((name) => ({ name })),
    technologies: c.technologies, sap_roles: c.sap_roles, languages: c.languages, industries: c.industries, customer_segments: c.customer_segments,
    localization_countries: c.localization_countries, vertical_solutions: c.vertical_solutions, localization_solutions: c.localization_solutions,
    project_types: c.project_types, deployment_experience: c.deployment_experience, work_modes: c.work_modes, timezone: c.timezone ?? null,
    hourly_rate: c.rate, ai_interview_badge: c.ai_interview_badge ?? null, rating: c.rating, total_reviews: c.reviews,
    response_time_minutes: c.response_time_minutes, completion_percent: c.completion_percent ?? 0, founding: founding.has(c.id),
  };
}

export type DirectoryMatch = { score: number; chips: Chip[] };

/** Match % and why-chips per consultant; null when no filter or search gives the ranking something to match. */
export function directoryMatches(list: ConsultantLive[], f: DirectoryFilters, founding: ReadonlySet<string>, levels?: ReadonlyMap<string, RespLevel> | null): Map<string, DirectoryMatch> | null {
  const t = filtersAsTicket(f);
  if (!t.title && !t.sap_modules && !t.industry && !t.customer_segment && !t.country && !t.deployment && !t.work_mode && !t.budget_max_rate && !t.vertical_solutions) return null;
  const s = extractTicketSignals(t);
  const out = new Map<string, DirectoryMatch>();
  for (const c of list) {
    const r = scoreConsultant(toMatchConsultant(c, founding, levels), t, s);
    out.set(c.id, { score: r.score, chips: r.chips });
  }
  return out;
}

/** `respScores`: ring responsiveness score per consultant (lib/ringAvatar), only while responsiveness is public; New last. */
export function sortDirectory(list: ConsultantLive[], f: DirectoryFilters, matches: Map<string, DirectoryMatch> | null, tieBreak: (a: ConsultantLive, b: ConsultantLive) => number, respScores?: ReadonlyMap<string, number> | null, success?: ReadonlyMap<string, SuccessView> | null): ConsultantLive[] {
  const out = [...list];
  const byState = (a: ConsultantLive, b: ConsultantLive) => STATE_META[a.status].order - STATE_META[b.status].order;
  switch (f.sort) {
    case 'rating': return out.sort((a, b) => (b.reviews > 0 ? b.rating : -1) - (a.reviews > 0 ? a.rating : -1) || b.reviews - a.reviews || tieBreak(a, b));
    case 'responsiveness': return out.sort((a, b) => (respScores?.get(b.id) ?? -1) - (respScores?.get(a.id) ?? -1) || tieBreak(a, b));
    case 'success_level': return out.sort((a, b) => compareSuccessLevel(success?.get(a.id), success?.get(b.id)) || tieBreak(a, b));
    case 'success_rate': return out.sort((a, b) => compareSuccessRate(success?.get(a.id), success?.get(b.id)) || tieBreak(a, b));
    case 'rate_low': return out.sort((a, b) => a.rate - b.rate || tieBreak(a, b));
    case 'rate_high': return out.sort((a, b) => b.rate - a.rate || tieBreak(a, b));
    case 'experience': return out.sort((a, b) => (b.total_sap_years ?? 0) - (a.total_sap_years ?? 0) || tieBreak(a, b));
    case 'availability': return out.sort((a, b) => byState(a, b) || (b.slots?.length ?? 0) - (a.slots?.length ?? 0) || tieBreak(a, b));
    case 'credly_first': return out.sort((a, b) => Number(b.credlyVerified) - Number(a.credlyVerified) || tieBreak(a, b));
    default:
      return out.sort((a, b) => (matches ? (matches.get(b.id)?.score ?? 0) - (matches.get(a.id)?.score ?? 0) : 0) || tieBreak(a, b));
  }
}

/** Area (family) options for the filter, from the matcher's module list. */
export const FAMILY_OPTIONS: Array<{ value: string; label: [string, string] }> = [
  { value: 'finance', label: ['Finance', 'المالية'] },
  { value: 'logistics', label: ['Logistics & supply chain', 'الخدمات اللوجستية وسلسلة الإمداد'] },
  { value: 'procurement', label: ['Procurement', 'المشتريات'] },
  { value: 'hcm', label: ['HR / HCM', 'الموارد البشرية'] },
  { value: 'cx', label: ['Customer experience (CX)', 'تجربة العملاء'] },
  { value: 'analytics', label: ['Data & analytics', 'البيانات والتحليلات'] },
  { value: 'technology', label: ['Technology (ABAP, Basis, BTP...)', 'التقنية (ABAP وBasis وBTP...)'] },
  { value: 'erp', label: ['ERP platform (S/4HANA, ECC...)', 'منصة ERP (S/4HANA وECC...)'] },
];

export const MODULE_OPTIONS = MODULES.map((m) => ({ value: m.code, label: m.label, family: m.family }));
