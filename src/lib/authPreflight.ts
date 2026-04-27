import { supabase } from '@/integrations/supabase/client';

export type PreflightResult =
  | { ok: true; hasValidSession: boolean; userId?: string }
  | { ok: false; reason: 'config' | 'network' | 'endpoint' | 'session'; message: string };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Validates auth configuration, endpoint reachability, and existing session/JWT
 * before attempting a sign-in. Returns a structured result so callers can
 * short-circuit (already signed in) or surface a precise error.
 */
export async function runSignInPreflight(timeoutMs = 5000): Promise<PreflightResult> {
  // 1. Config sanity
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, reason: 'config', message: 'Auth is not configured (missing URL or key).' };
  }

  // 2. Endpoint reachability — hit the auth health/settings endpoint
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      method: 'GET',
      headers: { apikey: SUPABASE_KEY },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: 'endpoint',
        message: `Auth service unavailable (HTTP ${res.status}). Please try again.`,
      };
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, reason: 'network', message: 'Auth service timed out. Check your connection.' };
    }
    return { ok: false, reason: 'network', message: 'Cannot reach auth service. Check your connection.' };
  } finally {
    clearTimeout(timer);
  }

  // 3. Existing session/JWT validation
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      return { ok: false, reason: 'session', message: error.message };
    }
    if (!session) {
      return { ok: true, hasValidSession: false };
    }

    // If token is expired or about to expire, try a refresh
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAt && expiresAt - Date.now() < 30_000) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !refreshed.session) {
        await supabase.auth.signOut().catch(() => {});
        return { ok: true, hasValidSession: false };
      }
      return { ok: true, hasValidSession: true, userId: refreshed.session.user.id };
    }

    return { ok: true, hasValidSession: true, userId: session.user.id };
  } catch (err: any) {
    return { ok: false, reason: 'session', message: err?.message || 'Session check failed.' };
  }
}
