// Helpers for the return from the hosted social sign-in service to /login.

export const OAUTH_ROLE_KEY = 'oauth_role';
export const FIRST_OAUTH_WINDOW_MS = 60 * 60 * 1000;

export type FirstRole = 'client' | 'consultant';

/** Reads `error` / `error_description` from the query string or the hash. */
export function readOAuthError(search: string, hash: string): { error: string; description: string } | null {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const error = q.get('error') || h.get('error');
  const description = q.get('error_description') || h.get('error_description');
  if (!error && !description) return null;
  return {
    error: error || 'sign_in_failed',
    description: (description || error || '').replace(/\+/g, ' '),
  };
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

export function readStoredOAuthRole(): FirstRole | null {
  try {
    const v = sessionStorage.getItem(OAUTH_ROLE_KEY);
    return v === 'consultant' || v === 'client' ? v : null;
  } catch {
    return null;
  }
}

export function storeOAuthRole(role: FirstRole | null) {
  try {
    if (role) sessionStorage.setItem(OAUTH_ROLE_KEY, role);
    else sessionStorage.removeItem(OAUTH_ROLE_KEY);
  } catch {
    /* storage blocked */
  }
}
