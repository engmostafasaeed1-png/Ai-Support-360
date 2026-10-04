import { useSyncExternalStore } from 'react';
import { presenceStore } from '@/lib/presenceStore';

/**
 * The ids of the consultants who are present now (the app is open in their browser), or null while that is not known:
 * before the first answer of the channel, when the connection fails, when nobody is signed in, and when `enabled` is false.
 * The channel itself is opened once for the whole tab by ConsultantPresenceTracker; this only reads the answer.
 */
export function useConsultantPresence(enabled = true): ReadonlySet<string> | null {
  const present = useSyncExternalStore(presenceStore.subscribe, presenceStore.get, () => null);
  return enabled ? present : null;
}
