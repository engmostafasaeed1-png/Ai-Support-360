// Who is really there. The availability that a consultant sets (Online, Busy, Offline) stays in the database, also when the browser is closed.
// While the app is open in a consultant's browser the consultant is "present" (a Realtime presence key = the consultant id).
// Clients see Online or Busy only for a consultant who is present; a consultant who is not present is shown as Offline.

import type { AvailabilityState } from './mapMarkers';

export const PRESENCE_CHANNEL = 'consultant-presence';

/** The consultants that are present: the keys of the presence state of the channel (every key is a consultant id) that have at least one open window. */
export function presentIds(state: Record<string, unknown[]> | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const [key, windows] of Object.entries(state ?? {})) {
    if (Array.isArray(windows) && windows.length > 0) ids.add(key);
  }
  return ids;
}

/**
 * Online and Busy are shown only for a consultant who is present. `present` is null while it is not known (no connection yet, or the connection failed):
 * then the status that the consultant set is shown as it is.
 */
export function applyPresence<T extends { id: string; status: AvailabilityState }>(consultant: T, present: ReadonlySet<string> | null): T {
  if (present === null || consultant.status === 'offline' || present.has(consultant.id)) return consultant;
  return { ...consultant, status: 'offline', available: false } as T;
}
