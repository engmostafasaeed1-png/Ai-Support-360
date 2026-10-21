import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rows: { current: { key: string; value: unknown }[] } = { current: [] };
const session: { current: any } = { current: null };
const signInWithOAuth = vi.fn(async () => ({ redirected: true }));
const signOut = vi.fn(async () => ({ error: null }));
const inserts: string[] = [];

vi.mock('@/integrations/lovable/index', () => ({ lovable: { auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...(a as [])) } } }));
vi.mock('@/integrations/supabase/client', () => {
  const chainFor = (table: string): any => {
    const chain: any = {
      select: () => chain,
      in: async () => ({ data: rows.current, error: null }),
      eq: () => chain,
      limit: async () => ({ data: [{ role: 'client' }], error: null }),
      maybeSingle: async () => ({ data: { id: 'x' }, error: null }),
      insert: async () => { inserts.push(table); return { error: null }; },
      update: () => { inserts.push(table); return chain; },
      upsert: async () => { inserts.push(table); return { error: null }; },
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => chainFor(table),
      rpc: async () => ({ data: true, error: null }),
      auth: {
        getSession: async () => ({ data: { session: session.current } }),
        getUser: async () => ({ data: { user: session.current?.user ?? null } }),
        signOut: () => signOut(),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock('@/components/VideoBackground', () => ({ default: () => null }));

import { socialConfigFromRows, startSocialSignIn, storeSocialSignupIntent, shouldRefuseNewSocialUser } from './socialSignin';
import SocialSignInButtons from '@/components/auth/SocialSignInButtons';
import LoginPage from '@/pages/auth/LoginPage';
import SignupPage from '@/pages/auth/SignupPage';

const newGoogleUser = () => ({ id: 'u1', email: 'new@example.com', created_at: new Date().toISOString(), app_metadata: { provider: 'google' }, user_metadata: {} });

beforeEach(() => {
  rows.current = []; session.current = null; inserts.length = 0;
  signInWithOAuth.mockClear(); signOut.mockClear(); localStorage.clear(); sessionStorage.clear();
});

describe('social sign-in settings', () => {
  it('defaults to Google on /login and nothing on sign-up', () => {
    expect(socialConfigFromRows([])).toEqual({ login: ['google'], signup: [] });
  });

  it('sign-up offers the login providers only when social sign-up is on', () => {
    expect(socialConfigFromRows([{ key: 'social_signup_enabled', value: true }])).toEqual({ login: ['google'], signup: ['google'] });
    expect(socialConfigFromRows([{ key: 'social_login_providers', value: ['google', 'apple', 'lovable'] }]).login).toEqual(['google', 'apple']);
  });

  it('refuses Lovable and unlisted providers, and Google sign-up while sign-up is off', async () => {
    expect((await startSocialSignIn('lovable', { redirect_uri: 'x' })).refused).toBe(true);
    expect((await startSocialSignIn('apple', { redirect_uri: 'x' })).refused).toBe(true);
    expect((await startSocialSignIn('google', { redirect_uri: 'x' }, 'signup')).refused).toBe(true);
    expect(signInWithOAuth).not.toHaveBeenCalled();
    await startSocialSignIn('google', { redirect_uri: 'x' }, 'login');
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it('refuses a brand-new Google account unless it came from an allowed social sign-up', () => {
    expect(shouldRefuseNewSocialUser(newGoogleUser())).toBe(true);
    expect(shouldRefuseNewSocialUser({ ...newGoogleUser(), created_at: '2025-01-01T00:00:00Z' })).toBe(false);
    storeSocialSignupIntent();
    expect(shouldRefuseNewSocialUser(newGoogleUser())).toBe(false);
  });
});

describe('SocialSignInButtons', () => {
  it('renders nothing (no "or" divider) without providers', () => {
    const { container } = render(<SocialSignInButtons providers={[]} loadingProvider={null} onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

function renderPage(el: JSX.Element, path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{el}</MemoryRouter></QueryClientProvider>);
}

describe('LoginPage', () => {
  it('shows only Google with the returning-users note, and the e-mail form', async () => {
    renderPage(<LoginPage />, '/login');
    expect(await screen.findByRole('button', { name: /google/i })).toBeInTheDocument();
    for (const name of [/apple/i, /microsoft/i, /lovable/i]) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByTestId('social-note')).toHaveTextContent(/returning users only/i);
    expect(screen.getByLabelText(/auth\.email|e-?mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth\.password|password/i)).toBeInTheDocument();
  });

  it('signs out a brand-new Google account and creates nothing', async () => {
    session.current = { user: newGoogleUser() };
    renderPage(<LoginPage />, '/login');
    expect(await screen.findByText(/no account found for this google profile/i)).toBeInTheDocument();
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(inserts).toEqual([]);
  });
});

describe('SignupPage', () => {
  it('shows no social buttons while social sign-up is off', async () => {
    renderPage(<SignupPage />, '/signup');
    expect(await screen.findAllByLabelText(/auth\.email|e-?mail/i)).not.toHaveLength(0);
    await new Promise((r) => setTimeout(r, 20));
    for (const name of [/google/i, /apple/i, /microsoft/i, /lovable/i]) expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
