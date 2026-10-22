import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n/config';
import ReferEarnStep from './ReferEarnStep';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  invite: null as unknown,
  overview: {
    available: true,
    data: {
      settings: { enabled: true, rate_percent: 0.5, months: 12, min_payout: 25, terms_version: 1, pass_mark: 50, activation_days: 90 },
      code: 'SAP-MOSTAFA-7K2', previous_code: null, edits_left: 1, disabled: false, terms_accepted_version: null,
      funnel: { clicks: 0, signups: 0, verified: 0, paying: 0 }, earnings: [],
      eligibility: { verified: false, policy: true, suspended: false, payout_details: false },
      activation: { pass_mark: 50, interview_passed: false, best_score: null, acknowledged: false, active: false },
    },
  },
}));

vi.mock('@/hooks/useReferralProgram', () => ({
  referralRpc: h.rpc,
  rpcMessage: (_e: unknown, f: string) => f,
  useInvalidateReferral: () => () => {},
  useReferralOverview: () => ({ data: h.overview }),
  useMyReferralInvite: () => ({ isFetched: true, data: h.invite }),
  useReferralTerms: () => ({ data: null }),
  acceptReferralTerms: vi.fn(),
}));

const renderStep = (props: Parameters<typeof ReferEarnStep>[0] = {}) => render(<MemoryRouter><ReferEarnStep {...props} /></MemoryRouter>);

beforeEach(() => { h.rpc.mockReset(); h.invite = null; void i18n.changeLanguage('en'); });
afterEach(() => cleanup());

describe('Refer & earn onboarding step', () => {
  it('explains the programme with the illustrative example from the settings', () => {
    renderStep();
    expect(screen.getByText('Bring colleagues, earn together')).toBeTruthy();
    expect(screen.getByText(/10 x 8 h x \$50\.00 = \$4,000\.00 fee -> your reward \$20\.00/)).toBeTruthy();
    expect(screen.getByText(/5 colleagues like that -> \$100\.00/)).toBeTruthy();
    expect(screen.getByText(/Example only, not a promise/)).toBeTruthy();
    expect(screen.getByText('SAP-MOSTAFA-7K2').getAttribute('dir')).toBe('ltr');
  });

  it('is skippable and never a blocker', () => {
    const onLater = vi.fn(); const onDone = vi.fn();
    renderStep({ onLater, onDone });
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(onLater).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('asks for the AI interview before sharing (activation rule), not at registration', () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/ }));
    expect(screen.getByText(/Sharing starts after you pass the AI interview/)).toBeTruthy();
  });

  it('validates "Who invited you?" live and shows the masked owner name', async () => {
    h.rpc.mockResolvedValue({ data: { valid: true, name: 'R. S****' }, error: null });
    renderStep();
    fireEvent.change(screen.getByPlaceholderText('SAP-NAME-7K2'), { target: { value: 'sap-rami-7k2' } });
    await waitFor(() => expect(screen.getByText('Code belongs to R. S****')).toBeTruthy(), { timeout: 2000 });
    expect(h.rpc).toHaveBeenCalledWith('referral_validate_code', { _code: 'SAP-RAMI-7K2' });
  });

  it('hides the invite field when a referrer is already linked', () => {
    h.invite = { referrer_name: 'R. S****' };
    renderStep();
    expect(screen.queryByPlaceholderText('SAP-NAME-7K2')).toBeNull();
  });

  it('renders in Arabic with the code kept left-to-right', async () => {
    await i18n.changeLanguage('ar');
    renderStep();
    await waitFor(() => expect(screen.getByText('اجلب زملاءك واربحوا معًا')).toBeTruthy());
    expect(screen.getByText('SAP-MOSTAFA-7K2').getAttribute('dir')).toBe('ltr');
  });
});
