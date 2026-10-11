// The critical response service. A client can ask for a quick reply: the consultants who cover the SAP area are alarmed, and the consultant
// who replies in time earns a surcharge on the approved hourly rate. The database sets and checks every number (the window, the percentage,
// who is alerted, the rate); these helpers only describe its answers for the screens.

export type CriticalStatus = 'waiting' | 'answered' | 'missed';

export type CriticalTerms = {
  enabled: boolean;
  minutes: number;
  surcharge_percent: number;
  max_minutes: number;
  max_surcharge_percent: number;
};

export type CriticalEvent = {
  kind: 'extended' | 'boosted' | 'extended_and_boosted';
  at: string;
  old_due_at: string | null;
  new_due_at: string | null;
  old_percent: number | null;
  new_percent: number | null;
};

export type CriticalView = {
  critical_response: boolean;
  status?: CriticalStatus;
  due_at?: string;
  committed_at?: string;
  minutes?: number;
  surcharge_percent?: number;
  first_reply_at?: string | null;
  extensions?: number;
  max_minutes?: number;
  max_surcharge_percent?: number;
  can_extend?: boolean;
  alerted_count?: number;
  reply_count?: number;
  in_time_consultants?: string[];
  my_reply_at?: string | null;
  events?: CriticalEvent[];
};

export type CriticalAlert = {
  ticket_id: string;
  title: string;
  areas: string[];
  due_at: string;
  minutes: number;
  surcharge_percent: number;
  status: CriticalStatus;
  extensions: number;
  alerted_at: string;
  last_alerted_at: string;
  dismissed_at: string | null;
  replied_at: string | null;
};

/** What a client chose in the request form (null = the standard window / the standard surcharge). */
export type CriticalChoice = { on: boolean; minutes: number | null; percent: number | null; agreed: boolean };

export const NO_CRITICAL_CHOICE: CriticalChoice = { on: false, minutes: null, percent: null, agreed: false };

/** The standard terms, switched off: what the screens use until the database answers. */
export const DEFAULT_TERMS: CriticalTerms = { enabled: false, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 };

/** A client can extend a request this many times. */
export const MAX_EXTENSIONS = 5;

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : fallback;
};

/** The terms as the screens use them (a numeric column can arrive as text). */
export function readTerms(raw: unknown): CriticalTerms {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    minutes: num(r.minutes, DEFAULT_TERMS.minutes),
    surcharge_percent: num(r.surcharge_percent, DEFAULT_TERMS.surcharge_percent),
    max_minutes: num(r.max_minutes, DEFAULT_TERMS.max_minutes),
    max_surcharge_percent: num(r.max_surcharge_percent, DEFAULT_TERMS.max_surcharge_percent),
  };
}

/** The same rounding as the database: two decimals. */
export function effectiveRate(base: number, percent: number): number {
  return Math.round(base * (1 + percent / 100) * 100) / 100;
}

/** 30 -> "30%", 12.5 -> "12.5%". */
export function formatPercent(value: unknown): string {
  const n = num(value);
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`;
}

/** 30 -> "30 minutes", 1 -> "1 minute". */
export function formatWindow(minutes: number): string {
  const m = Math.max(0, Math.round(num(minutes)));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/** The time of day of a deadline, in the language and time zone of the browser. */
export function formatDeadline(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** The reply windows a client can choose: the standard one, a few steps and the limit. */
export function windowOptions(min: number, max: number): number[] {
  const steps = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];
  const set = new Set<number>([min, max, ...steps.filter((s) => s > min && s < max)]);
  return [...set].sort((a, b) => a - b);
}

/** The surcharges a client can choose: the standard one, steps of 10 and the limit. */
export function percentOptions(min: number, max: number): number[] {
  const set = new Set<number>([min, max]);
  for (let p = Math.ceil(min / 10) * 10; p < max; p += 10) {
    if (p > min) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

/** The minutes a client can add at a time. */
export function extraMinuteOptions(max: number): number[] {
  return [5, 10, 15, 30, 60, 120, 240, 480].filter((m) => m <= max);
}

/** Milliseconds left until the deadline (never negative). */
export function msLeft(dueAt: string | null | undefined, now: number = Date.now()): number {
  if (!dueAt) return 0;
  const t = new Date(dueAt).getTime();
  return Number.isFinite(t) ? Math.max(0, t - now) : 0;
}

/** "5:07" under an hour, "1:05:07" above it. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** An alert the consultant can still act on: waiting, the window is open, no reply yet, not dismissed. */
export function isOpenAlert(a: CriticalAlert, now: number = Date.now()): boolean {
  return a.status === 'waiting' && !a.replied_at && !a.dismissed_at && msLeft(a.due_at, now) > 0;
}

/** The open alerts, the one that ends first on top. */
export function openAlerts(alerts: CriticalAlert[] | null | undefined, now: number = Date.now()): CriticalAlert[] {
  return (alerts ?? [])
    .filter((a) => isOpenAlert(a, now))
    .sort((x, y) => new Date(x.due_at).getTime() - new Date(y.due_at).getTime());
}

/** A new alert or a reminder has a new key, so a consultant who closed the window is alarmed again by it. */
export function alertKey(a: Pick<CriticalAlert, 'ticket_id' | 'last_alerted_at'>): string {
  return `${a.ticket_id}:${a.last_alerted_at}`;
}

export type CriticalColumns = { critical_response?: boolean; critical_minutes?: number; critical_surcharge_percent?: number };

/** The columns of a new ticket for the choice of the client (nothing when the service is not chosen). */
export function criticalColumns(urgency: string, choice: CriticalChoice): CriticalColumns {
  if (urgency !== 'critical' || !choice.on) return {};
  return {
    critical_response: true,
    ...(choice.minutes ? { critical_minutes: choice.minutes } : {}),
    ...(choice.percent != null ? { critical_surcharge_percent: choice.percent } : {}),
  };
}

/** One line for the summary of a request, for example "Reply within 45 minutes, +40% for the consultant". */
export function choiceSummary(choice: CriticalChoice, terms: CriticalTerms): string {
  const minutes = choice.minutes ?? terms.minutes;
  const percent = choice.percent ?? terms.surcharge_percent;
  return `Reply within ${formatWindow(minutes)}, +${formatPercent(percent)} for the consultant`;
}

/** Does the surcharge apply to the proposal of this consultant? Only when the consultant replied in time. */
export function surchargeApplies(view: CriticalView | null | undefined, consultantId: string | null | undefined): boolean {
  return !!view?.critical_response && !!consultantId && (view.in_time_consultants ?? []).includes(consultantId);
}

/** One line of the history of a request. */
export function describeEvent(e: CriticalEvent, locale?: string): string {
  const until = formatDeadline(e.new_due_at, locale);
  const percent = e.new_percent == null ? '' : formatPercent(e.new_percent);
  if (e.kind === 'boosted') return `Surcharge raised to ${percent}`;
  if (e.kind === 'extended') return `Time extended until ${until}`;
  return `Time extended until ${until} and surcharge raised to ${percent}`;
}

/** The deadline after the client adds minutes: counted from the later of now and the current deadline (the rule of the database). */
export function extendedDeadline(dueAt: string | null | undefined, extraMinutes: number, now: number = Date.now()): string | null {
  const due = dueAt ? new Date(dueAt).getTime() : NaN;
  if (!(extraMinutes > 0)) return Number.isFinite(due) ? new Date(due).toISOString() : null;
  const base = Math.max(now, Number.isFinite(due) ? due : 0);
  return new Date(base + extraMinutes * 60_000).toISOString();
}

/** Why a change of the request would be refused (null = it can be sent). The database repeats every check. */
export function extensionProblem(view: CriticalView, extraMinutes: number, percent: number, now: number = Date.now()): string | null {
  const current = num(view.surcharge_percent);
  const maxMinutes = num(view.max_minutes, DEFAULT_TERMS.max_minutes);
  const maxPercent = num(view.max_surcharge_percent, DEFAULT_TERMS.max_surcharge_percent);
  if (num(view.extensions) >= MAX_EXTENSIONS) return `This request was already extended ${MAX_EXTENSIONS} times`;
  if (!Number.isFinite(extraMinutes) || extraMinutes < 0 || extraMinutes > maxMinutes) return `You can add ${formatWindow(maxMinutes)} at most at a time`;
  if (!Number.isFinite(percent) || percent < current) return 'The surcharge can only be raised';
  if (percent > maxPercent) return `The surcharge can be ${formatPercent(maxPercent)} at most`;
  if (!(extraMinutes > 0) && !(percent > current)) return 'Add minutes or raise the surcharge';
  if (msLeft(view.due_at, now) <= 0 && !(extraMinutes > 0)) return 'The reply window has passed: add minutes as well';
  return null;
}

/** Why the settings of the administrator would be refused (null = fine). The same rules as the database. */
export function termsProblem(t: CriticalTerms): string | null {
  if (![t.minutes, t.surcharge_percent, t.max_minutes, t.max_surcharge_percent].every((n) => Number.isFinite(n))) return 'Fill in every number';
  if (!Number.isInteger(t.minutes) || !Number.isInteger(t.max_minutes)) return 'Minutes must be whole numbers';
  if (t.minutes < 5 || t.minutes > 720) return 'The reply window must be between 5 and 720 minutes';
  if (t.surcharge_percent < 0 || t.surcharge_percent > 300) return 'The surcharge must be between 0 and 300 percent';
  if (t.max_minutes < t.minutes || t.max_minutes > 720) return 'The longest window must be at least the standard window and at most 720 minutes';
  if (t.max_surcharge_percent < t.surcharge_percent || t.max_surcharge_percent > 300) return 'The highest surcharge must be at least the standard surcharge and at most 300 percent';
  return null;
}
