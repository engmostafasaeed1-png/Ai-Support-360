import { supabase } from '@/integrations/supabase/client';

/**
 * Invokes an edge function with a fresh access token. The browser can hold a
 * stale or malformed token (the backend rejects it with "missing sub claim" /
 * "Invalid or expired session"), so we force a refresh first and retry once
 * on a 401 before giving up.
 */
export async function invokeWithAuth<T = any>(
  fn: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: any }> {
  const invoke = () => supabase.functions.invoke<T>(fn, { body });

  // Force-refresh so a stale stored token is replaced before the call.
  await supabase.auth.refreshSession().catch(() => {});

  let { data, error } = await invoke();
  const msg = String((data as any)?.error ?? error?.message ?? '');
  const isAuthReject =
    msg.includes('Invalid or expired session') || msg.includes('Unauthorized') || (error as any)?.status === 401;

  if (isAuthReject) {
    const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: null as any }));
    if (refreshed?.session) {
      ({ data, error } = await invoke());
    }
  }
  return { data, error };
}
