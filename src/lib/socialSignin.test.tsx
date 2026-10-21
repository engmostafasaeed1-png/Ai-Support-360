import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rows: { current: { key: string; value: unknown }[] } = { current: [] };
const signInWithOAuth = vi.fn(async () => ({ redirected: true }));

vi.mock('@/integrations/lovable/index', () => ({ lovable: { auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...(a as [])) } } }));
vi.mock('@/integrations/supabase/client', () => {
  const chain: any = {
    select: () => chain,
    in: async () => ({ data: rows.current, error: null }),
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock('@/components/VideoBackground', () => ({ default: () => null }));

import { socialProvidersFromRows, startSocialSignIn } from './socialSignin';
import SocialSignInButtons from '@/components/auth/SocialSignInButtons';
import LoginPage from '@/pages/auth/LoginPage';

const on = (keys: string[]) => keys.map((key) => ({ key, value: true }));

beforeEach(() => { rows.current = []; signInWithOAuth.mockClear(); });

describe('social sign-in switches', () => {
  it('offers no provider when the main switch is missing or off', () => {
    expect(socialProvidersFromRows([])).toEqual([]);
    expect(socialProvidersFromRows(null)).toEqual([]);
    expect(socialProvidersFromRows([{ key: 'social_signin_enabled', value: false }, ...on(['social_signin_google'])])).toEqual([]);
  });

  it('offers only the enabled providers when the main switch is on', () => {
    expect(socialProvidersFromRows(on(['social_signin_enabled', 'social_signin_google']))).toEqual(['google']);
    expect(socialProvidersFromRows([{ key: 'social_signin_enabled', value: 'true' }, ...on(['social_signin_apple', 'social_signin_microsoft'])])).toEqual(['apple', 'microsoft']);
  });

  it('refuses to start OAuth (no provider redirect) when switched off', async () => {
    const r = await startSocialSignIn('google', { redirect_uri: 'https://www.aisupport360.com' });
    expect(r.refused).toBe(true);
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it('refuses a provider that is off even when another is on', async () => {
    rows.current = on(['social_signin_enabled', 'social_signin_google']);
    expect((await startSocialSignIn('apple', { redirect_uri: 'x' })).refused).toBe(true);
    expect((await startSocialSignIn('lovable', { redirect_uri: 'x' })).refused).toBe(true);
    expect(signInWithOAuth).not.toHaveBeenCalled();
    await startSocialSignIn('google', { redirect_uri: 'x' });
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });
});

describe('SocialSignInButtons', () => {
  it('renders no button and no "or" divider when no provider is enabled', () => {
    const { container } = render(<SocialSignInButtons providers={[]} loadingProvider={null} onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the enabled providers', () => {
    render(<SocialSignInButtons providers={['google']} loadingProvider={null} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apple/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /microsoft/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /lovable/i })).toBeNull();
    expect(screen.getByTestId('social-divider')).toBeInTheDocument();
  });
});

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}><LoginPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage with social sign-in off', () => {
  it('keeps the e-mail form and renders no social buttons or divider', async () => {
    renderLogin();
    expect(await screen.findByLabelText(/auth\.email|e-?mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth\.password|password/i)).toBeInTheDocument();
    for (const name of [/google/i, /apple/i, /microsoft/i, /lovable/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByTestId('social-divider')).toBeNull();
  });

  it('shows only the switched-on providers when enabled', async () => {
    rows.current = on(['social_signin_enabled', 'social_signin_microsoft']);
    renderLogin();
    expect(await screen.findByRole('button', { name: /microsoft/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /apple/i })).toBeNull();
    expect(screen.getByLabelText(/auth\.email|e-?mail/i)).toBeInTheDocument();
  });
});
