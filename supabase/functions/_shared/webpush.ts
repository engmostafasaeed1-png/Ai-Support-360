// Web Push for the edge functions: delivery (RFC 8030), payload encryption (RFC 8291, content coding aes128gcm of RFC 8188) and the VAPID
// identification of the application server (RFC 8292), with WebCrypto only and no dependency. Only web APIs are used (fetch, crypto.subtle,
// TextEncoder, btoa): no Deno globals, so everything is unit-tested with vitest, the encryption against the example of RFC 8291 section 5.

const enc = new TextEncoder();

/** URL-safe base64 without padding. */
export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Which push services may be called. A subscription comes from a browser, so the address is user input: only the push services of the browsers
// are accepted (the same rule is in the database function push_subscribe), so that the server can never be made to call another address.
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const PUSH_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, Brave, Opera, Samsung Internet
  /^([a-z0-9-]+\.)?push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)*push\.apple\.com$/, // Safari, iPhone and iPad (web.push.apple.com)
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge with the Windows push service
];

export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length < 20 || endpoint.length > 1200) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443') && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// RFC 8291 payload encryption
// ---------------------------------------------------------------------------------------------------------------------------------------------------
export type SenderKey = { publicRaw: Uint8Array; privateKey: CryptoKey };

export async function generateSenderKey(): Promise<SenderKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), privateKey: pair.privateKey };
}

/**
 * Encrypts a push message for one subscription: the body of the request to the push service (86 octets of header, then the single record).
 * `fixed` is only for the unit test with the example of the RFC; a real call uses a new key pair and a new salt every time.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  uaPublicB64: string,
  authB64: string,
  fixed?: { salt?: Uint8Array; sender?: SenderKey },
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(uaPublicB64);
  const auth = b64urlDecode(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad_p256dh');
  if (auth.length !== 16) throw new Error('bad_auth');
  if (plaintext.length > 3993) throw new Error('payload_too_large');
  const sender = fixed?.sender ?? (await generateSenderKey());
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));
  const prkKey = await hmac(auth, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, sender.publicRaw);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, concat(plaintext, new Uint8Array([2]))));
  // header: salt (16), record size 4096 (4), key id length (1) = 65, key id = the public key of the application server (65)
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([65]), sender.publicRaw, cipher);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// RFC 8292 VAPID
// ---------------------------------------------------------------------------------------------------------------------------------------------------
export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

/** A new P-256 key pair for VAPID: the public key as 65 octets in base64url (what the browser needs), the private key as a JWK (stays on the server). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return {
    publicKey: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

/** The Authorization header for one push service: a signed token for the origin of the endpoint, valid for twelve hours at most. */
export async function vapidAuthorization(endpoint: string, subject: string, keys: VapidKeys, nowSeconds: number, ttlSeconds = 12 * 3600): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + Math.min(ttlSeconds, 23 * 3600), sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto answers the signature as r || s (64 octets), which is the form that JOSE wants
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------------------------------------------------------------
export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };
export type PushOutcome = { ok: boolean; gone: boolean; status: number; error?: string; retryAfter?: number };
export type PushFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array; redirect: 'manual' },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

const defaultFetcher: PushFetcher = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  try { await r.body?.cancel(); } catch { /* the answer body is not needed */ }
  return { status: r.status, headers: r.headers };
};

/**
 * Sends one encrypted push message. gone = the subscription is dead for good (the browser removed it, or the address or the keys are not valid):
 * the caller deactivates it. Redirects are never followed, so that an answer of a push service cannot lead the server to another address.
 */
export async function sendWebPush(
  sub: PushSubscriptionInput,
  payload: string,
  vapid: VapidKeys & { subject: string },
  opts: { ttl: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string },
  fetcher: PushFetcher = defaultFetcher,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<PushOutcome> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return { ok: false, gone: true, status: 0, error: 'endpoint_not_allowed' };
  let body: Uint8Array;
  try {
    body = await encryptPayload(enc.encode(payload), sub.p256dh, sub.auth);
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    return { ok: false, gone: message !== 'payload_too_large', status: 0, error: message === 'payload_too_large' ? 'payload_too_large' : 'bad_keys' };
  }
  const headers: Record<string, string> = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(Math.max(0, Math.floor(opts.ttl))),
    Urgency: opts.urgency ?? 'normal',
    Authorization: await vapidAuthorization(sub.endpoint, vapid.subject, vapid, nowSeconds),
  };
  const topic = (opts.topic ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  if (topic) headers.Topic = topic;
  let res: { status: number; headers: { get(name: string): string | null } };
  try {
    res = await fetcher(sub.endpoint, { method: 'POST', headers, body, redirect: 'manual' });
  } catch {
    return { ok: false, gone: false, status: 0, error: 'network' };
  }
  if (res.status === 200 || res.status === 201 || res.status === 202) return { ok: true, gone: false, status: res.status };
  if (res.status === 404 || res.status === 410) return { ok: false, gone: true, status: res.status, error: 'subscription_gone' };
  if (res.status === 413) return { ok: false, gone: false, status: res.status, error: 'payload_too_large' };
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After'));
    return { ok: false, gone: false, status: res.status, error: 'rate_limited', retryAfter: Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : undefined };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, gone: false, status: res.status, error: 'rejected' };
  return { ok: false, gone: false, status: res.status, error: res.status >= 500 ? 'server' : `http_${res.status}` };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The message of a critical request (read by public/sw.js)
// ---------------------------------------------------------------------------------------------------------------------------------------------------
export type AlertPushInput = { areas: string; minutes: number; percent: number; url: string; ticketId: string; updated: boolean; nowMs?: number };

/** The JSON of the push message: the SAP area, the time limit and the surcharge. The title and the description stay in the portal. `areas` must come from safeAreas. */
export function buildAlertPush(a: AlertPushInput): string {
  const minutes = Math.max(1, Math.round(a.minutes));
  const percent = Number(a.percent);
  const body = `${a.areas}. Send a proposal in the portal within ${minutes} min${percent > 0 ? ` (+${percent}% on your hourly rate if the client accepts it)` : ''}.`;
  return JSON.stringify({
    v: 1,
    title: a.updated ? 'Critical request updated' : 'Critical SAP request',
    body: a.updated ? `The client changed the terms. ${body}` : body,
    url: a.url,
    tag: `critical-${a.ticketId}`,
    urgent: true,
    sent_at: a.nowMs ?? Date.now(),
  });
}

/** The time that the push service keeps an undelivered message: until the reply window ends, at most 30 minutes, at least a minute. */
export function pushTtlSeconds(dueMs: number, nowMs: number): number {
  return Math.max(60, Math.min(1800, Math.floor((dueMs - nowMs) / 1000)));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The keys of the platform and the subscriptions (service role)
// ---------------------------------------------------------------------------------------------------------------------------------------------------
type Db = { from: (table: string) => any };

/** The VAPID key pair of the platform, or null while the administrator has not created it. */
export async function loadVapidKeys(admin: Db): Promise<VapidKeys | null> {
  const { data } = await admin.from('push_vapid_keys').select('public_key, private_jwk').eq('id', true).maybeSingle();
  if (!data || typeof data.public_key !== 'string' || !data.private_jwk || typeof data.private_jwk !== 'object') return null;
  return { publicKey: data.public_key, privateJwk: data.private_jwk as JsonWebKey };
}

/** What a push attempt means for the stored subscription: a dead one is switched off, a failing one keeps its last error, a good one clears it. */
export function subscriptionUpdate(outcome: PushOutcome, nowIso: string): Record<string, unknown> {
  if (outcome.ok) return { last_sent_at: nowIso, last_error: null, last_error_at: null };
  if (outcome.gone) return { active: false, last_error: outcome.error ?? 'gone', last_error_at: nowIso };
  return { last_error: outcome.error ?? 'failed', last_error_at: nowIso };
}

