// Two-layer ticket tracking (docs/sql/ticket-tracking.sql).
//
// 1. AUTOMATIC STAGE: read-only, derived here from the facts the database gathers (tt_facts: timestamps of bids,
//    acceptances, rate approvals, NDA signatures, engagement confirmations, work, resolution, closing). Users can not
//    edit it and the official tickets.status is never changed by it. On gated (team) tickets the next step comes from
//    the team-engagement function team_next_step, so this file adds no second engagement rule.
// 2. MANUAL "working status": a controlled list set by the client and the assigned / ready consultants (admin matrix).
//    The database decides who may set what (tt_set_working_status); the helpers below mirror the rules for display,
//    early validation and tests.
//
// Pure functions only (no React, no network).

import { contactDetailsInText } from '../../supabase/functions/_shared/assignmentInfo';

// ------------------------------------------------------------------ settings

export const TT_COLORS = ['muted', 'primary', 'accent', 'info', 'success', 'warning', 'destructive'] as const;
export type TtColor = typeof TT_COLORS[number];
export const TT_ICONS = ['circle', 'search', 'hourglass', 'user-clock', 'key', 'wrench', 'flask', 'eye', 'rotate', 'pause', 'check'] as const;
export type TtIcon = typeof TT_ICONS[number];

/** Who holds the ball while a working status is set. "other" = the party that did not set it. */
export type Court = 'client' | 'consultant' | 'both' | 'third_party' | 'none' | 'other';
export type Responsible = 'client' | 'consultant' | 'both' | 'third_party';
export const RESPONSIBLES: Responsible[] = ['client', 'consultant', 'both', 'third_party'];
export type ViewerRole = 'admin' | 'client' | 'consultant' | 'observer';
export type SetterRole = 'admin' | 'client' | 'consultant' | 'system';

export interface WorkingStatusDef {
  key: string;
  label_en: string;
  label_ar: string;
  color: TtColor;
  icon: TtIcon;
  order: number;
  enabled: boolean;
  court: Court;
}

export interface MatrixRule { client: boolean; consultant: boolean; note: boolean }

export interface TrackingSettings {
  enabled: boolean;
  statuses: WorkingStatusDef[];
  matrix: Record<string, MatrixRule>;
  note_max: number;
  rate_limit_per_hour: number;
  throttle_minutes: number;
  review_reminder_days: number;
  max_review_reminders: number;
  max_overdue_reminders: number;
  stuck_days: number;
  email_enabled: boolean;
}

/** Keys the rules depend on: they can be renamed (labels) or switched off, never deleted. not_started stays on. */
export const REQUIRED_KEYS = ['not_started', 'on_hold', 'ready_for_review', 'needs_rework', 'completed'] as const;

export const DEFAULT_STATUSES: WorkingStatusDef[] = [
  { key: 'not_started', label_en: 'Not started', label_ar: 'لم يبدأ', color: 'muted', icon: 'circle', order: 10, enabled: true, court: 'consultant' },
  { key: 'in_analysis', label_en: 'In analysis', label_ar: 'قيد التحليل', color: 'info', icon: 'search', order: 20, enabled: true, court: 'consultant' },
  { key: 'waiting_client_info', label_en: 'Waiting for client information', label_ar: 'بانتظار معلومات من العميل', color: 'warning', icon: 'hourglass', order: 30, enabled: true, court: 'client' },
  { key: 'waiting_consultant', label_en: 'Waiting for consultant', label_ar: 'بانتظار الاستشاري', color: 'warning', icon: 'user-clock', order: 40, enabled: true, court: 'consultant' },
  { key: 'waiting_third_party', label_en: 'Waiting for third party / access', label_ar: 'بانتظار طرف ثالث / صلاحيات الوصول', color: 'warning', icon: 'key', order: 50, enabled: true, court: 'third_party' },
  { key: 'in_development', label_en: 'In development / configuration', label_ar: 'قيد التطوير / الإعداد', color: 'primary', icon: 'wrench', order: 60, enabled: true, court: 'consultant' },
  { key: 'in_testing', label_en: 'In testing', label_ar: 'قيد الاختبار', color: 'accent', icon: 'flask', order: 70, enabled: true, court: 'both' },
  { key: 'ready_for_review', label_en: 'Ready for client review', label_ar: 'جاهز لمراجعة العميل', color: 'success', icon: 'eye', order: 80, enabled: true, court: 'client' },
  { key: 'needs_rework', label_en: 'Needs rework', label_ar: 'يحتاج إلى إعادة عمل', color: 'destructive', icon: 'rotate', order: 90, enabled: true, court: 'consultant' },
  { key: 'on_hold', label_en: 'On hold', label_ar: 'معلّق', color: 'muted', icon: 'pause', order: 100, enabled: true, court: 'none' },
  { key: 'completed', label_en: 'Completed (from my side)', label_ar: 'مكتمل (من جهتي)', color: 'success', icon: 'check', order: 110, enabled: true, court: 'other' },
];

export const DEFAULT_MATRIX: Record<string, MatrixRule> = {
  not_started: { client: true, consultant: true, note: false },
  in_analysis: { client: false, consultant: true, note: false },
  waiting_client_info: { client: false, consultant: true, note: true },
  waiting_consultant: { client: true, consultant: false, note: true },
  waiting_third_party: { client: true, consultant: true, note: true },
  in_development: { client: false, consultant: true, note: false },
  in_testing: { client: true, consultant: true, note: false },
  ready_for_review: { client: false, consultant: true, note: false },
  needs_rework: { client: true, consultant: false, note: true },
  on_hold: { client: true, consultant: true, note: true },
  completed: { client: true, consultant: true, note: false },
};

export const DEFAULT_SETTINGS: TrackingSettings = {
  enabled: false,
  statuses: DEFAULT_STATUSES,
  matrix: DEFAULT_MATRIX,
  note_max: 1000,
  rate_limit_per_hour: 30,
  throttle_minutes: 15,
  review_reminder_days: 3,
  max_review_reminders: 3,
  max_overdue_reminders: 3,
  stuck_days: 7,
  email_enabled: true,
};

const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

/** Settings as the database returns them (tt_settings), made safe for display; unknown values fall back to defaults. */
export function normalizeSettings(raw: unknown): TrackingSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.statuses) ? r.statuses : DEFAULT_STATUSES;
  const statuses: WorkingStatusDef[] = [];
  for (const s of list as Array<Record<string, unknown>>) {
    if (!s || typeof s.key !== 'string' || !/^[a-z_]{2,40}$/.test(s.key) || statuses.some((x) => x.key === s.key)) continue;
    const def = DEFAULT_STATUSES.find((d) => d.key === s.key);
    statuses.push({
      key: s.key,
      label_en: typeof s.label_en === 'string' && s.label_en.trim() ? s.label_en.slice(0, 60) : def?.label_en ?? s.key,
      label_ar: typeof s.label_ar === 'string' && s.label_ar.trim() ? s.label_ar.slice(0, 60) : def?.label_ar ?? s.key,
      color: (TT_COLORS as readonly string[]).includes(String(s.color)) ? (s.color as TtColor) : def?.color ?? 'muted',
      icon: (TT_ICONS as readonly string[]).includes(String(s.icon)) ? (s.icon as TtIcon) : def?.icon ?? 'circle',
      order: num(s.order, def?.order ?? 999, 0, 10_000),
      enabled: s.enabled !== false,
      court: (['client', 'consultant', 'both', 'third_party', 'none', 'other'] as const).includes(s.court as Court) ? (s.court as Court) : def?.court ?? 'none',
    });
  }
  statuses.sort((a, b) => a.order - b.order);
  const m = (r.matrix && typeof r.matrix === 'object' ? r.matrix : {}) as Record<string, Partial<MatrixRule>>;
  const matrix: Record<string, MatrixRule> = {};
  for (const s of statuses) {
    const d = DEFAULT_MATRIX[s.key] ?? { client: false, consultant: false, note: false };
    const x = m[s.key] ?? {};
    matrix[s.key] = {
      client: typeof x.client === 'boolean' ? x.client : d.client,
      consultant: typeof x.consultant === 'boolean' ? x.consultant : d.consultant,
      note: typeof x.note === 'boolean' ? x.note : d.note,
    };
  }
  return {
    enabled: r.enabled === true,
    statuses,
    matrix,
    note_max: num(r.note_max, 1000, 50, 2000),
    rate_limit_per_hour: num(r.rate_limit_per_hour, 30, 1, 200),
    throttle_minutes: num(r.throttle_minutes, 15, 1, 240),
    review_reminder_days: num(r.review_reminder_days, 3, 1, 30),
    max_review_reminders: num(r.max_review_reminders, 3, 0, 10),
    max_overdue_reminders: num(r.max_overdue_reminders, 3, 0, 10),
    stuck_days: num(r.stuck_days, 7, 1, 90),
    email_enabled: r.email_enabled !== false,
  };
}

/** Problems that stop the admin from saving the list / matrix (the database checks the same). */
export function settingsProblems(s: TrackingSettings): string[] {
  const out: string[] = [];
  const keys = s.statuses.map((x) => x.key);
  for (const k of REQUIRED_KEYS) if (!keys.includes(k)) out.push(`missing:${k}`);
  if (!s.statuses.find((x) => x.key === 'not_started')?.enabled) out.push('not_started_off');
  if (s.statuses.length > 20) out.push('too_many');
  for (const x of s.statuses) {
    if (!x.label_en.trim() || !x.label_ar.trim()) out.push(`label:${x.key}`);
    if (x.label_en.length > 60 || x.label_ar.length > 60) out.push(`label_long:${x.key}`);
  }
  if (new Set(keys).size !== keys.length) out.push('duplicate');
  return out;
}

export function statusDef(settings: TrackingSettings, key: string | null | undefined): WorkingStatusDef | undefined {
  return settings.statuses.find((s) => s.key === key) ?? DEFAULT_STATUSES.find((s) => s.key === key);
}

export function statusLabel(settings: TrackingSettings, key: string | null | undefined, lang: string): string {
  const d = statusDef(settings, key);
  if (!d) return String(key ?? '');
  return lang.startsWith('ar') ? d.label_ar : d.label_en;
}

// ------------------------------------------------------------------ permission matrix

/** Statuses the viewer may pick (admins: every enabled status; observers, bidders and outsiders: none). */
export function allowedStatuses(role: ViewerRole | null | undefined, settings: TrackingSettings): string[] {
  if (!role || role === 'observer') return [];
  return settings.statuses
    .filter((s) => s.enabled && (role === 'admin' || settings.matrix[s.key]?.[role] === true))
    .map((s) => s.key);
}

export function canSetStatus(role: ViewerRole | null | undefined, key: string, settings: TrackingSettings): boolean {
  return allowedStatuses(role, settings).includes(key);
}

export function noteRequired(key: string, settings: TrackingSettings): boolean {
  return settings.matrix[key]?.note === true;
}

export type ChangeProblem = 'not_allowed' | 'unknown_status' | 'note_required' | 'note_too_long' | 'contact_details'
  | 'bad_responsible' | 'date_past' | 'date_far' | 'closed' | 'unchanged';

export interface ChangeInput {
  role: ViewerRole | null | undefined;
  ticketStatus: string;
  current: { key: string; note: string | null; expected_date: string | null; responsible: string | null } | null;
  key: string;
  note: string;
  expectedDate: string | null;
  responsible: string | null;
  today: string; // YYYY-MM-DD
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Mirrors tt_set_working_status: the first problem the database would raise, or null. */
export function validateChange(input: ChangeInput, settings: TrackingSettings): ChangeProblem | null {
  const def = settings.statuses.find((s) => s.key === input.key && s.enabled);
  if (!def) return 'unknown_status';
  if (input.ticketStatus === 'closed' && input.role !== 'admin') return 'closed';
  if (!canSetStatus(input.role, input.key, settings)) return 'not_allowed';
  const note = input.note.trim();
  if (note.length > settings.note_max) return 'note_too_long';
  if (!note && noteRequired(input.key, settings)) return 'note_required';
  if (note && contactDetailsInText(note)) return 'contact_details';
  if (input.responsible && !RESPONSIBLES.includes(input.responsible as Responsible)) return 'bad_responsible';
  if (input.expectedDate) {
    if (input.expectedDate < input.today) return 'date_past';
    if (input.expectedDate > addDays(input.today, 365)) return 'date_far';
  }
  const c = input.current;
  if (c && c.key === input.key && (c.note ?? '') === note && (c.expected_date ?? null) === (input.expectedDate || null)
      && (c.responsible ?? null) === (input.responsible || null)) return 'unchanged';
  return null;
}

// ------------------------------------------------------------------ automatic stage

export const STAGES = ['submitted', 'details', 'matching', 'selected', 'rate', 'nda', 'confirmed', 'work', 'delivered', 'closed'] as const;
export type StageKey = typeof STAGES[number];
export type StageState = 'done' | 'current' | 'pending' | 'skipped';
export type Actor = 'client' | 'consultant' | 'both' | 'admin' | 'system' | 'third_party' | 'none';

/** What tt_facts returns for one ticket (all timestamps ISO strings or null). */
export interface TicketFacts {
  created_at: string;
  status: string;
  close_outcome: string | null;
  details_ok: boolean;
  details_at: string | null;
  brd_at: string | null;
  bids_at: string | null;
  bids_open: boolean;
  selected_at: string | null;
  has_consultant: boolean;
  rate_at: string | null;
  rate_proposed: boolean;
  nda_at: string | null;
  nda_state: 'none' | 'consultant_signed' | 'signed';
  gated: boolean;
  confirmed_at: string | null;
  work_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  /** team_next_step of the furthest pre-ready team member (gated tickets only). */
  team_next: { actor: string; step: string } | null;
  actors?: Partial<Record<StageKey | 'reopened', string | null>>;
  working?: WorkingRow | null;
}

export interface WorkingRow {
  key: string;
  set_at: string;
  set_by_role: SetterRole;
  note: string | null;
  expected_date: string | null;
  responsible: Responsible | null;
  version: number;
}

export interface StageStep { key: StageKey; state: StageState; at: string | null; by: string | null }
export type SideState = { kind: 'on_hold' } | { kind: 'blocked'; by: 'client' | 'consultant' | 'third_party' } | { kind: 'cancelled' } | { kind: 'reopened'; at: string };

export interface NextAction { actor: Actor; key: string }

export interface DerivedStage {
  steps: StageStep[];
  current: StageKey | null;
  side: SideState[];
  next: NextAction;
  outcome: 'solved' | 'not_solved' | null;
}

const after = (a: string | null, b: string | null) => !!a && (!b || Date.parse(a) >= Date.parse(b));

/** The 10-step pipeline + side states, purely from facts. Unit-tested step by step. */
export function deriveStage(f: TicketFacts): DerivedStage {
  const cancelled = f.close_outcome === 'cancelled';
  const closed = f.status === 'closed';
  const deliveredDone = (f.status === 'resolved' || closed) || after(f.delivered_at, f.reopened_at);
  const raw: Record<StageKey, { done: boolean; at: string | null; skippable?: boolean }> = {
    submitted: { done: true, at: f.created_at },
    details: { done: f.details_ok, at: f.details_at },
    matching: { done: !!f.bids_at || f.bids_open, at: f.bids_at },
    selected: { done: !!f.selected_at || f.has_consultant, at: f.selected_at },
    rate: { done: !!f.rate_at, at: f.rate_at },
    nda: { done: !!f.nda_at || f.nda_state === 'signed', at: f.nda_at },
    confirmed: { done: f.gated && !!f.confirmed_at, at: f.confirmed_at },
    work: { done: !!f.work_at, at: f.work_at },
    delivered: { done: deliveredDone, at: deliveredDone ? f.delivered_at : null },
    closed: { done: closed, at: closed ? f.closed_at : null },
  };
  const steps: StageStep[] = STAGES.map((key) => ({ key, state: raw[key].done ? 'done' : 'pending', at: raw[key].done ? raw[key].at : null, by: f.actors?.[key] ?? null }));
  // Legacy tickets (no team engagement) have no engagement confirmation step.
  const conf = steps.find((s) => s.key === 'confirmed')!;
  if (!f.gated && conf.state !== 'done') conf.state = 'skipped';
  // A step that was never reached but a later one was is skipped (e.g. a direct assignment without bids).
  let laterDone = false;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].state === 'done') laterDone = true;
    else if (laterDone) steps[i].state = 'skipped';
  }
  let current: StageKey | null = null;
  if (!closed && !cancelled) {
    const first = steps.find((s) => s.state === 'pending');
    if (first) { first.state = 'current'; current = first.key; }
  }

  const side: SideState[] = [];
  const w = f.working;
  if (cancelled) side.push({ kind: 'cancelled' });
  if (f.reopened_at && !closed && f.status !== 'resolved') side.push({ kind: 'reopened', at: f.reopened_at });
  if (!closed && !cancelled) {
    if (w?.key === 'on_hold') side.push({ kind: 'on_hold' });
    if (f.status === 'waiting_for_client' || w?.key === 'waiting_client_info') side.push({ kind: 'blocked', by: 'client' });
    else if (w?.key === 'waiting_consultant') side.push({ kind: 'blocked', by: 'consultant' });
    else if (w?.key === 'waiting_third_party') side.push({ kind: 'blocked', by: 'third_party' });
  }

  return {
    steps,
    current,
    side,
    next: nextAction(f, current, side),
    outcome: closed && !cancelled ? (f.close_outcome === 'unresolved' ? 'not_solved' : 'solved') : null,
  };
}

const TEAM_STEP_KEYS: Record<string, string> = {
  send_bid: 'send_bid', respond: 'respond', choose_bid: 'choose_bid', approve_rate: 'approve_rate', propose_rate: 'propose_rate',
  sign_nda: 'sign_nda', prepare_confirmation: 'prepare_confirmation', confirm: 'confirm',
};

/** "What happens next + who must act". Gated tickets before "ready" follow team_next_step exactly. */
export function nextAction(f: TicketFacts, current: StageKey | null, side: SideState[]): NextAction {
  if (side.some((s) => s.kind === 'cancelled')) return { actor: 'none', key: 'cancelled' };
  if (current === null) return { actor: 'none', key: 'done' };
  const blocked = side.find((s): s is Extract<SideState, { kind: 'blocked' }> => s.kind === 'blocked');
  if (side.some((s) => s.kind === 'on_hold')) return { actor: 'none', key: 'on_hold' };
  if (blocked) return { actor: blocked.by, key: `blocked_${blocked.by}` };
  if (f.gated && f.team_next && TEAM_STEP_KEYS[f.team_next.step] && ['client', 'consultant'].includes(f.team_next.actor)
      && ['matching', 'selected', 'rate', 'nda', 'confirmed'].includes(current)) {
    return { actor: f.team_next.actor as Actor, key: `team_${TEAM_STEP_KEYS[f.team_next.step]}` };
  }
  switch (current) {
    case 'details': return { actor: 'client', key: 'complete_details' };
    case 'matching': return { actor: 'client', key: 'find_consultant' };
    case 'selected': return f.bids_open ? { actor: 'client', key: 'choose_bid' } : { actor: 'client', key: 'choose_consultant' };
    case 'rate': return f.rate_proposed ? { actor: 'client', key: 'approve_rate' } : { actor: 'consultant', key: 'propose_rate' };
    case 'nda': return f.nda_state === 'consultant_signed' ? { actor: 'client', key: 'client_sign_nda' } : { actor: 'consultant', key: 'consultant_sign_nda' };
    case 'confirmed': return { actor: 'both', key: 'confirm_engagement' };
    case 'work': return { actor: 'consultant', key: 'start_work' };
    case 'delivered': return { actor: 'consultant', key: 'deliver' };
    case 'closed': return { actor: 'client', key: 'confirm_resolution' };
    default: return { actor: 'none', key: 'done' };
  }
}

// ------------------------------------------------------------------ waiting on whom, durations

export function otherSide(role: SetterRole | ViewerRole | null | undefined): 'client' | 'consultant' | 'none' {
  return role === 'client' ? 'consultant' : role === 'consultant' ? 'client' : 'none';
}

/** Who holds the ball for one working status entry (explicit "who is responsible" wins). */
export function courtOf(key: string, setBy: SetterRole | null | undefined, responsible: Responsible | null | undefined, settings: TrackingSettings): Exclude<Court, 'other'> {
  if (responsible) return responsible;
  const c = statusDef(settings, key)?.court ?? 'none';
  return c === 'other' ? otherSide(setBy) : c;
}

export interface StatusEvent { at: string; to: string; by: SetterRole; responsible: Responsible | null }
export interface Durations {
  byStatus: Record<string, number>;
  byCourt: Record<'client' | 'consultant' | 'both' | 'third_party' | 'none', number>;
  segments: Array<{ key: string; court: Exclude<Court, 'other'>; from: number; to: number }>;
}

/** Time spent in each working status and in each party's court (ms), from the status history (oldest first). */
export function durations(events: readonly StatusEvent[], now: number, settings: TrackingSettings, until?: number | null): Durations {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const end = until ?? now;
  const out: Durations = { byStatus: {}, byCourt: { client: 0, consultant: 0, both: 0, third_party: 0, none: 0 }, segments: [] };
  sorted.forEach((e, i) => {
    const from = Date.parse(e.at);
    const to = Math.min(i + 1 < sorted.length ? Date.parse(sorted[i + 1].at) : end, end);
    if (!(to > from)) return;
    const court = courtOf(e.to, e.by, e.responsible, settings);
    out.byStatus[e.to] = (out.byStatus[e.to] ?? 0) + (to - from);
    out.byCourt[court] += to - from;
    out.segments.push({ key: e.to, court, from, to });
  });
  return out;
}

/** Durations between consecutive completed stage steps (ms), for the stage history bar. */
export function stageDurations(steps: readonly StageStep[], now: number): Array<{ key: StageKey; ms: number }> {
  const done = steps.filter((s) => s.at && s.state === 'done').sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  return done.map((s, i) => ({ key: s.key, ms: Math.max(0, (i + 1 < done.length ? Date.parse(done[i + 1].at!) : now) - Date.parse(s.at!)) }));
}

// ------------------------------------------------------------------ overdue, reminders, throttling (mirrors of the SQL)

export function isOverdue(expectedDate: string | null | undefined, today: string): boolean {
  return !!expectedDate && expectedDate < today;
}

export interface ReminderRow {
  key: string;
  set_by_role: SetterRole;
  set_at: string;
  expected_date: string | null;
  last_reminder_on: string | null;
  overdue_reminders: number;
  review_reminded_on: string | null;
  review_reminders: number;
  ticket_status: string;
}
export type ReminderKind = 'due_tomorrow' | 'overdue' | 'review';

/** Mirrors tt_reminder_sweep: at most one reminder per item per day, none for backfilled rows or closed tickets. */
export function reminderDue(r: ReminderRow, today: string, s: TrackingSettings): ReminderKind | null {
  if (!s.enabled || r.ticket_status === 'closed' || r.set_by_role === 'system' || r.key === 'completed') return null;
  if (r.last_reminder_on === today) return null;
  if (r.expected_date) {
    if (r.expected_date === addDays(today, 1)) return 'due_tomorrow';
    if (r.expected_date < today && r.overdue_reminders < s.max_overdue_reminders) return 'overdue';
  }
  if (r.key === 'ready_for_review' && r.review_reminders < s.max_review_reminders
      && r.set_at.slice(0, 10) <= addDays(today, -s.review_reminder_days)
      && (!r.review_reminded_on || r.review_reminded_on <= addDays(today, -s.review_reminder_days))) return 'review';
  return null;
}

/** Who receives an expected-date reminder: the responsible side (third party / unknown: both parties). */
export function reminderRecipients(responsible: Responsible | null, key: string, setBy: SetterRole, kind: ReminderKind, settings: TrackingSettings): Array<'client' | 'consultant'> {
  if (kind === 'review') return ['client'];
  const c = courtOf(key, setBy, responsible, settings);
  if (c === 'client' || c === 'consultant') return [c];
  return ['client', 'consultant'];
}

/** In-app throttle: an unread tracking notice for the same ticket inside the window is updated instead of adding one. */
export function coalesceNotice(prev: { created_at: string; is_read: boolean } | null, now: number, windowMinutes: number): 'update' | 'insert' {
  return prev && !prev.is_read && now - Date.parse(prev.created_at) < windowMinutes * 60_000 ? 'update' : 'insert';
}

/** E-mail throttle (leading edge): one status e-mail per person and ticket per window; the bell always shows the latest. */
export function shouldEmail(lastQueuedAt: string | null, now: number, windowMinutes: number): boolean {
  return !lastQueuedAt || now - Date.parse(lastQueuedAt) >= windowMinutes * 60_000;
}

// ------------------------------------------------------------------ lists

export interface TrackingSummary {
  ticket_id: string;
  role: ViewerRole;
  facts: TicketFacts;
}

/** Does this ticket wait for the viewer? Next stage step, the working status court, or the responsible side. */
export function needsMyAction(summary: TrackingSummary, settings: TrackingSettings): boolean {
  const role = summary.role;
  if (role !== 'client' && role !== 'consultant') return false;
  const f = summary.facts;
  if (f.status === 'closed' || f.close_outcome === 'cancelled') return false;
  const d = deriveStage(f);
  if (d.next.actor === role || d.next.actor === 'both') return true;
  const w = f.working;
  if (!w || w.key === 'on_hold' || (w.key === 'not_started' && w.set_by_role === 'system')) return false;
  const c = courtOf(w.key, w.set_by_role, w.responsible, settings);
  return c === role || c === 'both';
}

export interface ListFilter { working: string; needsMe: boolean; sort: 'default' | 'working' | 'waiting_me' | 'changed' }
export const EMPTY_FILTER: ListFilter = { working: 'all', needsMe: false, sort: 'default' };

/** Filters and sorts any list of tickets by working status / "waiting on me". Tickets without a summary stay last. */
export function applyListFilter<T extends { id: string }>(items: readonly T[], summaries: ReadonlyMap<string, TrackingSummary>, f: ListFilter, settings: TrackingSettings): T[] {
  const ws = (t: T) => summaries.get(t.id)?.facts.working ?? null;
  let out = items.filter((t) => {
    if (f.working !== 'all' && (ws(t)?.key ?? 'not_started') !== f.working) return false;
    if (f.needsMe) { const s = summaries.get(t.id); if (!s || !needsMyAction(s, settings)) return false; }
    return true;
  });
  const order = (k: string | undefined) => statusDef(settings, k ?? 'not_started')?.order ?? 9999;
  if (f.sort === 'working') out = [...out].sort((a, b) => order(ws(a)?.key) - order(ws(b)?.key));
  else if (f.sort === 'waiting_me') {
    const v = (t: T) => { const s = summaries.get(t.id); return s && needsMyAction(s, settings) ? 0 : 1; };
    out = [...out].sort((a, b) => v(a) - v(b));
  } else if (f.sort === 'changed') {
    const at = (t: T) => Date.parse(ws(t)?.set_at ?? '') || 0;
    out = [...out].sort((a, b) => at(b) - at(a));
  }
  return out;
}

export function countNeedsMe(summaries: ReadonlyMap<string, TrackingSummary>, settings: TrackingSettings): number {
  let n = 0;
  for (const s of summaries.values()) if (needsMyAction(s, settings)) n++;
  return n;
}

// ------------------------------------------------------------------ saved filters (this browser)

export interface SavedFilter { name: string; filter: ListFilter }
const SAVED_MAX = 10;

export function parseSaved(raw: string | null): SavedFilter[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return [];
    return v.filter((x) => x && typeof x.name === 'string' && x.filter && typeof x.filter === 'object')
      .slice(0, SAVED_MAX)
      .map((x) => ({ name: String(x.name).slice(0, 40), filter: { ...EMPTY_FILTER, ...x.filter } }));
  } catch { return []; }
}

export function addSaved(list: readonly SavedFilter[], name: string, filter: ListFilter): SavedFilter[] {
  const n = name.trim().slice(0, 40);
  if (!n) return [...list];
  return [{ name: n, filter }, ...list.filter((x) => x.name !== n)].slice(0, SAVED_MAX);
}
