import { describe, expect, it, beforeEach } from 'vitest';
import {
  captureReferral, isBlockedReferralWord, isReferralPayout, normalizeReferralCode, parseReferralSettings, parseStoredRef,
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
    enabled: true, attributionStatus: 'active', referrerId: 'a', referredId: 'b',
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
