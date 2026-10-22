import { describe, expect, it } from 'vitest';
import {
  calcText, earningsSummary, filterLines, funnelChip, journeyCounts, lineCalc, lineState, monthChange, monthlySeries, navIndicator, nextAction,
  pageOf, parseRewardLines, pulseActive, rewardLinesCsv, sortLines, termsState, DEFAULT_LINE_FILTER, type RewardLine,
} from './referralTracking';

const NOW = new Date('2026-10-22T12:00:00Z');
const money = (v: number) => `$${v.toFixed(2)}`;

function line(p: Partial<RewardLine>): RewardLine {
  return {
    line_ref: 'L-AAAAAA', created_at: '2026-10-10T10:00:00Z', ref_key: 'k1', referred_name: 'D. F****', kind: 'reward', status: 'pending', hold_reason: null,
    engagement_ref: 'Engagement #A12F', approved_hours: 8, man_days: 1, fee_amount: 400, rate_percent: 0.5, tier_name: 'Tier 1', amount: 2,
    currency: 'USD', released_at: '2026-10-10T10:00:00Z', matures_at: '2026-10-24T10:00:00Z', available_at: null, paid_at: null, payout_ref: null, note: null,
    ...p,
  };
}

describe('reward line calculation display', () => {
  it('approved hours -> fee x tier rate = reward, without the hourly rate', () => {
    const c = lineCalc(line({}));
    expect(c).toEqual({ hours: 8, manDays: 1, fee: 400, rate: 0.5, reward: 2, exact: true });
    expect(calcText(c, money)).toBe('Fee $400.00 x 0.5 % = $2.00');
  });
  it('tier rates keep their decimals and rounding is half-up to cents', () => {
    expect(calcText(lineCalc(line({ fee_amount: 333.33, rate_percent: 0.6, amount: 2 })), money)).toBe('Fee $333.33 x 0.6 % = $2.00');
    expect(lineCalc(line({ fee_amount: 333.33, rate_percent: 0.6, amount: 2 })).exact).toBe(true);
    expect(lineCalc(line({ fee_amount: 400, rate_percent: 0.5, amount: 2.5 })).exact).toBe(false);
  });
  it('man-days fall back to hours / 8 and reversals have no formula', () => {
    expect(lineCalc(line({ man_days: null, approved_hours: 12 })).manDays).toBe(1.5);
    expect(calcText(lineCalc(line({ kind: 'reversal', fee_amount: null, rate_percent: null, amount: -2 })), money)).toBeNull();
  });
  it('state: pending shows the date it becomes available, held shows only a public reason', () => {
    expect(lineState(line({}))).toEqual({ key: 'pending', until: '2026-10-24T10:00:00Z', reason: null });
    expect(lineState(line({ status: 'held', hold_reason: 'dispute' }))).toEqual({ key: 'held', until: null, reason: 'dispute' });
    expect(lineState(line({ status: 'held', hold_reason: null })).reason).toBe('review');
    expect(lineState(line({ status: 'paid' })).until).toBeNull();
  });
  it('unknown hold reasons from the database read as review', () => {
    expect(parseRewardLines([{ status: 'held', hold_reason: 'related_party', amount: '3.10' }])[0]).toMatchObject({ hold_reason: 'review', amount: 3.1 });
  });
});

describe('filters, sorting and pages (own rows only)', () => {
  const rows = [
    line({ line_ref: 'L-1', created_at: '2026-10-05T00:00:00Z', status: 'pending', amount: 2 }),
    line({ line_ref: 'L-2', created_at: '2026-09-20T00:00:00Z', status: 'paid', amount: 5, payout_ref: 'RP-1A2B3C4D' }),
    line({ line_ref: 'L-3', created_at: '2026-08-01T00:00:00Z', status: 'available', amount: 1, ref_key: 'k2', referred_name: 'M. S****' }),
    line({ line_ref: 'L-4', created_at: '2026-09-25T00:00:00Z', kind: 'reversal', status: 'available', amount: -2, fee_amount: null, rate_percent: null }),
    line({ line_ref: 'L-5', created_at: '2025-12-30T00:00:00Z', status: 'held', amount: 4 }),
  ];
  const f = (p: Partial<typeof DEFAULT_LINE_FILTER>) => filterLines(rows, { ...DEFAULT_LINE_FILTER, ...p }, NOW).map((l) => l.line_ref);
  it('period', () => {
    expect(f({ period: 'month' })).toEqual(['L-1']);
    expect(f({ period: 'last_month' })).toEqual(['L-2', 'L-4']);
    expect(f({ period: '3m' })).toEqual(['L-1', 'L-2', 'L-3', 'L-4']);
    expect(f({ period: 'year' })).toEqual(['L-1', 'L-2', 'L-3', 'L-4']);
  });
  it('status (available includes in a payout, reversed includes reversal lines)', () => {
    expect(f({ status: 'available' })).toEqual(['L-3', 'L-4']);
    expect(f({ status: 'reversed' })).toEqual(['L-4']);
    expect(f({ status: 'held' })).toEqual(['L-5']);
  });
  it('referral and search (name, payout reference)', () => {
    expect(f({ refKey: 'k2' })).toEqual(['L-3']);
    expect(f({ search: 'rp-1a2b' })).toEqual(['L-2']);
    expect(f({ search: 'm. s' })).toEqual(['L-3']);
  });
  it('sorting by amount and date, both directions', () => {
    expect(sortLines(rows, 'amount', 'desc').map((l) => l.line_ref)).toEqual(['L-2', 'L-5', 'L-1', 'L-3', 'L-4']);
    expect(sortLines(rows, 'date', 'asc')[0].line_ref).toBe('L-5');
  });
  it('pages clamp to the available range', () => {
    const list = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(list, 3, 10)).toMatchObject({ items: [20, 21, 22], page: 3, pages: 3, total: 23 });
    expect(pageOf(list, 9, 10).page).toBe(3);
    expect(pageOf([], 1, 10)).toMatchObject({ items: [], page: 1, pages: 1 });
  });
  it('CSV has only the visible rows and no hourly rate column', () => {
    const csv = rewardLinesCsv(filterLines(rows, { ...DEFAULT_LINE_FILTER, status: 'paid' }, NOW));
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('RP-1A2B3C4D');
    expect(csv.toLowerCase()).not.toContain('hourly');
  });
});

describe('earnings summary and chart', () => {
  const rows = [
    line({ status: 'pending', amount: 2, matures_at: '2026-10-30T00:00:00Z', created_at: '2026-10-05T00:00:00Z' }),
    line({ status: 'pending', amount: 3, matures_at: '2026-10-25T00:00:00Z', created_at: '2026-10-06T00:00:00Z' }),
    line({ status: 'held', amount: 4, created_at: '2026-09-06T00:00:00Z' }),
    line({ status: 'available', amount: 1.5, created_at: '2026-09-07T00:00:00Z' }),
    line({ status: 'in_payout', amount: 1, created_at: '2026-09-08T00:00:00Z' }),
    line({ status: 'paid', amount: 10, created_at: '2026-06-08T00:00:00Z' }),
    line({ status: 'reversed', amount: 6, created_at: '2026-06-09T00:00:00Z' }),
    line({ kind: 'reversal', status: 'available', amount: -6, created_at: '2026-09-10T00:00:00Z' }),
    line({ status: 'paid', amount: 7, currency: 'EUR', created_at: '2026-10-01T00:00:00Z' }),
  ];
  it('cards per currency: pending with the earliest release date, held, available, paid, reversed, lifetime', () => {
    const [usd, eur] = earningsSummary(rows, NOW);
    expect(usd).toEqual({ currency: 'USD', pending: 5, nextRelease: '2026-10-25T00:00:00Z', held: 4, available: -3.5, paid: 10, reversed: -6, lifetime: 15.5, thisMonth: 5, lastMonth: 0.5 });
    expect(eur).toMatchObject({ currency: 'EUR', paid: 7, lifetime: 7 });
  });
  it('month change in percent, none when last month was zero', () => {
    expect(monthChange(5, 0.5)).toBe(900);
    expect(monthChange(3, 4)).toBe(-25);
    expect(monthChange(3, 0)).toBeNull();
  });
  it('monthly series: net per month and running total, reversed lines left out', () => {
    const s = monthlySeries(rows, 'USD', 6, NOW);
    expect(s.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(s.map((m) => m.earned)).toEqual([0, 10, 0, 0, 0.5, 5]);
    expect(s.at(-1)?.cumulative).toBe(15.5);
  });
});

describe('referral funnel, journey and next step', () => {
  const r = (p: Partial<Parameters<typeof funnelChip>[0]>) => funnelChip({ status: 'signed_up', activation_status: 'pending', verified: false, first_paid_at: null, ...p });
  it('one plain status per referred consultant', () => {
    expect(r({})).toBe('registered');
    expect(r({ verified: true })).toBe('interview_pending');
    expect(r({ activation_status: 'active', status: 'verified', verified: true })).toBe('active');
    expect(r({ activation_status: 'active', status: 'paying', verified: true, first_paid_at: '2026-10-01' })).toBe('earning');
    expect(r({ activation_status: 'expired' })).toBe('expired');
    expect(r({ status: 'on_review', activation_status: 'active' })).toBe('on_review');
    expect(r({ status: 'ended', activation_status: 'active', first_paid_at: '2025-01-01' })).toBe('ended');
  });
  it('journey counts are the consultant\'s own numbers', () => {
    const refs = [
      { they_passed: true, first_paid_at: '2026-10-01', activation_status: 'active' },
      { they_passed: true, first_paid_at: null, activation_status: 'active' },
      { they_passed: false, first_paid_at: null, activation_status: 'pending' },
    ];
    expect(journeyCounts({ clicks: 7, signups: 3, paying: 1 }, refs, 12.5)).toEqual({ shared: 7, registered: 3, interviewed: 2, paying: 1, earning: 1 });
    expect(journeyCounts({ clicks: 0, signups: 0, paying: 0 }, [], 0)).toEqual({ shared: 0, registered: 0, interviewed: 0, paying: 0, earning: 0 });
  });
  const base = { suspended: false, profileSubmitted: true, interviewPassed: true, acknowledged: true, policy: true, verified: true, signups: 1, pendingReferrals: 0, available: 0, payoutDetails: true };
  it('next step follows the activation order, then sharing and follow-up', () => {
    expect(nextAction({ ...base, suspended: true })).toBe('support');
    expect(nextAction({ ...base, profileSubmitted: false, interviewPassed: false })).toBe('profile');
    expect(nextAction({ ...base, interviewPassed: false, acknowledged: false })).toBe('interview');
    expect(nextAction({ ...base, acknowledged: false })).toBe('terms');
    expect(nextAction({ ...base, policy: false })).toBe('policy');
    expect(nextAction({ ...base, verified: false })).toBe('wait_verify');
    expect(nextAction({ ...base, available: 5, payoutDetails: false })).toBe('payout');
    expect(nextAction({ ...base, signups: 0 })).toBe('share');
    expect(nextAction({ ...base, pendingReferrals: 2 })).toBe('follow_up');
    expect(nextAction({ ...base, available: 5 })).toBe('earnings');
  });
  it('terms state: current, outdated (new version) or none', () => {
    expect(termsState(2, 2)).toBe('current');
    expect(termsState(1, 2)).toBe('outdated');
    expect(termsState(null, 2)).toBe('none');
  });
});

describe('menu pill indicator', () => {
  const day = 86_400_000;
  it('pulses for 14 days after first shown or until the page was opened', () => {
    const t0 = NOW.getTime();
    expect(pulseActive({ first: null, opened: null, seenLinesAt: null }, t0)).toBe(true);
    expect(pulseActive({ first: t0 - 13 * day, opened: null, seenLinesAt: null }, t0)).toBe(true);
    expect(pulseActive({ first: t0 - 14 * day, opened: null, seenLinesAt: null }, t0)).toBe(false);
    expect(pulseActive({ first: t0, opened: t0, seenLinesAt: null }, t0)).toBe(false);
  });
  it('dot only for rewards newer than the last visit; count = referrals waiting', () => {
    expect(navIndicator({ latest_line_at: '2026-10-20T00:00:00Z', pending_referrals: 2 }, '2026-10-21T00:00:00Z')).toEqual({ dot: false, count: 2 });
    expect(navIndicator({ latest_line_at: '2026-10-22T00:00:00Z', pending_referrals: 0 }, '2026-10-21T00:00:00Z')).toEqual({ dot: true, count: 0 });
    expect(navIndicator({ latest_line_at: '2026-10-22T00:00:00Z' }, null).dot).toBe(true);
    expect(navIndicator(null, null)).toEqual({ dot: false, count: 0 });
  });
});
