import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n/config';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The real client returns query BUILDERS: awaitable, but without .catch(). The mock does the same, so any
 * `.catch()` chained on a builder crashes these tests exactly like the live site did.
 */
const h = vi.hoisted(() => {
  const thenable = (value: unknown) => ({ then: (res?: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej) });
  const missing = { data: null, error: { message: 'Could not find the function public.referral_track_click in the schema cache', code: 'PGRST202' } };
  const builder = (): unknown => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? thenable({ data: [], error: null, count: 0 }).then : () => builder()),
  });
  return { thenable, missing, builder, rpc: vi.fn() };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: h.rpc,
    from: () => h.builder(),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signUp: async () => ({ data: {}, error: null }),
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  },
}));

import SignupPage from './SignupPage';
import SignupErrorBoundary from '@/components/auth/SignupErrorBoundary';
import { ReferralCapture, ReferralJoinRedirect, resetReferralClickCounts } from '@/components/referral/ReferralCapture';
import { clearStoredReferral, storedReferral } from '@/lib/referrals';

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ReferralCapture />
        <Routes>
          <Route path="/join" element={<ReferralJoinRedirect />} />
          <Route path="/signup" element={<SignupErrorBoundary><SignupPage /></SignupErrorBoundary>} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const formShown = () => waitFor(() => expect(document.querySelector('input[type="email"]')).not.toBeNull());
const trackCalls = () => h.rpc.mock.calls.filter((c) => c[0] === 'referral_track_click');
const flush = () => new Promise((r) => setTimeout(r, 20));

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockImplementation((fn: string) => h.thenable(fn === 'registration_is_open' ? { data: true, error: null } : h.missing));
  resetReferralClickCounts();
  clearStoredReferral();
  localStorage.clear();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const noCrash = () => {
  expect(screen.queryByText(/could not be shown/i)).toBeNull();
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/catch is not a function/);
};

describe('sign-up with referral links (missing referral functions on the server)', () => {
  it.each(['/signup?ref=ABC123', '/signup?ref=%%%', '/join?ref=ABC123', '/signup'])('renders the form for %s', async (url) => {
    renderAt(url);
    await formShown();
    await flush();
    noCrash();
  });

  it('stores a valid code before any network call and counts the visit once per session, silently', async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === 'referral_track_click') expect(storedReferral()).toBe('SAP-RAMI-7K2');
      return h.thenable(fn === 'registration_is_open' ? { data: true, error: null } : h.missing);
    });
    renderAt('/signup?ref=SAP-RAMI-7K2');
    await formShown();
    await waitFor(() => expect(trackCalls()).toHaveLength(1));
    cleanup();
    renderAt('/join?ref=SAP-RAMI-7K2');
    await formShown();
    await flush();
    expect(trackCalls()).toHaveLength(1);
    noCrash();
  });

  it('survives a network failure that throws inside the call', async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === 'referral_track_click') throw new Error('network down');
      return h.thenable({ data: true, error: null });
    });
    renderAt('/signup?ref=SAP-RAMI-7K2');
    await formShown();
    await flush();
    noCrash();
  });

  it('works when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    renderAt('/signup?ref=SAP-RAMI-7K2');
    await formShown();
    await waitFor(() => expect(trackCalls()).toHaveLength(1));
    noCrash();
  });
});

describe('sign-up error boundary', () => {
  it('shows Reload and a sign-in link instead of a blank page', () => {
    const Boom = () => { throw new Error('boom'); };
    render(<MemoryRouter><SignupErrorBoundary><Boom /></SignupErrorBoundary></MemoryRouter>);
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});
