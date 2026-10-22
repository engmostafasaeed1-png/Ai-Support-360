/**
 * Feature Z, consultant referral programme ("Refer & earn"). Display helpers and mirrors of the database rules in
 * docs/sql/referral-program.sql. Every official number (rewards, windows, totals) is computed in the database; these
 * helpers only format, validate input before sending it, and power the tests.
 */

export const SITE_URL = 'https://www.aisupport360.com';

export interface ReferralSettings {
  enabled: boolean;
  /** AI interview pass mark for activation (both consultants). */
  pass_mark: number;
  /** Days from sign-up for both to pass and acknowledge before the referral expires. */
  activation_days: number;
  /** Base rate = the first tier's rate. The rate of each reward line is the referrer's tier when the line is created. */
  rate_percent: number;
  /** Tiers by the referrer's number of verified, non-suspended referred consultants (ascending). */
  tiers: Tier[];
  /** Admin cap for every tier rate (default 2 %). */
  max_rate: number;
  months: number;
  min_payout: number;
  terms_version: number;
}

export interface Tier { min: number; rate: number; name: string }

/** Owner defaults: 0-10 -> 0.5 %, 11-20 -> 0.6 %, 21-30 -> 0.7 %, 31-40 -> 0.8 %, 41+ -> 1.0 %. Mirror of referral_tiers(). */
export const DEFAULT_TIERS: Tier[] = [
  { min: 0, rate: 0.5, name: 'Tier 1' }, { min: 11, rate: 0.6, name: 'Tier 2' }, { min: 21, rate: 0.7, name: 'Tier 3' },
  { min: 31, rate: 0.8, name: 'Tier 4' }, { min: 41, rate: 1.0, name: 'Tier 5' },
];
export const MAX_TIERS = 5;
export const DEFAULT_MAX_RATE = 2;

/** Mirror of referral_tiers_valid(): null when valid, else the reason. */
export function tiersProblem(tiers: Array<{ min: unknown; rate: unknown; name?: unknown }>, maxRate = DEFAULT_MAX_RATE): string | null {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > MAX_TIERS) return 'Use 1 to 5 tiers';
  let prevMin = -1; let prevRate = 0;
  for (let i = 0; i < tiers.length; i++) {
    const min = Number(tiers[i].min); const rate = Number(tiers[i].rate);
    if (tiers[i].min === '' || tiers[i].rate === '' || !Number.isFinite(min) || !Number.isFinite(rate)) return 'Each tier needs a number of referrals and a rate';
    if (!Number.isInteger(min) || min < 0) return 'Referral counts must be whole numbers';
    if (i === 0 && min !== 0) return 'The first tier must start at 0 referrals';
    if (min <= prevMin) return 'Referral counts must go up from tier to tier';
    if (rate <= prevRate) return 'Rates must go up from tier to tier';
    if (rate > maxRate) return `Rates can not be above the maximum of ${maxRate} %`;
    if (String(tiers[i].name ?? '').length > 30) return 'Tier names have at most 30 characters';
    prevMin = min; prevRate = rate;
  }
  return null;
}

/** Stored tiers if valid, else the defaults (same fallback as the database). */
export function parseTiers(raw: unknown, maxRate = DEFAULT_MAX_RATE): Tier[] {
  if (!Array.isArray(raw) || tiersProblem(raw as Array<{ min: unknown; rate: unknown }>, maxRate)) return DEFAULT_TIERS;
  return (raw as Array<Record<string, unknown>>).map((t, i) => ({ min: Number(t.min), rate: Number(t.rate), name: String(t.name || `Tier ${i + 1}`) }));
}

export interface TierInfo { index: number; name: string; rate: number; min: number; max: number | null; next: Tier | null; needed: number | null }

/** Mirror of referral_tier_for(): the tier for a count of verified referred consultants, and what is needed for the next. */
export function tierFor(count: number, tiers: Tier[] = DEFAULT_TIERS): TierInfo {
  const list = tiers.length ? tiers : DEFAULT_TIERS;
  const c = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  let i = 0;
  for (let k = 0; k < list.length; k++) if (list[k].min <= c) i = k;
  const next = list[i + 1] ?? null;
  return { index: i + 1, name: list[i].name, rate: list[i].rate, min: list[i].min, max: next ? next.min - 1 : null, next, needed: next ? next.min - c : null };
}

/** "0.5-1" for texts like "{{rate}} % of the fee" (single rate when there is one tier). */
export function rateRangeText(tiers: Tier[]): string {
  const list = tiers.length ? tiers : DEFAULT_TIERS;
  const lo = formatRate(list[0].rate); const hi = formatRate(list[list.length - 1].rate);
  return lo === hi ? lo : `${lo}-${hi}`;
}

/** "0-10", "11-20", "41+" */
export const tierRangeLabel = (tiers: Tier[], i: number) => (tiers[i + 1] ? `${tiers[i].min}-${tiers[i + 1].min - 1}` : `${tiers[i].min}+`);

/** Tiers of a settings object (older shapes without tiers fall back to the defaults). */
export const settingsTiers = (s: { tiers?: Tier[] } | null | undefined): Tier[] => (s?.tiers?.length ? s.tiers : DEFAULT_TIERS);

export const REFERRAL_DEFAULTS: ReferralSettings = { enabled: true, pass_mark: 50, activation_days: 90, rate_percent: 0.5, tiers: DEFAULT_TIERS, max_rate: DEFAULT_MAX_RATE, months: 12, min_payout: 25, terms_version: 1 };

const num = (v: unknown, def: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
};

export function parseReferralSettings(o: unknown): ReferralSettings {
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const max_rate = num(r.max_rate, DEFAULT_MAX_RATE, 0.01, 10);
  const tiers = Array.isArray(r.tiers) ? parseTiers(r.tiers, max_rate)
    : r.rate_percent != null ? [{ min: 0, rate: num(r.rate_percent, 0.5, 0.001, 10), name: 'Tier 1' }] : DEFAULT_TIERS;
  return {
    tiers,
    max_rate,
    enabled: r.enabled === true,
    pass_mark: num(r.pass_mark, REFERRAL_DEFAULTS.pass_mark, 0, 100),
    activation_days: Math.round(num(r.activation_days, REFERRAL_DEFAULTS.activation_days, 1, 365)),
    rate_percent: tiers[0].rate,
    months: Math.round(num(r.months, REFERRAL_DEFAULTS.months, 1, 60)),
    min_payout: num(r.min_payout, REFERRAL_DEFAULTS.min_payout, 0, 100000),
    terms_version: Math.round(num(r.terms_version, 1, 1, 1000)),
  };
}

/** "0.5" not "0.50"; at most 3 decimals. */
export const formatRate = (rate: number) => String(Number(rate.toFixed(3)));

// ------------------------------------------------------------------ codes

export function normalizeReferralCode(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 40);
}

const BLOCKED_ANYWHERE = /(FUCK|SHIT|CUNT|PUSSY|BITCH|NIGG|WHORE|SLUT|PORN|BASTARD|WANK|MOTHERF)/;
const BLOCKED_SEGMENTS = new Set(['ASS', 'SEX', 'SEXY', 'XXX', 'FAG', 'KKK', 'NAZI', 'RAPE', 'TIT', 'TITS', 'DICK', 'COCK',
  'PENIS', 'ANUS', 'DAMN', 'HELL', 'KILL', 'SUCK', 'PIMP', 'DRUG', 'DRUGS']);
const RESERVED = new Set(['ADMIN', 'SUPPORT', 'TEST', 'NULL', 'AISUPPORT360']);

/** Mirror of referral_code_blocked_word. */
export function isBlockedReferralWord(code: string): boolean {
  const c = normalizeReferralCode(code);
  return BLOCKED_ANYWHERE.test(c) || c.split('-').some((s) => BLOCKED_SEGMENTS.has(s)) || RESERVED.has(c);
}

export const REFERRAL_CODE_RE = /^[A-Z0-9]{2,12}(-[A-Z0-9]{1,12}){0,3}$/;

/** null when the code may be saved (uniqueness is checked by the database). */
export function referralCodeProblem(raw: string): 'format' | 'blocked' | null {
  const c = normalizeReferralCode(raw);
  if (c.length < 4 || c.length > 24 || !REFERRAL_CODE_RE.test(c)) return 'format';
  if (isBlockedReferralWord(c)) return 'blocked';
  return null;
}

/** Share link: https://www.aisupport360.com/join?ref=CODE */
export function referralLink(code: string, path: 'join' | 'signup' | 'for-consultants' = 'join'): string {
  return `${SITE_URL}/${path}?ref=${encodeURIComponent(normalizeReferralCode(code))}`;
}

// ------------------------------------------------------------------ money (mirrors only)

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** reward = rate % of the referred consultant's fee (approved hourly rate x approved hours), 2 decimals. */
export function rewardForFee(fee: number, ratePercent: number): number {
  if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(ratePercent) || ratePercent <= 0) return 0;
  return round2(round2(fee) * ratePercent / 100);
}

export const MAN_DAY_HOURS = 8;

/** Example for the explainer: reward for one man-day (8 approved hours) at an hourly rate. */
export function rewardPerManDay(hourlyRate: number, ratePercent: number): number {
  return rewardForFee(hourlyRate * MAN_DAY_HOURS, ratePercent);
}

/** End of the window: months after the first paid ticket (same calendar arithmetic as Postgres for day <= 28). */
export function windowEnd(firstPaidAt: Date, months: number): Date {
  const d = new Date(firstPaidAt.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export interface RewardCheck {
  enabled: boolean;
  activation: 'pending' | 'active' | 'expired';
  activatedAt: Date | null;
  attributionStatus: 'active' | 'review' | 'held' | 'removed';
  referrerId: string;
  referredId: string;
  windowEndsAt: Date | null;
  paidAt: Date;
  referredVerified: boolean;
  referrerVerified: boolean;
  referrerSuspended: boolean;
  referrerPolicyOk: boolean;
}

/** Mirror of referral_reward_block_reason (null = earns). */
export function rewardBlockReason(c: RewardCheck): string | null {
  if (!c.enabled) return 'programme_off';
  if (c.attributionStatus === 'removed') return 'removed';
  if (c.referrerId === c.referredId) return 'own_work';
  if (c.activation !== 'active') return 'not_active';
  if (!c.activatedAt || c.paidAt.getTime() < c.activatedAt.getTime()) return 'before_activation';
  if (!c.windowEndsAt || c.paidAt.getTime() >= c.windowEndsAt.getTime()) return 'outside_window';
  if (!c.referredVerified) return 'referred_not_verified';
  if (!c.referrerVerified) return 'referrer_not_verified';
  if (c.referrerSuspended) return 'referrer_suspended';
  if (!c.referrerPolicyOk) return 'referrer_policy';
  return null;
}

// ------------------------------------------------------------------ badges and statuses

export const REFERRER_BADGES = [1, 5, 10] as const;

export function referrerBadges(verifiedReferrals: number): Array<{ at: number; earned: boolean }> {
  return REFERRER_BADGES.map((at) => ({ at, earned: verifiedReferrals >= at }));
}

export type ReferralStatus = 'signed_up' | 'verified' | 'paying' | 'ended' | 'on_review';

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  signed_up: 'Signed up',
  verified: 'Verified',
  paying: 'Earning',
  ended: '12 months ended',
  on_review: 'Under review',
};

export type LineStatus = 'pending' | 'available' | 'held' | 'in_payout' | 'paid' | 'reversed';

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  pending: 'Pending',
  available: 'Available',
  held: 'On hold',
  in_payout: 'In a payout',
  paid: 'Paid',
  reversed: 'Reversed',
};

/** Referral payouts are normal payouts rows whose reference starts with "referral:". */
export const isReferralPayout = (p: { reference?: string | null } | null | undefined) =>
  String(p?.reference ?? '').startsWith('referral:');

// ------------------------------------------------------------------ link capture (first party, 30 days)

export const REF_STORAGE_KEY = 'aisupport360.ref';
export const REF_DEVICE_KEY = 'aisupport360.device';
export const REF_TTL_DAYS = 30;
const DAY = 86_400_000;

export interface StoredRef { code: string; at: number }

export function parseStoredRef(raw: string | null, now = Date.now()): StoredRef | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<StoredRef>;
    const code = normalizeReferralCode(o.code);
    if (!code || typeof o.at !== 'number' || now - o.at > REF_TTL_DAYS * DAY || o.at > now + DAY) return null;
    return { code, at: o.at };
  } catch {
    return null;
  }
}

/** Keep ?ref=CODE from /join, /signup and /for-consultants for 30 days (latest link wins). */
export function captureReferral(pathname: string, search: string, now = Date.now()): string | null {
  if (!/^\/(join|signup|for-consultants)\/?$/.test(pathname)) return null;
  const code = normalizeReferralCode(new URLSearchParams(search).get('ref'));
  if (code.length < 4 || code.length > 24 || !/^[A-Z0-9-]+$/.test(code)) return null;
  try {
    localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code, at: now }));
    document.cookie = `aisupport360_ref=${encodeURIComponent(code)}; Max-Age=${REF_TTL_DAYS * 86400}; Path=/; SameSite=Lax; Secure`;
  } catch { /* storage blocked */ }
  return code;
}

export function storedReferral(now = Date.now()): string | null {
  try {
    const found = parseStoredRef(localStorage.getItem(REF_STORAGE_KEY), now);
    if (found) return found.code;
    const m = document.cookie.match(/(?:^|;\s*)aisupport360_ref=([^;]+)/);
    return m ? normalizeReferralCode(decodeURIComponent(m[1])) || null : null;
  } catch {
    return null;
  }
}

export function clearStoredReferral(): void {
  try {
    localStorage.removeItem(REF_STORAGE_KEY);
    document.cookie = 'aisupport360_ref=; Max-Age=0; Path=/; SameSite=Lax; Secure';
  } catch { /* ignore */ }
}

/** Random id for this browser (not personal); the database stores only a salted hash of it. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(REF_DEVICE_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      localStorage.setItem(REF_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ sharing

export interface ShareInput { code: string; link: string; rate: number; months: number }

export function shareMessage(lang: 'en' | 'ar', s: ShareInput): { subject: string; text: string } {
  const code = normalizeReferralCode(s.code);
  if (lang === 'ar') {
    return {
      subject: 'انضم إلى AI Support 360 كمستشار SAP',
      text: `أدعوك للانضمام إلى AI Support 360، منصة لمستشاري SAP تصلك فيها طلبات دعم حقيقية من العملاء. سجّل من هذا الرابط أو استخدم رمز الإحالة ${code}: ${s.link}`,
    };
  }
  return {
    subject: 'Join AI Support 360 as an SAP consultant',
    text: `I'd like to invite you to AI Support 360, a platform where SAP consultants get real support requests from clients. Sign up with this link or use my referral code ${code}: ${s.link}`,
  };
}

export type ShareChannel = 'whatsapp' | 'linkedin' | 'telegram' | 'x' | 'email';

export function shareUrl(channel: ShareChannel, link: string, text: string, subject = ''): string {
  const e = encodeURIComponent;
  switch (channel) {
    case 'whatsapp': return `https://wa.me/?text=${e(text)}`;
    case 'linkedin': return `https://www.linkedin.com/sharing/share-offsite/?url=${e(link)}`;
    case 'telegram': return `https://t.me/share/url?url=${e(link)}&text=${e(text.replace(link, '').trim())}`;
    case 'x': return `https://twitter.com/intent/tweet?text=${e(text.replace(link, '').trim())}&url=${e(link)}`;
    case 'email': return `mailto:?subject=${e(subject)}&body=${e(text)}`;
  }
}

// ------------------------------------------------------------------ CSV

const cell = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function referralCsv(rows: Array<Record<string, unknown>>, columns: Array<[string, string]>): string {
  const head = columns.map(([, label]) => cell(label)).join(',');
  const body = rows.map((r) => columns.map(([k]) => cell(r[k])).join(','));
  return [head, ...body].join('\r\n');
}

// ------------------------------------------------------------------ activation (mirrors only; decided in the database)

/** Mirror of the pass check: a completed AI interview with overall score >= pass mark (49 fails, 50 passes by default). */
export const interviewPasses = (score: number | null | undefined, passMark: number) =>
  typeof score === 'number' && Number.isFinite(score) && score >= passMark;

export type ActivationChip = 'waiting_you' | 'waiting_them' | 'active' | 'expired' | 'under_review';
export type NextStep = 'pass_interview' | 'acknowledge' | 'wait_other' | 'none';

export const CHIP_LABEL: Record<ActivationChip, string> = {
  waiting_you: 'Pending: waiting for you',
  waiting_them: 'Pending: waiting for them',
  active: 'Active',
  expired: 'Expired',
  under_review: 'Under review',
};

/** Mirror of referral_next_step for one side. */
export function nextStep(s: { activation: 'pending' | 'active' | 'expired'; removed?: boolean; passed: boolean; acknowledged: boolean }): NextStep {
  if (s.activation !== 'pending' || s.removed) return 'none';
  if (!s.passed) return 'pass_interview';
  if (!s.acknowledged) return 'acknowledge';
  return 'wait_other';
}

/** Mirror of referral_chip. */
export function activationChip(s: { review: boolean; activation: 'pending' | 'active' | 'expired'; myNext: NextStep }): ActivationChip {
  if (s.review) return 'under_review';
  if (s.activation === 'active') return 'active';
  if (s.activation === 'expired') return 'expired';
  return s.myNext === 'pass_interview' || s.myNext === 'acknowledge' ? 'waiting_you' : 'waiting_them';
}

export const CHIP_TONE: Record<ActivationChip, string> = {
  waiting_you: 'bg-warning/15 text-warning',
  waiting_them: 'bg-muted text-muted-foreground',
  active: 'bg-success/15 text-success',
  expired: 'bg-destructive/10 text-destructive',
  under_review: 'bg-warning/15 text-warning',
};

// ------------------------------------------------------------------ referral calculations (display mirrors)

/** Man-days = approved hours / 8, 2 decimals. */
export const manDays = (hours: number | null | undefined) => (hours == null || !Number.isFinite(hours) ? null : round2(hours / MAN_DAY_HOURS));

/** "Fee $400.00 x 0.5 % = $2.00" - the plain formula shown next to every reward line. */
export function formulaText(fee: number, ratePercent: number, reward: number, money: (v: number) => string): string {
  return `Fee ${money(fee)} x ${formatRate(ratePercent)} % = ${money(reward)}`;
}

/** Progress to the payout minimum: "$18.40 of $25.00 available". */
export function thresholdProgress(available: number, minPayout: number): { percent: number; reached: boolean; missing: number } {
  const a = Math.max(0, round2(available));
  const m = Math.max(0, minPayout);
  if (m === 0) return { percent: 100, reached: true, missing: 0 };
  return { percent: Math.min(100, Math.round((a / m) * 100)), reached: a >= m, missing: round2(Math.max(0, m - a)) };
}

/** Net per referral = reward earned + reversed (reversed is negative). */
export const netReward = (earned: number, reversed: number) => round2(earned + reversed);

export interface EstimateInput {
  referred: number; manDaysPerMonth: number; hourlyRate: number; months: number;
  /** Flat rate (old callers); ignored when tiers are given. */
  ratePercent?: number;
  /** With tiers the rate is the tier reached by alreadyVerified + referred (assumes all of them become verified). */
  tiers?: Tier[];
  alreadyVerified?: number;
}

/**
 * ILLUSTRATION only (no promise): n consultants x man-days per month x 8 h x hourly rate x rate %, per month and over
 * the reward window. Uses the real rate and window from the settings.
 */
export function referralEstimate(i: EstimateInput): { perMonth: number; overWindow: number; rate: number } {
  const n = Math.max(0, Math.min(1000, Math.floor(i.referred || 0)));
  const d = Math.max(0, Math.min(31, i.manDaysPerMonth || 0));
  const h = Math.max(0, Math.min(10000, i.hourlyRate || 0));
  const rate = i.tiers ? tierFor(Math.max(0, Math.floor(i.alreadyVerified || 0)) + n, i.tiers).rate : (i.ratePercent ?? 0);
  const perConsultant = rewardForFee(d * MAN_DAY_HOURS * h, rate);
  const perMonth = round2(perConsultant * n);
  return { perMonth, overWindow: round2(perMonth * Math.max(0, Math.round(i.months || 0))), rate };
}

export interface CalcLine {
  created_at: string; ref_key: string | null; referred_name: string | null; kind: string; status: string; ticket_ref: string | null;
  approved_hours: number | null; man_days: number | null; hourly_rate: number | null; fee_amount: number | null; rate_percent: number | null;
  tier_name?: string | null; amount: number; currency: string; payment_status: string | null; client_paid_at: string | null; payout_status: string | null;
  payout_released_at: string | null; referral_payout_due: string | null; note: string | null;
}

export const STATEMENT_COLUMNS: Array<[keyof CalcLine, string]> = [
  ['created_at', 'Date'], ['referred_name', 'Referred consultant'], ['kind', 'Type'], ['ticket_ref', 'Ticket'], ['approved_hours', 'Approved hours'],
  ['man_days', 'Man-days'], ['hourly_rate', 'Hourly rate'], ['fee_amount', 'Fee'], ['rate_percent', 'Rate %'], ['tier_name', 'Tier'], ['amount', 'Reward'],
  ['currency', 'Currency'], ['status', 'State'], ['payment_status', 'Client invoice'], ['payout_released_at', 'Payout released'],
];

export function statementCsv(lines: CalcLine[]): string {
  return referralCsv(lines as unknown as Array<Record<string, unknown>>, STATEMENT_COLUMNS as Array<[string, string]>);
}

// ------------------------------------------------------------------ "Refer & earn" onboarding step

export type ReferStepState = 'new' | 'done' | 'later';
const stepKey = (userId: string) => `aisupport360.refer-step.${userId}`;

/** The onboarding step is shown once per account and browser; "Maybe later" moves it to a dashboard card. */
export function referStepState(userId: string | null | undefined): ReferStepState {
  if (!userId) return 'done';
  try {
    const v = localStorage.getItem(stepKey(userId));
    return v === 'done' || v === 'later' ? v : 'new';
  } catch { return 'new'; }
}

export function setReferStepState(userId: string | null | undefined, state: Exclude<ReferStepState, 'new'>): void {
  if (!userId) return;
  try { localStorage.setItem(stepKey(userId), state); } catch { /* storage blocked */ }
}

/**
 * ILLUSTRATIVE example for the step, from the live settings: 1 colleague billing 10 man-days in a month at $50/h =
 * 10 x 8 h x $50 = $4,000 fee -> reward at the rate; 5 colleagues -> five times that.
 */
export function referStepExample(rateOrTiers: number | Tier[], manDaysPerMonth = 10, hourlyRate = 50, colleagues = 5) {
  const fee = round2(manDaysPerMonth * MAN_DAY_HOURS * hourlyRate);
  // Tiers: 1 colleague -> tier for 1; several -> tier for that many (each counted once verified).
  const rateOne = Array.isArray(rateOrTiers) ? tierFor(1, rateOrTiers).rate : rateOrTiers;
  const rateMany = Array.isArray(rateOrTiers) ? tierFor(colleagues, rateOrTiers).rate : rateOrTiers;
  const one = rewardForFee(fee, rateOne);
  return { manDays: manDaysPerMonth, hours: MAN_DAY_HOURS, hourlyRate, fee, one, colleagues, many: round2(rewardForFee(fee, rateMany) * colleagues), rateOne, rateMany };
}

/** Opens the "Refer & earn" introduction again (menu page / help sheet). */
export const REFERRAL_INTRO_EVENT = 'aisupport360:open-referral-intro';
export const REFERRAL_INTRO_TOUR_KEY = 'referral-intro';

/**
 * One-time introduction pop-up for every consultant (existing and new): only while the programme is live, never for demo
 * visitors, and only if this consultant has not seen it (stored per account on the server, browser copy as fallback).
 */
export function shouldShowReferralIntro(s: { live: boolean; isGuest: boolean; progressLoaded: boolean; seenOnServer: boolean; localState: ReferStepState }): boolean {
  return s.live && !s.isGuest && s.progressLoaded && !s.seenOnServer && s.localState === 'new';
}
