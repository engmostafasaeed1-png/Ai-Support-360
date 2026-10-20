import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DRAFT_POLICY_V1 } from '@/lib/consultantPolicy';

// A consultant who signed up with Google (provider is irrelevant: the step runs after the account exists).
let session = { access_token: '', user: { id: 'u1', last_sign_in_at: '2026-10-20T08:00:00Z', app_metadata: { provider: 'google' } } };
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session } }) } } }));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));

const markShown = vi.fn(async () => {});
const mutateAsync = vi.fn(async () => ({ version: 1, accepted_at: '2026-10-20T09:00:00Z' }));
let raw = { current_version: 1, effective_at: '2026-10-01T00:00:00Z', accepted_version: null as number | null, accepted_at: null, first_shown_at: null, grace_days: 7, consultant_id: 'c1', signed_up_at: '2026-10-20T07:00:00Z' };
vi.mock('@/hooks/useConsultantPolicy', async () => {
  const { policyState } = await import('@/lib/consultantPolicy');
  return {
    usePolicyVersion: () => ({ data: { policy: { ...DRAFT_POLICY_V1, effectiveAt: '2026-10-01T00:00:00Z' }, ready: true } }),
    useMyPolicy: () => ({
      ready: true, loading: false, isConsultant: true, raw,
      status: policyState({ currentVersion: raw.current_version, acceptedVersion: raw.accepted_version, firstShownAt: raw.first_shown_at, graceDays: raw.grace_days, now: Date.now() }),
      markShown, accept: { mutateAsync },
    }),
  };
});

import PolicyGate from './PolicyGate';
import PolicyRegistrationStep from './PolicyRegistrationStep';

const wrap = (ui: React.ReactNode, path = '/consultant') => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);

beforeEach(() => {
  localStorage.clear();
  markShown.mockClear(); mutateAsync.mockClear();
  raw = { ...raw, accepted_version: null };
  session = { ...session, user: { ...session.user, last_sign_in_at: '2026-10-20T08:00:00Z' } };
});

describe('policy pop-up', () => {
  it('Google sign-up path: a new consultant gets the pop-up, which records the first display', async () => {
    wrap(<PolicyGate />);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Please confirm the Consultant Service Policy');
    expect(markShown).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('once per sign-in after "Remind me later", and again at the next sign-in', async () => {
    const first = wrap(<PolicyGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remind me later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    first.unmount();
    wrap(<PolicyGate />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    session = { ...session, user: { ...session.user, last_sign_in_at: '2026-10-21T08:00:00Z' } };
    wrap(<PolicyGate />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('never opens on the profile page (the step is shown there) or once accepted', async () => {
    wrap(<PolicyGate />, '/consultant/profile');
    raw = { ...raw, accepted_version: 1 };
    wrap(<PolicyGate />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirming saves the acknowledgement for the shown version', async () => {
    wrap(<PolicyGate />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /version 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ version: 1, lang: 'en', source: 'popup' }));
  });
});

describe('registration step', () => {
  it('is the final step before review: summary, required checkbox, "Accept and submit for review"', async () => {
    wrap(<PolicyRegistrationStep verificationStatus="pending" />, '/consultant/profile');
    expect(screen.getByRole('heading', { name: 'Final step: Consultant Service Policy' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Full policy text' })).toHaveTextContent('Summary');
    const submit = screen.getByRole('button', { name: 'Accept and submit for review' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ version: 1, lang: 'en', source: 'registration' }));
    expect(markShown).toHaveBeenCalledWith(1);
  });
});
