// E-mail confirmation helpers: new confirmation e-mails, the one-click confirm page and the 6-digit code.
// Answers are deliberately neutral so nobody can find out whether an address has an account.
import { supabase } from '@/integrations/supabase/client';
import { emailRedirectBase } from '@/lib/oauthReturn';

export const RESEND_COOLDOWN_SECONDS = 60;
export const CONFIRM_SENDER = 'noreply@aisupport360.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ResendResult = 'sent' | 'rate_limited' | 'invalid_email';

/** Same answer for unknown, unconfirmed and already-confirmed addresses (no account enumeration). */
export async function requestNewConfirmation(email: string, origin = window.location.origin): Promise<ResendResult> {
  const clean = email.trim().slice(0, 254);
  if (!EMAIL_RE.test(clean)) return 'invalid_email';
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: clean,
    options: { emailRedirectTo: `${emailRedirectBase(origin)}/login` },
  });
  if (!error) return 'sent';
  const code = (error as { code?: string; status?: number }).code;
  const status = (error as { status?: number }).status;
  if (status === 429 || /rate_limit|security purposes/i.test(`${code ?? ''} ${error.message}`)) return 'rate_limited';
  return 'sent';
}

export type ConfirmType = 'signup' | 'invite' | 'magiclink' | 'email_change' | 'email';
const CONFIRM_TYPES: ConfirmType[] = ['signup', 'invite', 'magiclink', 'email_change', 'email'];

/** Reads the confirm-page parameters; anything unexpected is ignored. */
export function readConfirmParams(search: string): { tokenHash: string | null; type: ConfirmType; email: string } {
  const q = new URLSearchParams(search);
  const raw = q.get('token_hash') || '';
  const tokenHash = /^[A-Za-z0-9_-]{6,200}$/.test(raw) ? raw : null;
  const t = q.get('type') as ConfirmType | null;
  const email = (q.get('email') || '').slice(0, 254);
  return { tokenHash, type: t && CONFIRM_TYPES.includes(t) ? t : 'signup', email: EMAIL_RE.test(email) ? email : '' };
}

export type VerifyResult = 'ok' | 'expired' | 'failed';

function classify(error: { message?: string; code?: string; status?: number } | null): VerifyResult {
  if (!error) return 'ok';
  const raw = `${error.code ?? ''} ${error.message ?? ''}`;
  if (/otp_expired|expired|invalid|not found/i.test(raw) || error.status === 403) return 'expired';
  return 'failed';
}

/** Runs only when the person presses the button, so mail scanners that open links cannot use it up. */
export async function confirmWithTokenHash(tokenHash: string, type: ConfirmType): Promise<VerifyResult> {
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'signup' });
  return classify(error as never);
}

export function isCodeShape(code: string): boolean {
  return /^\d{6,8}$/.test(code.trim());
}

/** Fallback: the 6-digit code from the confirmation e-mail. */
export async function confirmWithCode(email: string, code: string): Promise<VerifyResult> {
  const clean = email.trim();
  if (!EMAIL_RE.test(clean) || !isCodeShape(code)) return 'failed';
  const { error } = await supabase.auth.verifyOtp({ email: clean, token: code.trim(), type: 'signup' });
  return classify(error as never);
}
