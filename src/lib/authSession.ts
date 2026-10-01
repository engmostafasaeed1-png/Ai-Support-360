import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';

/**
 * supabase.auth.getSession() can throw a transient
 * "Lock ... was released because another request stole it" error when several
 * auth calls race for the Web Locks API mutex (e.g. route change + auth state
 * listener firing together). Retry a few times with a short backoff.
 */
export async function getSessionWithRetry(maxAttempts = 4): Promise<Session | null> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message ?? err ?? '');
      if (!msg.includes('stole it') && !msg.includes('Lock')) throw err;
      await new Promise((r) => setTimeout(r, 75 * (attempt + 1)));
    }
  }
  throw lastError;
}
