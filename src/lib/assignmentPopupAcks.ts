/**
 * Which assignment-request popups the consultant acknowledged ("Later") in the current sign-in.
 * Stored per sign-in session, so every popup comes back at the next sign-in; other sessions' entries are dropped.
 */
const PREFIX = 'assignment-popup:';

type SessionLike = { access_token?: string | null; user?: { id?: string | null; last_sign_in_at?: string | null } | null } | null | undefined;

/** The sign-in session id from the access token (stable across token refreshes); falls back to user + last sign-in time. */
export function sessionIdOf(session: SessionLike): string | null {
  if (!session) return null;
  const token = session.access_token;
  if (token) {
    try {
      const part = token.split('.')[1] ?? '';
      const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
      if (typeof json.session_id === 'string' && json.session_id) return json.session_id;
    } catch { /* fall back */ }
  }
  const user = session.user;
  return user?.id ? `${user.id}:${user.last_sign_in_at ?? ''}` : null;
}

export function readAcks(sessionId: string | null, storage: Storage | undefined = globalThis.localStorage): Set<string> {
  if (!sessionId || !storage) return new Set();
  try {
    const raw = storage.getItem(PREFIX + sessionId);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeAck(sessionId: string | null, key: string, storage: Storage | undefined = globalThis.localStorage): Set<string> {
  const next = readAcks(sessionId, storage);
  next.add(key);
  if (!sessionId || !storage) return next;
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX) && k !== PREFIX + sessionId) storage.removeItem(k);
    }
    storage.setItem(PREFIX + sessionId, JSON.stringify([...next].slice(-200)));
  } catch { /* storage full or blocked: the popup simply shows again */ }
  return next;
}
