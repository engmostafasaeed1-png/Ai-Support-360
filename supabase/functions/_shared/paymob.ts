// Paymob helpers shared by the card-payment edge functions and by the unit test (src/lib/paymobHmac.test.ts).
// Pure functions only: no Deno globals, no network, no database. The same file therefore runs in Deno and in Node.
//
// Paymob signs a transaction with HMAC-SHA512 over 20 values in a fixed order. The same values arrive in two shapes:
//   * the JSON webhook ("transaction processed callback"): obj.order.id, obj.source_data.pan, ...
//   * the query string of the browser redirect after the payment: order, source_data.pan, ...
// Both are verified with the same secret. Nothing else in a callback is trusted: an invoice is found through the order
// id that this platform stored when it created the payment, and the amount and currency are compared with the invoice.

export const PAYMOB_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

/** Reads one field of a transaction, whatever shape it arrived in. */
export type Reader = (field: string) => unknown;

/** Value at a dotted path, for example "order.id" inside the webhook object. */
export function readPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Reader for the JSON webhook object (obj). */
export function webhookReader(obj: unknown): Reader {
  return (field) => readPath(obj, field);
}

/** Reader for the redirect query string: the same names, except that order.id arrives as "order" (the documentation also says "order_id"). */
export function redirectReader(params: Record<string, string | undefined>): Reader {
  return (field) => {
    if (field === 'order.id') return params.order ?? params.order_id ?? params['order.id'];
    return params[field];
  };
}

/** The text that Paymob signed, plus the names of any signed fields that are missing (then it cannot be verified). */
export function hmacSource(read: Reader): { source: string; missing: string[] } {
  const missing: string[] = [];
  let source = '';
  for (const field of PAYMOB_HMAC_FIELDS) {
    const value = read(field);
    if (value === undefined || value === null) {
      missing.push(field);
      continue;
    }
    source += String(value);
  }
  return { source, missing };
}

/** HMAC-SHA512 as lowercase hex. */
export async function paymobHmac(secret: string, source: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(source)));
  return Array.from(signature)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Comparison that takes the same time wherever the texts differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ea = encoder.encode(a);
  const eb = encoder.encode(b);
  let diff = ea.length ^ eb.length;
  const length = Math.max(ea.length, eb.length);
  for (let i = 0; i < length; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** True only when every signed field is present and the received signature matches. */
export async function verifyPaymobHmac(
  secret: string,
  read: Reader,
  received: string | null | undefined,
): Promise<{ ok: boolean; missing: string[] }> {
  const { source, missing } = hmacSource(read);
  const given = String(received ?? '').trim().toLowerCase();
  if (missing.length > 0 || given === '') return { ok: false, missing };
  const expected = await paymobHmac(secret, source);
  return { ok: constantTimeEqual(expected, given), missing };
}

export type PaymobKind = 'paid' | 'failed' | 'refunded' | 'voided';

export interface Transaction {
  /** 'ignore' means: nothing to record (see reason) */
  kind: PaymobKind | 'ignore';
  /** for 'ignore': pending | child | unusable */
  reason: string;
  orderId: string;
  transactionId: string;
  /** in currency units, for example 57 for 5700 cents */
  amount: number;
  /** capital letters, for example USD */
  currency: string;
}

const flag = (value: unknown): boolean => value === true || value === 'true';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** What happened to the money, from a verified transaction. */
export function describeTransaction(read: Reader): Transaction {
  const orderId = String(read('order.id') ?? '');
  const transactionId = String(read('id') ?? '');
  const cents = Number(read('amount_cents'));
  const currency = String(read('currency') ?? '').toUpperCase();
  const base = { orderId, transactionId, amount: Number.isFinite(cents) ? cents / 100 : NaN, currency };
  if (!ID_RE.test(orderId) || !ID_RE.test(transactionId) || !Number.isInteger(cents) || cents < 0 || !/^[A-Z]{3}$/.test(currency)) {
    return { ...base, kind: 'ignore', reason: 'unusable' };
  }
  if (flag(read('is_voided')) || flag(read('is_void'))) return { ...base, kind: 'voided', reason: '' };
  if (flag(read('is_refunded')) || flag(read('is_refund'))) return { ...base, kind: 'refunded', reason: '' };
  if (flag(read('has_parent_transaction'))) return { ...base, kind: 'ignore', reason: 'child' };
  if (flag(read('pending'))) return { ...base, kind: 'ignore', reason: 'pending' };
  const captured = !flag(read('is_auth')) || flag(read('is_capture'));
  if (flag(read('success')) && !flag(read('error_occured')) && captured) return { ...base, kind: 'paid', reason: '' };
  return { ...base, kind: 'failed', reason: '' };
}

// What is kept in the event log: identifiers and flags only. No card data (not even the masked number), no billing data.
const PAYLOAD_FIELDS = [
  'id',
  'order.id',
  'order.merchant_order_id',
  'amount_cents',
  'currency',
  'success',
  'pending',
  'is_voided',
  'is_refunded',
  'is_refund',
  'is_void',
  'error_occured',
  'is_auth',
  'is_capture',
  'has_parent_transaction',
  'is_3d_secure',
  'integration_id',
  'created_at',
  'source_data.type',
  'source_data.sub_type',
  'txn_response_code',
  'data.message',
] as const;

export function eventPayload(read: Reader): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const field of PAYLOAD_FIELDS) {
    const value = read(field);
    if (typeof value === 'string') out[field] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean') out[field] = value;
  }
  return out;
}

/** Invoice amount (two decimals at most) to the whole number of cents that Paymob wants. */
export function amountToCents(amount: number | string): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('The amount must be a positive number');
  const cents = Math.round(n * 100);
  if (Math.abs(cents - n * 100) > 1e-6) throw new Error('The amount has more than two decimals');
  return cents;
}

const clip = (text: unknown, max: number): string => String(text ?? '').trim().slice(0, max);

export function splitName(display: string | null | undefined): { first: string; last: string } {
  const parts = clip(display, 100).split(/\s+/).filter(Boolean);
  return { first: clip(parts[0] ?? 'NA', 50), last: clip(parts.slice(1).join(' ') || 'NA', 50) };
}

/** Digits (and a leading +) of 7 to 15 characters, otherwise the placeholder Paymob accepts. */
export function cleanPhone(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return 'NA';
  return text.startsWith('+') ? `+${digits}` : digits;
}

export interface IntentionInput {
  amountCents: number;
  currency: string;
  integrationId: number;
  specialReference: string;
  itemName: string;
  description: string;
  name: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  notificationUrl: string;
  redirectionUrl: string;
}

/** Body of POST /v1/intention/ (Paymob Unified Checkout). One line item for the whole invoice. */
export function buildIntention(input: IntentionInput): Record<string, unknown> {
  const { first, last } = splitName(input.name);
  return {
    amount: input.amountCents,
    currency: input.currency,
    payment_methods: [input.integrationId],
    items: [
      {
        name: clip(input.itemName, 50) || 'Invoice',
        amount: input.amountCents,
        description: clip(input.description, 100) || 'Invoice payment',
        quantity: 1,
      },
    ],
    billing_data: {
      first_name: first,
      last_name: last,
      email: clip(input.email, 100) || 'NA',
      phone_number: cleanPhone(input.phone),
    },
    special_reference: clip(input.specialReference, 50),
    notification_url: input.notificationUrl,
    redirection_url: input.redirectionUrl,
  };
}

/** Address of Paymob's hosted payment page. */
export function checkoutUrl(baseUrl: string, publicKey: string, clientSecret: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
}

/** Keys look like egy_sk_test_... or egy_pk_live_...: test and live must not be mixed. */
export function keyMode(key: string | null | undefined): 'test' | 'live' | 'unknown' {
  const text = String(key ?? '');
  if (/_test_/i.test(text)) return 'test';
  if (/_live_/i.test(text)) return 'live';
  return 'unknown';
}
