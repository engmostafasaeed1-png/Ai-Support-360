/**
 * Duplicate-safe ticket creation.
 * The id of a new ticket is made in the browser and kept in the tab's sessionStorage until the request is done.
 * A double click shares one running save (singleFlight); a retry, or a retry after a page refresh, sends the same id,
 * and the database answers "already there" instead of storing a second ticket.
 */
export const PENDING_KEY = 'aisupport360.pending-request';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PendingRequest = { fp: string; id: string; at: number };

const memory = new Map<string, string>();
const memoryStorage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

/** The tab's sessionStorage (survives a refresh), or memory when the browser refuses it. */
export function requestStorage(): KeyValueStorage {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('__probe', '1');
      window.sessionStorage.removeItem('__probe');
      return window.sessionStorage;
    }
  } catch {
    /* private mode or blocked storage */
  }
  return memoryStorage;
}

/** A short fingerprint of the request content (no text is stored, only this hash). */
export function requestFingerprint(parts: unknown): string {
  const text = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function readPending(storage: KeyValueStorage, now = Date.now()): PendingRequest | null {
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingRequest;
    if (!p || typeof p.id !== 'string' || typeof p.fp !== 'string' || now - Number(p.at) > PENDING_TTL_MS) {
      storage.removeItem(PENDING_KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/** The id for this request content: the stored one when the same content was tried before, else a new one. */
export function pendingIdFor(storage: KeyValueStorage, fp: string, newId: () => string = () => crypto.randomUUID(), now = Date.now()): string {
  const p = readPending(storage, now);
  if (p && p.fp === fp) return p.id;
  const id = newId();
  try {
    storage.setItem(PENDING_KEY, JSON.stringify({ fp, id, at: now } satisfies PendingRequest));
  } catch {
    /* storage full: the id still works for retries in this page */
  }
  return id;
}

export function clearPending(storage: KeyValueStorage): void {
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to do */
  }
}

type DbError = { code?: string; message?: string; details?: string | null } | null;

/** 23505 on the primary key: an earlier try with this id was saved although its answer was lost. */
export const isAlreadySaved = (error: DbError): boolean =>
  !!error && error.code === '23505' && /tickets_pkey/.test(`${error.message ?? ''} ${error.details ?? ''}`);

/** Inserts the ticket once. On failure the id stays stored so the next try (even after a refresh) reuses it. */
export async function saveTicketOnce(opts: {
  storage: KeyValueStorage;
  fingerprint: string;
  insert: (id: string) => PromiseLike<{ error: DbError }>;
  newId?: () => string;
}): Promise<{ id: string; alreadySaved: boolean }> {
  const id = pendingIdFor(opts.storage, opts.fingerprint, opts.newId);
  const { error } = await opts.insert(id);
  const alreadySaved = isAlreadySaved(error);
  if (error && !alreadySaved) throw error;
  return { id, alreadySaved };
}

/** While a call runs, further calls get the same promise instead of starting a second run. */
export function singleFlight<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let running: Promise<T> | null = null;
  return (...args: A) => {
    if (running) return running;
    running = fn(...args).finally(() => {
      running = null;
    });
    return running;
  };
}
