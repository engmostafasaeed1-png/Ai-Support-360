// Helpers for starting social sign-in and handling the return from the hosted sign-in service to /login.

export const OAUTH_ROLE_KEY = 'oauth_role';
export const OAUTH_ROLE_TTL_MS = 10 * 60 * 1000;
export const FIRST_OAUTH_WINDOW_MS = 60 * 60 * 1000;
export const CANONICAL_ORIGIN = 'https://www.aisupport360.com';
/** Clean public return path; /login finishes the sign-in and routes by role. */
export const OAUTH_RETURN_PATH = '/login';

export type FirstRole = 'client' | 'consultant';

/** Hosts that must hand over to the canonical www address before sign-in starts (the sign-in state is kept per address). */
const NON_CANONICAL_HOSTS = /^(aisupport360\.com|(www\.)?aisapsupportnow\.com|ai-support-360\.lovable\.app)$/i;

/**
 * Returns the canonical address to move to before starting social sign-in, or null when already fine.
 * Only the path is kept (query/hash dropped). Editor previews and local development are left alone:
 * there the sign-in library uses a popup on the same page, so no address change happens.
 */
export function canonicalOAuthUrl(href: string): string | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (!NON_CANONICAL_HOSTS.test(url.hostname)) return null;
  return CANONICAL_ORIGIN + url.pathname;
}

export function oauthRedirectUri(origin: string): string {
  return origin + OAUTH_RETURN_PATH;
}

/** Reads `error` / `error_code` / `error_description` from the query string or the hash. */
export function readOAuthError(search: string, hash: string): { error: string; description: string; code?: string } | null {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const error = q.get('error') || h.get('error');
  const description = q.get('error_description') || h.get('error_description');
  const code = q.get('error_code') || h.get('error_code') || undefined;
  if (!error && !description) return null;
  return {
    error: error || 'sign_in_failed',
    description: (description || error || '').replace(/\+/g, ' '),
    ...(code ? { code } : {}),
  };
}

/**
 * True when the error came back from an e-mail link (confirmation, invitation, magic link) that expired
 * or was already used — for example by a mail scanner or a second click. This is never a Google error.
 */
export function isEmailLinkError(e: { error: string; description: string; code?: string } | null): boolean {
  if (!e) return false;
  if (e.code === 'otp_expired') return true;
  return /email link is invalid or has expired|otp_expired|token has expired or is invalid/i.test(`${e.error} ${e.description}`);
}

/**
 * Base address put into e-mail links. On the live site (any of its addresses) this is always the
 * canonical www address, so the confirmation lands where the sign-in state is kept; previews keep their own.
 */
export function emailRedirectBase(origin: string): string {
  try {
    const host = new URL(origin).hostname;
    if (host === 'www.aisupport360.com' || NON_CANONICAL_HOSTS.test(host)) return CANONICAL_ORIGIN;
  } catch { /* fall through */ }
  return origin;
}

export const STATE_FAILED_MESSAGE =
  'Your sign-in could not be confirmed. Please start again from this page, in a normal browser window (not private mode or an in-app browser), and allow cookies for this site.';

/** Friendly text for a sign-in service error; never repeats raw technical text for the state failure. */
export function friendlyOAuthMessage(err: { error: string; description: string } | string): string {
  const raw = typeof err === 'string' ? err : `${err.error} ${err.description}`;
  if (/state|verification/i.test(raw)) return STATE_FAILED_MESSAGE;
  if (/access_denied|cancel/i.test(raw)) return 'Sign-in was cancelled. You can try again.';
  return 'Sign-in did not complete. Please try again from this page.';
}

interface MinimalUser {
  created_at?: string;
  app_metadata?: Record<string, any>;
  user_metadata?: Record<string, any>;
}

/** A social sign-in account created within the last hour that never chose a role at sign-up. */
export function isFirstTimeOAuthUser(user: MinimalUser, now = Date.now()): boolean {
  const provider = user.app_metadata?.provider;
  if (!provider || provider === 'email') return false;
  if (user.user_metadata?.role) return false;
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (Number.isNaN(created)) return false;
  return now - created < FIRST_OAUTH_WINDOW_MS;
}

/** Where a brand-new account lands after choosing its role. */
export function newUserDestination(role: FirstRole): string {
  return role === 'consultant' ? '/consultant/profile?section=setup' : '/client/companies';
}

/** Chosen account type, kept 10 minutes across the sign-in redirect. */
export function readStoredOAuthRole(now = Date.now()): FirstRole | null {
  try {
    const raw = localStorage.getItem(OAUTH_ROLE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { role?: string; exp?: number };
    if (!v || typeof v.exp !== 'number' || v.exp < now) {
      localStorage.removeItem(OAUTH_ROLE_KEY);
      return null;
    }
    return v.role === 'consultant' || v.role === 'client' ? v.role : null;
  } catch {
    return null;
  }
}

export function storeOAuthRole(role: FirstRole | null, now = Date.now()) {
  try {
    if (role) localStorage.setItem(OAUTH_ROLE_KEY, JSON.stringify({ role, exp: now + OAUTH_ROLE_TTL_MS }));
    else localStorage.removeItem(OAUTH_ROLE_KEY);
  } catch {
    /* storage blocked */
  }
}

/** Display name and photo offered by the social provider (used only to fill empty profile fields). */
export function providerProfile(user: MinimalUser & { email?: string | null }): { name: string | null; avatar: string | null } {
  const m = user.user_metadata || {};
  const name = String(m.full_name || m.name || '').trim().slice(0, 120) || null;
  const avatarRaw = String(m.avatar_url || m.picture || '');
  const avatar = /^https:\/\//i.test(avatarRaw) ? avatarRaw : null;
  return { name, avatar };
}
