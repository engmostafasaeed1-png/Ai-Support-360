/**
 * Device guard shared by every notice pop-up and banner: a notice id is shown at most once per device, a dismissed notice
 * never comes back (even before the server confirmed), and the server acknowledgement is retried silently in the background.
 * Stored in localStorage (shared by all tabs through the storage event); falls back to memory when storage is blocked.
 * The database stays the source of truth for read / acknowledged; this only stops re-opening.
 */
import type { NoticeFamily } from '@/lib/noticeModalConfig';

export type GuardScope = NoticeFamily | `${NoticeFamily}-banner`;
type Entry = { s?: number; d?: number; p?: 1 }; // shown at, dismissed at, server acknowledgement pending
type Store = Record<string, Entry>;

export const NOTICE_GUARD_KEY = 'aisupport360.notice-guard.v1';
const LEGACY_RESP_ACKED = 'aisupport360.resp-notices.acked';
const SAME_TAB_EVENT = 'aisupport360:notice-guard';
const MAX_ENTRIES = 400;
let memory: Store = {};

const storage = (): Storage | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

function read(): Store {
  const ls = storage();
  let s: Store = {};
  try {
    const v = JSON.parse(ls?.getItem(NOTICE_GUARD_KEY) ?? '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) s = v as Store;
  } catch { /* corrupt: start again */ }
  // Notices acknowledged with the previous responsiveness guard stay closed.
  try {
    const legacy = JSON.parse(ls?.getItem(LEGACY_RESP_ACKED) ?? '[]');
    if (Array.isArray(legacy)) for (const id of legacy) if (typeof id === 'string') s[`responsiveness:${id}`] ??= { s: 1, d: 1 };
  } catch { /* ignore */ }
  return { ...memory, ...s };
}

function write(s: Store) {
  const keys = Object.keys(s);
  if (keys.length > MAX_ENTRIES) {
    // Keep the newest entries; pending acknowledgements are never dropped.
    const keep = keys.sort((a, b) => Math.max(s[b].d ?? 0, s[b].s ?? 0) - Math.max(s[a].d ?? 0, s[a].s ?? 0));
    const trimmed: Store = {};
    keep.forEach((k, i) => { if (i < MAX_ENTRIES || s[k].p) trimmed[k] = s[k]; });
    s = trimmed;
  }
  memory = s;
  try { storage()?.setItem(NOTICE_GUARD_KEY, JSON.stringify(s)); } catch { /* storage full or blocked: memory only */ }
  try { window.dispatchEvent(new Event(SAME_TAB_EVENT)); } catch { /* no window */ }
}

const k = (scope: GuardScope, id: string) => `${scope}:${id}`;
const update = (scope: GuardScope, ids: string[], fn: (e: Entry) => Entry) => {
  if (!ids.length) return;
  const s = read();
  for (const id of ids) s[k(scope, id)] = fn(s[k(scope, id)] ?? {});
  write(s);
};

export const wasShown = (scope: GuardScope, id: string) => { const e = read()[k(scope, id)]; return !!(e?.s || e?.d); };
export const isDismissed = (scope: GuardScope, id: string) => !!read()[k(scope, id)]?.d;
export const markShown = (scope: GuardScope, ids: string[]) => update(scope, ids, (e) => ({ ...e, s: e.s ?? Date.now() }));
/** Closed by the person: never shown again on this device; `pending` = the server acknowledgement still has to succeed. */
export const markDismissed = (scope: GuardScope, ids: string[], pending = true) =>
  update(scope, ids, (e) => ({ ...e, s: e.s ?? Date.now(), d: e.d ?? Date.now(), ...(pending ? { p: 1 as const } : {}) }));
export const markServerAcked = (scope: GuardScope, ids: string[]) => update(scope, ids, (e) => { const { p: _p, ...rest } = e; return rest; });
export function pendingAcks(scope: GuardScope): string[] {
  const prefix = `${scope}:`;
  return Object.entries(read()).filter(([key, e]) => key.startsWith(prefix) && e.p).map(([key]) => key.slice(prefix.length));
}

/** Re-read on changes from this tab and from other tabs. */
export function subscribeGuard(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key === NOTICE_GUARD_KEY || e.key === LEGACY_RESP_ACKED) cb(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SAME_TAB_EVENT, cb);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(SAME_TAB_EVENT, cb); };
}

// ---------------------------------------------------------------- background acknowledgement (silent retries)
export const ACK_RETRY_MS = [2_000, 10_000, 30_000] as const;
const inflight = new Set<string>();
const logDev = (e: unknown) => { if (import.meta.env?.DEV) console.error('[notice] acknowledgement failed, will retry', e); };

/**
 * Sends the acknowledgement without blocking the person. On failure it retries after 2 s, 10 s and 30 s; after that the ids
 * stay "pending" and are retried on the next page load, window focus or when the connection comes back (flushPendingAcks).
 */
export function acknowledgeInBackground(scope: GuardScope, ids: string[], ack: (ids: string[]) => Promise<void>, attempt = 0): void {
  const todo = ids.filter((id) => !inflight.has(k(scope, id)));
  if (!todo.length) return;
  todo.forEach((id) => inflight.add(k(scope, id)));
  let p: Promise<void>;
  try { p = Promise.resolve(ack(todo)); } catch (e) { p = Promise.reject(e); }
  p.then(
    () => { markServerAcked(scope, todo); },
    (e) => {
      logDev(e);
      const wait = ACK_RETRY_MS[attempt];
      if (wait !== undefined) setTimeout(() => acknowledgeInBackground(scope, todo, ack, attempt + 1), wait);
    },
  ).finally(() => todo.forEach((id) => inflight.delete(k(scope, id))));
}

export function flushPendingAcks(scope: GuardScope, ack: (ids: string[]) => Promise<void>): void {
  const ids = pendingAcks(scope);
  if (ids.length) acknowledgeInBackground(scope, ids, ack);
}

/** Tests only. */
export function __resetNoticeGuard() { memory = {}; inflight.clear(); }
