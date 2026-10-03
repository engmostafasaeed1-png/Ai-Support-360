// Paymob "transaction processed callback": Paymob calls this address after every card payment attempt.
//
// Paymob cannot send a Supabase JWT, so this function is deployed with verify_jwt = false (see supabase/config.toml).
// The caller proves itself with Paymob's HMAC-SHA512 signature (the ?hmac= parameter, checked against PAYMOB_HMAC_SECRET
// in constant time). Nothing else in the message is trusted:
//   * the invoice is found through the Paymob order id that this platform stored when it created the payment,
//   * apply_provider_payment compares amount and currency with the invoice and applies each transaction only once,
//   * the answer never says which part of a message was wrong.
// A verified message that cannot be understood is reported to the administrators instead of being guessed at.
import { adminClient, clientIp, jsonResponse, withinRateLimit } from '../_shared/security.ts';
import { describeTransaction, eventPayload, verifyPaymobHmac, webhookReader } from '../_shared/paymob.ts';

const MAX_BODY_BYTES = 64 * 1024;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const hmacSecret = Deno.env.get('PAYMOB_HMAC_SECRET');
  if (!hmacSecret || !Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    console.error('paymob-webhook: not configured (PAYMOB_HMAC_SECRET missing)');
    return jsonResponse(req, { error: 'Not configured' }, 503);
  }

  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    return jsonResponse(req, { error: 'Payload too large' }, 413);
  }

  try {
    const admin = adminClient();
    // fail open: a problem with the limiter must never make a real payment message get lost
    if (!(await withinRateLimit(admin, `paymob-webhook:${clientIp(req)}`, 300, 60, true))) {
      return jsonResponse(req, { error: 'Too many requests' }, 429);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return jsonResponse(req, { error: 'Payload too large' }, 413);
    let body: { type?: unknown; obj?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(req, { error: 'Invalid JSON' }, 400);
    }
    if (body?.type !== 'TRANSACTION' || !body.obj || typeof body.obj !== 'object') {
      return jsonResponse(req, { ok: true, ignored: 'not a transaction' });
    }

    const read = webhookReader(body.obj);
    const received = new URL(req.url).searchParams.get('hmac');
    const check = await verifyPaymobHmac(hmacSecret, read, received);
    if (!check.ok) {
      // names of missing fields only: never the values, never the secret
      console.error('paymob-webhook: signature not accepted', { hasHmac: Boolean(received), missing: check.missing });
      return jsonResponse(req, { error: 'Invalid signature' }, 401);
    }

    const transaction = describeTransaction(read);
    if (transaction.kind === 'ignore') {
      if (transaction.reason === 'unusable') {
        console.error('paymob-webhook: verified message could not be understood', { id: String(read('id') ?? '').slice(0, 40) });
        await admin.rpc('notify_payment_admins', {
          _title: 'Card payment message not understood',
          _body: `Paymob sent a signed message (transaction ${String(read('id') ?? '?').slice(0, 40)}) that this platform could not read. Check the Paymob dashboard.`,
        });
      }
      return jsonResponse(req, { ok: true, ignored: transaction.reason });
    }

    const { data, error } = await admin.rpc('apply_provider_payment', {
      _provider: 'paymob',
      _order_id: transaction.orderId,
      _transaction_id: transaction.transactionId,
      _kind: transaction.kind,
      _amount: transaction.amount,
      _currency: transaction.currency,
      _source: 'webhook',
      _payload: eventPayload(read),
    });
    if (error) {
      // 500 makes Paymob send the message again later
      console.error('paymob-webhook: could not apply the payment', { code: error.code, message: error.message });
      return jsonResponse(req, { error: 'Could not apply the payment' }, 500);
    }
    console.log('paymob-webhook: handled', { kind: transaction.kind, result: data });
    return jsonResponse(req, { ok: true, result: data });
  } catch (err) {
    console.error('paymob-webhook: unexpected error', err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { error: 'Internal error' }, 500);
  }
});
