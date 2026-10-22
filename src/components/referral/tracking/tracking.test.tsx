import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n/config';
import { parseReferralSettings } from '@/lib/referrals';
import type { RewardLine } from '@/lib/referralTracking';
import ReferralEarnings from './ReferralEarnings';
import ReferralFunnelList from './ReferralFunnelList';
import ReferralPolicyCards from './ReferralPolicyCards';

vi.mock('@/hooks/useReferralProgram', () => ({
  referralRpc: vi.fn(async () => ({ data: null, error: null })),
  rpcMessage: (_e: unknown, f: string) => f,
  useReferralTerms: () => ({ data: null }),
  acceptReferralTerms: vi.fn(),
}));
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

const money = (v: number, cur = 'USD') => `${cur === 'USD' ? '$' : `${cur} `}${v.toFixed(2)}`;
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '-');
const month = (iso: string) => iso.slice(0, 7);
const tiers = [{ min: 0, rate: 0.5, name: 'Tier 1' }, { min: 11, rate: 0.6, name: 'Tier 2' }, { min: 21, rate: 0.7, name: 'Tier 3' }];

function line(p: Partial<RewardLine>): RewardLine {
  return {
    line_ref: 'L-AAAAAA', created_at: new Date().toISOString(), ref_key: 'k1', referred_name: 'D. F****', kind: 'reward', status: 'pending', hold_reason: null,
    engagement_ref: 'Engagement #A12F', approved_hours: 8, man_days: 1, fee_amount: 400, rate_percent: 0.5, tier_name: 'Tier 1', amount: 2,
    currency: 'USD', released_at: null, matures_at: '2026-11-05T00:00:00Z', available_at: null, paid_at: null, payout_ref: null, note: null, ...p,
  };
}

const renderEarnings = (lines: RewardLine[]) => render(
  <MemoryRouter>
    <ReferralEarnings lines={lines} loading={false} detailed payouts={[{ payout_ref: 'RP-1A2B3C4D', bank_reference: 'TRX-42', created_at: '2026-10-01T00:00:00Z', amount: 30, currency: 'USD', status: 'completed', due_by: null, paid_at: '2026-10-03T00:00:00Z', lines: 3 }]}
      payoutsAvailable tiers={tiers} tierCount={9} minPayout={25} payoutDetails={false} money={money} date={date} month={month} />
  </MemoryRouter>,
);

beforeEach(() => { void i18n.changeLanguage('en'); document.documentElement.dir = 'ltr'; });
afterEach(() => cleanup());

describe('Earnings & payouts tab', () => {
  it('shows the exact calculation, the release date and the payout references', () => {
    renderEarnings([line({}), line({ line_ref: 'L-BBBBBB', status: 'paid', amount: 5, fee_amount: 1000, approved_hours: 20, payout_ref: 'RP-1A2B3C4D' })]);
    const table = screen.getByRole('table', { name: 'Reward lines' });
    expect(within(table).getAllByText('8 h approved → Fee $400.00 x 0.5 % = $2.00').length).toBe(1);
    expect(within(table).getByText('Pending · available 2026-11-05')).toBeTruthy();
    expect(screen.getAllByText('RP-1A2B3C4D').length).toBeGreaterThan(0);
    expect(screen.getByText('TRX-42')).toBeTruthy();
    expect(screen.getByText('Bank details missing')).toBeTruthy();
    expect(screen.getByText('2 more verified referred consultants to reach Tier 2 (0.6 %) for new rewards.')).toBeTruthy();
  });

  it('status filter and search narrow the rows; CSV count follows', () => {
    renderEarnings([line({ line_ref: 'L-1' }), line({ line_ref: 'L-2', status: 'held', hold_reason: 'dispute' }), line({ line_ref: 'L-3', status: 'paid', referred_name: 'M. S****' })]);
    expect(screen.getByRole('button', { name: /CSV \(3 rows\)/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'm. s' } });
    expect(screen.getByRole('button', { name: /CSV \(1 rows\)/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    expect(screen.getAllByText('On hold · client dispute').length).toBeGreaterThan(0);
  });

  it('empty state explains when rewards appear', () => {
    renderEarnings([]);
    expect(screen.getByText(/No rewards yet\. A reward appears when a colleague you referred is paid/)).toBeTruthy();
  });

  it('never shows an hourly rate column', () => {
    renderEarnings([line({})]);
    expect(document.body.textContent?.toLowerCase()).not.toContain('hourly rate x');
    expect(screen.queryByText(/per hour/i)).toBeNull();
  });
});

describe('My referrals list', () => {
  it('plain status chips, masked names and a plain rejected reason', () => {
    render(<MemoryRouter><ReferralFunnelList loading={false} passMark={50} date={date} money={money}
      referrals={[
        { referred_name: 'D. F****', status: 'paying', attributed_at: '2026-09-01', verified: true, first_paid_at: '2026-09-10', window_ends_at: '2027-09-10', earned: { USD: 12 },
          activation_status: 'active', chip: 'active', my_next: 'none', their_next: 'none', activated_at: '2026-09-05', activation_expires_at: null, they_passed: true, they_acknowledged: true },
        { referred_name: 'P. L****', status: 'verified', attributed_at: '2026-10-01', verified: true, first_paid_at: null, window_ends_at: null, earned: {},
          activation_status: 'pending', chip: 'waiting_them', my_next: 'wait_other', their_next: 'pass_interview', activated_at: null, activation_expires_at: '2026-12-30', they_passed: false, they_acknowledged: false },
      ]}
      rejected={[{ referred_name: 'X. M****', attributed_at: '2026-08-01', decided_at: '2026-08-20', reason: 'review_failed' }]} /></MemoryRouter>);
    expect(screen.getByText('Earning')).toBeTruthy();
    expect(screen.getByText('Interview pending')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText(/did not pass our fraud review/)).toBeTruthy();
    expect(screen.getByText(/Pass the AI interview \(score at least 50\)/)).toBeTruthy();
    expect(screen.getByText(/USD|\$12\.00/)).toBeTruthy();
  });
});

describe('Programme policy cards', () => {
  const s = parseReferralSettings({ enabled: true, months: 9, min_payout: 30, terms_version: 2, pass_mark: 55, activation_days: 60, hold_days: 21,
    min_invoice: 15, payout_change_hold_days: 5, tiers, terms_published_at: '2026-10-01T00:00:00Z' });
  const renderCards = (acceptedVersion: number | null, acceptedAt: string | null, canAccept = true) => render(
    <MemoryRouter><ReferralPolicyCards s={s} tiers={tiers} passMark={55} money={(v) => `$${v.toFixed(2)}`} date={date} acceptedVersion={acceptedVersion} canAccept={canAccept} onDone={() => {}}
      terms={{ current_version: 2, published_at: '2026-10-01T00:00:00Z', is_draft: true, accepted_version: acceptedVersion, accepted_at: acceptedAt, accepted_current_at: acceptedVersion === 2 ? acceptedAt : null }} /></MemoryRouter>,
  );

  it('15 numbered cards; every number comes from the settings', () => {
    renderCards(2, '2026-10-05T00:00:00Z');
    const triggers = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') != null);
    expect(triggers).toHaveLength(15);
    fireEvent.click(screen.getByRole('button', { name: /What you earn/ }));
    expect(screen.getByText(/0\.5-0\.7 % \(by your tier\) of the referred consultant's approved fee, for 9 months/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hold period and payout timing/ }));
    expect(screen.getByText(/stays pending for 21 days/)).toBeTruthy();
    expect(screen.getByText(/referral payouts wait 5 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Minimum payout/ }));
    expect(screen.getByText(/at least \$30\.00 is available/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /When a referral counts/ }));
    expect(screen.getByText(/within 60 days of their sign-up/)).toBeTruthy();
    expect(screen.getByText('Draft pending legal review')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('You accepted version 2 on 2026-10-05.');
  }, 20_000);

  it('a new terms version asks to accept again', () => {
    renderCards(1, '2026-09-01T00:00:00Z');
    expect(screen.getByRole('status').textContent).toContain('You accepted version 1 (2026-09-01). Version 2 is new');
    expect(screen.getByRole('button', { name: 'Accept the new version' })).toBeTruthy();
  });

  it('Arabic: right-to-left with translated card titles', async () => {
    await i18n.changeLanguage('ar');
    document.documentElement.dir = 'rtl';
    renderCards(2, '2026-10-05T00:00:00Z');
    expect(screen.getByRole('button', { name: /من يمكنه الانضمام/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /الحد الأدنى للدفع/ })).toBeTruthy();
  });
});
