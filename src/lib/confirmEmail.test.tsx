import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const resend = vi.fn(async (_a?: unknown) => ({ error: null as any }));
const verifyOtp = vi.fn(async (_a?: unknown) => ({ data: {}, error: null as any }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      resend: (a: unknown) => resend(a),
      verifyOtp: (a: unknown) => verifyOtp(a),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    functions: { invoke: async () => ({ data: { expiry_minutes: 1440 }, error: null }) },
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
    rpc: async () => ({ data: true, error: null }),
  },
}));
vi.mock('@/components/VideoBackground', () => ({ default: () => null }));
vi.mock('@/lib/errorReporter', () => ({ reportError: vi.fn() }));

import { isEmailLinkError, readOAuthError, emailRedirectBase, friendlyOAuthMessage } from '@/lib/oauthReturn';
import { requestNewConfirmation, readConfirmParams } from '@/lib/confirmEmail';
import { confirmPageUrl, confirmCode } from '../../supabase/functions/_shared/authConfirmLink';
import ConfirmLinkProblem from '@/components/auth/ConfirmLinkProblem';
import ConfirmEmailPage from '@/pages/auth/ConfirmEmailPage';
import LoginPage from '@/pages/auth/LoginPage';

const EXPIRED_HASH = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

beforeEach(() => {
  resend.mockReset(); resend.mockResolvedValue({ error: null });
  verifyOtp.mockReset(); verifyOtp.mockResolvedValue({ data: {}, error: null });
  localStorage.clear(); sessionStorage.clear();
});

describe('expired or used e-mail links', () => {
  it('recognises the confirmation-link error and never treats a Google error as one', () => {
    expect(isEmailLinkError(readOAuthError('', EXPIRED_HASH))).toBe(true);
    expect(isEmailLinkError(readOAuthError('', '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired'))).toBe(true);
    expect(isEmailLinkError(readOAuthError('?error=server_error&error_description=failed+to+sign+in+with+vendor', ''))).toBe(false);
    expect(isEmailLinkError(readOAuthError('?error=access_denied&error_description=user+cancelled', ''))).toBe(false);
  });

  it('/login shows the expired-link panel with the address prefilled, not a Google error', async () => {
    localStorage.setItem('verification_pending_email', 'new.consultant@example.com');
    render(<MemoryRouter initialEntries={[`/login${EXPIRED_HASH}`]}><LoginPage /></MemoryRouter>);
    expect(await screen.findByText('Your confirmation link has expired or was already used')).toBeInTheDocument();
    expect(screen.queryByText('Sign-in did not complete')).toBeNull();
    expect(screen.queryByText(friendlyOAuthMessage('access_denied'))).toBeNull();
    expect((screen.getByLabelText('E-mail', { selector: '#link-problem-email' }) as HTMLInputElement).value).toBe('new.consultant@example.com');
    expect(screen.getByRole('button', { name: 'I already confirmed - sign in' })).toBeInTheDocument();
  });

  it('a new confirmation e-mail gives the same neutral answer and a 60 s cooldown', async () => {
    render(<MemoryRouter><ConfirmLinkProblem initialEmail="someone@example.com" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Send me a new confirmation e-mail' }));
    expect(await screen.findByText(/If this address is waiting for confirmation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send again in 60 s/ })).toBeDisabled();
    expect(resend).toHaveBeenCalledTimes(1);
    expect((resend.mock.calls[0][0] as any).type).toBe('signup');
  });

  it('does not reveal whether an account exists (unknown / already confirmed look the same as sent)', async () => {
    resend.mockResolvedValueOnce({ error: { message: 'Email address already confirmed', status: 422 } });
    expect(await requestNewConfirmation('a@example.com', 'http://localhost:8080')).toBe('sent');
    resend.mockResolvedValueOnce({ error: { message: 'For security purposes, you can only request this after 60 seconds.', status: 429 } });
    expect(await requestNewConfirmation('a@example.com', 'http://localhost:8080')).toBe('rate_limited');
    expect(await requestNewConfirmation('not-an-email', 'http://localhost:8080')).toBe('invalid_email');
  });

  it('e-mail links on the live site always come back to https://www.aisupport360.com', () => {
    expect(emailRedirectBase('https://aisupport360.com')).toBe('https://www.aisupport360.com');
    expect(emailRedirectBase('https://ai-support-360.lovable.app')).toBe('https://www.aisupport360.com');
    expect(emailRedirectBase('http://localhost:8080')).toBe('http://localhost:8080');
  });
});

describe('confirm page (scanner-safe link)', () => {
  it('the e-mail link points to /auth/confirm on the canonical site with the token and type', () => {
    const verify = 'https://abc.supabase.co/auth/v1/verify?token=pkce_abc123DEF&type=signup&redirect_to=https://www.aisupport360.com/login';
    const url = new URL(confirmPageUrl(verify, 'https://www.aisupport360.com', 'x@example.com'));
    expect(url.origin + url.pathname).toBe('https://www.aisupport360.com/auth/confirm');
    expect(url.searchParams.get('token_hash')).toBe('pkce_abc123DEF');
    expect(url.searchParams.get('type')).toBe('signup');
    expect(url.searchParams.get('email')).toBe('x@example.com');
  });

  it('keeps the original link when it does not look like a confirmation link', () => {
    expect(confirmPageUrl('https://example.com/other', 'https://www.aisupport360.com')).toBe('https://example.com/other');
    expect(confirmPageUrl('not a url', 'https://www.aisupport360.com')).toBe('not a url');
    expect(confirmPageUrl('https://a.co/verify?token=<script>&type=signup', 'https://www.aisupport360.com')).toBe('https://a.co/verify?token=<script>&type=signup');
    expect(confirmCode('123456')).toBe('123456');
    expect(confirmCode('12ab')).toBeNull();
  });

  it('reads only safe parameters', () => {
    expect(readConfirmParams('?token_hash=abc123&type=evil&email=bad')).toEqual({ tokenHash: 'abc123', type: 'signup', email: '' });
  });

  it('does not use the link on page load; only the button confirms', async () => {
    render(<MemoryRouter initialEntries={['/auth/confirm?token_hash=abcdef123&type=signup']}>
      <Routes><Route path="/auth/confirm" element={<ConfirmEmailPage />} /><Route path="/login" element={<p>login page</p>} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Confirm my e-mail' })).toBeInTheDocument();
    expect(verifyOtp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm my e-mail' }));
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abcdef123', type: 'signup' }));
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  it('an expired link on the confirm page offers a new e-mail', async () => {
    verifyOtp.mockResolvedValueOnce({ data: {}, error: { message: 'Email link is invalid or has expired', code: 'otp_expired', status: 403 } });
    render(<MemoryRouter initialEntries={['/auth/confirm?token_hash=abcdef123&type=signup&email=me@example.com']}><ConfirmEmailPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm my e-mail' }));
    expect(await screen.findByText('Your confirmation link has expired or was already used')).toBeInTheDocument();
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('me@example.com');
  });

  it('the 6-digit code confirms the address', async () => {
    render(<MemoryRouter initialEntries={['/auth/confirm?email=me@example.com']}>
      <Routes><Route path="/auth/confirm" element={<ConfirmEmailPage />} /><Route path="/login" element={<p>login page</p>} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('Enter your confirmation code')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Code from the e-mail'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '123456', type: 'signup' }));
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});
