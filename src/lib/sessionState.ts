import { supabase } from '@/integrations/supabase/client';

/**
 * The sign-in state as last reported by the auth listener, readable synchronously
 * (error reporting needs it at report time). `known` stays false until the first answer.
 */
let known = false;
let signedIn = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  const changed = !known || signedIn !== next;
  known = true;
  signedIn = next;
  if (changed) listeners.forEach((l) => l());
}

let started = false;
export function startSessionTracking(): void {
  if (started) return;
  started = true;
  try {
    supabase.auth.getSession().then(
      ({ data }) => set(!!data.session),
      () => set(false),
    );
    supabase.auth.onAuthStateChange((_event, session) => set(!!session));
  } catch {
    // no auth client (tests): stays unknown
  }
}

export function getSessionState(): { known: boolean; signedIn: boolean } {
  return { known, signedIn };
}

/** True only when the auth listener has reported a session. */
export function hasActiveSession(): boolean {
  return known && signedIn;
}

export function subscribeSessionState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
