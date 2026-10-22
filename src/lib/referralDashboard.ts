/**
 * Admin › Referrals › Dashboard. All amounts come from the admin_referral_dashboard database summary
 * (docs/sql/referral-dashboard.sql); this file only reshapes them for charts and tables (month gaps, currency, labels).
 */
export interface DashMonthCount { month: string; count: number }
export interface DashRewardMonth { month: string; currency: string; earned: number; paid: number; reversed: number }
export interface DashTotals {
  currency: string; lines: number; issued: number; reversed: number; pending: number; held: number; available: number;
  in_payout: number; paid: number; referrers: number;
}
export interface DashPayout { id: string; referrer: string; amount: number; currency: string; status: string; due_by: string | null; created_at?: string; paid_at?: string | null }
export interface DashWaiting { currency: string; referrers: number; ready: number; ready_amount: number; below_minimum: number; below_amount: number }
export interface DashForecastMonth { month: string; currency: string; maturing: number; trend: number }
export interface DashApproved { currency: string; timesheets: number; expected_fee: number; expected_reward: number }

export interface ReferralDashboard {
  generated_at: string; months: number; settings: { min_payout: number; hold_days: number };
  invitations: {
    announcement: { sent: number; first_at: string | null; last_at: string | null };
    invitation: { runs?: number; tests?: number; queued?: number; skipped?: number; sent?: number; failed?: number; last_at?: string | null; by_month?: DashMonthCount[] };
    by_month: DashMonthCount[];
  };
  rewards: { totals: DashTotals[]; by_month: DashRewardMonth[] };
  payouts: { upcoming: DashPayout[]; recent: DashPayout[]; next_due: string | null; overdue: number; waiting: DashWaiting[] };
  forecast: { months: DashForecastMonth[]; approved_work: DashApproved[] };
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** "YYYY-MM" of the last `count` months ending with the month of `now` (Asia/Riyadh, like the database). */
export function lastMonths(count: number, now = new Date()): string[] {
  const riyadh = new Date(now.getTime() + 3 * 3600_000);
  const y = riyadh.getUTCFullYear(), m = riyadh.getUTCMonth();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Currencies that have any money; USD when nothing exists yet. */
export function dashCurrencies(d: ReferralDashboard | null | undefined): string[] {
  const set = new Set<string>();
  for (const t of d?.rewards.totals ?? []) set.add(t.currency);
  for (const f of d?.forecast.months ?? []) set.add(f.currency);
  for (const p of d?.payouts.upcoming ?? []) set.add(p.currency);
  return set.size ? [...set].sort() : ['USD'];
}

/** Launch announcement + Refer & earn invitations sent, per month, with empty months filled. */
export function invitationSeries(d: ReferralDashboard, months: string[]) {
  const a = new Map((d.invitations.by_month ?? []).map((x) => [x.month, n(x.count)]));
  const b = new Map((d.invitations.invitation?.by_month ?? []).map((x) => [x.month, n(x.count)]));
  return months.map((month) => ({ month, announcement: a.get(month) ?? 0, invitation: b.get(month) ?? 0 }));
}

export function rewardSeries(d: ReferralDashboard, currency: string, months: string[]) {
  const rows = (d.rewards.by_month ?? []).filter((r) => r.currency === currency);
  return months.map((month) => {
    const r = rows.find((x) => x.month === month);
    return { month, earned: n(r?.earned), paid: n(r?.paid), reversed: n(r?.reversed) };
  });
}

export function forecastSeries(d: ReferralDashboard, currency: string) {
  return (d.forecast.months ?? []).filter((f) => f.currency === currency).map((f) => ({ month: f.month, maturing: n(f.maturing), trend: n(f.trend) }));
}

export function totalsFor(d: ReferralDashboard, currency: string): DashTotals {
  return d.rewards.totals.find((t) => t.currency === currency)
    ?? { currency, lines: 0, issued: 0, reversed: 0, pending: 0, held: 0, available: 0, in_payout: 0, paid: 0, referrers: 0 };
}

export function invitationsSent(d: ReferralDashboard): { total: number; announcement: number; invitation: number } {
  const announcement = n(d.invitations.announcement?.sent);
  const invitation = n(d.invitations.invitation?.sent);
  return { total: announcement + invitation, announcement, invitation };
}

/** Payout due-date state for the table badge. */
export function dueState(dueBy: string | null | undefined, today = new Date()): 'none' | 'overdue' | 'today' | 'soon' | 'later' {
  if (!dueBy) return 'none';
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).getTime();
  const days = Math.round((new Date(`${dueBy.slice(0, 10)}T00:00:00Z`).getTime() - t) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'later';
}
