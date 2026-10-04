// Who is present now, kept once for the whole browser tab and read by the pages that show Online or Busy.
// One component (ConsultantPresenceTracker) owns the Realtime channel and writes here; the pages only read.
// The Realtime library gives the same channel object to everybody who asks for the same channel name in one tab, so a page must never open the channel itself.

let current: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

function sameMembers(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export const presenceStore = {
  /** The ids of the consultants who are present, or null while that is not known. */
  get: (): ReadonlySet<string> | null => current,

  /** Saves who is present (null: not known) and tells the readers, unless nothing changed. */
  set(next: ReadonlySet<string> | null): void {
    if (sameMembers(current, next)) return;
    current = next;
    listeners.forEach(listener => listener());
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
