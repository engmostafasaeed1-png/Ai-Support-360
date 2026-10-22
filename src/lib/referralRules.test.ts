import { describe, expect, it } from 'vitest';
import { DEFAULT_TIERS } from './referrals';
import {
  journeyProgress, realNumbersFromReferrals, referralChecklist, simDefaultRate, simMonths, simulateReferrals, type ChecklistInput, type SimSettings,
} from './referralRules';

const all: ChecklistInput = { profileSubmitted: true, interviewPassed: true, bestScore: 80, passMark: 50, acknowledged: true, verified: true, policy: true, payoutDetails: true, suspended: false };
const state = (c: ReturnType<typeof referralChecklist>, id: string) => c.items.find((x) => x.id === id)?.state;

describe('prerequisites checklist', () => {
  it('everything done -> ACTIVE', () => {
    const c = referralChecklist(all);
    expect(c.active).toBe(true);
    expect(c.left).toBe(0);
  });
  it('new consultant: terms locked until the interview is passed, 5 steps left', () => {
    const c = referralChecklist({ ...all, profileSubmitted: false, interviewPassed: false, bestScore: null, acknowledged: false, verified: false, policy: false, payoutDetails: false });
    expect(state(c, 'terms')).toBe('locked');
    expect(state(c, 'interview')).toBe('todo');
    expect(c.left).toBe(5);
    expect(c.active).toBe(false);
  });
  it('interview passed but terms not accepted: terms become a to-do, 1 step left', () => {
    const c = referralChecklist({ ...all, acknowledged: false });
    expect(state(c, 'terms')).toBe('todo');
    expect(c.left).toBe(1);
  });
  it('missing bank details never block the programme (needed to be paid, not to share)', () => {
    const c = referralChecklist({ ...all, payoutDetails: false });
    expect(state(c, 'payout')).toBe('todo');
    expect(c.active).toBe(true);
  });
  it('waiting for verification counts as a step left', () => {
    expect(referralChecklist({ ...all, verified: false }).left).toBe(1);
  });
  it('a suspended account is never active', () => {
    expect(referralChecklist({ ...all, suspended: true }).active).toBe(false);
  });
});

describe('journey', () => {
  it('highlights the first step not done', () => {
    expect(journeyProgress({ clicks: 0, signups: 0, activePairs: 0, paying: 0, lifetime: 0 }).current).toBe(0);
    expect(journeyProgress({ clicks: 3, signups: 1, activePairs: 0, paying: 0, lifetime: 0 }).current).toBe(2);
    expect(journeyProgress({ clicks: 3, signups: 1, activePairs: 1, paying: 1, lifetime: 0 }).current).toBe(4);
    expect(journeyProgress({ clicks: 0, signups: 2, activePairs: 1, paying: 1, lifetime: 9 }).current).toBe(5);
  });
});

const S: SimSettings = { tiers: DEFAULT_TIERS, months: 12, minInvoice: 20, monthlyCap: null, monthlyCapReferred: null, maxPerReferred: null };
const sim = (referred: number, extra: Partial<Parameters<typeof simulateReferrals>[0]> = {}, s: SimSettings = S) =>
  simulateReferrals({ referred, manDays: 10, hourlyRate: 50, months: 12, rampUp: false, ...extra }, s);

describe('simulator arithmetic', () => {
  it('chooses the tier from the number of referrals at every boundary', () => {
    const cases: Array<[number, number]> = [[10, 0.5], [11, 0.6], [20, 0.6], [21, 0.7], [30, 0.7], [31, 0.8], [40, 0.8], [41, 1.0]];
    for (const [n, rate] of cases) expect(sim(n).tier.rate).toBe(rate);
  });
  it('fee = man-days x 8 h x hourly rate; reward rounded to cents', () => {
    const r = sim(1);
    expect(r.feePerReferralMonth).toBe(4000);       // 10 x 8 x 50
    expect(r.perReferralMonthly).toBe(20);           // 0.5 %
    expect(r.monthly).toBe(20);
    expect(r.windowTotal).toBe(240);
    expect(r.perReferralWindow).toBe(240);
    expect(r.totalFeeBase).toBe(48000);
    // 1 man-day at 33.33/h = 266.64 fee -> 0.6 % = 1.59984 -> 1.60
    expect(simulateReferrals({ referred: 11, manDays: 1, hourlyRate: 33.33, months: 1, rampUp: false }, S).perReferralMonthly).toBe(1.6);
  });
  it('the owner example: $400 fee at 0.6 % = $2.40', () => {
    expect(simulateReferrals({ referred: 11, manDays: 1, hourlyRate: 50, months: 1, rampUp: false }, S).perReferralMonthly).toBe(2.4);
  });
  it('months come from the settings and never exceed 12', () => {
    expect(sim(2, { months: 24 }).months).toBe(12);
    expect(sim(2, { months: 9 }, { ...S, months: 6 }).months).toBe(6);
    expect(simMonths(36)).toBe(12);
    expect(sim(2).series).toHaveLength(12);
  });
  it('shows what the next tier adds', () => {
    const r = sim(10);
    expect(r.next).toMatchObject({ min: 11, needed: 1, rate: 0.6, monthlyAtNext: 264 });
    expect(r.next?.extraMonthly).toBe(44);          // 11 x (24 - 20)
    expect(sim(41).next).toBeNull();
  });
  it('ramp-up: colleagues join gradually, the tier follows the active count', () => {
    const r = sim(12, { rampUp: true });
    expect(r.series[0].active).toBe(1);
    expect(r.series[11].active).toBe(12);
    expect(r.series[11].rate).toBe(0.6);
    expect(r.windowTotal).toBeLessThan(sim(12).windowTotal);
    expect(r.series[11].cumulative).toBe(r.windowTotal);
  });
  it('invoice lines under the minimum earn nothing and are explained', () => {
    const r = simulateReferrals({ referred: 3, manDays: 0.1, hourlyRate: 20, months: 12, rampUp: false }, S); // 16.00 < 20
    expect(r.perReferralMonthly).toBe(0);
    expect(r.notes).toContain('min_invoice');
  });
  it('caps are shown as notes (held for review), never cut', () => {
    const r = sim(41, { manDays: 22, hourlyRate: 200 }, { ...S, monthlyCap: 1000, monthlyCapReferred: 250, maxPerReferred: 1000 });
    expect(r.perReferralMonthly).toBe(352);           // 22 x 8 x 200 = 35,200 x 1 %
    expect(r.monthly).toBe(14432);
    expect(r.notes).toEqual(expect.arrayContaining(['cap_referrer', 'cap_referred', 'max_per_referred']));
  });
  it('clamps the inputs to the documented ranges', () => {
    const r = simulateReferrals({ referred: 500, manDays: 40, hourlyRate: -5, months: 0, rampUp: false }, S);
    expect(r.referred).toBe(60);
    expect(r.feePerReferralMonth).toBe(0);
    expect(r.months).toBe(1);
  });
});

describe('simulator inputs', () => {
  it('default hourly rate: own rate, else platform average, else empty', () => {
    expect(simDefaultRate({ own_rate: 85, platform_rate: 60 })).toBe(85);
    expect(simDefaultRate({ own_rate: null, platform_rate: 60 })).toBe(60);
    expect(simDefaultRate({ own_rate: null, platform_rate: null })).toBeNull();
  });
  it('"Use my real numbers" counts active paying referrals and averages man-days per month', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const rows = [
      { activation_status: 'active', first_paid_at: '2026-04-01T00:00:00Z', window_ends_at: '2027-04-01T00:00:00Z', man_days: 30 },
      { activation_status: 'active', first_paid_at: '2026-06-01T00:00:00Z', window_ends_at: '2027-06-01T00:00:00Z', man_days: 6 },
      { activation_status: 'pending', first_paid_at: null, window_ends_at: null, man_days: 0 },
    ];
    expect(realNumbersFromReferrals(rows, now)).toEqual({ referred: 2, manDays: 9 }); // 36 man-days over 3 + 1 months
    expect(realNumbersFromReferrals([], now)).toEqual({ referred: 0, manDays: 0 });
  });
});

import { parseRulesTexts, rulesTextsProblem } from './referrals';

describe('administrator section notes', () => {
  it('are plain text only, known sections, at most 600 characters', () => {
    expect(rulesTextsProblem({ payment: { en: 'Payouts run on Mondays.' } })).toBeNull();
    expect(rulesTextsProblem({ payment: { en: '<b>bold</b>' } })).toMatch(/plain text/);
    expect(rulesTextsProblem({ secret: { en: 'x' } })).toBe('Unknown section');
    expect(rulesTextsProblem({ rules: { ar: 'x'.repeat(601) } })).toMatch(/600/);
    expect(parseRulesTexts({ payment: { en: '<script>x</script>', ar: 'نص' }, other: { en: 'x' } })).toEqual({ payment: { ar: 'نص' } });
  });
});
