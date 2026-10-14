import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => ({
  listener: null as null | ((e: string, s: unknown) => void),
  resolveSession: null as null | ((s: unknown) => void),
}));

vi.mock('@/lib/authSession', () => ({
  getSessionWithRetry: () => new Promise((r) => { h.resolveSession = r; }),
}));
vi.mock('@/components/auth/TwoFactorGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/integrations/supabase/client', () => {
  const chain: any = {
    select: () => chain, eq: () => chain, limit: () => Promise.resolve({ data: [{ tenant_id: 't' }] }),
    maybeSingle: () => Promise.resolve({ data: { role: 'consultant', onboarding_completed: true } }),
  };
  return {
    supabase: {
      from: () => chain,
      auth: {
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
          h.listener = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    },
  };
});

import ProtectedRoute from './ProtectedRoute';

const session = { user: { id: 'u1' } };
const app = () => render(
  <MemoryRouter initialEntries={['/consultant/profile']}>
    <Routes>
      <Route path="/consultant/profile" element={<ProtectedRoute requiredRole="consultant"><p>secret page</p></ProtectedRoute>} />
      <Route path="/login" element={<p>login page</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('ProtectedRoute and the session check', () => {
  it('renders nothing of the page until the session check finished, then the page with a session', async () => {
    app();
    expect(screen.queryByText('secret page')).toBeNull();
    await act(async () => { h.resolveSession!(session); });
    expect(await screen.findByText('secret page')).toBeInTheDocument();
  });

  it('goes to /login when the session is lost while a check is still running', async () => {
    app();
    const pending = h.resolveSession!;
    await act(async () => { h.listener!('SIGNED_OUT', null); });
    await act(async () => { pending(session); }); // the older check answers late with the old session
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret page')).toBeNull();
  });
});
