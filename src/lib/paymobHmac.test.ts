// Tests for the Paymob helpers used by the card-payment edge functions (supabase/functions/_shared/paymob.ts).
// The expected signature below was computed outside the code under test (HMAC-SHA512, .NET) from the signed text.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PAYMOB_HMAC_FIELDS,
  amountToCents,
  buildIntention,
  checkoutUrl,
  cleanPhone,
  describeTransaction,
  eventPayload,
  hmacSource,
  keyMode,
  paymobHmac,
  redirectReader,
  splitName,
  verifyPaymobHmac,
  webhookReader,
} from '../../supabase/functions/_shared/paymob.ts';

beforeAll(async () => {
  // Node 20+ already has crypto.subtle; this only covers an older runtime
  if (!globalThis.crypto?.subtle) {
    const nodeCrypto = 'node:crypto';
    const { webcrypto } = await import(/* @vite-ignore */ nodeCrypto);
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const SECRET = 'test-secret-value';
const SIGNED_TEXT =
  '57002026-10-03T12:00:00.123456USDfalsefalse1234567894567890truefalsefalsefalsetruefalse987654321111222false2346MasterCardcardtrue';
const SIGNATURE =
  '6fe2b0d897ed0fbf81b2a5eb180e2a1b17de5e1f16baba5c9badb940a393901a890df2307023e375c13934faeaf4ebda465ee2549aa58c2051ff6cc87f73e25a';

// a paid card transaction, as it arrives inside the webhook
const transaction = (): Record<string, unknown> => ({
  amount_cents: 5700,
  created_at: '2026-10-03T12:00:00.123456',
  currency: 'USD',
  error_occured: false,
  has_parent_transaction: false,
  id: 123456789,
  integration_id: 4567890,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 987654321, merchant_order_id: 'x' },
  owner: 111222,
  pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
  success: true,
});

// the same transaction as the redirect query string (every value is text, order.id arrives as "order")
const redirectParams = (): Record<string, string> => ({
  amount_cents: '5700',
  created_at: '2026-10-03T12:00:00.123456',
  currency: 'USD',
  error_occured: 'false',
  has_parent_transaction: 'false',
  id: '123456789',
  integration_id: '4567890',
  is_3d_secure: 'true',
  is_auth: 'false',
  is_capture: 'false',
  is_refunded: 'false',
  is_standalone_payment: 'true',
  is_voided: 'false',
  order: '987654321',
  owner: '111222',
  pending: 'false',
  'source_data.pan': '2346',
  'source_data.sub_type': 'MasterCard',
  'source_data.type': 'card',
  success: 'true',
});

describe('Paymob signature', () => {
  it('signs the 20 fields in the documented order', () => {
    expect([...PAYMOB_HMAC_FIELDS]).toEqual([
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
    ]);
  });

  it('builds the signed text from the webhook object', () => {
    expect(hmacSource(webhookReader(transaction()))).toEqual({ source: SIGNED_TEXT, missing: [] });
  });

  it('builds the same signed text from the redirect parameters', () => {
    expect(hmacSource(redirectReader(redirectParams()))).toEqual({ source: SIGNED_TEXT, missing: [] });
  });

  it('also finds the order id when the redirect calls it order_id', () => {
    const { order, ...rest } = redirectParams();
    expect(hmacSource(redirectReader({ ...rest, order_id: order }))).toEqual({ source: SIGNED_TEXT, missing: [] });
  });

  it('computes HMAC-SHA512 as lowercase hex (value computed independently)', async () => {
    expect(await paymobHmac(SECRET, SIGNED_TEXT)).toBe(SIGNATURE);
  });

  it('accepts a correct webhook signature, also written in capitals', async () => {
    const read = webhookReader(transaction());
    expect((await verifyPaymobHmac(SECRET, read, SIGNATURE)).ok).toBe(true);
    expect((await verifyPaymobHmac(SECRET, read, SIGNATURE.toUpperCase())).ok).toBe(true);
  });

  it('accepts a correct redirect signature', async () => {
    expect((await verifyPaymobHmac(SECRET, redirectReader(redirectParams()), SIGNATURE)).ok).toBe(true);
  });

  it('rejects a wrong secret, a wrong or missing signature and a changed signed value', async () => {
    const read = webhookReader(transaction());
    expect((await verifyPaymobHmac('another-secret', read, SIGNATURE)).ok).toBe(false);
    expect((await verifyPaymobHmac(SECRET, read, SIGNATURE.slice(0, -1) + '0')).ok).toBe(false);
    expect((await verifyPaymobHmac(SECRET, read, '')).ok).toBe(false);
    expect((await verifyPaymobHmac(SECRET, read, null)).ok).toBe(false);
    const cheaper = { ...transaction(), amount_cents: 100 };
    expect((await verifyPaymobHmac(SECRET, webhookReader(cheaper), SIGNATURE)).ok).toBe(false);
    const paid = { ...transaction(), success: false };
    expect((await verifyPaymobHmac(SECRET, webhookReader(paid), SIGNATURE)).ok).toBe(false);
    const params = { ...redirectParams(), order: '1' };
    expect((await verifyPaymobHmac(SECRET, redirectReader(params), SIGNATURE)).ok).toBe(false);
  });

  it('can not be verified when a signed field is missing, and says which one', async () => {
    const broken = transaction();
    delete broken.order;
    const result = await verifyPaymobHmac(SECRET, webhookReader(broken), SIGNATURE);
    expect(result).toEqual({ ok: false, missing: ['order.id'] });
  });

  it('does not sign merchant_order_id, which is why an invoice is found through the stored order id instead', async () => {
    const other = transaction();
    (other.order as Record<string, unknown>).merchant_order_id = 'another-invoice';
    expect((await verifyPaymobHmac(SECRET, webhookReader(other), SIGNATURE)).ok).toBe(true);
  });
});

describe('Paymob transaction meaning', () => {
  const describeWith = (change: Record<string, unknown>) => describeTransaction(webhookReader({ ...transaction(), ...change }));

  it('a successful card payment is paid, with order, transaction, amount and currency', () => {
    expect(describeWith({})).toEqual({
      kind: 'paid',
      reason: '',
      orderId: '987654321',
      transactionId: '123456789',
      amount: 57,
      currency: 'USD',
    });
  });

  it('the redirect parameters give the same answer', () => {
    expect(describeTransaction(redirectReader(redirectParams())).kind).toBe('paid');
    expect(describeTransaction(redirectReader({ ...redirectParams(), success: 'false' })).kind).toBe('failed');
  });

  it('an unsuccessful or errored transaction is failed', () => {
    expect(describeWith({ success: false }).kind).toBe('failed');
    expect(describeWith({ error_occured: true }).kind).toBe('failed');
  });

  it('a pending transaction is not recorded yet', () => {
    expect(describeWith({ pending: true, success: false })).toMatchObject({ kind: 'ignore', reason: 'pending' });
  });

  it('a voided or refunded transaction is never paid, even when success is true', () => {
    expect(describeWith({ is_voided: true }).kind).toBe('voided');
    expect(describeWith({ is_refunded: true }).kind).toBe('refunded');
    expect(describeWith({ is_refund: true }).kind).toBe('refunded');
    expect(describeWith({ is_void: true }).kind).toBe('voided');
  });

  it('an authorisation that was not captured is not paid; a captured one is', () => {
    expect(describeWith({ is_auth: true, is_capture: false }).kind).toBe('failed');
    expect(describeWith({ is_auth: true, is_capture: true }).kind).toBe('paid');
  });

  it('a child transaction (capture, adjustment) is left alone', () => {
    expect(describeWith({ has_parent_transaction: true })).toMatchObject({ kind: 'ignore', reason: 'child' });
  });

  it('unusable identifiers, amounts or currencies are reported, never guessed', () => {
    expect(describeWith({ amount_cents: 57.5 })).toMatchObject({ kind: 'ignore', reason: 'unusable' });
    expect(describeWith({ amount_cents: -1 })).toMatchObject({ kind: 'ignore', reason: 'unusable' });
    expect(describeWith({ id: "1'; drop table payments;--" })).toMatchObject({ kind: 'ignore', reason: 'unusable' });
    expect(describeWith({ order: {} })).toMatchObject({ kind: 'ignore', reason: 'unusable' });
    expect(describeWith({ currency: 'US' })).toMatchObject({ kind: 'ignore', reason: 'unusable' });
  });

  it('keeps identifiers and flags in the event log, never card or billing data', () => {
    const payload = eventPayload(
      webhookReader({ ...transaction(), billing_data: { email: 'a@b.c', phone_number: '0100' }, data: { message: 'Approved' } }),
    );
    expect(payload).toMatchObject({
      id: 123456789,
      'order.id': 987654321,
      amount_cents: 5700,
      currency: 'USD',
      success: true,
      'source_data.type': 'card',
      'data.message': 'Approved',
    });
    const text = JSON.stringify(payload);
    expect(text).not.toContain('2346');
    expect(text).not.toContain('a@b.c');
    expect(text).not.toContain('0100');
    expect(text.length).toBeLessThan(1500);
  });
});

describe('Paymob payment request', () => {
  it('turns an invoice amount into whole cents and refuses anything else', () => {
    expect(amountToCents('57.00')).toBe(5700);
    expect(amountToCents(114)).toBe(11400);
    expect(amountToCents(0.07)).toBe(7);
    expect(amountToCents('19.99')).toBe(1999);
    expect(() => amountToCents('10.005')).toThrow();
    expect(() => amountToCents(0)).toThrow();
    expect(() => amountToCents(-5)).toThrow();
    expect(() => amountToCents('abc')).toThrow();
  });

  it('builds one line item for the whole invoice and carries both callback addresses', () => {
    const body = buildIntention({
      amountCents: 5700,
      currency: 'USD',
      integrationId: 4567890,
      specialReference: 'QT-ABCD1234-1a2b3c4d',
      itemName: 'INV-2026-000001',
      description: 'Timesheet: 1 h',
      name: 'Mostafa El Sayed',
      email: 'client@example.com',
      phone: '+20 100 123 4567',
      notificationUrl: 'https://project.supabase.co/functions/v1/paymob-webhook',
      redirectionUrl: 'https://www.example.com/client/payments',
    });
    expect(body).toEqual({
      amount: 5700,
      currency: 'USD',
      payment_methods: [4567890],
      items: [{ name: 'INV-2026-000001', amount: 5700, description: 'Timesheet: 1 h', quantity: 1 }],
      billing_data: { first_name: 'Mostafa', last_name: 'El Sayed', email: 'client@example.com', phone_number: '+201001234567' },
      special_reference: 'QT-ABCD1234-1a2b3c4d',
      notification_url: 'https://project.supabase.co/functions/v1/paymob-webhook',
      redirection_url: 'https://www.example.com/client/payments',
    });
  });

  it('uses placeholders for a missing name or phone and never an empty item name', () => {
    const body = buildIntention({
      amountCents: 100,
      currency: 'USD',
      integrationId: 1,
      specialReference: 'r',
      itemName: '',
      description: '',
      name: '',
      email: 'client@example.com',
      phone: '12',
      notificationUrl: 'https://n',
      redirectionUrl: 'https://r',
    }) as { items: Array<{ name: string; description: string }>; billing_data: Record<string, string> };
    expect(body.billing_data).toMatchObject({ first_name: 'NA', last_name: 'NA', phone_number: 'NA' });
    expect(body.items[0].name).toBe('Invoice');
    expect(body.items[0].description).toBe('Invoice payment');
  });

  it('cleans names and phone numbers', () => {
    expect(splitName('  Ada   Lovelace King ')).toEqual({ first: 'Ada', last: 'Lovelace King' });
    expect(splitName('Madonna')).toEqual({ first: 'Madonna', last: 'NA' });
    expect(splitName(null)).toEqual({ first: 'NA', last: 'NA' });
    expect(cleanPhone('+20 (100) 123-4567')).toBe('+201001234567');
    expect(cleanPhone('01001234567')).toBe('01001234567');
    expect(cleanPhone('123')).toBe('NA');
    expect(cleanPhone('1'.repeat(20))).toBe('NA');
    expect(cleanPhone(null)).toBe('NA');
  });

  it('builds the hosted checkout address with both keys encoded', () => {
    expect(checkoutUrl('https://accept.paymob.com/', 'egy_pk_test_abc', 'cs_1+2/3=')).toBe(
      'https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_abc&clientSecret=cs_1%2B2%2F3%3D',
    );
  });

  it('tells test keys from live keys', () => {
    expect(keyMode('egy_sk_test_abc')).toBe('test');
    expect(keyMode('egy_pk_live_abc')).toBe('live');
    expect(keyMode('something-else')).toBe('unknown');
    expect(keyMode(undefined)).toBe('unknown');
  });
});
