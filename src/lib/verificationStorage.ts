// Persists the timestamp of the last verification email sent per email address,
// so the verification timeline survives page refreshes and tab restores.

const KEY = 'verification_email_sent_at';
// Drop entries older than the link's typical lifetime (24h) + buffer.
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

type Store = Record<string, number>;

const read = (): Store => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    // Prune stale entries.
    const now = Date.now();
    const cleaned: Store = {};
    for (const [email, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && now - ts < MAX_AGE_MS) cleaned[email] = ts;
    }
    return cleaned;
  } catch {
    return {};
  }
};

const write = (store: Store) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / privacy mode errors */
  }
};

const norm = (email: string) => email.trim().toLowerCase();

export const setVerificationSentAt = (email: string, when: Date = new Date()) => {
  if (!email) return;
  const store = read();
  store[norm(email)] = when.getTime();
  write(store);
};

export const getVerificationSentAt = (email: string): Date | null => {
  if (!email) return null;
  const store = read();
  const ts = store[norm(email)];
  return typeof ts === 'number' ? new Date(ts) : null;
};

export const clearVerificationSentAt = (email: string) => {
  if (!email) return;
  const store = read();
  delete store[norm(email)];
  write(store);
};
