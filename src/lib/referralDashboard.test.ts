import { describe, expect, it } from 'vitest';
import { dashCurrencies, dueState, forecastSeries, invitationSeries, invitationsSent, lastMonths, rewardSeries, type ReferralDashboard } from './referralDashboard';

const dash = (over: Partial<ReferralDashboard> = {}): ReferralDashboard => ({
  generated_at: '2026-10-22T12:00:00Z', months: 6, settings: { min_payout: 25, hold_days: 14 },
  invitations: { announcement: { sent: 34, first_at: null, last_at: null }, invitation: { sent: 3, by_month: [{ month: '2026-10', count: 3 }] }, by_month: [{ month: '2026-10', count: 34 }] },
  rewards: { totals: [], by_month: [{ month: '2026-09', currency: 'USD', earned: 10, paid: 4, reversed: 1 }] },
  payouts: { upcoming: [], recent: [], next_due: null, overdue: 0, waiting: [] },
  forecast: { months: [{ month: '2026-10', currency: 'USD', maturing: 5, trend: 2 }, { month: '2026-11', currency: 'EUR', maturing: 1, trend: 0 }], approved_work: [] },
  ...over,
});

describe('referral admin dashboard', () => {
  it('invitations sent = launch announcement + Refer & earn invitations', () => {
    expect(invitationsSent(dash())).toEqual({ total: 37, announcement: 34, invitation: 3 });
  });
  it('fills 12 months ending this month (Riyadh time) and keeps empty months at zero', () => {
    const m = lastMonths(12, new Date('2026-10-31T22:30:00Z'));
    expect(m[11]).toBe('2026-11');
    expect(m).toHaveLength(12);
    const s = invitationSeries(dash(), lastMonths(12, new Date('2026-10-22T12:00:00Z')));
    expect(s.at(-1)).toEqual({ month: '2026-10', announcement: 34, invitation: 3 });
    expect(s[0]).toEqual({ month: '2025-11', announcement: 0, invitation: 0 });
  });
  it('rewards and forecast are shown per currency, straight from the database figures', () => {
    const months = lastMonths(12, new Date('2026-10-22T12:00:00Z'));
    expect(rewardSeries(dash(), 'USD', months).find((r) => r.month === '2026-09')).toEqual({ month: '2026-09', earned: 10, paid: 4, reversed: 1 });
    expect(forecastSeries(dash(), 'USD')).toEqual([{ month: '2026-10', maturing: 5, trend: 2 }]);
    expect(dashCurrencies(dash())).toEqual(['EUR', 'USD']);
  });
  it('payout due dates: overdue, today, within 3 days, later', () => {
    const today = new Date('2026-10-22T09:00:00Z');
    expect(dueState('2026-10-21', today)).toBe('overdue');
    expect(dueState('2026-10-22', today)).toBe('today');
    expect(dueState('2026-10-25', today)).toBe('soon');
    expect(dueState('2026-11-10', today)).toBe('later');
    expect(dueState(null, today)).toBe('none');
  });
});
