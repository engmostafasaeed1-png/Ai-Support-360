import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n/config';
import { parseReferralSettings } from '@/lib/referrals';
import type { ReferralOverview } from '@/hooks/useReferralProgram';
import ReferralRulesHub from './ReferralRulesHub';

vi.mock('@/hooks/useReferralProgram', () => ({
  referralRpc: vi.fn(async () => ({ data: [], error: null })),
  rpcMessage: (_e: unknown, f: string) => f,
  useReferralTerms: () => ({ data: null }),
  acceptReferralTerms: vi.fn(),
}));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

const money = (v: number) => `$${v.toFixed(2)}`;
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '-');

function overview(over: Partial<ReferralOverview> = {}, settings: Record<string, unknown> = {}): ReferralOverview {
  return {
    settings: parseReferralSettings({ enabled: true, months: 12, min_payout: 25, terms_version: 1, pass_mark: 50, activation_days: 90, hold_days: 14,
      min_invoice: 20, monthly_cap: 1000, monthly_cap_referred: 250, payout_change_hold_days: 7, tier_paid_days: 90, terms_published_at: '2026-10-01T00:00:00Z',
      tiers: [{ min: 0, rate: 0.5, name: 'Tier 1' }, { min: 11, rate: 0.6, name: 'Tier 2' }, { min: 21, rate: 0.7, name: 'Tier 3' }, { min: 31, rate: 0.8, name: 'Tier 4' }, { min: 41, rate: 1, name: 'Tier 5' }],
      ...settings }),
    code: 'SAP-RAMI-7K2M9QX', previous_code: null, edits_left: 1, disabled: false, terms_accepted_version: null,
    funnel: { clicks: 0, signups: 0, verified: 0, paying: 0 }, earnings: [],
    eligibility: { verified: false, policy: false, suspended: false, payout_details: false, profile_submitted: false },
    sim_defaults: { own_rate: 50, platform_rate: null },
    activation: { pass_mark: 50, interview_passed: false, best_score: 42, acknowledged: false, active: false },
    claim: { can_claim: false, until: null }, tier_count: 0,
    ...over,
  } as ReferralOverview;
}

const renderHub = (ov: ReferralOverview) =>
  render(<MemoryRouter><ReferralRulesHub ov={ov} referrals={[]} money={money} date={date} onDone={() => {}} /></MemoryRouter>);

beforeEach(() => { void i18n.changeLanguage('en'); document.documentElement.dir = 'ltr'; });
afterEach(() => cleanup());

describe('Programme rules hub', () => {
  it('new consultant: LOCKED with the steps left, interview button, terms locked', () => {
    renderHub(overview());
    expect(screen.getByRole('status').textContent).toBe('Your programme is LOCKED - 5 steps left');
    expect(screen.getByText('Best score 42 of the 50 needed.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start AI interview' }).getAttribute('href')).toBe('/consultant/interviews?start=1');
    const terms = screen.getByText('Programme terms accepted').closest('li') as HTMLElement;
    expect(terms.dataset.state).toBe('locked');
    expect(within(terms).getByText('Opens after you pass the AI interview.')).toBeTruthy();
  });

  it('everything done except bank details: ACTIVE (bank details only needed to be paid)', () => {
    renderHub(overview({
      eligibility: { verified: true, policy: true, suspended: false, payout_details: false, profile_submitted: true },
      activation: { pass_mark: 50, interview_passed: true, best_score: 80, acknowledged: true, active: true },
    }));
    expect(screen.getByRole('status').textContent).toBe('Your programme is ACTIVE');
    expect((screen.getByText('Payout details added').closest('li') as HTMLElement).dataset.state).toBe('todo');
    expect(screen.queryByRole('link', { name: 'Start AI interview' })).toBeNull();
  });

  it('interview passed, terms open: the accept button appears', () => {
    renderHub(overview({ activation: { pass_mark: 50, interview_passed: true, best_score: 70, acknowledged: false, active: false } }));
    expect(screen.getByRole('button', { name: 'Accept the terms' })).toBeTruthy();
  });

  it('reads every number from the live settings (nothing hard-coded)', () => {
    renderHub(overview({ tier_count: 2 }, {
      pass_mark: 63, hold_days: 9, min_payout: 31, min_invoice: 17, months: 7, terms_version: 4, payout_change_hold_days: 3,
      monthly_cap: 777, monthly_cap_referred: null, tier_paid_days: 45,
      tiers: [{ min: 0, rate: 0.4, name: 'Starter' }, { min: 3, rate: 0.9, name: 'Pro' }],
    }));
    const text = document.body.textContent ?? '';
    for (const s of ['at least 63', 'Hold 9 days', 'Minimum $31.00', 'below $17.00', '7 months', 'Terms version 4', 'wait 3 days', '$777.00 a month',
                     'Starter', 'Pro', '0.4 %', 'within 45 days', '0.4-0.9 %']) expect(text).toContain(s);
    for (const s of ['Hold 14 days', 'at least 50', '$25.00', '12 months', '0.5 %']) expect(text).not.toContain(s);
  });

  it('shows the administrator note of a section as plain text', () => {
    renderHub(overview({}, { rules_texts: { payment: { en: 'Payouts run on Mondays.' } } }));
    expect(screen.getByText('Payouts run on Mondays.')).toBeTruthy();
  });

  it('navigation: 7 labelled chips, each controls its section, click moves focus, arrows move between chips', () => {
    renderHub(overview());
    const nav = screen.getByRole('navigation', { name: 'Programme rules sections' });
    const chips = within(nav).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Overview', 'Prerequisites', 'How you earn', 'Rates', 'Payment', 'Rules & fairness', 'Simulator']);
    for (const c of chips) expect(document.getElementById(c.getAttribute('aria-controls') as string)).toBeTruthy();
    fireEvent.click(chips[3]);
    expect(document.activeElement?.id).toBe('refz-rules-rates');
    expect(chips[3].getAttribute('aria-current')).toBe('true');
    chips[0].focus();
    fireEvent.keyDown(chips[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(chips[1]);
    fireEvent.keyDown(chips[1], { key: 'End' });
    expect(document.activeElement).toBe(chips[6]);
  });

  it('simulator: the tier follows the number of referrals and the banner says illustration only', () => {
    renderHub(overview());
    expect(screen.getByText(/Illustration only - not a promise or a guarantee/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Referred consultants (verified and paying)', { selector: 'input' }), { target: { value: '11' } });
    expect(screen.getByText('Tier 2: 0.6 % applied')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Referred consultants (verified and paying)', { selector: 'input' }), { target: { value: '10' } });
    expect(screen.getByText('Tier 1: 0.5 % applied')).toBeTruthy();
    expect(screen.getByText(/1 more referrals to reach Tier 2 \(0\.6 %\)/)).toBeTruthy();
  });

  it('Arabic: translated hub and arrows follow the reading direction', async () => {
    await i18n.changeLanguage('ar');
    document.documentElement.dir = 'rtl';
    renderHub(overview());
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('قواعد البرنامج');
    const chips = within(screen.getByRole('navigation')).getAllByRole('button');
    chips[1].focus();
    fireEvent.keyDown(chips[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(chips[0]);
  });
});
