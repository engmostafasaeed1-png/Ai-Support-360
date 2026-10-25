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
  /** Crew size (lead included), company contacts per list, document size and count limits. */
  crew_max: number;
  contacts_max: number;
  doc_max_mb: number;
  docs_per_agreement: number;
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
  crew_max: 6,
  contacts_max: 5,
  doc_max_mb: 20,
  docs_per_agreement: 50,
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
    crew_max: num(s.crew_max, d.crew_max, 1, 20),
    contacts_max: num(s.contacts_max, d.contacts_max, 1, 20),
    doc_max_mb: num(s.doc_max_mb, d.doc_max_mb, 1, 100),
    docs_per_agreement: num(s.docs_per_agreement, d.docs_per_agreement, 1, 500),
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
  return { carried_out: next, expired_hours: expired, charge_hours: chargeHours, overage_hours: overage, available: r2(carried.reduce((n, b) => n + Math.max(0, b.hours), 0) + t.hours_per_month) };
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

// ------------------------------------------------------------------------------------------------ crew
export const CREW_ROLES = ['lead', 'functional', 'technical', 'basis', 'backup', 'support'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];
export interface WorkingHours { timezone?: string; days?: number[]; from?: string; to?: string }
export interface CrewEntry {
  consultant_id: string;
  role: CrewRole;
  capacity_hours_per_week?: number | null;
  working_hours?: WorkingHours;
  backup_for?: string | null;
  required?: boolean;
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Crew rules the browser can check (mirror of sa_crew_problems; verification and client blocks are server-only). */
export function crewProblems(team: CrewEntry[], lead: string | null, s: Pick<SaSettings, 'crew_max'>): string[] {
  const out = new Set<string>();
  if (team.length > s.crew_max) out.add('crew_size');
  const ids = new Set<string>();
  for (const e of team) {
    if (!e.consultant_id) { out.add('crew_member'); continue; }
    if (ids.has(e.consultant_id)) out.add('crew_duplicate');
    ids.add(e.consultant_id);
    if (!(CREW_ROLES as readonly string[]).includes(e.role) || (e.role === 'lead') !== (!!lead && e.consultant_id === lead)) out.add('crew_role');
    if (e.capacity_hours_per_week != null && !(e.capacity_hours_per_week >= 0 && e.capacity_hours_per_week <= 60)) out.add('crew_capacity');
    const w = e.working_hours ?? {};
    if ((w.timezone?.length ?? 0) > 64 || (w.from !== undefined && !HHMM.test(w.from)) || (w.to !== undefined && !HHMM.test(w.to))
      || (w.days !== undefined && !w.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7))) out.add('crew_hours');
  }
  for (const e of team) {
    if (!e.backup_for) continue;
    if (e.backup_for === e.consultant_id || !(ids.has(e.backup_for) || e.backup_for === lead)) out.add('crew_backup');
  }
  return [...out];
}

export interface CrewMemberState {
  consultant_id: string; role: CrewRole | string; required: boolean; status: 'invited' | 'active' | 'declined' | 'ended' | string;
  sla_accepted_at?: string | null; nda_ok?: boolean | null;
}

/**
 * Team confirmation (mirror of sa_confirmation): nobody works under the agreement until the terms are accepted, the
 * lead and every REQUIRED member accepted the place + SLA, the NDA is signed by both sides for each working member
 * (when required), the admin review is done and the start date has come.
 */
export function confirmationState(a: { agreed: boolean; nda_required: boolean; admin_review: string; start_date: string | null; members: CrewMemberState[] }, today: string) {
  const lead = a.members.find((m) => m.role === 'lead');
  const crew = !!lead && lead.status === 'active' && !!lead.sla_accepted_at
    && !a.members.some((m) => m.required && (m.status === 'invited' || m.status === 'declined' || (m.status === 'active' && !m.sla_accepted_at)));
  const nda = !a.nda_required || !a.members.some((m) => m.status === 'active' && (m.required || m.role === 'lead') && !m.nda_ok);
  const review = a.admin_review === 'not_needed' || a.admin_review === 'approved';
  const start = !!a.start_date && a.start_date <= today;
  return { ready: a.agreed && crew && nda && review && start, items: { terms: a.agreed, crew, nda, admin_review: review, start_date: start } };
}

// ------------------------------------------------------------------------------------------------ contacts, secrets, documents
export interface EscalationContact { email: string; level: 1 | 2 | 3; title?: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Count / format / level checks; "inside the company only" is checked by the database (sa_contact_problems). */
export function contactProblems(t: Pick<SaTerms, 'statement_recipients' | 'escalation_contacts'>, s: Pick<SaSettings, 'contacts_max'>): string[] {
  const out = new Set<string>();
  const rec = t.statement_recipients ?? [];
  if (rec.length > s.contacts_max) out.add('recipients_max');
  if (rec.some((e) => !EMAIL.test(e))) out.add('recipient_outside');
  const esc = t.escalation_contacts ?? [];
  if (esc.length > s.contacts_max) out.add('escalation_max');
  for (const e of esc) {
    if (!EMAIL.test(e.email)) out.add('escalation_outside');
    if (![1, 2, 3].includes(Number(e.level))) out.add('escalation_level');
    if ((e.title ?? '').length > 80) out.add('escalation_title');
  }
  return [...out];
}

/** No passwords or access secrets in texts ("password: ...", "api key = ...", private keys). Mirror of sa_secret_ok. */
export function secretOk(text: string | null | undefined): boolean {
  if (!text) return true;
  if (/(^|[^\p{L}\p{N}_])(pass(word|wort|wd)?|pwd|kennwort|secret|api[ _-]?key|access[ _-]?key|token|client[ _-]?secret)\s*[:=]/iu.test(text)) return false;
  if (/كلمة\s*(المرور|السر)\s*[:=]/u.test(text)) return false;
  return !/-----BEGIN [A-Z ]*PRIVATE KEY/.test(text);
}

export const DOC_KINDS = ['sow', 'scope_annex', 'access_plan', 'escalation_matrix', 'other'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};
/** Allow-list: extension and type must belong together (mirror of sa_doc_type_ok). */
export function docTypeOk(fileName: string, mime: string): boolean {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  return !!DOC_TYPES[ext] && DOC_TYPES[ext] === (mime ?? '').toLowerCase();
}
export const docSizeOk = (bytes: number, s: Pick<SaSettings, 'doc_max_mb'>) => bytes > 0 && bytes <= s.doc_max_mb * 1048576;

/** "SA-2026-000012" */
export const REFERENCE_RE = /^SA-\d{4}-\d{6}$/;
export const agreementLabel = (a: { name: string; reference?: string | null }) => (a.reference ? `${a.name} (${a.reference})` : a.name);

// ------------------------------------------------------------------------------------------------ terms + hash
export interface SaSla {
  policy_id: string | null;
  version: number | null;
  summary: string;
  /** Filled by the database: policy name, 'platform' | 'template' | 'client', version hash and the version body. */
  name?: string | null;
  source?: string;
  hash?: string | null;
  body?: unknown;
}

export interface SaTerms {
  name: string;
  reference?: string;
  scope: { modules: string[]; versions: string[]; systems: string[]; covered: string; not_covered: string };
  term: { start_date: string; end_date: string | null; notice_days: number; auto_renew: boolean; renew_months: number };
  model: SaModel;
  bank: BankTerms | null;
  capacity_hours_per_week: number | null;
  rate: { hourly_rate: number; currency: string; s1_multiplier: number | null; ooh_multiplier: number | null; overage_rate: number | null };
  sla: SaSla;
  reporting: 'weekly' | 'monthly';
  /** Monthly statement e-mails to people inside the client company only. */
  statement_email?: boolean;
  statement_recipients?: string[];
  escalation_contacts?: EscalationContact[];
  language: string;
  timezone: string | null;
  nda_required: boolean;
  team: CrewEntry[];
}

/** Canonical JSON (sorted keys) so both parties accept the same bytes; the database stores md5 of the same text. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export type ChecklistState = 'done' | 'todo' | 'optional' | 'error';
export const SETTINGS_SECTIONS = ['basics', 'term', 'rates', 'commitment', 'sla', 'crew', 'reporting', 'escalation', 'documents', 'review'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
const SECTION_OF: Record<string, SettingsSection> = {
  name: 'basics', modules: 'basics', start_past: 'term', end_before_start: 'term', term_short: 'term', notice: 'term',
  model_disabled: 'commitment', bank_hours: 'commitment', forfeit_disabled: 'commitment', prepay_disabled: 'commitment', capacity: 'commitment',
  rate_low: 'rates', rate_high: 'rates', multiplier: 'rates', overage_low: 'rates', currency: 'rates',
  crew_size: 'crew', crew_member: 'crew', crew_duplicate: 'crew', crew_role: 'crew', crew_capacity: 'crew', crew_hours: 'crew', crew_backup: 'crew', crew_blocked: 'crew',
  recipients_max: 'reporting', recipient_outside: 'reporting', escalation_max: 'escalation', escalation_outside: 'escalation', escalation_level: 'escalation', escalation_title: 'escalation',
  sla_invalid: 'sla', name_taken: 'basics',
};
export const sectionOfProblem = (p: string): SettingsSection => SECTION_OF[p] ?? 'review';

/**
 * Progress checklist of the "Agreement settings" form. Rates are optional before applications arrive (applicants
 * propose them), crew/escalation/documents are optional. The draft can be saved at any time; publishing needs no errors.
 */
export function draftChecklist(t: SaTerms, s: SaSettings, today: string, extra: string[] = []) {
  const probs = [...termsProblems({ ...t, rate: { ...t.rate, hourly_rate: t.rate.hourly_rate > 0 ? t.rate.hourly_rate : s.rate_min } }, s, today),
    ...crewProblems(t.team ?? [], null, s), ...contactProblems(t, s), ...extra];
  const by = new Map<SettingsSection, string[]>();
  for (const p of probs) by.set(sectionOfProblem(p), [...(by.get(sectionOfProblem(p)) ?? []), p]);
  const state = (k: SettingsSection, filled: boolean, optional = false): ChecklistState =>
    by.get(k)?.length ? 'error' : filled ? 'done' : optional ? 'optional' : 'todo';
  const sections: Record<SettingsSection, ChecklistState> = {
    basics: state('basics', !!t.name.trim() && t.scope.modules.length > 0),
    term: state('term', !!t.term.start_date),
    rates: state('rates', t.rate.hourly_rate > 0, true),
    commitment: state('commitment', !!t.model),
    sla: state('sla', true),
    crew: state('crew', (t.team ?? []).length > 0, true),
    reporting: state('reporting', !!t.reporting),
    escalation: state('escalation', (t.escalation_contacts ?? []).length > 0, true),
    documents: 'optional',
    review: 'todo',
  };
  const blocking = probs.filter((p) => !['rate_low', 'rate_high', 'overage_low', 'currency'].includes(p) || t.rate.hourly_rate > 0);
  sections.review = blocking.length ? 'error' : 'done';
  const required = SETTINGS_SECTIONS.filter((k) => !['rates', 'crew', 'escalation', 'documents'].includes(k));
  const done = required.filter((k) => sections[k] === 'done').length;
  return { sections, problems: [...new Set(blocking)], percent: Math.round((done / required.length) * 100), canPublish: blocking.length === 0 };
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
