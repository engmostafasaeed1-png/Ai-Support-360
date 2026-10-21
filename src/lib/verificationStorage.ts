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

// ---- Resend cooldown persistence ---------------------------------------
// Stores the absolute timestamp (ms epoch) when resend becomes available again.
const COOLDOWN_KEY = 'verification_resend_available_at';
const COOLDOWN_MAX_AGE_MS = 10 * 60 * 1000; // cooldowns are short; prune anything > 10m old

type CooldownStore = Record<string, number>;

const readCooldown = (): CooldownStore => {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CooldownStore;
    const now = Date.now();
    const cleaned: CooldownStore = {};
    for (const [email, ts] of Object.entries(parsed)) {
      // Keep entries whose availability time is in the future, OR recently elapsed
      // (so a quick refresh doesn't accidentally re-arm the button).
      if (typeof ts === 'number' && ts - now > -COOLDOWN_MAX_AGE_MS) {
        cleaned[email] = ts;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
};

const writeCooldown = (store: CooldownStore) => {
  try {
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
};

/** Persist a cooldown of `seconds` from now for the given email. */
export const setResendCooldown = (email: string, seconds: number) => {
  if (!email || seconds <= 0) return;
  const store = readCooldown();
  store[norm(email)] = Date.now() + seconds * 1000;
  writeCooldown(store);
};

/** Returns the seconds remaining until resend is allowed (0 if ready). */
export const getResendCooldownRemaining = (email: string): number => {
  if (!email) return 0;
  const store = readCooldown();
  const ts = store[norm(email)];
  if (typeof ts !== 'number') return 0;
  const remainingMs = ts - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
};

export const clearResendCooldown = (email: string) => {
  if (!email) return;
  const store = readCooldown();
  delete store[norm(email)];
  writeCooldown(store);
};

// ---- Address waiting for confirmation ----------------------------------
// The sign-up screen remembers the address so a later "link expired" page can prefill it.
export const PENDING_EMAIL_KEY = 'verification_pending_email';

export const getPendingEmail = (): string => {
  try { return (localStorage.getItem(PENDING_EMAIL_KEY) || '').slice(0, 254); } catch { return ''; }
};
