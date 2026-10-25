// Support agreements (long-term commitments between one client organisation and a lead consultant, optionally a small
// team): the shared model used by the browser, the agreement-run worker and the unit tests. Pure functions only.
// The DATABASE decides (docs/sql/support-agreements.sql: sa_transition_allowed, sa_bank_month, sa_rate_ok, sa_sweep);
// this file mirrors the same rules so screens, e-mails and tests agree.
//
// Money: billing stays the platform's pricing v2 (approved timesheet hours x the agreed rate + portal fee + payment
// fee + VAT). An hours-bank (retainer) agreement only adds a month-end settlement for committed hours that expire
// unused (so the client pays max(committed, used) over time) plus an optional overage difference. Nothing here changes
// the pricing of ordinary tickets.

export const SA_STATUSES = ['draft', 'open', 'negotiating', 'agreed', 'active', 'suspended', 'renewal_due', 'expired', 'terminated', 'archived'] as const;
export type SaStatus = (typeof SA_STATUSES)[number];
export const SA_MODELS = ['payg', 'hours_bank', 'availability'] as const;
export type SaModel = (typeof SA_MODELS)[number];
export const ROLLOVER_MODES = ['none', 'hours', 'months'] as const;
export type RolloverMode = (typeof ROLLOVER_MODES)[number];
export const UNUSED_HANDLING = ['charge', 'forfeit'] as const;
export type UnusedHandling = (typeof UNUSED_HANDLING)[number];

/** Allowed status changes (same table as sa_transition_allowed in SQL). */
export const SA_TRANSITIONS: Record<SaStatus, SaStatus[]> = {
  draft: ['open', 'archived'],
  open: ['negotiating', 'draft', 'archived'],
  negotiating: ['agreed', 'open', 'archived'],
  agreed: ['active', 'terminated', 'archived'],
  active: ['suspended', 'renewal_due', 'terminated', 'expired'],
  suspended: ['active', 'terminated'],
  renewal_due: ['active', 'expired', 'terminated'],
  expired: ['archived'],
  terminated: ['archived'],
  archived: [],
};
export const canTransition = (from: SaStatus, to: SaStatus) => SA_TRANSITIONS[from]?.includes(to) ?? false;
/** Statuses in which tickets can be opened under the agreement. */
export const SA_LIVE: SaStatus[] = ['active', 'renewal_due'];

export interface SaSettings {
  enabled: boolean;
  needs_admin_review: boolean;
  draft_legal_flag: boolean;
  models_enabled: SaModel[];
  rate_min: number;
  rate_max: number;
  /** Per module caps, e.g. { FI: { min: 40, max: 250 } }. */
  rate_caps: Record<string, { min?: number; max?: number }>;
  /** null = the same portal (service) fee as every other invoice (today 10 %). */
  service_fee_percent: number | null;
  max_multiplier: number;
  renewal_reminder_days: number[];
  inactivity_weeks: number;
  min_term_months: number;
  max_notice_days: number;
  allow_prepayment: boolean;
  allow_forfeit: boolean;
  application_limit_per_day: number;
}

export const SA_DEFAULT_SETTINGS: SaSettings = {
  enabled: false,
  needs_admin_review: true,
  draft_legal_flag: true,
  models_enabled: ['payg', 'hours_bank', 'availability'],
  rate_min: 10,
  rate_max: 1000,
  rate_caps: {},
  service_fee_percent: null,
  max_multiplier: 2,
  renewal_reminder_days: [60, 30, 7],
  inactivity_weeks: 6,
  min_term_months: 1,
  max_notice_days: 90,
  allow_prepayment: false,
  allow_forfeit: false,
  application_limit_per_day: 10,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function normalizeSaSettings(raw: unknown): SaSettings {
  const s = isObj(raw) ? raw : {};
  const d = SA_DEFAULT_SETTINGS;
  const models = Array.isArray(s.models_enabled) ? s.models_enabled.filter((m): m is SaModel => (SA_MODELS as readonly string[]).includes(String(m))) : d.models_enabled;
  const caps: SaSettings['rate_caps'] = {};
  if (isObj(s.rate_caps)) for (const [k, v] of Object.entries(s.rate_caps)) if (isObj(v)) caps[k] = { min: v.min == null ? undefined : num(v.min, 0, 0), max: v.max == null ? undefined : num(v.max, 0, 0) };
  return {
    enabled: s.enabled === true,
    needs_admin_review: s.needs_admin_review !== false,
    draft_legal_flag: s.draft_legal_flag !== false,
    models_enabled: models.length ? models : d.models_enabled,
    rate_min: num(s.rate_min, d.rate_min, 1, 100000),
    rate_max: num(s.rate_max, d.rate_max, 1, 100000),
    rate_caps: caps,
    service_fee_percent: s.service_fee_percent === null || s.service_fee_percent === undefined || s.service_fee_percent === '' ? null : num(s.service_fee_percent, 10, 0, 50),
    max_multiplier: num(s.max_multiplier, d.max_multiplier, 1, 5),
    renewal_reminder_days: Array.isArray(s.renewal_reminder_days) ? s.renewal_reminder_days.map(Number).filter((x) => Number.isInteger(x) && x > 0 && x <= 365).sort((a, b) => b - a) : d.renewal_reminder_days,
    inactivity_weeks: num(s.inactivity_weeks, d.inactivity_weeks, 1, 52),
    min_term_months: num(s.min_term_months, d.min_term_months, 0, 60),
    max_notice_days: num(s.max_notice_days, d.max_notice_days, 0, 365),
    allow_prepayment: s.allow_prepayment === true,
    allow_forfeit: s.allow_forfeit === true,
    application_limit_per_day: num(s.application_limit_per_day, d.application_limit_per_day, 1, 100),
  };
}

// ------------------------------------------------------------------------------------------------ rates
export type RateProblem = 'rate_low' | 'rate_high' | 'multiplier' | 'overage_low';

/** Bounds: global min/max, narrowed by the strictest module cap of the agreement's modules. */
export function rateBounds(s: Pick<SaSettings, 'rate_min' | 'rate_max' | 'rate_caps'>, modules: string[]) {
  let min = s.rate_min, max = s.rate_max;
  for (const m of modules) {
    const c = s.rate_caps[m];
    if (c?.min != null) min = Math.max(min, c.min);
    if (c?.max != null) max = Math.min(max, c.max);
  }
  return { min, max };
}

export function rateProblems(r: { hourly_rate: number; s1_multiplier?: number | null; ooh_multiplier?: number | null; overage_rate?: number | null },
  s: Pick<SaSettings, 'rate_min' | 'rate_max' | 'rate_caps' | 'max_multiplier'>, modules: string[]): RateProblem[] {
  const out: RateProblem[] = [];
  const b = rateBounds(s, modules);
  if (!(r.hourly_rate >= b.min)) out.push('rate_low');
  if (!(r.hourly_rate <= b.max)) out.push('rate_high');
  for (const m of [r.s1_multiplier, r.ooh_multiplier]) if (m != null && (m < 1 || m > s.max_multiplier)) { out.push('multiplier'); break; }
  if (r.overage_rate != null && r.overage_rate < r.hourly_rate) out.push('overage_low');
  return out;
}

/** Hourly rate billed on one agreement ticket: agreed rate, x the S1 multiplier for critical tickets when agreed. */
export function ticketRate(rate: { hourly_rate: number; s1_multiplier?: number | null }, critical: boolean) {
  const m = critical && rate.s1_multiplier ? rate.s1_multiplier : 1;
  return Math.round(rate.hourly_rate * m * 100) / 100;
}

/** A rate change is never retroactive: it takes effect on a future day (tomorrow at the earliest). */
export function rateChangeEffectiveOk(effectiveDate: string, today: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && effectiveDate > today;
}

// ------------------------------------------------------------------------------------------------ hours bank
export interface Bucket { month: string; hours: number }
export interface BankTerms { hours_per_month: number; rollover: RolloverMode; rollover_hours: number; rollover_months: number; unused: UnusedHandling; overage_rate: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100;
const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};

/**
 * One month of an hours bank. `carried` = unused committed hours from earlier months (oldest first). Usage consumes
 * the oldest hours first. At month end:
 *   none   -> every unused hour expires;
 *   hours  -> up to `rollover_hours` unused hours of THIS month move to next month (carried hours from earlier expire);
 *   months -> each month's unused hours stay `rollover_months` months, then expire.
 * Expired hours are invoiced (unused = 'charge': the client pays what was committed) or dropped ('forfeit').
 * Overage = hours above everything available; they are billed by the normal timesheets at the agreed rate, plus the
 * difference to the overage rate when one is set. Mirrors sa_bank_month in SQL.
 */
export function bankMonth(month: string, carried: Bucket[], used: number, t: BankTerms) {
  const buckets = [...carried.filter((b) => b.hours > 0).map((b) => ({ ...b })), { month, hours: t.hours_per_month }].sort((a, b) => a.month.localeCompare(b.month));
  let left = Math.max(0, used);
  for (const b of buckets) {
    const take = Math.min(b.hours, left);
    b.hours = r2(b.hours - take);
    left = r2(left - take);
  }
  const overage = left;
  const next: Bucket[] = [];
  let expired = 0;
  for (const b of buckets) {
    if (b.hours <= 0) continue;
    let keep = 0;
    if (t.rollover === 'hours') keep = b.month === month ? Math.min(b.hours, Math.max(0, t.rollover_hours)) : 0;
    else if (t.rollover === 'months') keep = monthsBetween(b.month, month) + 1 <= Math.max(0, t.rollover_months) ? b.hours : 0;
    if (keep > 0) next.push({ month: b.month, hours: r2(keep) });
    expired = r2(expired + b.hours - keep);
  }
  const chargeHours = t.unused === 'charge' ? expired : 0;
  return { carried_out: next, expired_hours: expired, charge_hours: chargeHours, overage_hours: overage, available: r2(buckets.reduce((n, b) => n, 0) + carried.reduce((n, b) => n + b.hours, 0) + t.hours_per_month) };
}

/** Settlement amount (before fees/VAT) for a bank month: expired committed hours + overage rate difference. */
export function settlementBase(m: { charge_hours: number; overage_hours: number }, rate: number, overageRate: number | null) {
  const diff = overageRate != null && overageRate > rate ? overageRate - rate : 0;
  return r2(m.charge_hours * rate + m.overage_hours * diff);
}

// ------------------------------------------------------------------------------------------------ fees (pricing v2)
/** pricing v2 rounding: each part to cents in order (same order as pricing_breakdown). */
export function feeExample(base: number, servicePct: number, processingPct = 5, vatPct = 15) {
  const c = (n: number) => Math.round(n * 100) / 100;
  const b = c(base), sf = c((b * servicePct) / 100), pf = c((b * processingPct) / 100), sub = c(b + sf + pf), vat = c((sub * vatPct) / 100);
  return { base: b, service_fee: sf, processing_fee: pf, subtotal: sub, vat, total: c(sub + vat) };
}

// ------------------------------------------------------------------------------------------------ dates
const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};
export const addMonths = (iso: string, m: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  const day = x.getUTCDate();
  x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x.toISOString().slice(0, 10);
};

/** Renewal reminder days that are due today ("60, 30, 7 days before the end"). */
export function renewalRemindersDue(endDate: string | null, today: string, days: number[]) {
  if (!endDate) return [];
  return days.filter((d) => addDays(endDate, -d) === today);
}

/** Last working day of a termination: notice runs from the request day; never before today, never after the term end. */
export function terminationEnd(requested: string, noticeDays: number, endDate: string | null) {
  const n = addDays(requested, Math.max(0, noticeDays));
  return endDate && endDate < n ? endDate : n;
}

/** Bypass alert: an active agreement without ticket or timesheet activity for N weeks. */
export function inactive(lastActivity: string | null, startedAt: string, today: string, weeks: number) {
  const from = lastActivity && lastActivity > startedAt ? lastActivity : startedAt;
  return addDays(from, weeks * 7) <= today;
}

/** Status after the daily check (mirrors sa_sweep): renewal window, auto-renew, expiry. */
export function dailyStatus(a: { status: SaStatus; end_date: string | null; auto_renew: boolean; renew_months: number; termination_end: string | null }, today: string, firstReminderDays: number) {
  if (a.termination_end && today > a.termination_end && ['active', 'suspended', 'renewal_due'].includes(a.status)) return { status: 'terminated' as SaStatus, end_date: a.end_date };
  if (!a.end_date || !['active', 'renewal_due'].includes(a.status)) return { status: a.status, end_date: a.end_date };
  if (today > a.end_date) {
    if (a.auto_renew && a.renew_months > 0) return { status: 'active' as SaStatus, end_date: addMonths(a.end_date, a.renew_months), renewed: true };
    return { status: 'expired' as SaStatus, end_date: a.end_date };
  }
  if (a.status === 'active' && addDays(a.end_date, -firstReminderDays) <= today) return { status: 'renewal_due' as SaStatus, end_date: a.end_date };
  return { status: a.status, end_date: a.end_date };
}

// ------------------------------------------------------------------------------------------------ terms + hash
export interface SaTerms {
  name: string;
  scope: { modules: string[]; versions: string[]; systems: string[]; covered: string; not_covered: string };
  term: { start_date: string; end_date: string | null; notice_days: number; auto_renew: boolean; renew_months: number };
  model: SaModel;
  bank: BankTerms | null;
  capacity_hours_per_week: number | null;
  rate: { hourly_rate: number; currency: string; s1_multiplier: number | null; ooh_multiplier: number | null; overage_rate: number | null };
  sla: { policy_id: string | null; version: number | null; summary: string };
  reporting: 'weekly' | 'monthly';
  language: string;
  timezone: string | null;
  nda_required: boolean;
  team: Array<{ consultant_id: string; role: 'lead' | 'support' }>;
}

/** Canonical JSON (sorted keys) so both parties accept the same bytes; the database stores md5 of the same text. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function termsProblems(t: SaTerms, s: SaSettings, today: string): string[] {
  const out: string[] = [];
  if (!t.name.trim() || t.name.length > 120) out.push('name');
  if (!t.scope.modules.length) out.push('modules');
  if (!s.models_enabled.includes(t.model)) out.push('model_disabled');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.term.start_date) || t.term.start_date < today) out.push('start_past');
  if (t.term.end_date) {
    if (t.term.end_date <= t.term.start_date) out.push('end_before_start');
    else if (s.min_term_months > 0 && t.term.end_date < addMonths(t.term.start_date, s.min_term_months)) out.push('term_short');
  }
  if (t.term.notice_days < 0 || t.term.notice_days > s.max_notice_days) out.push('notice');
  if (t.model === 'hours_bank') {
    const b = t.bank;
    if (!b || !(b.hours_per_month > 0) || b.hours_per_month > 744) out.push('bank_hours');
    if (b && b.unused === 'forfeit' && !s.allow_forfeit) out.push('forfeit_disabled');
  }
  if (t.model === 'availability' && !(Number(t.capacity_hours_per_week) > 0 && Number(t.capacity_hours_per_week) <= 60)) out.push('capacity');
  out.push(...rateProblems(t.rate, s, t.scope.modules));
  if (!/^[A-Z]{3}$/.test(t.rate.currency)) out.push('currency');
  return out;
}

/** Share of a consultant's week reserved by availability commitments (for matching). */
export const reservedShare = (reservedHours: number, weekHours = 40) => Math.max(0, Math.min(1, reservedHours / Math.max(1, weekHours)));
