// SLA policies: the shared model used by the browser (policy editor, live preview, chips, lists), the sla-run worker
// and the unit tests. Pure functions only (no Deno or browser APIs beyond Intl). Mirror of docs/sql/sla-policies.sql:
// the DATABASE decides (sla_business_minutes, sla_add_business_minutes, sla_policy_problems, sla_reconcile,
// sla_sweep); this file explains and previews the same rules so screens and the database agree.
//
// Clock model (one row per ticket and clock in the database):
//   consumed(now) = consumed_min + (running_since ? businessMinutes(running_since, now) : 0)
//   due           = running_since ? addBusinessMinutes(running_since, target + extended - consumed_min) : null (paused)
// Coverage "business" counts only minutes inside the calendar (days, start-end in the policy time zone, no holidays);
// "24x7" counts every minute. Pauses (waiting for client, on hold, ...) stop the clock; outside coverage it simply
// does not count. Time zones and daylight saving follow the IANA database (Intl here, AT TIME ZONE in SQL).

export const SEVERITY_KEYS = ['S1', 'S2', 'S3', 'S4'] as const;
export type SeverityKey = (typeof SEVERITY_KEYS)[number];
export const URGENCIES = ['critical', 'high', 'medium', 'low'] as const;
export type Urgency = (typeof URGENCIES)[number];
export const CLOCK_KINDS = ['response', 'workaround', 'resolution'] as const;
export type ClockKind = (typeof CLOCK_KINDS)[number];
export const COVERAGE_MODES = ['24x7', 'business'] as const;
export type CoverageMode = (typeof COVERAGE_MODES)[number];
export const START_RULES = ['submitted', 'assigned', 'ready'] as const;
export type StartRule = (typeof START_RULES)[number];
export const STOP_RULES = ['resolved', 'closed'] as const;
export type StopRule = (typeof STOP_RULES)[number];
export const PAUSE_KEYS = ['waiting_client_info', 'waiting_third_party', 'on_hold', 'waiting_for_client', 'awaiting_nda', 'awaiting_brd_approval'] as const;
export type PauseKey = (typeof PAUSE_KEYS)[number];
export const RECIPIENTS = ['lead', 'support', 'all_assigned', 'client_contact', 'client_manager', 'admin', 'extra'] as const;
export type Recipient = (typeof RECIPIENTS)[number];
/** SMS is never a channel (owner rule). */
export const CHANNELS = ['in_app', 'email', 'push', 'telegram'] as const;
export type Channel = (typeof CHANNELS)[number];
export const STEP_TEMPLATES = ['reminder', 'escalation', 'breach', 'after_breach'] as const;
export type StepTemplate = (typeof STEP_TEMPLATES)[number];
export const POLICY_STATUSES = ['draft', 'active', 'archived'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
export const APPLIES_KINDS = ['all', 'sap_area', 'module'] as const;
export type AppliesKind = (typeof APPLIES_KINDS)[number];
export const BREACH_CHOICES = ['extend', 'reassign', 'admin_help'] as const;
export type BreachChoice = (typeof BREACH_CHOICES)[number];

export const MINUTE = 60_000;
export const MAX_TARGET_MIN = 60 * 24 * 365; // one year
const MAX_DAYS_SCANNED = 3700;
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'mail.com', 'yandex.com', 'zoho.com'];

// ------------------------------------------------------------------------------------------------ types
export interface Coverage {
  mode: CoverageMode;
  /** IANA time zone; null = the client's company time zone (client profile), else UTC. */
  tz: string | null;
  /** Working days, 0 = Sunday ... 6 = Saturday. */
  days: number[];
  start: string; // HH:MM
  end: string; // HH:MM (after start; overnight windows are not supported)
  /** Client's own non-working dates (YYYY-MM-DD). */
  holidays: string[];
  /** Admin-managed national holiday lists (keys, e.g. "SA"). */
  holiday_lists: string[];
}

export interface EscalationStep {
  clock: ClockKind;
  /** 'percent' = at N % of the target; 'after_breach' = N minutes (of counted time) after the target. */
  kind: 'percent' | 'after_breach';
  value: number;
  who: Recipient[];
  channels: Channel[];
  template: StepTemplate;
  /** Repeat every N minutes (>= 30) while not acknowledged; null = once. */
  repeat_min: number | null;
  until_ack: boolean;
  /** S1 only, when the admin allows it: ignores notification pauses and quiet hours. */
  unpausable: boolean;
}

export interface SeverityTargets {
  response_min: number;
  workaround_min: number | null;
  resolution_min: number;
  escalations: EscalationStep[];
}

export interface BreachHandling {
  notify: boolean;
  flag: boolean;
  ask_client: boolean;
  offer_replacement: boolean;
}

export interface PolicyBody {
  severities: Record<SeverityKey, SeverityTargets>;
  coverage: Coverage;
  clock: { start: StartRule; pause: PauseKey[]; stop: StopRule };
  breach: BreachHandling;
  /** Registered company members' e-mails on the company's own domain (step recipient "extra"). */
  extra_contacts: string[];
}

export interface PolicyMeta {
  name: string;
  description: string;
  applies_to: { kind: AppliesKind; values: string[] };
}

export interface SeverityDef {
  key: SeverityKey;
  rank: number;
  color: 'destructive' | 'warning' | 'info' | 'muted';
  label_en: string;
  label_ar: string;
  definition_en: string;
  definition_ar: string;
  examples_en: string[];
  examples_ar: string[];
}

export interface PremiumRule { severity: SeverityKey; field: 'response' | 'resolution'; under_min: number; requires: 'critical_service' }

export interface SlaBounds {
  min_response: Record<SeverityKey, number>;
  min_resolution: Record<SeverityKey, number>;
  max_escalations: number;
  allowed_coverage: CoverageMode[];
  allowed_start: StartRule[];
  allowed_pause: PauseKey[];
  premium: PremiumRule[];
  max_repeats: number;
  min_repeat_min: number;
  max_extra_contacts: number;
}

export interface SlaSettings {
  enabled: boolean;
  severities: SeverityDef[];
  urgency_map: Record<Urgency, SeverityKey>;
  bounds: SlaBounds;
  at_risk_pct: number;
  quiet_hours: { start: string; end: string };
  unpausable_allowed: boolean;
  require_acceptance: boolean;
  compliance_alert_pct: number;
  channels_enabled: Record<Channel, boolean>;
}

// ------------------------------------------------------------------------------------------------ defaults
export const DEFAULT_SEVERITIES: SeverityDef[] = [
  { key: 'S1', rank: 1, color: 'destructive', label_en: 'Critical', label_ar: 'حرج',
    definition_en: 'Production is down or a business-critical process is blocked and there is no workaround.',
    definition_ar: 'نظام الإنتاج متوقف أو عملية حرجة للأعمال متوقفة ولا يوجد حل بديل.',
    examples_en: ['Production system down', 'Financial close or payroll run blocked', 'No goods can be shipped or invoiced'],
    examples_ar: ['توقف نظام الإنتاج', 'تعطل الإقفال المالي أو تشغيل الرواتب', 'تعذر شحن البضائع أو إصدار الفواتير'] },
  { key: 'S2', rank: 2, color: 'warning', label_en: 'High', label_ar: 'مرتفع',
    definition_en: 'A key function is seriously degraded or blocked for many users; a workaround is hard to use or missing.',
    definition_ar: 'وظيفة أساسية متعطلة بشدة أو متوقفة لعدد كبير من المستخدمين، والحل البديل صعب أو غير موجود.',
    examples_en: ['Interface to a bank or warehouse failing', 'Key report wrong before a deadline', 'Many users cannot post documents'],
    examples_ar: ['تعطل الربط مع البنك أو المستودع', 'تقرير أساسي غير صحيح قبل موعد نهائي', 'عدد كبير من المستخدمين لا يستطيع ترحيل المستندات'] },
  { key: 'S3', rank: 3, color: 'info', label_en: 'Medium', label_ar: 'متوسط',
    definition_en: 'A function does not work as expected; a reasonable workaround exists or few users are affected.',
    definition_ar: 'وظيفة لا تعمل كما هو متوقع، ويوجد حل بديل مقبول أو يتأثر عدد قليل من المستخدمين.',
    examples_en: ['One transaction gives an error for some users', 'Layout of a form is wrong', 'A batch job needs a manual restart'],
    examples_ar: ['معاملة تعطي خطأ لبعض المستخدمين', 'تنسيق نموذج غير صحيح', 'مهمة مجدولة تحتاج إلى إعادة تشغيل يدوية'] },
  { key: 'S4', rank: 4, color: 'muted', label_en: 'Low', label_ar: 'منخفض',
    definition_en: 'Question, how-to, small defect or change request with little business impact.',
    definition_ar: 'سؤال أو استفسار عن طريقة استخدام أو عيب بسيط أو طلب تغيير بتأثير محدود على الأعمال.',
    examples_en: ['How do I run this report?', 'Small text change', 'Advice on a planned change'],
    examples_ar: ['كيف أشغّل هذا التقرير؟', 'تعديل نص بسيط', 'استشارة حول تغيير مخطط له'] },
];

export const DEFAULT_URGENCY_MAP: Record<Urgency, SeverityKey> = { critical: 'S1', high: 'S2', medium: 'S3', low: 'S4' };

export const DEFAULT_BOUNDS: SlaBounds = {
  min_response: { S1: 15, S2: 30, S3: 60, S4: 120 },
  min_resolution: { S1: 120, S2: 240, S3: 480, S4: 960 },
  max_escalations: 6,
  allowed_coverage: ['24x7', 'business'],
  allowed_start: ['submitted', 'assigned', 'ready'],
  allowed_pause: [...PAUSE_KEYS],
  premium: [{ severity: 'S1', field: 'response', under_min: 60, requires: 'critical_service' }],
  max_repeats: 6,
  min_repeat_min: 30,
  max_extra_contacts: 5,
};

export const DEFAULT_SETTINGS: SlaSettings = {
  enabled: false,
  severities: DEFAULT_SEVERITIES,
  urgency_map: DEFAULT_URGENCY_MAP,
  bounds: DEFAULT_BOUNDS,
  at_risk_pct: 75,
  quiet_hours: { start: '22:00', end: '07:00' },
  unpausable_allowed: true,
  require_acceptance: true,
  compliance_alert_pct: 90,
  channels_enabled: { in_app: true, email: true, push: true, telegram: true },
};

const step = (clock: ClockKind, kind: EscalationStep['kind'], value: number, who: Recipient[], channels: Channel[], template: StepTemplate,
  extra: Partial<EscalationStep> = {}): EscalationStep => ({ clock, kind, value, who, channels, template, repeat_min: null, until_ack: false, unpausable: false, ...extra });

const BUSINESS: Coverage = { mode: 'business', tz: null, days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00', holidays: [], holiday_lists: [] };
const ALWAYS: Coverage = { mode: '24x7', tz: null, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', holidays: [], holiday_lists: [] };
const ALL_PAUSES: PauseKey[] = [...PAUSE_KEYS];

function ladder(full: boolean, s1: boolean): EscalationStep[] {
  if (!full) {
    return [
      step('response', 'percent', 75, ['lead'], ['in_app'], 'reminder'),
      step('response', 'percent', 100, ['lead', 'client_contact'], ['in_app', 'email'], 'breach'),
      step('resolution', 'percent', 90, ['all_assigned'], ['in_app', 'email'], 'reminder'),
      step('resolution', 'percent', 100, ['all_assigned', 'client_contact'], ['in_app', 'email'], 'breach'),
    ];
  }
  return [
    step('response', 'percent', 50, ['lead'], ['in_app'], 'reminder'),
    step('response', 'percent', 75, ['all_assigned'], ['in_app', 'email'], 'reminder'),
    step('response', 'percent', 90, ['all_assigned', 'client_manager'], ['in_app', 'email', 'push'], 'escalation', { unpausable: s1 }),
    step('response', 'percent', 100, ['lead', 'client_contact', 'admin'], ['in_app', 'email', 'push', 'telegram'], 'breach', { unpausable: s1 }),
    step('resolution', 'percent', 90, ['all_assigned'], ['in_app', 'email'], 'reminder'),
    step('resolution', 'after_breach', 60, ['admin', 'client_manager'], ['in_app', 'email'], 'after_breach', { repeat_min: 120, until_ack: true }),
  ];
}

const targets = (r: number, w: number | null, res: number, escalations: EscalationStep[]): SeverityTargets => ({ response_min: r, workaround_min: w, resolution_min: res, escalations });

/**
 * Platform default policy = today's behaviour (live system rows of ticket_sla_policies, 24x7, measured from submission,
 * one breach notice in-app to the assigned consultant and administrators). The SQL seed uses the same numbers.
 */
export function platformDefaultBody(): PolicyBody {
  const breachOnly = (): EscalationStep[] => [
    step('response', 'percent', 100, ['lead', 'admin'], ['in_app'], 'breach'),
    step('resolution', 'percent', 100, ['lead', 'admin'], ['in_app'], 'breach'),
  ];
  return {
    severities: {
      S1: targets(60, null, 480, breachOnly()),
      S2: targets(240, null, 1440, breachOnly()),
      S3: targets(480, null, 4320, breachOnly()),
      S4: targets(1440, null, 10080, breachOnly()),
    },
    coverage: { ...ALWAYS },
    clock: { start: 'submitted', pause: [], stop: 'resolved' },
    breach: { notify: true, flag: true, ask_client: false, offer_replacement: false },
    extra_contacts: [],
  };
}

export const TEMPLATE_KEYS = ['standard', 'enterprise_24x7', 'business_light'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Starting points a client can copy (admin-editable in the database; these are the seeded values). */
export function templateBody(key: TemplateKey): PolicyBody {
  const base = { clock: { start: 'assigned' as StartRule, pause: ALL_PAUSES, stop: 'resolved' as StopRule }, extra_contacts: [] as string[] };
  if (key === 'enterprise_24x7') {
    return { ...base, coverage: { ...ALWAYS },
      breach: { notify: true, flag: true, ask_client: true, offer_replacement: true },
      severities: { S1: targets(60, 240, 480, ladder(true, true)), S2: targets(120, null, 1440, ladder(true, false)),
        S3: targets(480, null, 2880, ladder(true, false)), S4: targets(1440, null, 7200, ladder(false, false)) } };
  }
  if (key === 'business_light') {
    return { ...base, coverage: { ...BUSINESS },
      breach: { notify: true, flag: true, ask_client: false, offer_replacement: false },
      severities: { S1: targets(120, null, 1920, ladder(false, false)), S2: targets(240, null, 2880, ladder(false, false)),
        S3: targets(960, null, 4800, ladder(false, false)), S4: targets(1920, null, 9600, ladder(false, false)) } };
  }
  return { ...base, coverage: { ...BUSINESS },
    breach: { notify: true, flag: true, ask_client: true, offer_replacement: false },
    severities: { S1: targets(60, 240, 960, ladder(true, true)), S2: targets(120, null, 960, ladder(true, false)),
      S3: targets(480, null, 2400, ladder(true, false)), S4: targets(960, null, 4800, ladder(false, false)) } };
}

// ------------------------------------------------------------------------------------------------ normalise
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed as readonly string[]).includes(String(v)) ? (v as T) : dflt;
const pickAll = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.map(String).filter((x): x is T => (allowed as readonly string[]).includes(x)))] : [];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Keeps known keys and plausible values only (the database validates again and refuses what this would change). */
export function normalizeBody(raw: unknown): PolicyBody {
  const src = isObj(raw) ? raw : {};
  const def = platformDefaultBody();
  const sevSrc = isObj(src.severities) ? src.severities : {};
  const severities = {} as Record<SeverityKey, SeverityTargets>;
  for (const k of SEVERITY_KEYS) {
    const s = isObj(sevSrc[k]) ? (sevSrc[k] as Record<string, unknown>) : {};
    const d = def.severities[k];
    const w = s.workaround_min;
    severities[k] = {
      response_min: intIn(s.response_min, 1, MAX_TARGET_MIN, d.response_min),
      workaround_min: w === null || w === undefined || w === '' ? null : intIn(w, 1, MAX_TARGET_MIN, d.resolution_min),
      resolution_min: intIn(s.resolution_min, 1, MAX_TARGET_MIN, d.resolution_min),
      escalations: Array.isArray(s.escalations) ? s.escalations.filter(isObj).slice(0, 20).map(normalizeStep) : [],
    };
  }
  const c = isObj(src.coverage) ? src.coverage : {};
  const coverage: Coverage = {
    mode: pick(c.mode, COVERAGE_MODES, '24x7'),
    tz: typeof c.tz === 'string' && c.tz.trim() ? c.tz.trim().slice(0, 64) : null,
    days: Array.isArray(c.days) ? [...new Set(c.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [...BUSINESS.days],
    start: typeof c.start === 'string' && HHMM.test(c.start) ? c.start : BUSINESS.start,
    end: typeof c.end === 'string' && HHMM.test(c.end) ? c.end : BUSINESS.end,
    holidays: Array.isArray(c.holidays) ? [...new Set(c.holidays.map(String).filter((d) => DAY.test(d)))].sort().slice(0, 200) : [],
    holiday_lists: Array.isArray(c.holiday_lists) ? [...new Set(c.holiday_lists.map(String).filter((x) => /^[A-Za-z0-9_-]{1,24}$/.test(x)))].slice(0, 5) : [],
  };
  const k = isObj(src.clock) ? src.clock : {};
  const b = isObj(src.breach) ? src.breach : {};
  return {
    severities,
    coverage,
    clock: { start: pick(k.start, START_RULES, 'assigned'), pause: pickAll(k.pause, PAUSE_KEYS), stop: pick(k.stop, STOP_RULES, 'resolved') },
    breach: { notify: b.notify !== false, flag: b.flag !== false, ask_client: b.ask_client === true, offer_replacement: b.offer_replacement === true },
    extra_contacts: Array.isArray(src.extra_contacts) ? [...new Set(src.extra_contacts.map((e) => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 10) : [],
  };
}

function normalizeStep(s: Record<string, unknown>): EscalationStep {
  const kind = pick(s.kind, ['percent', 'after_breach'] as const, 'percent');
  const rep = s.repeat_min;
  return {
    clock: pick(s.clock, CLOCK_KINDS, 'response'),
    kind,
    value: kind === 'percent' ? intIn(s.value, 1, 100, 100) : intIn(s.value, 1, 10080, 60),
    who: pickAll(s.who, RECIPIENTS),
    // An unknown channel (e.g. "sms") is kept out here and reported by policyProblems on the raw input.
    channels: pickAll(s.channels, CHANNELS),
    template: pick(s.template, STEP_TEMPLATES, 'reminder'),
    repeat_min: rep === null || rep === undefined || rep === '' ? null : intIn(rep, 1, 10080, 30),
    until_ack: s.until_ack === true,
    unpausable: s.unpausable === true,
  };
}

// ------------------------------------------------------------------------------------------------ calendar maths
interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; dow: number }
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    dtf(tz).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock parts of an instant in a time zone. */
export function localParts(ms: number, tz: string): LocalParts {
  const parts = dtf(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = get('year'), m = get('month'), d = get('day');
  return { y, m, d, hh: get('hour') % 24, mm: get('minute'), dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function offsetMs(ms: number, tz: string): number {
  const p = dtf(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instant of a local wall-clock time (a time inside a DST gap moves forward like PostgreSQL does). */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const o1 = offsetMs(guess - offsetMs(guess, tz), tz);
  const first = guess - o1;
  const o2 = offsetMs(first, tz);
  return o2 === o1 ? first : guess - Math.max(o1, o2);
}

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return { h, m };
};
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function nextDay(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Calendar actually used for counting: time zone resolved, holiday lists expanded to dates. */
export interface ResolvedCalendar { mode: CoverageMode; tz: string; days: number[]; start: string; end: string; holidays: string[] }

export function resolveCalendar(c: Coverage, companyTz: string | null | undefined, listDates: Record<string, string[]> = {}): ResolvedCalendar {
  const tz = isValidTimeZone(c.tz) ? c.tz : isValidTimeZone(companyTz) ? companyTz : 'UTC';
  const holidays = new Set(c.holidays);
  for (const key of c.holiday_lists) for (const day of listDates[key] ?? []) holidays.add(day);
  return { mode: c.mode, tz, days: c.days, start: c.start, end: c.end, holidays: [...holidays].sort() };
}

function windowsOf(cal: ResolvedCalendar, p: { y: number; m: number; d: number }): [number, number] | null {
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  if (!cal.days.includes(dow) || cal.holidays.includes(ymd(p.y, p.m, p.d))) return null;
  const s = hm(cal.start), e = hm(cal.end);
  const ws = zonedToUtc(p.y, p.m, p.d, s.h, s.m, cal.tz);
  const we = zonedToUtc(p.y, p.m, p.d, e.h, e.m, cal.tz);
  return we > ws ? [ws, we] : null;
}

/** Minutes between two instants that count under the calendar (24x7 = every minute). Never negative. */
export function businessMinutes(fromMs: number, toMs: number, cal: ResolvedCalendar): number {
  if (!(toMs > fromMs)) return 0;
  if (cal.mode === '24x7') return (toMs - fromMs) / MINUTE;
  let total = 0;
  let p = localParts(fromMs, cal.tz);
  let day = { y: p.y, m: p.m, d: p.d };
  for (let i = 0; i < MAX_DAYS_SCANNED; i++) {
    const w = windowsOf(cal, day);
    if (w) {
      const a = Math.max(fromMs, w[0]), b = Math.min(toMs, w[1]);
      if (b > a) total += (b - a) / MINUTE;
      if (w[0] >= toMs) break;
    }
    const n = nextDay(day.y, day.m, day.d);
    // Stop once the day starts after the end instant.
    if (zonedToUtc(n.y, n.m, n.d, 0, 0, cal.tz) >= toMs) break;
    day = n;
  }
  p = undefined as unknown as LocalParts;
  return total;
}

/** Instant at which `minutes` counted minutes have passed after `fromMs`; null when the calendar has no working time. */
export function addBusinessMinutes(fromMs: number, minutes: number, cal: ResolvedCalendar): number | null {
  if (!(minutes > 0)) return fromMs;
  if (cal.mode === '24x7') return fromMs + minutes * MINUTE;
  let left = minutes;
  const p = localParts(fromMs, cal.tz);
  let day = { y: p.y, m: p.m, d: p.d };
  for (let i = 0; i < MAX_DAYS_SCANNED; i++) {
    const w = windowsOf(cal, day);
    if (w) {
      const s = Math.max(fromMs, w[0]);
      if (w[1] > s) {
        const avail = (w[1] - s) / MINUTE;
        if (left <= avail) return s + left * MINUTE;
        left -= avail;
      }
    }
    day = nextDay(day.y, day.m, day.d);
  }
  return null;
}

/** True when the instant is inside working time (always true for 24x7). */
export function inCoverage(ms: number, cal: ResolvedCalendar): boolean {
  if (cal.mode === '24x7') return true;
  const p = localParts(ms, cal.tz);
  const w = windowsOf(cal, p);
  return !!w && ms >= w[0] && ms < w[1];
}

// ------------------------------------------------------------------------------------------------ clocks
export interface ClockRow {
  kind: ClockKind;
  target_min: number;
  extended_min: number;
  started_at: string | null;
  running_since: string | null;
  consumed_min: number;
  paused_since: string | null;
  pause_reason: string | null;
  due_at: string | null;
  met_at: string | null;
  breached_at: string | null;
  stopped_at: string | null;
}

export type ClockState = 'not_started' | 'on_track' | 'at_risk' | 'paused' | 'outside_hours' | 'breached' | 'met' | 'met_late';

export const totalTarget = (c: Pick<ClockRow, 'target_min' | 'extended_min'>) => c.target_min + (c.extended_min || 0);

export function consumedAt(c: ClockRow, nowMs: number, cal: ResolvedCalendar): number {
  const base = Number(c.consumed_min) || 0;
  return c.running_since ? base + businessMinutes(Date.parse(c.running_since), nowMs, cal) : base;
}

export function dueAt(c: ClockRow, cal: ResolvedCalendar): number | null {
  if (!c.running_since) return null;
  return addBusinessMinutes(Date.parse(c.running_since), Math.max(0, totalTarget(c) - (Number(c.consumed_min) || 0)), cal);
}

export function clockState(c: ClockRow, nowMs: number, cal: ResolvedCalendar, atRiskPct = 75): { state: ClockState; pct: number; leftMin: number } {
  const target = totalTarget(c);
  const used = consumedAt(c, nowMs, cal);
  const pct = target > 0 ? Math.min(999, (used / target) * 100) : 0;
  const leftMin = Math.round(target - used);
  if (c.met_at) return { state: c.breached_at || used > target ? 'met_late' : 'met', pct, leftMin };
  if (!c.started_at) return { state: 'not_started', pct: 0, leftMin: target };
  if (c.breached_at || used >= target) return { state: 'breached', pct, leftMin };
  if (!c.running_since) return { state: 'paused', pct, leftMin };
  if (!inCoverage(nowMs, cal)) return { state: 'outside_hours', pct, leftMin };
  return { state: pct >= atRiskPct ? 'at_risk' : 'on_track', pct, leftMin };
}

export type ClockEvent = { at: number; type: 'start' | 'pause' | 'resume' | 'stop' };

/** Replays start/pause/resume/stop events (the database stores the same transitions); used by tests and simulations. */
export function replayClock(targetMin: number, cal: ResolvedCalendar, events: ClockEvent[], nowMs: number) {
  let consumed = 0;
  let running: number | null = null;
  let started = false;
  let stoppedAt: number | null = null;
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.at > nowMs || stoppedAt !== null) break;
    if (e.type === 'start' && !started) { started = true; running = e.at; }
    else if (e.type === 'pause' && running !== null) { consumed += businessMinutes(running, e.at, cal); running = null; }
    else if (e.type === 'resume' && started && running === null) { running = e.at; }
    else if (e.type === 'stop' && started) { if (running !== null) consumed += businessMinutes(running, e.at, cal); running = null; stoppedAt = e.at; }
  }
  const used = running !== null ? consumed + businessMinutes(running, nowMs, cal) : consumed;
  const due = running !== null ? addBusinessMinutes(running, Math.max(0, targetMin - consumed), cal) : null;
  return { consumed: used, due, running: running !== null, stoppedAt, breached: used >= targetMin && targetMin > 0 };
}

// ------------------------------------------------------------------------------------------------ escalations
/** Counted minutes after the clock start at which a step fires. */
export function stepThreshold(s: EscalationStep, targetMin: number): number {
  return s.kind === 'percent' ? Math.ceil((targetMin * s.value) / 100) : targetMin + s.value;
}

export const stepKey = (s: EscalationStep, index: number) => `${s.clock}:${index}:${s.kind === 'percent' ? 'p' : 'b'}${s.value}`;

/** Steps that are due now and not yet sent (first sending only; repeats are decided by repeatDue). */
export function dueSteps(steps: EscalationStep[], clock: ClockKind, targetMin: number, consumedMin: number, sentKeys: ReadonlySet<string>) {
  return steps
    .map((s, i) => ({ s, key: stepKey(s, i) }))
    .filter(({ s, key }) => s.clock === clock && !sentKeys.has(key) && consumedMin >= stepThreshold(s, targetMin));
}

/** Next repeat number (1, 2, ...) that is due, or null. Repeats are at least `minRepeat` minutes apart and capped. */
export function repeatDue(s: EscalationStep, firstSentMs: number, lastSeq: number, nowMs: number, acked: boolean, bounds: Pick<SlaBounds, 'max_repeats' | 'min_repeat_min'>): number | null {
  if (!s.repeat_min || (s.until_ack && acked)) return null;
  const every = Math.max(s.repeat_min, bounds.min_repeat_min) * MINUTE;
  const seq = Math.floor((nowMs - firstSentMs) / every);
  if (seq <= lastSeq || seq < 1) return null;
  return Math.min(seq, bounds.max_repeats) > lastSeq ? Math.min(seq, bounds.max_repeats) : null;
}

/** When each step of one clock would fire for a clock started at `startMs` without pauses (preview and admin dry run). */
export function escalationPlan(steps: EscalationStep[], clock: ClockKind, targetMin: number, startMs: number, cal: ResolvedCalendar) {
  return steps
    .map((s, i) => ({ s, key: stepKey(s, i) }))
    .filter(({ s }) => s.clock === clock)
    .map(({ s, key }) => ({ key, step: s, at: addBusinessMinutes(startMs, stepThreshold(s, targetMin), cal) }));
}

/** Quiet hours in the recipient's time zone (start > end means overnight, e.g. 22:00-07:00). */
export function inQuietHours(nowMs: number, tz: string | null | undefined, q: { start: string; end: string }): boolean {
  const zone = isValidTimeZone(tz) ? tz : 'UTC';
  const p = localParts(nowMs, zone);
  const now = p.hh * 60 + p.mm;
  const s = hm(q.start), e = hm(q.end);
  const a = s.h * 60 + s.m, b = e.h * 60 + e.m;
  if (a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

// ------------------------------------------------------------------------------------------------ validation
export type ProblemLevel = 'error' | 'warning';
export interface PolicyProblem { code: string; level: ProblemLevel; path: string; params?: Record<string, string | number> }

const EMAIL = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;
// Same idea as the database contact_details_in_text (M60): free text must not carry contact details.
const CONTACT = [
  /[a-z0-9._%+-]+\s?(@|\[at\]|\(at\))\s?[a-z0-9-]+(\.|\s?\[dot\]\s?)[a-z]{2,}/i,
  /(https?:\/\/|www\.)\S+/i,
  /\b(whats\s?app|telegram|skype|viber|wechat|t\.me)\b/i,
  /(\+|\b00)\d[\d\s().-]{7,}\d/,
  /\b\d{9,}\b/,
];
export const hasContactDetails = (t: string) => CONTACT.some((r) => r.test(t));

export interface ValidationContext {
  bounds: SlaBounds;
  unpausableAllowed: boolean;
  /** Domains the client's extra contacts may use (company domain); empty = no extra contacts allowed. */
  allowedDomains?: string[];
  /** Registered company members' e-mails (lower case); extra contacts must be one of them. */
  memberEmails?: string[];
}

/**
 * Problems of a policy against the admin bounds. Errors block activation (the database refuses them too); warnings
 * explain what is needed (e.g. a premium service). `raw` is the editor's input before normalisation, so a channel
 * such as "sms" is reported instead of silently dropped.
 */
export function policyProblems(body: PolicyBody, meta: PolicyMeta, ctx: ValidationContext, raw?: unknown): PolicyProblem[] {
  const out: PolicyProblem[] = [];
  const b = ctx.bounds;
  const name = meta.name.trim();
  if (!name || name.length > 120) out.push({ code: 'name_length', level: 'error', path: 'name' });
  if (meta.description.length > 1000) out.push({ code: 'description_length', level: 'error', path: 'description' });
  if (hasContactDetails(`${meta.name} ${meta.description}`)) out.push({ code: 'contact_details', level: 'error', path: 'description' });
  if (meta.applies_to.kind !== 'all' && meta.applies_to.values.length === 0) out.push({ code: 'applies_empty', level: 'error', path: 'applies_to' });

  for (const k of SEVERITY_KEYS) {
    const s = body.severities[k];
    const p = `severities.${k}`;
    if (s.response_min < b.min_response[k]) out.push({ code: 'below_min_response', level: 'error', path: `${p}.response_min`, params: { severity: k, min: b.min_response[k] } });
    if (s.resolution_min < b.min_resolution[k]) out.push({ code: 'below_min_resolution', level: 'error', path: `${p}.resolution_min`, params: { severity: k, min: b.min_resolution[k] } });
    if (s.resolution_min <= s.response_min) out.push({ code: 'resolution_before_response', level: 'error', path: `${p}.resolution_min`, params: { severity: k } });
    if (s.workaround_min !== null && (s.workaround_min < s.response_min || s.workaround_min > s.resolution_min)) {
      out.push({ code: 'workaround_order', level: 'error', path: `${p}.workaround_min`, params: { severity: k } });
    }
    for (const r of b.premium) {
      if (r.severity !== k) continue;
      const v = r.field === 'response' ? s.response_min : s.resolution_min;
      if (v < r.under_min) out.push({ code: 'premium_required', level: 'warning', path: `${p}.${r.field}_min`, params: { severity: k, under: r.under_min, requires: r.requires } });
    }
    if (s.escalations.length > b.max_escalations) out.push({ code: 'too_many_steps', level: 'error', path: `${p}.escalations`, params: { severity: k, max: b.max_escalations } });
    const lastByClock: Record<string, number> = {};
    s.escalations.forEach((st, i) => {
      const sp = `${p}.escalations.${i}`;
      if (!st.who.length) out.push({ code: 'step_no_recipient', level: 'error', path: sp, params: { severity: k, step: i + 1 } });
      if (!st.channels.length) out.push({ code: 'step_no_channel', level: 'error', path: sp, params: { severity: k, step: i + 1 } });
      if (st.clock === 'workaround' && s.workaround_min === null) out.push({ code: 'step_no_workaround', level: 'error', path: sp, params: { severity: k, step: i + 1 } });
      if (st.repeat_min !== null && st.repeat_min < b.min_repeat_min) out.push({ code: 'repeat_too_often', level: 'error', path: sp, params: { severity: k, step: i + 1, min: b.min_repeat_min } });
      if (st.unpausable && (k !== 'S1' || !ctx.unpausableAllowed)) out.push({ code: 'unpausable_not_allowed', level: 'error', path: sp, params: { severity: k, step: i + 1 } });
      if (st.who.includes('extra') && body.extra_contacts.length === 0) out.push({ code: 'step_extra_missing', level: 'error', path: sp, params: { severity: k, step: i + 1 } });
      const th = st.kind === 'percent' ? st.value : 100 + st.value / 1000;
      if (lastByClock[st.clock] !== undefined && th <= lastByClock[st.clock]) out.push({ code: 'steps_order', level: 'error', path: sp, params: { severity: k, step: i + 1 } });
      lastByClock[st.clock] = th;
    });
  }
  // Unknown channels in the raw input (e.g. SMS) are refused, not dropped.
  const rawSev = isObj(raw) && isObj(raw.severities) ? raw.severities : null;
  if (rawSev) {
    for (const k of SEVERITY_KEYS) {
      const s = rawSev[k];
      const steps = isObj(s) && Array.isArray(s.escalations) ? s.escalations : [];
      steps.forEach((st, i) => {
        const ch = isObj(st) && Array.isArray(st.channels) ? st.channels.map(String) : [];
        if (ch.some((c) => !(CHANNELS as readonly string[]).includes(c))) out.push({ code: 'channel_not_allowed', level: 'error', path: `severities.${k}.escalations.${i}`, params: { severity: k, step: i + 1 } });
      });
    }
  }

  const c = body.coverage;
  if (!b.allowed_coverage.includes(c.mode)) out.push({ code: 'coverage_not_allowed', level: 'error', path: 'coverage.mode', params: { mode: c.mode } });
  if (c.tz !== null && !isValidTimeZone(c.tz)) out.push({ code: 'bad_timezone', level: 'error', path: 'coverage.tz' });
  if (c.mode === 'business') {
    if (!c.days.length) out.push({ code: 'no_working_days', level: 'error', path: 'coverage.days' });
    if (c.end <= c.start) out.push({ code: 'end_before_start', level: 'error', path: 'coverage.end' });
  }
  if (!b.allowed_start.includes(body.clock.start)) out.push({ code: 'start_not_allowed', level: 'error', path: 'clock.start' });
  for (const pz of body.clock.pause) if (!b.allowed_pause.includes(pz)) out.push({ code: 'pause_not_allowed', level: 'error', path: 'clock.pause', params: { pause: pz } });

  if (body.extra_contacts.length > b.max_extra_contacts) out.push({ code: 'too_many_contacts', level: 'error', path: 'extra_contacts', params: { max: b.max_extra_contacts } });
  const domains = (ctx.allowedDomains ?? []).map((d) => d.toLowerCase());
  const members = new Set((ctx.memberEmails ?? []).map((e) => e.toLowerCase()));
  for (const e of body.extra_contacts) {
    const domain = e.split('@')[1] ?? '';
    if (!EMAIL.test(e)) out.push({ code: 'contact_invalid', level: 'error', path: 'extra_contacts', params: { email: e } });
    else if (FREE_MAIL.includes(domain) || !domains.includes(domain)) out.push({ code: 'contact_domain', level: 'error', path: 'extra_contacts', params: { email: e } });
    else if (ctx.memberEmails && !members.has(e)) out.push({ code: 'contact_not_member', level: 'error', path: 'extra_contacts', params: { email: e } });
  }
  return out;
}

export const hasErrors = (p: PolicyProblem[]) => p.some((x) => x.level === 'error');

// ------------------------------------------------------------------------------------------------ snapshot + diff
export interface TicketSnapshot {
  policy_id: string;
  policy_name: string;
  version: number;
  severity: SeverityKey;
  response_min: number;
  workaround_min: number | null;
  resolution_min: number;
  /** True when the policy's premium target was not bought (e.g. S1 under 60 min without the Critical service). */
  premium_capped: boolean;
  calendar: ResolvedCalendar;
  clock: PolicyBody['clock'];
  escalations: EscalationStep[];
  breach: BreachHandling;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return o;
}

/** What is copied onto a ticket (immutable copy; later policy edits never change it). Mirrors sla_snapshot_data. */
export function snapshotFor(policy: { id: string; name: string; version: number; body: PolicyBody }, severity: SeverityKey,
  opts: { criticalService: boolean; premium: PremiumRule[]; calendar: ResolvedCalendar }): TicketSnapshot {
  const body = JSON.parse(JSON.stringify(policy.body)) as PolicyBody;
  const s = body.severities[severity];
  let response = s.response_min, resolution = s.resolution_min, capped = false;
  if (!opts.criticalService) {
    for (const r of opts.premium) {
      if (r.severity !== severity) continue;
      if (r.field === 'response' && response < r.under_min) { response = r.under_min; capped = true; }
      if (r.field === 'resolution' && resolution < r.under_min) { resolution = r.under_min; capped = true; }
    }
  }
  return deepFreeze({
    policy_id: policy.id, policy_name: policy.name, version: policy.version, severity,
    response_min: response, workaround_min: s.workaround_min, resolution_min: Math.max(resolution, response + 1), premium_capped: capped,
    calendar: JSON.parse(JSON.stringify(opts.calendar)), clock: body.clock, escalations: s.escalations, breach: body.breach,
  });
}

export interface DiffLine { path: string; before: unknown; after: unknown }

function flatten(v: unknown, prefix: string, out: Record<string, unknown>) {
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) { out[prefix] = v.join(', '); return; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
    if (Array.isArray(v) && v.length === 0) out[prefix] = '';
    return;
  }
  out[prefix] = v;
}

/** Field-level differences between two policy versions (body + meta), for the version history. */
export function diffPolicies(a: { body: PolicyBody; meta?: Partial<PolicyMeta> }, b: { body: PolicyBody; meta?: Partial<PolicyMeta> }): DiffLine[] {
  const fa: Record<string, unknown> = {}, fb: Record<string, unknown> = {};
  flatten({ meta: a.meta ?? {}, ...a.body }, '', fa);
  flatten({ meta: b.meta ?? {}, ...b.body }, '', fb);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  return keys.filter((k) => JSON.stringify(fa[k]) !== JSON.stringify(fb[k])).map((k) => ({ path: k, before: fa[k], after: fb[k] }));
}

// ------------------------------------------------------------------------------------------------ text helpers
export function formatMinutes(min: number | null | undefined, lang: 'en' | 'ar' = 'en'): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const neg = min < 0;
  let m = Math.round(Math.abs(min));
  const d = Math.floor(m / 1440); m -= d * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  const u = lang === 'ar' ? { d: 'ي', h: 'س', m: 'د' } : { d: 'd', h: 'h', m: 'm' };
  const parts = d ? [`${d} ${u.d}`, h ? `${h} ${u.h}` : ''] : h ? [`${h} ${u.h}`, m ? `${m} ${u.m}` : ''] : [`${m} ${u.m}`];
  return (neg ? '-' : '') + parts.filter(Boolean).join(' ');
}

/** Target as the client wrote it: business-hour targets that are whole 8-hour days read as business days. */
export function formatTarget(min: number, mode: CoverageMode, hoursPerDay: number, lang: 'en' | 'ar' = 'en'): string {
  if (mode === 'business' && hoursPerDay > 0 && min >= hoursPerDay * 60 && min % (hoursPerDay * 60) === 0) {
    const n = min / (hoursPerDay * 60);
    return lang === 'ar' ? `${n} يوم عمل` : `${n} business day${n === 1 ? '' : 's'}`;
  }
  return formatMinutes(min, lang);
}

export const hoursPerDay = (c: Pick<Coverage, 'start' | 'end'>) => {
  const s = hm(c.start), e = hm(c.end);
  return Math.max(0, (e.h * 60 + e.m - (s.h * 60 + s.m)) / 60);
};

/** Live preview numbers: when the response and resolution would be due for a ticket opened at `openedMs`. */
export function previewDue(body: PolicyBody, severity: SeverityKey, openedMs: number, cal: ResolvedCalendar) {
  const s = body.severities[severity];
  return {
    response: addBusinessMinutes(openedMs, s.response_min, cal),
    workaround: s.workaround_min ? addBusinessMinutes(openedMs, s.workaround_min, cal) : null,
    resolution: addBusinessMinutes(openedMs, s.resolution_min, cal),
  };
}

/** One-line summary the consultant accepts ("S2 response 2 h, resolution 2 business days, escalations to ..."). */
export function acceptanceSummary(snap: Pick<TicketSnapshot, 'severity' | 'response_min' | 'resolution_min' | 'workaround_min' | 'calendar' | 'escalations'>, lang: 'en' | 'ar' = 'en', labels?: Partial<Record<Recipient, string>>): string {
  const hpd = hoursPerDay(snap.calendar);
  const f = (m: number) => formatTarget(m, snap.calendar.mode, hpd, lang);
  const who = [...new Set(snap.escalations.flatMap((s) => s.who))].map((w) => labels?.[w] ?? w);
  if (lang === 'ar') {
    return `${snap.severity}: الاستجابة ${f(snap.response_min)}${snap.workaround_min ? `، الحل المؤقت ${f(snap.workaround_min)}` : ''}، الحل ${f(snap.resolution_min)}`
      + (snap.calendar.mode === 'business' ? ' (ساعات العمل)' : ' (24×7)') + (who.length ? `، التصعيد إلى ${who.join('، ')}` : '');
  }
  return `${snap.severity} response ${f(snap.response_min)}${snap.workaround_min ? `, workaround ${f(snap.workaround_min)}` : ''}, resolution ${f(snap.resolution_min)}`
    + (snap.calendar.mode === 'business' ? ' (business hours)' : ' (24x7)') + (who.length ? `, escalations to ${who.join(', ')}` : '');
}

export function severityFor(urgency: string | null | undefined, map: Record<string, string> = DEFAULT_URGENCY_MAP): SeverityKey {
  const k = map[String(urgency ?? 'medium')] ?? DEFAULT_URGENCY_MAP[(urgency as Urgency) ?? 'medium'] ?? 'S3';
  return (SEVERITY_KEYS as readonly string[]).includes(k) ? (k as SeverityKey) : 'S3';
}

export function normalizeSettings(raw: unknown): SlaSettings {
  const s = isObj(raw) ? raw : {};
  const sev = Array.isArray(s.severities) ? s.severities.filter(isObj) : [];
  const severities = DEFAULT_SEVERITIES.map((d) => {
    const x = sev.find((r) => r.key === d.key) ?? {};
    const str = (v: unknown, dflt: string, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : dflt);
    const list = (v: unknown, dflt: string[]) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 6) : dflt);
    return { ...d, color: pick(x.color, ['destructive', 'warning', 'info', 'muted'] as const, d.color),
      label_en: str(x.label_en, d.label_en, 40), label_ar: str(x.label_ar, d.label_ar, 40),
      definition_en: str(x.definition_en, d.definition_en), definition_ar: str(x.definition_ar, d.definition_ar),
      examples_en: list(x.examples_en, d.examples_en), examples_ar: list(x.examples_ar, d.examples_ar) };
  });
  const um = isObj(s.urgency_map) ? s.urgency_map : {};
  const urgency_map = Object.fromEntries(URGENCIES.map((u) => [u, pick(um[u], SEVERITY_KEYS, DEFAULT_URGENCY_MAP[u])])) as Record<Urgency, SeverityKey>;
  const bb = isObj(s.bounds) ? s.bounds : {};
  const rec = (v: unknown, d: Record<SeverityKey, number>) => Object.fromEntries(SEVERITY_KEYS.map((k) => [k, intIn(isObj(v) ? v[k] : undefined, 1, MAX_TARGET_MIN, d[k])])) as Record<SeverityKey, number>;
  const premium = Array.isArray(bb.premium) ? bb.premium.filter(isObj).map((r) => ({
    severity: pick(r.severity, SEVERITY_KEYS, 'S1'), field: pick(r.field, ['response', 'resolution'] as const, 'response'),
    under_min: intIn(r.under_min, 1, MAX_TARGET_MIN, 60), requires: 'critical_service' as const })) : DEFAULT_BOUNDS.premium;
  const ce = isObj(s.channels_enabled) ? s.channels_enabled : {};
  const q = isObj(s.quiet_hours) ? s.quiet_hours : {};
  return {
    enabled: s.enabled === true,
    severities,
    urgency_map,
    bounds: {
      min_response: rec(bb.min_response, DEFAULT_BOUNDS.min_response),
      min_resolution: rec(bb.min_resolution, DEFAULT_BOUNDS.min_resolution),
      max_escalations: intIn(bb.max_escalations, 1, 20, DEFAULT_BOUNDS.max_escalations),
      allowed_coverage: pickAll(bb.allowed_coverage, COVERAGE_MODES).length ? pickAll(bb.allowed_coverage, COVERAGE_MODES) : DEFAULT_BOUNDS.allowed_coverage,
      allowed_start: pickAll(bb.allowed_start, START_RULES).length ? pickAll(bb.allowed_start, START_RULES) : DEFAULT_BOUNDS.allowed_start,
      allowed_pause: Array.isArray(bb.allowed_pause) ? pickAll(bb.allowed_pause, PAUSE_KEYS) : DEFAULT_BOUNDS.allowed_pause,
      premium,
      max_repeats: intIn(bb.max_repeats, 0, 24, DEFAULT_BOUNDS.max_repeats),
      min_repeat_min: Math.max(30, intIn(bb.min_repeat_min, 30, 1440, 30)),
      max_extra_contacts: intIn(bb.max_extra_contacts, 0, 10, DEFAULT_BOUNDS.max_extra_contacts),
    },
    at_risk_pct: intIn(s.at_risk_pct, 50, 99, 75),
    quiet_hours: { start: typeof q.start === 'string' && HHMM.test(q.start) ? q.start : '22:00', end: typeof q.end === 'string' && HHMM.test(q.end) ? q.end : '07:00' },
    unpausable_allowed: s.unpausable_allowed !== false,
    require_acceptance: s.require_acceptance !== false,
    compliance_alert_pct: intIn(s.compliance_alert_pct, 1, 100, 90),
    channels_enabled: Object.fromEntries(CHANNELS.map((c) => [c, ce[c] !== false])) as Record<Channel, boolean>,
  };
}
