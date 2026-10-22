import { describe, expect, it, beforeEach } from 'vitest';
import {
  activationChip, interviewPasses, nextStep, captureReferral, isBlockedReferralWord, isReferralPayout, normalizeReferralCode, parseReferralSettings, parseStoredRef,
  referralCodeProblem, referralCsv, referralLink, referrerBadges, rewardBlockReason, rewardForFee, rewardPerManDay, shareMessage,
  shareUrl, storedReferral, windowEnd, type RewardCheck,
} from './referrals';

describe('referral reward (owner rule: 0.5 % of the referred consultant fee)', () => {
  it('is 0.5 % of the fee, rounded to 2 decimals', () => {
    expect(rewardForFee(1000, 0.5)).toBe(5);
    expect(rewardForFee(333.33, 0.5)).toBe(1.67);
    expect(rewardForFee(0, 0.5)).toBe(0);
    expect(rewardForFee(-50, 0.5)).toBe(0);
  });
  it('one man-day = 8 approved hours', () => {
    expect(rewardPerManDay(100, 0.5)).toBe(4); // 100 x 8 = 800 -> 4.00
    expect(rewardPerManDay(85, 0.5)).toBe(3.4);
  });
});

describe('12-month window', () => {
  const base: RewardCheck = {
    enabled: true, activation: 'active', activatedAt: new Date('2026-03-01T00:00:00Z'), attributionStatus: 'active', referrerId: 'a', referredId: 'b',
    windowEndsAt: windowEnd(new Date('2026-03-15T10:00:00Z'), 12), paidAt: new Date('2026-06-01T00:00:00Z'),
    referredVerified: true, referrerVerified: true, referrerSuspended: false, referrerPolicyOk: true,
  };
  it('ends 12 months after the first paid ticket', () => {
    expect(windowEnd(new Date('2026-03-15T10:00:00Z'), 12).toISOString()).toBe('2027-03-15T10:00:00.000Z');
    expect(windowEnd(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
  it('earns until the last moment, not at the end', () => {
    const end = base.windowEndsAt as Date;
    expect(rewardBlockReason({ ...base, paidAt: new Date(end.getTime() - 1000) })).toBeNull();
    expect(rewardBlockReason({ ...base, paidAt: end })).toBe('outside_window');
  });
  it('earns only after activation (both passed + acknowledged), never on earlier work', () => {
    expect(rewardBlockReason({ ...base, activation: 'pending' })).toBe('not_active');
    expect(rewardBlockReason({ ...base, activation: 'expired' })).toBe('not_active');
    expect(rewardBlockReason({ ...base, activatedAt: new Date('2026-06-02T00:00:00Z') })).toBe('before_activation');
  });
  it('needs both verified, referrer not suspended and with signed policy', () => {
    expect(rewardBlockReason({ ...base, referredVerified: false })).toBe('referred_not_verified');
    expect(rewardBlockReason({ ...base, referrerVerified: false })).toBe('referrer_not_verified');
    expect(rewardBlockReason({ ...base, referrerSuspended: true })).toBe('referrer_suspended');
    expect(rewardBlockReason({ ...base, referrerPolicyOk: false })).toBe('referrer_policy');
    expect(rewardBlockReason({ ...base, referredId: 'a' })).toBe('own_work');
    expect(rewardBlockReason({ ...base, enabled: false })).toBe('programme_off');
  });
});

describe('referral codes', () => {
  it('are case-insensitive and readable', () => {
    expect(normalizeReferralCode(' sap-mostafa-7k2 ')).toBe('SAP-MOSTAFA-7K2');
    expect(referralCodeProblem('sap-mostafa-7k2')).toBeNull();
    expect(referralCodeProblem('ab')).toBe('format');
    expect(referralCodeProblem('SAP--X')).toBe('format');
  });
  it('refuse profanity but allow names that contain short words', () => {
    expect(isBlockedReferralWord('SAP-SEX-123')).toBe(true);
    expect(referralCodeProblem('sap-fuck')).toBe('blocked');
    expect(isBlockedReferralWord('SAP-HASSAN-7K2')).toBe(false);
  });
  it('build the share link on the public site', () => {
    expect(referralLink('sap-rami-7k2')).toBe('https://www.aisupport360.com/join?ref=SAP-RAMI-7K2');
  });
});

describe('link capture keeps the code for 30 days', () => {
  beforeEach(() => { localStorage.clear(); document.cookie = 'aisupport360_ref=; Max-Age=0; Path=/'; });
  it('captures from /join, /signup and /for-consultants only', () => {
    expect(captureReferral('/join', '?ref=sap-rami-7k2', 1000)).toBe('SAP-RAMI-7K2');
    expect(captureReferral('/pricing', '?ref=SAP-X-111', 1000)).toBeNull();
    expect(captureReferral('/signup', '?ref=<script>', 1000)).toBeNull();
  });
  it('expires after 30 days', () => {
    const at = Date.UTC(2026, 0, 1);
    const raw = JSON.stringify({ code: 'SAP-RAMI-7K2', at });
    expect(parseStoredRef(raw, at + 29 * 86_400_000)?.code).toBe('SAP-RAMI-7K2');
    expect(parseStoredRef(raw, at + 31 * 86_400_000)).toBeNull();
  });
  it('reads the stored code back', () => {
    captureReferral('/for-consultants', '?ref=SAP-RAMI-7K2');
    expect(storedReferral()).toBe('SAP-RAMI-7K2');
  });
});

describe('sharing and display', () => {
  it('has English and Arabic messages with the code and link', () => {
    const s = { code: 'SAP-RAMI-7K2', link: 'https://www.aisupport360.com/join?ref=SAP-RAMI-7K2', rate: 0.5, months: 12 };
    expect(shareMessage('en', s).text).toContain('SAP-RAMI-7K2');
    expect(shareMessage('ar', s).text).toContain(s.link);
    expect(shareUrl('whatsapp', s.link, 'hi ' + s.link)).toBe(`https://wa.me/?text=${encodeURIComponent('hi ' + s.link)}`);
  });
  it('badges at 1, 5 and 10 verified referrals', () => {
    expect(referrerBadges(5).map((b) => b.earned)).toEqual([true, true, false]);
  });
  it('labels referral payouts by reference', () => {
    expect(isReferralPayout({ reference: 'referral:abc' })).toBe(true);
    expect(isReferralPayout({ reference: 'payment:abc' })).toBe(false);
  });
  it('reads settings safely', () => {
    expect(parseReferralSettings({ enabled: true, rate_percent: 0.5, months: 12, min_payout: 25 }).rate_percent).toBe(0.5);
    expect(parseReferralSettings({ rate_percent: 99 }).rate_percent).toBe(0.5);
    expect(parseReferralSettings(null).enabled).toBe(false);
  });
  it('CSV keeps negative amounts as numbers and neutralises formulas', () => {
    const csv = referralCsv([{ a: -5, b: '=HYPERLINK("x")' }], [['a', 'Amount'], ['b', 'Note']]);
    expect(csv.split('\r\n')[1]).toBe('-5,"\'=HYPERLINK(""x"")"');
  });
});

describe('activation rule (both must pass the AI interview and acknowledge)', () => {
  it('pass mark boundary 49 / 50', () => {
    expect(interviewPasses(49, 50)).toBe(false);
    expect(interviewPasses(50, 50)).toBe(true);
    expect(interviewPasses(null, 50)).toBe(false);
  });
  it('next step and chip per side', () => {
    expect(nextStep({ activation: 'pending', passed: false, acknowledged: true })).toBe('pass_interview');
    expect(nextStep({ activation: 'pending', passed: true, acknowledged: false })).toBe('acknowledge');
    expect(nextStep({ activation: 'pending', passed: true, acknowledged: true })).toBe('wait_other');
    expect(nextStep({ activation: 'active', passed: true, acknowledged: true })).toBe('none');
    expect(activationChip({ review: false, activation: 'pending', myNext: 'pass_interview' })).toBe('waiting_you');
    expect(activationChip({ review: false, activation: 'pending', myNext: 'wait_other' })).toBe('waiting_them');
    expect(activationChip({ review: true, activation: 'active', myNext: 'none' })).toBe('under_review');
    expect(activationChip({ review: false, activation: 'expired', myNext: 'none' })).toBe('expired');
  });
});

import { formulaText, manDays, netReward, referralEstimate, statementCsv, thresholdProgress } from './referrals';

describe('referral calculations arithmetic', () => {
  const usd = (v: number) => `$${v.toFixed(2)}`;
  it('man-days = approved hours / 8', () => {
    expect(manDays(50)).toBe(6.25);
    expect(manDays(7)).toBe(0.88);
    expect(manDays(null)).toBeNull();
  });
  it('shows the formula in plain words', () => {
    expect(formulaText(400, 0.5, 2, usd)).toBe('Fee $400.00 x 0.5 % = $2.00');
  });
  it('rounds every reward to 2 decimals and nets reversals', () => {
    expect(rewardForFee(333.33, 0.5)).toBe(1.67);
    expect(rewardForFee(101, 0.5)).toBe(0.51);
    expect(netReward(5, -5)).toBe(0);
    expect(netReward(7.67, -1.67)).toBe(6);
  });
  it('threshold progress "$18.40 of $25.00"', () => {
    expect(thresholdProgress(18.4, 25)).toEqual({ percent: 74, reached: false, missing: 6.6 });
    expect(thresholdProgress(25, 25).reached).toBe(true);
    expect(thresholdProgress(-3, 25).percent).toBe(0);
  });
  it('estimate is an illustration with the real rate and window', () => {
    // 3 consultants x 10 man-days x 8 h x $50 = $12,000 per month -> 0.5 % = $60, over 12 months $720
    expect(referralEstimate({ referred: 3, manDaysPerMonth: 10, hourlyRate: 50, ratePercent: 0.5, months: 12 })).toEqual({ perMonth: 60, overWindow: 720 });
    expect(referralEstimate({ referred: -2, manDaysPerMonth: 10, hourlyRate: 50, ratePercent: 0.5, months: 12 }).perMonth).toBe(0);
  });
  it('statement CSV keeps the numbers', () => {
    const csv = statementCsv([{ created_at: '2026-10-01', ref_key: 'k', referred_name: 'D. K****', kind: 'reward', status: 'paid', ticket_ref: 'T-1', approved_hours: 50, man_days: 6.25,
      hourly_rate: 8, fee_amount: 400, rate_percent: 0.5, amount: 2, currency: 'USD', payment_status: 'completed', client_paid_at: null, payout_status: 'completed', payout_released_at: null, referral_payout_due: null, note: null }]);
    expect(csv.split('\r\n')[1]).toBe('2026-10-01,D. K****,reward,T-1,50,6.25,8,400,0.5,2,USD,paid,completed,');
  });
});

import { referStepExample, referStepState, setReferStepState } from './referrals';

describe('Refer & earn onboarding step', () => {
  beforeEach(() => localStorage.clear());
  it('example from the settings: 10 x 8 h x $50 = $4,000 -> $20.00; 5 colleagues -> $100.00', () => {
    expect(referStepExample(0.5)).toMatchObject({ fee: 4000, one: 20, many: 100 });
    expect(referStepExample(0.75)).toMatchObject({ fee: 4000, one: 30, many: 150 });
  });
  it('is shown once, and "Maybe later" is remembered', () => {
    expect(referStepState('u1')).toBe('new');
    setReferStepState('u1', 'later');
    expect(referStepState('u1')).toBe('later');
    setReferStepState('u1', 'done');
    expect(referStepState('u1')).toBe('done');
    expect(referStepState('u2')).toBe('new');
    expect(referStepState(null)).toBe('done');
  });
});

import { shouldShowReferralIntro } from './referrals';

describe('one-time Refer & earn introduction', () => {
  const base = { live: true, isGuest: false, progressLoaded: true, seenOnServer: false, localState: 'new' as const };
  it('shows once for a consultant who has not seen it', () => {
    expect(shouldShowReferralIntro(base)).toBe(true);
    expect(shouldShowReferralIntro({ ...base, seenOnServer: true })).toBe(false);
    expect(shouldShowReferralIntro({ ...base, localState: 'later' })).toBe(false);
    expect(shouldShowReferralIntro({ ...base, localState: 'done' })).toBe(false);
  });
  it('never before the programme is live, for demo visitors or before the stored state is read', () => {
    expect(shouldShowReferralIntro({ ...base, live: false })).toBe(false);
    expect(shouldShowReferralIntro({ ...base, isGuest: true })).toBe(false);
    expect(shouldShowReferralIntro({ ...base, progressLoaded: false })).toBe(false);
  });
});
