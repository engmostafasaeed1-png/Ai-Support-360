// H2 regression: a consultant on the profile page must reach every sidebar entry, whatever the profile state.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  onboarded: false,
  locationSet: true,
  policyState: 'accepted' as string,
}));

vi.mock('@/lib/authSession', () => ({ getSessionWithRetry: () => Promise.resolve({ user: { id: 'u1' }, access_token: 't' }) }));
vi.mock('@/components/auth/TwoFactorGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/lib/assignmentPopupAcks', () => ({ sessionIdOf: () => 'session-1' }));
vi.mock('@/integrations/supabase/client', () => {
  const chain: any = {
    select: () => chain, eq: () => chain, in: () => chain, limit: () => Promise.resolve({ data: [{ tenant_id: 't' }] }),
    maybeSingle: () => Promise.resolve({ data: { role: 'consultant', onboarding_completed: h.onboarded } }),
  };
  return {
    supabase: {
      from: () => chain,
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock('@/hooks/useMyLocation', () => ({
  useMyLocation: () => ({
    loading: false, has: h.locationSet, isConsultant: true, save: vi.fn(),
    data: { userId: 'u1', metadata: {}, country: null, city: null },
  }),
}));
vi.mock('@/hooks/useConsultantPolicy', () => ({
  useMyPolicy: () => ({
    ready: true, isConsultant: true, status: { state: h.policyState }, raw: { current_version: 1, grace_days: 14 },
    markShown: vi.fn(), accept: { mutateAsync: vi.fn() },
  }),
  usePolicyVersion: () => ({ data: { ready: true, policy: { version: 1 } } }),
}));
// The dialogs themselves are not under test; they must simply never move the page.
vi.mock('@/components/consultant/LocationDialog', () => ({ default: ({ open }: { open: boolean }) => (open ? <div data-testid="location-dialog" /> : null) }));
vi.mock('@/components/consultant/policy/PolicyDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="policy-dialog" /> : null),
  policyLang: () => 'en',
}));

import ProtectedRoute from './ProtectedRoute';
import LocationGate from '@/components/consultant/LocationGate';
import PolicyGate from '@/components/consultant/policy/PolicyGate';
import { consultantNavGroups } from '@/components/sidebar/navConfig';

const targets = consultantNavGroups.flatMap((g) => g.items).filter((i) => !i.external && i.path.startsWith('/consultant'));

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function Layout() {
  return (
    <div>
      <nav>
        <Link to="/consultant/profile?section=setup">Open profile</Link>
        <Link to="/consultant/interviews?start=1">Start interview</Link>
        {targets.map((t) => <Link key={t.key} to={t.path}>{`go:${t.key}`}</Link>)}
      </nav>
      <Outlet />
      <LocationGate />
      <PolicyGate />
    </div>
  );
}

function renderPortal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/consultant/profile?section=setup']}>
        <Routes>
          <Route path="/consultant" element={<ProtectedRoute requiredRole="consultant"><Layout /></ProtectedRoute>}>
            <Route path="*" element={<Where />} />
            <Route index element={<Where />} />
          </Route>
          <Route path="/login" element={<p>login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function clickThroughEveryEntry() {
  renderPortal();
  expect(await screen.findByTestId('where')).toHaveTextContent('/consultant/profile?section=setup');
  for (const t of targets) {
    await act(async () => { fireEvent.click(screen.getByText('Open profile')); });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/consultant/profile'));
    await act(async () => { fireEvent.click(screen.getByText(`go:${t.key}`)); });
    // Let every guard / effect settle, then the page must still be the one clicked.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(t.path));
  }
}

describe('the AI interview start link from the profile (H3)', () => {
  beforeEach(() => { h.onboarded = false; h.locationSet = true; h.policyState = 'accepted'; });
  it('reaches /consultant/interviews?start=1 even with an incomplete profile (it used to bounce back to the profile)', async () => {
    renderPortal();
    expect(await screen.findByTestId('where')).toHaveTextContent('/consultant/profile');
    await act(async () => { fireEvent.click(screen.getByText('Start interview')); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/consultant/interviews?start=1'));
  });
});

describe('consultant navigation from the profile page (H2)', () => {
  beforeEach(() => {
    h.onboarded = false; h.locationSet = true; h.policyState = 'accepted';
    sessionStorage.clear(); localStorage.clear();
  });

  it('has sidebar entries to check', () => {
    expect(targets.length).toBeGreaterThan(10);
  });

  it('reaches every entry with an incomplete profile', async () => {
    h.onboarded = false;
    await clickThroughEveryEntry();
  });

  it('reaches every entry with a complete profile', async () => {
    h.onboarded = true;
    await clickThroughEveryEntry();
  });

  it('reaches every entry while the service policy is still to be confirmed (pop-up shown, page unchanged)', async () => {
    h.policyState = 'grace';
    await clickThroughEveryEntry();
    expect(screen.getByTestId('policy-dialog')).toBeInTheDocument();
  });

  it('reaches every entry while the location is missing (dialog shown, page unchanged)', async () => {
    h.locationSet = false;
    await clickThroughEveryEntry();
    expect(screen.getByTestId('location-dialog')).toBeInTheDocument();
  });
});
