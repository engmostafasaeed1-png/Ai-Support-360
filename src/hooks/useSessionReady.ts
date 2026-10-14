import { useSyncExternalStore } from 'react';
import { getSessionState, startSessionTracking, subscribeSessionState } from '@/lib/sessionState';

let snapshot = getSessionState();
function read() {
  const next = getSessionState();
  if (next.known !== snapshot.known || next.signedIn !== snapshot.signedIn) snapshot = next;
  return snapshot;
}

/**
 * Whether the sign-in check has finished (`ready`) and a session exists (`signedIn`).
 * Shared by every caller (one getSession and one auth listener), so queries can use `enabled: signedIn`
 * and never run as an anonymous caller while the session is being restored.
 */
export function useSessionReady(): { ready: boolean; signedIn: boolean } {
  startSessionTracking();
  const s = useSyncExternalStore(subscribeSessionState, read, read);
  return { ready: s.known, signedIn: s.known && s.signedIn };
}
