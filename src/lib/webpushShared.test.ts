import { beforeAll, describe, it, expect } from 'vitest';
import {
  b64urlDecode, b64urlEncode, buildAlertPush, encryptPayload, generateSenderKey, generateVapidKeys, isAllowedPushEndpoint, loadVapidKeys, pushTtlSeconds, sendWebPush, subscriptionUpdate,
  vapidAuthorization, type PushFetcher, type SenderKey, type VapidKeys,
} from '../../supabase/functions/_shared/webpush';

beforeAll(async () => {
  // Node 20+ already has crypto.subtle; this only covers a runtime whose global crypto has none (for example jsdom's)
  if (!globalThis.crypto?.subtle) {
    const nodeCrypto = 'node:crypto';
    const { webcrypto } = await import(/* @vite-ignore */ nodeCrypto);
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

// The example of RFC 8291 section 5 and appendix A
const UA_PUBLIC = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';
const AS_PUBLIC = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
const SALT = 'DGv6ra1nlYgDCS1FRnbzlw';
const EXPECTED_BODY =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

async function rfcSender(): Promise<SenderKey> {
  const pub = b64urlDecode(AS_PUBLIC);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: AS_PRIVATE };
  return { publicRaw: pub, privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) };
}

const text = (s: string) => new TextEncoder().encode(s);

describe('base64url', () => {
  it('round-trips bytes and uses the URL-safe alphabet without padding', () => {
    const bytes = new Uint8Array([251, 255, 254, 0, 1, 2, 3]);
    const s = b64urlEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(b64urlDecode(s))).toEqual(Array.from(bytes));
    expect(b64urlEncode(new Uint8Array([]))).toBe('');
  });
});

describe('encryptPayload (RFC 8291)', () => {
  it('produces exactly the message of the example in the RFC', async () => {
    const body = await encryptPayload(text('When I grow up, I want to be a watermelon'), UA_PUBLIC, AUTH, { salt: b64urlDecode(SALT), sender: await rfcSender() });
    expect(b64urlEncode(body)).toBe(EXPECTED_BODY);
    expect(body.length).toBe(144);
  });

  it('writes the header with the salt, the record size 4096 and the key of the application server', async () => {
    const body = await encryptPayload(text('hello'), UA_PUBLIC, AUTH);
    expect(body.length).toBe(86 + 5 + 1 + 16);
    expect(Array.from(body.slice(16, 20))).toEqual([0, 0, 0x10, 0]);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(4);
  });

  it('uses a new salt and a new key every time', async () => {
    const a = await encryptPayload(text('same'), UA_PUBLIC, AUTH);
    const b = await encryptPayload(text('same'), UA_PUBLIC, AUTH);
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
    expect(b64urlEncode(a.slice(0, 16))).not.toBe(b64urlEncode(b.slice(0, 16)));
  });

  it('refuses wrong keys and a message that is too long', async () => {
    await expect(encryptPayload(text('x'), 'AAAA', AUTH)).rejects.toThrow('bad_p256dh');
    await expect(encryptPayload(text('x'), UA_PUBLIC, 'AAAA')).rejects.toThrow('bad_auth');
    await expect(encryptPayload(new Uint8Array(3994), UA_PUBLIC, AUTH)).rejects.toThrow('payload_too_large');
    expect((await encryptPayload(new Uint8Array(3993), UA_PUBLIC, AUTH)).length).toBe(4096);
  });

  it('makes sender keys that are 65 octets of an uncompressed point', async () => {
    const k = await generateSenderKey();
    expect(k.publicRaw.length).toBe(65);
    expect(k.publicRaw[0]).toBe(4);
  });
});

describe('isAllowedPushEndpoint', () => {
  it('accepts the push services of the browsers', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123def456ghi789')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGWx8bQxyz0123456789')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=BQYAAAAbc')).toBe(true);
  });

  it('refuses everything else', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.example/fcm/send/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pw@fcm.googleapis.com/fcm/send/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/fcm/send/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://localhost/fcm/send/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/fcm/send/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://evilpush.apple.com.example/x/abc123def456ghi789')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/' + 'a'.repeat(1200))).toBe(false);
    expect(isAllowedPushEndpoint('')).toBe(false);
    expect(isAllowedPushEndpoint(null)).toBe(false);
    expect(isAllowedPushEndpoint(42)).toBe(false);
  });
});

describe('VAPID', () => {
  it('generates a public key of 65 octets and a private JWK', async () => {
    const keys = await generateVapidKeys();
    const pub = b64urlDecode(keys.publicKey);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(4);
    expect(keys.privateJwk.kty).toBe('EC');
    expect(typeof keys.privateJwk.d).toBe('string');
  });

  it('signs a token for the origin of the endpoint that verifies with the public key', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', 'https://www.aisupport360.com', keys, 1_800_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m as RegExpExecArray;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://www.aisupport360.com' });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signature = b64urlDecode(s);
    expect(signature.length).toBe(64);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, signature, text(`${h}.${c}`))).toBe(true);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, signature, text(`${h}.${c}x`))).toBe(false);
  });

  it('never asks for more than a day of validity', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', 'mailto:a@b.example', keys, 1000, 10 * 24 * 3600);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(/t=[\w-]+\.([\w-]+)\./.exec(header)![1])));
    expect(claims.exp - 1000).toBeLessThanOrEqual(24 * 3600);
  });
});

describe('sendWebPush', () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123def456ghi789', p256dh: UA_PUBLIC, auth: AUTH };
  let vapid: VapidKeys & { subject: string };
  beforeAll(async () => {
    vapid = { ...(await generateVapidKeys()), subject: 'https://www.aisupport360.com' };
  });
  const answer = (status: number, headers: Record<string, string> = {}): PushFetcher => async () => ({ status, headers: { get: (n: string) => headers[n] ?? null } });

  it('posts the encrypted message with the headers of RFC 8030 and answers ok', async () => {
    const calls: { url: string; headers: Record<string, string>; body: Uint8Array; redirect: string }[] = [];
    const fetcher: PushFetcher = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body, redirect: init.redirect });
      return { status: 201, headers: { get: () => null } };
    };
    const res = await sendWebPush(sub, '{"a":1}', vapid, { ttl: 900, urgency: 'high', topic: 'critical 123/abc-DEF_ghi0123456789012345678901234' }, fetcher, 1_800_000_000);
    expect(res).toEqual({ ok: true, gone: false, status: 201 });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(sub.endpoint);
    expect(calls[0].redirect).toBe('manual');
    expect(calls[0].headers['Content-Encoding']).toBe('aes128gcm');
    expect(calls[0].headers.TTL).toBe('900');
    expect(calls[0].headers.Urgency).toBe('high');
    expect(calls[0].headers.Topic).toBe('critical123abc-DEF_ghi0123456789');
    expect(calls[0].headers.Topic.length).toBeLessThanOrEqual(32);
    expect(calls[0].headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(calls[0].body.length).toBe(86 + 7 + 1 + 16);
  });

  it('maps the answers of the push service', async () => {
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(410))).toMatchObject({ ok: false, gone: true, status: 410 });
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(404))).toMatchObject({ ok: false, gone: true, status: 404 });
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(413))).toMatchObject({ ok: false, gone: false, error: 'payload_too_large' });
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(429, { 'Retry-After': '30' }))).toMatchObject({ ok: false, gone: false, error: 'rate_limited', retryAfter: 30 });
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(401))).toMatchObject({ ok: false, gone: false, error: 'rejected' });
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(403))).toMatchObject({ ok: false, gone: false, error: 'rejected' });
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(503))).toMatchObject({ ok: false, gone: false, error: 'server' });
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, answer(202))).toMatchObject({ ok: true });
  });

  it('reports a network failure without throwing', async () => {
    const down: PushFetcher = async () => {
      throw new Error('connection reset');
    };
    expect(await sendWebPush(sub, 'x', vapid, { ttl: 60 }, down)).toEqual({ ok: false, gone: false, status: 0, error: 'network' });
  });

  it('never calls an address that is not a push service, and drops a subscription with bad keys', async () => {
    let called = 0;
    const counting: PushFetcher = async () => {
      called++;
      return { status: 201, headers: { get: () => null } };
    };
    expect(await sendWebPush({ ...sub, endpoint: 'https://evil.example/fcm/send/abc123def456ghi789' }, 'x', vapid, { ttl: 60 }, counting)).toEqual({ ok: false, gone: true, status: 0, error: 'endpoint_not_allowed' });
    expect(await sendWebPush({ ...sub, p256dh: 'AAAA' }, 'x', vapid, { ttl: 60 }, counting)).toEqual({ ok: false, gone: true, status: 0, error: 'bad_keys' });
    expect(called).toBe(0);
  });
});

describe('buildAlertPush and pushTtlSeconds', () => {
  const base = { areas: 'SAP FI/CO', minutes: 30, percent: 30, url: 'https://www.aisupport360.com/consultant/open-tickets?critical=t1', ticketId: 'abc-123', updated: false, nowMs: 1_700_000_000_000 };

  it('says the area, the time limit and the surcharge, with the address and a tag per request', () => {
    const p = JSON.parse(buildAlertPush(base));
    expect(p).toEqual({
      v: 1, title: 'Critical SAP request', body: 'SAP FI/CO. Send a proposal in the portal within 30 min (+30% on your hourly rate if the client accepts it).',
      url: base.url, tag: 'critical-abc-123', urgent: true, sent_at: 1_700_000_000_000,
    });
  });

  it('marks an update and leaves the surcharge out when there is none', () => {
    const p = JSON.parse(buildAlertPush({ ...base, updated: true, percent: 0, minutes: 44.6 }));
    expect(p.title).toBe('Critical request updated');
    expect(p.body).toBe('The client changed the terms. SAP FI/CO. Send a proposal in the portal within 45 min.');
  });

  it('keeps the message far below the limit of a push message', () => {
    expect(new TextEncoder().encode(buildAlertPush({ ...base, areas: 'x'.repeat(160) })).length).toBeLessThan(600);
  });

  it('keeps an undelivered message until the window ends, at most 30 minutes and at least a minute', () => {
    const now = 1_000_000;
    expect(pushTtlSeconds(now + 10 * 60_000, now)).toBe(600);
    expect(pushTtlSeconds(now + 5 * 3600_000, now)).toBe(1800);
    expect(pushTtlSeconds(now + 5_000, now)).toBe(60);
    expect(pushTtlSeconds(now - 5_000, now)).toBe(60);
  });
});

describe('loadVapidKeys and subscriptionUpdate', () => {
  const fakeDb = (row: unknown) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
  });

  it('reads the key pair, and answers null while there is none or the row is odd', async () => {
    const keys = await loadVapidKeys(fakeDb({ public_key: 'PUB', private_jwk: { kty: 'EC' } }));
    expect(keys).toEqual({ publicKey: 'PUB', privateJwk: { kty: 'EC' } });
    expect(await loadVapidKeys(fakeDb(null))).toBeNull();
    expect(await loadVapidKeys(fakeDb({ public_key: 5, private_jwk: {} }))).toBeNull();
    expect(await loadVapidKeys(fakeDb({ public_key: 'PUB', private_jwk: null }))).toBeNull();
  });

  it('switches a dead subscription off, keeps the error of a failing one and clears a good one', () => {
    const now = '2026-10-12T10:00:00.000Z';
    expect(subscriptionUpdate({ ok: true, gone: false, status: 201 }, now)).toEqual({ last_sent_at: now, last_error: null, last_error_at: null });
    expect(subscriptionUpdate({ ok: false, gone: true, status: 410, error: 'subscription_gone' }, now)).toEqual({ active: false, last_error: 'subscription_gone', last_error_at: now });
    expect(subscriptionUpdate({ ok: false, gone: false, status: 503, error: 'server' }, now)).toEqual({ last_error: 'server', last_error_at: now });
  });
});

