/**
 * Refer & earn page upgrade: pure display helpers for the consultant's OWN referral data (reward lines, payouts,
 * referrals, menu indicator). Money is decided only in the database (docs/sql/referral-program.sql and
 * referral-tracking.sql); these helpers only group, filter, sort and explain what the database returned.
 */
import { MAN_DAY_HOURS, formatRate, referralCsv, round2, type LineStatus } from './referrals';

// ------------------------------------------------------------------ reward lines

export type HoldReason = 'review' | 'dispute' | 'cap';

export interface RewardLine {
  line_ref: string | null;
  created_at: string;
  ref_key: string | null;
  referred_name: string | null;
  kind: string;
  status: string;
  hold_reason: HoldReason | null;
  /** Anonymous "Engagement #A12F" - never the client or the ticket title (docs/referral-security.md A7). */
  engagement_ref: string | null;
  approved_hours: number | null;
  man_days: number | null;
  fee_amount: number | null;
  rate_percent: number | null;
  tier_name: string | null;
  amount: number;
  currency: string;
  released_at: string | null;
  matures_at: string | null;
  available_at: string | null;
  paid_at: string | null;
  payout_ref: string | null;
  note: string | null;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const HOLD: HoldReason[] = ['review', 'dispute', 'cap'];

export function parseRewardLines(raw: unknown): RewardLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const hr = strOrNull(o.hold_reason);
    return {
      line_ref: strOrNull(o.line_ref),
      created_at: String(o.created_at ?? ''),
      ref_key: strOrNull(o.ref_key),
      referred_name: strOrNull(o.referred_name),
      kind: String(o.kind ?? 'reward'),
      status: String(o.status ?? 'pending'),
      hold_reason: hr && (HOLD as string[]).includes(hr) ? (hr as HoldReason) : hr ? 'review' : null,
      engagement_ref: strOrNull(o.engagement_ref),
      approved_hours: numOrNull(o.approved_hours),
      man_days: numOrNull(o.man_days),
      fee_amount: numOrNull(o.fee_amount),
      rate_percent: numOrNull(o.rate_percent),
      tier_name: strOrNull(o.tier_name),
      amount: Number(o.amount) || 0,
      currency: String(o.currency ?? 'USD'),
      released_at: strOrNull(o.released_at),
      matures_at: strOrNull(o.matures_at),
      available_at: strOrNull(o.available_at),
      paid_at: strOrNull(o.paid_at),
      payout_ref: strOrNull(o.payout_ref),
      note: strOrNull(o.note),
    };
  });
}

/** Fallback while referral-tracking.sql is not applied: the older history rows (no hours, references or release date). */
export function linesFromHistory(rows: Array<Record<string, unknown>>): RewardLine[] {
  return parseRewardLines(rows.map((r) => ({ ...r, line_ref: null, ref_key: r.referred_name ?? null, hold_reason: null, engagement_ref: null })));
}

export type LineStateKey = LineStatus;

/** What the consultant sees for one line: the state and, while pending, the date it becomes available. */
export function lineState(l: Pick<RewardLine, 'status' | 'matures_at' | 'hold_reason' | 'kind'>): { key: LineStateKey; until: string | null; reason: HoldReason | null } {
  const key = (['pending', 'available', 'held', 'in_payout', 'paid', 'reversed'].includes(l.status) ? l.status : 'pending') as LineStateKey;
  return { key, until: key === 'pending' ? l.matures_at : null, reason: key === 'held' ? (l.hold_reason ?? 'review') : null };
}

export interface LineCalc { hours: number | null; manDays: number | null; fee: number | null; rate: number | null; reward: number; exact: boolean }

/**
 * Breakdown of one reward line: approved hours -> fee (the referred consultant's hourly rate is never shown, only the
 * resulting fee) -> x tier rate % -> reward. `exact` is false when the stored reward differs from fee x rate (it never
 * should; rounding is half-up to 2 decimals in the database).
 */
export function lineCalc(l: Pick<RewardLine, 'kind' | 'approved_hours' | 'man_days' | 'fee_amount' | 'rate_percent' | 'amount'>): LineCalc {
  const hours = l.approved_hours;
  const manDays = l.man_days ?? (hours == null ? null : round2(hours / MAN_DAY_HOURS));
  if (l.kind !== 'reward' || l.fee_amount == null || l.rate_percent == null) {
    return { hours, manDays, fee: l.fee_amount, rate: l.rate_percent, reward: l.amount, exact: true };
  }
  const expected = round2((l.fee_amount * l.rate_percent) / 100);
  return { hours, manDays, fee: l.fee_amount, rate: l.rate_percent, reward: l.amount, exact: Math.abs(expected - l.amount) < 0.005 };
}

/** "Fee $400.00 x 0.5 % = $2.00" in the reader's words (the caller passes the translated "Fee" label). */
export function calcText(c: LineCalc, money: (v: number) => string, feeLabel = 'Fee'): string | null {
  if (c.fee == null || c.rate == null) return null;
  return `${feeLabel} ${money(c.fee)} x ${formatRate(c.rate)} % = ${money(c.reward)}`;
}

// ------------------------------------------------------------------ filters, sorting, pages

export const LINE_PERIODS = ['all', 'month', 'last_month', '3m', 'year'] as const;
export type LinePeriod = typeof LINE_PERIODS[number];
export const LINE_FILTER_STATES = ['all', 'pending', 'held', 'available', 'paid', 'reversed'] as const;
export type LineFilterState = typeof LINE_FILTER_STATES[number];

export interface LineFilter { period: LinePeriod; status: LineFilterState; refKey: string; search: string }
export const DEFAULT_LINE_FILTER: LineFilter = { period: 'all', status: 'all', refKey: 'all', search: '' };

const monthStart = (d: Date, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));

export function periodBounds(p: LinePeriod, now: Date): { from: Date | null; to: Date | null } {
  if (p === 'month') return { from: monthStart(now), to: null };
  if (p === 'last_month') return { from: monthStart(now, -1), to: monthStart(now) };
  if (p === '3m') return { from: monthStart(now, -2), to: null };
  if (p === 'year') return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: null };
  return { from: null, to: null };
}

function statusMatches(l: RewardLine, s: LineFilterState): boolean {
  if (s === 'all') return true;
  if (s === 'available') return l.status === 'available' || l.status === 'in_payout';
  if (s === 'reversed') return l.status === 'reversed' || l.kind === 'reversal';
  return l.status === s;
}

/** Filters run on the consultant's own rows only (the database returns nothing else). */
export function filterLines(lines: RewardLine[], f: LineFilter, now = new Date()): RewardLine[] {
  const { from, to } = periodBounds(f.period, now);
  const q = f.search.trim().toLowerCase();
  return lines.filter((l) => {
    const at = new Date(l.created_at);
    if (from && at < from) return false;
    if (to && at >= to) return false;
    if (!statusMatches(l, f.status)) return false;
    if (f.refKey !== 'all' && l.ref_key !== f.refKey) return false;
    if (q) {
      const hay = [l.referred_name, l.engagement_ref, l.line_ref, l.payout_ref, l.tier_name, l.note].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type LineSortKey = 'date' | 'amount' | 'fee' | 'status';
export function sortLines(lines: RewardLine[], key: LineSortKey, dir: 'asc' | 'desc'): RewardLine[] {
  const sign = dir === 'asc' ? 1 : -1;
  const val = (l: RewardLine): number | string =>
    key === 'amount' ? l.amount : key === 'fee' ? (l.fee_amount ?? -1) : key === 'status' ? l.status : new Date(l.created_at).getTime();
  return [...lines].sort((a, b) => {
    const x = val(a); const y = val(b);
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
    return a.created_at < b.created_at ? 1 : -1;
  });
}

export function pageOf<T>(list: T[], page: number, size: number): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(list.length / Math.max(1, size)));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: list.slice((p - 1) * size, p * size), page: p, pages, total: list.length };
}

// ------------------------------------------------------------------ summary + chart

export interface EarningsSummary {
  currency: string;
  /** Waiting for the hold period after the payout release; nextRelease = earliest date one becomes available. */
  pending: number; nextRelease: string | null;
  /** Held for review, a client dispute or a cap (no date: released after the review). */
  held: number;
  available: number; paid: number;
  /** Reversals (refunds, chargebacks, corrections) - negative or 0. */
  reversed: number;
  /** Everything earned after reversals (same rule as the database: every line not in state "reversed"). */
  lifetime: number;
  thisMonth: number; lastMonth: number;
}

export function earningsSummary(lines: RewardLine[], now = new Date()): EarningsSummary[] {
  const by = new Map<string, EarningsSummary>();
  const m0 = monthStart(now); const m1 = monthStart(now, -1);
  for (const l of lines) {
    const s = by.get(l.currency) ?? { currency: l.currency, pending: 0, nextRelease: null, held: 0, available: 0, paid: 0, reversed: 0, lifetime: 0, thisMonth: 0, lastMonth: 0 };
    if (l.status === 'pending') {
      s.pending += l.amount;
      if (l.matures_at && (!s.nextRelease || l.matures_at < s.nextRelease)) s.nextRelease = l.matures_at;
    } else if (l.status === 'held') s.held += l.amount;
    else if (l.status === 'available' || l.status === 'in_payout') s.available += l.amount;
    else if (l.status === 'paid') s.paid += l.amount;
    if (l.kind === 'reversal') s.reversed += l.amount;
    if (l.status !== 'reversed') {
      s.lifetime += l.amount;
      const at = new Date(l.created_at);
      if (at >= m0) s.thisMonth += l.amount;
      else if (at >= m1) s.lastMonth += l.amount;
    }
    by.set(l.currency, s);
  }
  return [...by.values()].map((s) => ({
    ...s, pending: round2(s.pending), held: round2(s.held), available: round2(s.available), paid: round2(s.paid),
    reversed: round2(s.reversed), lifetime: round2(s.lifetime), thisMonth: round2(s.thisMonth), lastMonth: round2(s.lastMonth),
  })).sort((a, b) => b.lifetime - a.lifetime || a.currency.localeCompare(b.currency));
}

/** Change from last month in percent (null when last month was 0). */
export function monthChange(thisMonth: number, lastMonth: number): number | null {
  if (!lastMonth) return null;
  return Math.round(((thisMonth - lastMonth) / Math.abs(lastMonth)) * 100);
}

/** Net earned per month (UTC months, oldest first) and the running total, for one currency. */
export function monthlySeries(lines: RewardLine[], currency: string, months = 12, now = new Date()): Array<{ month: string; earned: number; cumulative: number }> {
  const n = Math.max(1, Math.min(36, months));
  const keys = Array.from({ length: n }, (_, i) => monthStart(now, i - n + 1).toISOString().slice(0, 7));
  const sums = new Map(keys.map((k) => [k, 0]));
  let before = 0;
  for (const l of lines) {
    if (l.currency !== currency || l.status === 'reversed') continue;
    const k = l.created_at.slice(0, 7);
    if (sums.has(k)) sums.set(k, (sums.get(k) ?? 0) + l.amount);
    else if (k < keys[0]) before += l.amount;
  }
  let run = round2(before);
  return keys.map((k) => {
    const earned = round2(sums.get(k) ?? 0);
    run = round2(run + earned);
    return { month: k, earned, cumulative: run };
  });
}

export const REWARD_LINE_COLUMNS: Array<[keyof RewardLine, string]> = [
  ['created_at', 'Date'], ['line_ref', 'Line'], ['referred_name', 'Referred consultant'], ['kind', 'Type'], ['engagement_ref', 'Engagement'],
  ['approved_hours', 'Approved hours'], ['fee_amount', 'Fee'], ['rate_percent', 'Rate %'], ['tier_name', 'Tier'], ['amount', 'Reward'],
  ['currency', 'Currency'], ['status', 'State'], ['hold_reason', 'Held because'], ['matures_at', 'Available from'], ['paid_at', 'Paid on'], ['payout_ref', 'Payout'],
];

/** CSV of exactly the rows on screen (built in the browser from the consultant's own data). */
export function rewardLinesCsv(lines: RewardLine[]): string {
  return referralCsv(lines as unknown as Array<Record<string, unknown>>, REWARD_LINE_COLUMNS as Array<[string, string]>);
}

// ------------------------------------------------------------------ payouts

export interface ReferralPayoutRow { payout_ref: string; bank_reference: string | null; created_at: string; amount: number; currency: string; status: string; due_by: string | null; paid_at: string | null; lines: number }

export function parsePayouts(raw: unknown): ReferralPayoutRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      payout_ref: String(o.payout_ref ?? ''), bank_reference: strOrNull(o.bank_reference), created_at: String(o.created_at ?? ''),
      amount: Number(o.amount) || 0, currency: String(o.currency ?? 'USD'), status: String(o.status ?? 'pending'),
      due_by: strOrNull(o.due_by), paid_at: strOrNull(o.paid_at), lines: Number(o.lines) || 0,
    };
  });
}

// ------------------------------------------------------------------ referrals funnel

export type FunnelChip = 'registered' | 'interview_pending' | 'active' | 'earning' | 'ended' | 'on_review' | 'expired' | 'rejected';

export interface FunnelInput {
  status: string; activation_status: string; verified: boolean; first_paid_at: string | null; window_ends_at?: string | null;
}

/** One status per referred consultant, in plain words (Rejected comes from the separate rejected list). */
export function funnelChip(r: FunnelInput): FunnelChip {
  if (r.activation_status === 'expired') return 'expired';
  if (r.status === 'on_review') return 'on_review';
  if (r.status === 'ended') return 'ended';
  if (r.activation_status === 'active') return r.first_paid_at ? 'earning' : 'active';
  return r.verified ? 'interview_pending' : 'registered';
}

export const FUNNEL_TONE: Record<FunnelChip, string> = {
  registered: 'bg-muted text-muted-foreground',
  interview_pending: 'bg-warning/15 text-warning',
  active: 'bg-primary/10 text-primary',
  earning: 'bg-success/15 text-success',
  ended: 'bg-muted text-muted-foreground',
  on_review: 'bg-warning/15 text-warning',
  expired: 'bg-destructive/10 text-destructive',
  rejected: 'bg-destructive/10 text-destructive',
};

export interface JourneyCounts { shared: number; registered: number; interviewed: number; paying: number; earning: number }

/** Own counts at each of the five steps ("3 visits, 2 registered, 1 interviewed, 1 earning"). */
export function journeyCounts(funnel: { clicks: number; signups: number; paying: number }, referrals: Array<{ they_passed: boolean; first_paid_at: string | null; activation_status: string }>, lifetime: number): JourneyCounts {
  return {
    shared: Math.max(0, funnel.clicks),
    registered: Math.max(funnel.signups, referrals.length),
    interviewed: referrals.filter((r) => r.they_passed).length,
    paying: Math.max(funnel.paying, referrals.filter((r) => r.first_paid_at && r.activation_status === 'active').length),
    earning: lifetime > 0 ? Math.max(1, referrals.filter((r) => r.first_paid_at && r.activation_status === 'active').length) : 0,
  };
}

export type NextAction = 'support' | 'profile' | 'interview' | 'terms' | 'policy' | 'wait_verify' | 'share' | 'follow_up' | 'payout' | 'earnings';

export interface NextActionInput {
  suspended: boolean; profileSubmitted: boolean; interviewPassed: boolean; acknowledged: boolean; policy: boolean; verified: boolean;
  signups: number; pendingReferrals: number; available: number; payoutDetails: boolean;
}

/** The single most useful next step for the consultant (one clear button). */
export function nextAction(i: NextActionInput): NextAction {
  if (i.suspended) return 'support';
  if (!i.profileSubmitted) return 'profile';
  if (!i.interviewPassed) return 'interview';
  if (!i.acknowledged) return 'terms';
  if (!i.policy) return 'policy';
  if (!i.verified) return 'wait_verify';
  if (i.available > 0 && !i.payoutDetails) return 'payout';
  if (i.signups === 0) return 'share';
  if (i.pendingReferrals > 0) return 'follow_up';
  if (i.available > 0) return 'earnings';
  return 'share';
}

// ------------------------------------------------------------------ terms status

export type TermsState = 'current' | 'outdated' | 'none';
export function termsState(accepted: number | null | undefined, current: number): TermsState {
  if (accepted == null) return 'none';
  return accepted >= current ? 'current' : 'outdated';
}

// ------------------------------------------------------------------ menu indicator (gradient pill)

export const REFER_NAV_KEY = 'aisupport360.refer-nav';
export const REFER_NAV_EVENT = 'aisupport360:refer-nav';
export const REFER_PULSE_DAYS = 14;

export interface ReferNavSeen { first: number | null; opened: number | null; seenLinesAt: string | null }

export function readReferNav(): ReferNavSeen {
  try {
    const o = JSON.parse(localStorage.getItem(REFER_NAV_KEY) ?? 'null') as Partial<ReferNavSeen> | null;
    return {
      first: typeof o?.first === 'number' ? o.first : null,
      opened: typeof o?.opened === 'number' ? o.opened : null,
      seenLinesAt: typeof o?.seenLinesAt === 'string' ? o.seenLinesAt : null,
    };
  } catch { return { first: null, opened: null, seenLinesAt: null }; }
}

export function writeReferNav(patch: Partial<ReferNavSeen>): void {
  try {
    localStorage.setItem(REFER_NAV_KEY, JSON.stringify({ ...readReferNav(), ...patch }));
    window.dispatchEvent(new Event(REFER_NAV_EVENT));
  } catch { /* storage blocked: the pill simply keeps its default look */ }
}

/** Subtle pulse for the first 14 days after the pill was first shown, or until the page was opened once. */
export function pulseActive(seen: ReferNavSeen, now = Date.now(), days = REFER_PULSE_DAYS): boolean {
  if (seen.opened != null) return false;
  if (seen.first == null) return true;
  return now - seen.first < days * 86_400_000;
}

/** Dot = a reward line newer than the last visit; count = referrals still waiting for activation. */
export function navIndicator(state: { latest_line_at?: string | null; pending_referrals?: number } | null | undefined, seenLinesAt: string | null): { dot: boolean; count: number } {
  if (!state) return { dot: false, count: 0 };
  const latest = state.latest_line_at ?? null;
  return { dot: !!latest && (!seenLinesAt || latest > seenLinesAt), count: Math.max(0, Number(state.pending_referrals) || 0) };
}
