/**
 * Feature L: assignment response policy (alerts, reminders, escalation).
 * Pure rules shared by the assignment-reminders edge function, the portal (popup, countdowns, policy text) and the tests.
 * docs/sql/assignment-response.sql implements the same schedule and due selection inside the service-only claim RPC.
 */

export type ReminderStep = 'request' | 'r1' | 'r2' | 'r3' | 'expire' | 'expire2';
export const REMINDER_STEPS: ReminderStep[] = ['r1', 'r2', 'r3'];

export interface PolicyMinutes {
  r1: number; r2: number; r3: number; expire: number;
  critical_r1: number; critical_r2: number; critical_r3: number; critical_expire: number;
  /** Most reminder messages one consultant receives per hour (the first request message is never held back). */
  hourly_limit: number;
  /** "Wait longer": extra time the client may give once. */
  extend: number;
  /** Time the client has to answer a consultant's "Request more information" before it is returned to them. */
  info_wait: number;
}

/** Owner defaults: 2 h / 4 h / 24 h, reply window 24 h; Critical 10 / 20 / 30 min, window 30 min; extend 24 h once. */
export const POLICY_DEFAULTS: PolicyMinutes = {
  r1: 120, r2: 240, r3: 1440, expire: 1440,
  critical_r1: 10, critical_r2: 20, critical_r3: 30, critical_expire: 30,
  hourly_limit: 6, extend: 1440, info_wait: 1440,
};

const MIN = 60_000;
const MAX_MINUTES = 10_080; // one week

/** Reads the admin setting `assignment_reminder_minutes`; bad values fall back to the defaults (a whole group when the order breaks). */
export function readPolicyMinutes(raw: unknown): PolicyMinutes {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...POLICY_DEFAULTS };
  (Object.keys(POLICY_DEFAULTS) as Array<keyof PolicyMinutes>).forEach((k) => {
    const v = Number(src[k]);
    if (Number.isInteger(v) && v >= 1 && v <= MAX_MINUTES) out[k] = v;
  });
  if (!(out.r1 < out.r2 && out.r2 < out.r3 && out.r3 <= out.expire)) {
    Object.assign(out, { r1: POLICY_DEFAULTS.r1, r2: POLICY_DEFAULTS.r2, r3: POLICY_DEFAULTS.r3, expire: POLICY_DEFAULTS.expire });
  }
  if (!(out.critical_r1 < out.critical_r2 && out.critical_r2 < out.critical_r3 && out.critical_r3 <= out.critical_expire)) {
    Object.assign(out, {
      critical_r1: POLICY_DEFAULTS.critical_r1, critical_r2: POLICY_DEFAULTS.critical_r2,
      critical_r3: POLICY_DEFAULTS.critical_r3, critical_expire: POLICY_DEFAULTS.critical_expire,
    });
  }
  out.hourly_limit = Math.min(out.hourly_limit, 60);
  return out;
}

export interface ScheduleInput {
  /** Request time (ms epoch). */
  createdAt: number;
  /** Ticket urgency is critical or the client asked for the critical response service. */
  critical: boolean;
  /** Private bid invitation: answered by the bid deadline instead of the normal window. */
  bidInvite?: boolean;
  /** Ticket bid deadline (ms epoch), when one is set. */
  bidDeadline?: number | null;
}

/** When the consultant must have answered. Critical first, then a bid deadline (bid invitations only), else the normal window. */
export function responseDeadline(input: ScheduleInput, m: PolicyMinutes = POLICY_DEFAULTS): number {
  if (input.critical) return input.createdAt + m.critical_expire * MIN;
  if (input.bidInvite && input.bidDeadline != null && input.bidDeadline > input.createdAt) return input.bidDeadline;
  return input.createdAt + m.expire * MIN;
}

/** Every message of one request, counted from the request time. Reminders after the deadline are left out. */
export function scheduleFor(input: ScheduleInput, m: PolicyMinutes = POLICY_DEFAULTS): Array<{ step: ReminderStep; dueAt: number }> {
  const deadline = responseDeadline(input, m);
  const offsets = input.critical ? [m.critical_r1, m.critical_r2, m.critical_r3] : [m.r1, m.r2, m.r3];
  const steps: Array<{ step: ReminderStep; dueAt: number }> = [{ step: 'request', dueAt: input.createdAt }];
  REMINDER_STEPS.forEach((step, i) => {
    const dueAt = input.createdAt + offsets[i] * MIN;
    if (dueAt <= deadline) steps.push({ step, dueAt });
  });
  steps.push({ step: 'expire', dueAt: deadline });
  return steps;
}

export interface StepRow { step: ReminderStep; dueAt: number; sentAt: number | null; cancelled: boolean }

export interface RequestState {
  /** pending | accepted | rejected | withdrawn | expired */
  status: string;
  ticketClosed: boolean;
  /** Admin flag `assignment_reminders` (the first request message is sent even when it is off). */
  flagOn: boolean;
  steps: StepRow[];
  /** Reminder messages this consultant received during the last hour. */
  consultantRemindersLastHour: number;
  hourlyLimit: number;
}

export type DueDecision =
  | { action: 'stop' }
  | { action: 'none' }
  | { action: 'send'; step: ReminderStep; superseded: ReminderStep[] };

const isReminder = (s: ReminderStep) => s === 'r1' || s === 'r2' || s === 'r3';
const isExpire = (s: ReminderStep) => s === 'expire' || s === 'expire2';

/**
 * What one claim run does for one request (mirrors claim_assignment_reminders):
 * - answered, withdrawn, already expired or ticket closed: stop (cancel everything unsent);
 * - the first request message always goes first;
 * - only the latest due reminder is sent, older due ones are superseded (no bursts after an outage);
 * - reminders wait when the consultant reached the hourly limit;
 * - "No response" goes out only after every earlier message was sent in an earlier run.
 */
export function dueStep(s: RequestState, now: number): DueDecision {
  if (s.status !== 'pending' || s.ticketClosed) return { action: 'stop' };
  const open = s.steps.filter((x) => x.sentAt == null && !x.cancelled && x.dueAt <= now);
  const request = open.find((x) => x.step === 'request');
  if (request) return { action: 'send', step: 'request', superseded: [] };
  if (!s.flagOn) return { action: 'none' };
  const reminders = open.filter((x) => isReminder(x.step)).sort((a, b) => b.dueAt - a.dueAt);
  if (reminders.length > 0) {
    if (s.consultantRemindersLastHour >= s.hourlyLimit) return { action: 'none' };
    return { action: 'send', step: reminders[0].step, superseded: reminders.slice(1).map((x) => x.step) };
  }
  const expire = open.find((x) => isExpire(x.step));
  if (expire) {
    const earlierPending = s.steps.some((x) => !isExpire(x.step) && !x.cancelled && (x.sentAt == null || x.sentAt >= now));
    if (earlierPending) return { action: 'none' };
    return { action: 'send', step: expire.step, superseded: [] };
  }
  return { action: 'none' };
}

/** Recipient of a step: reminders go to the consultant, "No response" to the client. */
export const stepRecipient = (step: ReminderStep): 'consultant' | 'client' => (isExpire(step) ? 'client' : 'consultant');

// ---------------------------------------------------------------- popup

export interface PopupRequest {
  id: string;
  status: string;
  created_at: string;
  response_due_at?: string | null;
  reminders_sent?: number | null;
  extended_at?: string | null;
  /** Set while the consultant waits for the client's answer to "Request more information" (the clock is paused). */
  info_paused_at?: string | null;
  /** Last time the client answered and the clock resumed. */
  info_resumed_at?: string | null;
}

/** Changes with every reminder, an extension and every client answer, so the popup comes back after each of them. */
export const popupKey = (r: PopupRequest): string => {
  const base = `${r.id}:${r.reminders_sent ?? 0}:${r.extended_at ? 1 : 0}`;
  const resumed = r.info_resumed_at ? Date.parse(r.info_resumed_at) : NaN;
  return Number.isFinite(resumed) ? `${base}:i${resumed}` : base;
};

/**
 * One popup at a time: the pending request with the nearest deadline that was not acknowledged for its current reminder.
 * Requests waiting for the client's answer to an information request do not pop up (the clock is paused).
 */
export function nextPopup<T extends PopupRequest>(requests: T[], acknowledged: ReadonlySet<string>): T | null {
  const open = requests
    .filter((r) => r.status === 'pending' && !r.info_paused_at && !acknowledged.has(popupKey(r)))
    .sort((a, b) => deadlineOf(a) - deadlineOf(b));
  return open[0] ?? null;
}

const deadlineOf = (r: PopupRequest) => (r.response_due_at ? Date.parse(r.response_due_at) : Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------- text

export type Lang = 'en' | 'ar';

/** 30 -> "30 minutes", 120 -> "2 hours", 1440 -> "1 day" (or "24 hours" when days are not wanted). */
export function durationLabel(minutes: number, lang: Lang = 'en', preferDays = true): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return lang === 'ar' ? arCount(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة') : `${m} minute${m === 1 ? '' : 's'}`;
  if (preferDays && m % 1440 === 0) {
    const d = m / 1440;
    return lang === 'ar' ? arCount(d, 'يوم واحد', 'يومين', 'أيام', 'يوماً') : `${d} day${d === 1 ? '' : 's'}`;
  }
  if (m % 60 === 0) {
    const h = m / 60;
    return lang === 'ar' ? arCount(h, 'ساعة واحدة', 'ساعتين', 'ساعات', 'ساعة') : `${h} hour${h === 1 ? '' : 's'}`;
  }
  const h = Math.floor(m / 60);
  return lang === 'ar' ? `${durationLabel(h * 60, lang, false)} و${durationLabel(m % 60, lang)}` : `${h} h ${m % 60} min`;
}

function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one.includes(' ') ? one : `${one} واحدة`;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/**
 * The response policy, built from the current timings (with the defaults it is the owner's exact wording).
 * `info`: the "Request more information" option is live (docs/sql/assignment-info-requests.sql), so one sentence is added.
 */
export function policyText(m: PolicyMinutes = POLICY_DEFAULTS, lang: Lang = 'en', opts: { info?: boolean } = {}): string {
  const base = basePolicyText(m, lang);
  if (!opts.info) return base;
  return `${base} ${infoPolicySentence(lang)}`;
}

/** The sentence added once information requests are live (mirrored by assignment_policy_text in the SQL file). */
export function infoPolicySentence(lang: Lang = 'en'): string {
  return lang === 'ar'
    ? 'يمكنك أيضاً طلب معلومات إضافية من العميل: يتوقف العدّاد حتى يجيب، ويُحتسب طلبك في الوقت المحدد رداً.'
    : 'You can also ask the client for more information: the clock pauses until they answer, and asking in time counts as a response.';
}

function basePolicyText(m: PolicyMinutes, lang: Lang): string {
  if (lang === 'ar') {
    return `يرجى القبول أو الرفض خلال ${durationLabel(m.expire, 'ar', false)} (${durationLabel(m.critical_expire, 'ar', false)} للطلبات الحرجة). نذكّرك بعد ${durationLabel(m.r1, 'ar')} و${durationLabel(m.r2, 'ar')} و${durationLabel(m.r3, 'ar')}. إذا لم يصل رد يُبلَّغ العميل وقد يختار استشارياً آخر؛ وتكرار عدم الرد يخفض معدل استجابتك وترتيبك.`;
  }
  return `Please accept or decline within ${durationLabel(m.expire, 'en', false)} (${durationLabel(m.critical_expire, 'en', false)} for Critical requests). We remind you after ${durationLabel(m.r1)}, ${durationLabel(m.r2)} and ${durationLabel(m.r3)}. If there is no reply the client is told and may choose another consultant; repeated non-response lowers your response rate and ranking.`;
}

/** "3 h 20 min left" / "12 min left" / "Time is up". */
export function timeLeftLabel(deadlineMs: number, now: number, lang: Lang = 'en'): string {
  const left = Math.ceil((deadlineMs - now) / MIN);
  if (left <= 0) return lang === 'ar' ? 'انتهى الوقت' : 'Time is up';
  const h = Math.floor(left / 60);
  const min = left % 60;
  if (lang === 'ar') return `متبقٍ ${h > 0 ? `${h} س ` : ''}${min} د`;
  return `${h > 0 ? `${h} h ` : ''}${min} min left`;
}

/** Share of answered requests (accepted or declined) among answered + "No response"; null below 3 requests, so newcomers are not judged. */
export function responseRate(answered: number, noResponse: number): number | null {
  const total = Math.max(0, answered) + Math.max(0, noResponse);
  if (total < 3) return null;
  return Math.max(0, answered) / total;
}

// ---------------------------------------------------------------- client card

export interface ClientRequestRow {
  status: string;
  response_due_at?: string | null;
  extended_at?: string | null;
  info_paused_at?: string | null;
}

export type ClientRequestView =
  | { kind: 'waiting'; deadline: number | null }
  | { kind: 'paused' }
  | { kind: 'no_response'; canExtend: boolean }
  | { kind: 'done' };

/**
 * What the client sees on a sent request: waiting with a countdown, or "No response" with Invite another / Open for bids,
 * plus Wait longer only once per request and only while the ticket is open.
 */
export function clientRequestView(r: ClientRequestRow, ticketClosed = false): ClientRequestView {
  if (r.status === 'pending' && r.info_paused_at) return { kind: 'paused' };
  if (r.status === 'pending') {
    const d = r.response_due_at ? Date.parse(r.response_due_at) : NaN;
    return { kind: 'waiting', deadline: Number.isFinite(d) ? d : null };
  }
  if (r.status === 'expired') return { kind: 'no_response', canExtend: !r.extended_at && !ticketClosed };
  return { kind: 'done' };
}

// ---------------------------------------------------------------- admin timings form

export type TimingsProblem = 'range' | 'order' | 'critical_order';

/**
 * Checks the admin timings before saving (the server would silently fall back to the defaults instead):
 * every value 1 minute to 7 days, reminders in order and not after the reply window, for normal and Critical requests.
 */
export function timingsProblems(m: PolicyMinutes): TimingsProblem[] {
  const out: TimingsProblem[] = [];
  const values = Object.values(m);
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > MAX_MINUTES) || m.hourly_limit > 60) out.push('range');
  if (!(m.r1 < m.r2 && m.r2 < m.r3 && m.r3 <= m.expire)) out.push('order');
  if (!(m.critical_r1 < m.critical_r2 && m.critical_r2 < m.critical_r3 && m.critical_r3 <= m.critical_expire)) out.push('critical_order');
  return out;
}

/** Response-rate share of the ranking's "response" criterion: half reply speed, half answered requests (when known). */
export function responseFit(responseTimeMinutes: number | null | undefined, rate: number | null | undefined): number {
  const rt = responseTimeMinutes;
  const speed = !rt ? 0.3 : rt <= 30 ? 1 : rt <= 60 ? 0.8 : rt <= 240 ? 0.5 : rt <= 1440 ? 0.3 : 0.1;
  if (rate == null || !Number.isFinite(rate)) return speed;
  return 0.5 * speed + 0.5 * Math.max(0, Math.min(1, rate));
}

// ---------------------------------------------------------------- edge function entry

/**
 * Repeat-call guard of the 5-minute sweep. Kept just under the cron interval: a 30-minute guard would hold back the
 * 10 / 20 / 30-minute Critical reminders. A call for one request (the immediate first e-mail) is bounded by that request instead.
 */
export const SWEEP_GUARD_MS = 4 * 60_000;

export function sweepGuarded(lastRunAt: number | null, now: number): boolean {
  return lastRunAt != null && now - lastRunAt >= 0 && now - lastRunAt < SWEEP_GUARD_MS;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a well-formed request id (or information request id) narrows the run; anything else is treated as a plain sweep. */
export function parseRunBody(body: unknown): { requestId: string | null; infoId: string | null } {
  const src = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const ok = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
  const requestId = ok(src.request_id);
  return { requestId, infoId: requestId ? null : ok(src.info_id) };
}

/** Public response body: counts only, never user data or error text. */
export function runResponse(r: { skipped: boolean; claimed: number; ok: boolean }): { skipped: boolean; claimed: number; ok: boolean } {
  return { skipped: r.skipped, claimed: Math.max(0, r.claimed | 0), ok: r.ok };
}
