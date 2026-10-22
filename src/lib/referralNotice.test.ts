import { describe, expect, it } from 'vitest';
import { isReferralNotice, referralNoticeAmount, referralNoticeView } from './referralNotice';

describe('Refer & earn in-app notices', () => {
  it('keeps type referral (and the older referral_intro)', () => {
    expect(isReferralNotice('referral')).toBe(true);
    expect(isReferralNotice('referral_intro')).toBe(true);
    expect(isReferralNotice('admin_message')).toBe(false);
  });
  it('invitations are violet-teal and open the programme tab', () => {
    const v = referralNoticeView({ type: 'referral', title: 'Invitation: Refer & earn on AI Support 360', link: '/consultant/referrals?tab=programme&from=invite' });
    expect(v).toMatchObject({ kind: 'invitation', tone: 'invite', action: 'open', link: '/consultant/referrals?tab=programme' });
  });
  it('earned rewards are green with the amount and open the earnings tab', () => {
    const v = referralNoticeView({ type: 'referral', title: 'You earned your first referral reward', body: 'You earned 12.50 USD from the work of D. K****.' });
    expect(v).toMatchObject({ kind: 'reward_earned', tone: 'earned', action: 'view_earning' });
    expect(v.amount).toEqual({ amount: '12.50', currency: 'USD' });
    expect(v.link).toBe('/consultant/referrals?tab=earnings&status=pending');
  });
  it('held is amber, reversed and rejected are red', () => {
    expect(referralNoticeView({ type: 'referral', title: 'A referral reward is on hold' })).toMatchObject({ tone: 'pending', link: '/consultant/referrals?tab=earnings&status=held' });
    expect(referralNoticeView({ type: 'referral', title: 'A referral reward was reversed' }).tone).toBe('negative');
    expect(referralNoticeView({ type: 'referral', title: 'A referral was not accepted' })).toMatchObject({ tone: 'negative', link: '/consultant/referrals?tab=referrals' });
  });
  it('a test notice is recognised and keeps its kind', () => {
    expect(referralNoticeView({ type: 'referral', title: '[TEST] Invitation: Refer & earn on AI Support 360' })).toMatchObject({ kind: 'invitation', test: true });
  });
  it('reads amounts in either order and ignores text without an amount', () => {
    expect(referralNoticeAmount('USD 7.10 paid')).toEqual({ amount: '7.10', currency: 'USD' });
    expect(referralNoticeAmount('nothing here')).toBeNull();
  });
});
