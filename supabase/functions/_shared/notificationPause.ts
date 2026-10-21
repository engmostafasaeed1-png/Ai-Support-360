// Feature Q: pause / snooze notifications. Pure helpers shared by edge functions (Deno) and the web app (tests, display).
// The official decision always comes from the database (public.notifications_paused, docs/sql/notification-pauses.sql);
// these mirrors keep e-mail footers, the bell, the request popup and tests in agreement with it.

export type PauseDuration = '3d' | '1w' | '1m';
export type PauseCategory = 'essential' | 'reminders' | 'digests' | 'activity';
export type PauseChannel = 'email' | 'in_app' | 'push' | 'telegram';
/** Unsubscribe is handled by the managed footer the e-mail platform adds to every app e-mail, never by our own links. */
export type LinkAction = PauseDuration;

export const PAUSE_DAYS: Record<PauseDuration, number> = { '3d': 3, '1w': 7, '1m': 30 };
export const PAUSE_DURATIONS: PauseDuration[] = ['3d', '1w', '1m'];
export const PAUSABLE: PauseCategory[] = ['reminders', 'digests', 'activity'];
export const DEFAULT_MAX_DAYS = 30;
/** Signed e-mail links stay usable for 30 days after the e-mail was sent. */
export const LINK_TTL_SECONDS = 30 * 86_400;

export interface PauseState {
  paused_until: string;
  email: boolean;
  in_app: boolean;
  categories: string[];
  hold_in_app: boolean;
}

// ------------------------------------------------------------------ categories

const ESSENTIAL_TYPES = new Set([
  'critical_request', 'payment', 'invoice', 'payout', 'nda', 'rate', 'engagement', 'security_alert', 'security', 'approval',
  'system', 'admin_message', 'policy', 'policy_reminder', 'admin_reminder_policy', 'consultant_policy', 'account',
  'responsiveness', 'notifications_resumed',
]);
const REMINDER_TITLE = /^(reminder|تذكير)/i;
const CLOSED_TITLE = /^(no reply|request closed|لا يوجد رد|انتهى وقت)/i;

/**
 * Mirror of public.notification_category(type, title). Security, money, legal, policy, account and Critical notices and
 * the first notice of each assignment request are essential; reminders, digests and activity updates can be paused.
 */
export function notificationCategory(type: string | null | undefined, title?: string | null): PauseCategory {
  const t = (type ?? '').trim();
  const head = (title ?? '').trim();
  if (ESSENTIAL_TYPES.has(t)) return 'essential';
  if (t.startsWith('admin_reminder_') || t === 'profile_reminder' || t === 'reminder') return 'reminders';
  if (REMINDER_TITLE.test(head)) return 'reminders';
  if (t === 'digest' || t === 'admin' || t === 'admin_marketing') return 'digests';
  if (t === 'match_request') return CLOSED_TITLE.test(head) ? 'activity' : 'essential';
  if (!t && (head === 'Complete your profile' || head === 'أكمل ملفك الشخصي')) return 'reminders';
  return 'activity';
}

/** Assignment e-mails: the first request (and anything Critical) is always sent; 2 h / 4 h / 1 day reminders are held. */
export function assignmentEmailCategory(step: string, recipient: 'consultant' | 'client', critical: boolean): PauseCategory {
  if (critical) return 'essential';
  if (step === 'request') return 'essential';
  if (step === 'r1' || step === 'r2' || step === 'r3') return 'reminders';
  // Expiry notices ('No reply from the consultant', 'Request closed') are activity updates for both sides.
  void recipient;
  return 'activity';
}

// ------------------------------------------------------------------ pause state

export function isPauseActive(state: PauseState | null | undefined, now: number): boolean {
  if (!state) return false;
  const until = Date.parse(state.paused_until);
  return Number.isFinite(until) && until > now;
}

/** Mirror of public.notifications_paused(user, category, channel). Push and Telegram follow the in-app choice. */
export function isPausedFor(
  state: PauseState | null | undefined, category: PauseCategory, channel: PauseChannel, now: number, enabled = true,
): boolean {
  if (!enabled || category === 'essential' || !isPauseActive(state, now)) return false;
  const s = state as PauseState;
  if (!s.categories.includes(category)) return false;
  return channel === 'email' ? s.email : s.in_app;
}

export function allowedDurations(maxDays: number | null | undefined): PauseDuration[] {
  const max = clampMaxDays(maxDays);
  return PAUSE_DURATIONS.filter((d) => PAUSE_DAYS[d] <= max);
}

export function clampMaxDays(maxDays: number | null | undefined): number {
  const n = Math.round(Number(maxDays));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_DAYS;
  return Math.min(90, Math.max(1, n));
}

/** End of a pause started now; capped at the admin maximum (same rule as the database). */
export function pauseEndsAt(duration: PauseDuration, now: number, maxDays?: number | null): Date {
  const days = Math.min(PAUSE_DAYS[duration], clampMaxDays(maxDays));
  return new Date(now + days * 86_400_000);
}

/** While in-app alerts are paused, a pending request pops up for its first notice only; reminder re-pops wait. Critical always shows. */
export function popupHeldByPause(
  r: { reminders_sent?: number | null; critical?: boolean | null },
  state: PauseState | null | undefined,
  now: number,
): boolean {
  if (r.critical) return false;
  if ((r.reminders_sent ?? 0) <= 0) return false;
  return isPausedFor(state, 'reminders', 'in_app', now);
}

// ------------------------------------------------------------------ signed links

export interface PauseTokenPayload { u: string; d: LinkAction; x: number; n: string }
export type VerifyResult =
  | { ok: true; payload: PauseTokenPayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'invalid' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[0-9a-f]{16}$/;
const ACTIONS: LinkAction[] = ['3d', '1w', '1m'];

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64');
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
export function newNonce(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** v1.<payload>.<HMAC-SHA256(secret, "v1.<payload>")>; carries the user id, the action, the expiry and a one-time nonce only. */
export async function signPauseToken(secret: string, payload: PauseTokenPayload): Promise<string> {
  if (!secret || secret.length < 32) throw new Error('pause secret missing');
  const body = b64url(new TextEncoder().encode(JSON.stringify({ u: payload.u, d: payload.d, x: payload.x, n: payload.n })));
  const sig = await hmac(secret, `v1.${body}`);
  return `v1.${body}.${b64url(sig)}`;
}

export async function verifyPauseToken(secret: string, token: unknown, nowSeconds: number): Promise<VerifyResult> {
  if (!secret || secret.length < 32) return { ok: false, reason: 'invalid' };
  if (typeof token !== 'string' || token.length > 600) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };
  let given: Uint8Array;
  try { given = fromB64url(parts[2]); } catch { return { ok: false, reason: 'malformed' }; }
  const expected = await hmac(secret, `v1.${parts[1]}`);
  if (!sameBytes(given, expected)) return { ok: false, reason: 'signature' };
  let p: Record<string, unknown>;
  try { p = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); } catch { return { ok: false, reason: 'malformed' }; }
  if (!p || typeof p !== 'object' || typeof p.u !== 'string' || !UUID.test(p.u) || !ACTIONS.includes(p.d as LinkAction)
    || typeof p.x !== 'number' || !Number.isInteger(p.x) || typeof p.n !== 'string' || !NONCE.test(p.n)) {
    return { ok: false, reason: 'invalid' };
  }
  if (p.x <= nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, payload: { u: p.u.toLowerCase(), d: p.d as LinkAction, x: p.x, n: p.n } };
}

export interface PauseLinks { d3: string; w1: string; m1: string }

/** The three footer links of one e-mail; each has its own nonce so every click is idempotent on its own. */
export async function buildPauseLinks(secret: string, userId: string, siteUrl: string, nowSeconds: number, lang: 'en' | 'ar' = 'en'): Promise<PauseLinks> {
  const x = nowSeconds + LINK_TTL_SECONDS;
  const link = async (d: LinkAction) => {
    const t = await signPauseToken(secret, { u: userId, d, x, n: newNonce() });
    return `${siteUrl}/notifications/pause?t=${encodeURIComponent(t)}${lang === 'ar' ? '&lang=ar' : ''}`;
  };
  const [d3, w1, m1] = await Promise.all([link('3d'), link('1w'), link('1m')]);
  return { d3, w1, m1 };
}
