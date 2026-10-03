// Authenticated endpoint for card payments through Paymob (Unified Checkout).
//   action "create"  -> a signed-in client starts a card payment for ONE open invoice of his own. The amount, currency and
//                       customer come from the database, never from the request. Returns the address of Paymob's hosted page.
//   action "confirm" -> the browser came back from Paymob. The redirect parameters are verified with the same HMAC signature
//                       as the webhook and applied through the same function, so a payment is booked once whichever arrives first.
//   action "status"  -> administrators only: which settings exist and in which mode (never a key, never part of a key).
// Secrets (edge function secrets, never in the code or the browser): PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY,
// PAYMOB_HMAC_SECRET, PAYMOB_CARD_INTEGRATION_ID; optional PAYMOB_BASE_URL (default https://accept.paymob.com) and
// PAYMOB_CURRENCIES (currencies the card integration accepts, comma separated, default USD).
import {
  ADMIN_ROLES,
  adminClient,
  authenticateUser,
  getUserRoles,
  hasAnyRole,
  jsonResponse,
  preflight,
  SITE_URL,
  withinRateLimit,
} from '../_shared/security.ts';
import {
  amountToCents,
  buildIntention,
  checkoutUrl,
  describeTransaction,
  eventPayload,
  keyMode,
  redirectReader,
  verifyPaymobHmac,
} from '../_shared/paymob.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseUrl = (): string => (Deno.env.get('PAYMOB_BASE_URL') ?? 'https://accept.paymob.com').replace(/\/+$/, '');
const functionsUrl = (): string => `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/functions/v1`;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  if (!Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return jsonResponse(req, { error: 'Server misconfigured' }, 500);
  }

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  const action = typeof body.action === 'string' ? body.action : 'create';

  // ---------------------------------------------------------------------------------------------------------------
  if (action === 'status') {
    if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
    const secretKey = Deno.env.get('PAYMOB_SECRET_KEY') ?? '';
    const publicKey = Deno.env.get('PAYMOB_PUBLIC_KEY') ?? '';
    const integration = Number(Deno.env.get('PAYMOB_CARD_INTEGRATION_ID') ?? '');
    const secretMode = keyMode(secretKey);
    const publicMode = keyMode(publicKey);
    return jsonResponse(req, {
      ok: true,
      configured: {
        secret_key: secretKey !== '',
        public_key: publicKey !== '',
        hmac_secret: (Deno.env.get('PAYMOB_HMAC_SECRET') ?? '') !== '',
        card_integration_id: Number.isInteger(integration) && integration > 0,
      },
      mode: secretMode,
      modes_match: secretMode === publicMode,
      webhook_url: `${functionsUrl()}/paymob-webhook`,
      return_url: `${SITE_URL}/client/payments`,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  if (action === 'confirm') {
    const hmacSecret = Deno.env.get('PAYMOB_HMAC_SECRET');
    if (!hmacSecret) return jsonResponse(req, { error: 'Card payments are not available right now' }, 503);
    const raw = body.params;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return jsonResponse(req, { error: 'params are required' }, 400);
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0 || entries.length > 80) return jsonResponse(req, { error: 'params are not valid' }, 400);
    const params: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (typeof value !== 'string' || key.length > 60 || value.length > 400) return jsonResponse(req, { error: 'params are not valid' }, 400);
      params[key] = value;
    }
    if (!(await withinRateLimit(admin, `paymob-confirm:${user.id}`, 60, 3600))) {
      return jsonResponse(req, { error: 'Too many requests, try again later' }, 429);
    }

    const read = redirectReader(params);
    const check = await verifyPaymobHmac(hmacSecret, read, params.hmac);
    if (!check.ok) {
      console.error('paymob-create-payment: redirect signature not accepted', { hasHmac: Boolean(params.hmac), missing: check.missing });
      return jsonResponse(req, { error: 'The payment confirmation could not be verified' }, 400);
    }
    const transaction = describeTransaction(read);
    if (transaction.kind === 'ignore') {
      return jsonResponse(req, { ok: true, state: transaction.reason === 'pending' ? 'pending' : 'ignored' });
    }
    const { data, error } = await admin.rpc('apply_provider_payment', {
      _provider: 'paymob',
      _order_id: transaction.orderId,
      _transaction_id: transaction.transactionId,
      _kind: transaction.kind,
      _amount: transaction.amount,
      _currency: transaction.currency,
      _source: 'redirect',
      _payload: eventPayload(read),
    });
    if (error) {
      console.error('paymob-create-payment: could not apply the payment', { code: error.code, message: error.message });
      return jsonResponse(req, { error: 'Could not apply the payment' }, 500);
    }
    return jsonResponse(req, { ok: true, state: transaction.kind, result: data });
  }

  // ---------------------------------------------------------------------------------------------------------------
  if (action !== 'create') return jsonResponse(req, { error: 'Unknown action' }, 400);

  const paymentId = typeof body.payment_id === 'string' ? body.payment_id : '';
  if (!UUID_RE.test(paymentId)) return jsonResponse(req, { error: 'payment_id is required' }, 400);
  if (!(await withinRateLimit(admin, `paymob-create:${user.id}`, 10, 3600))) {
    return jsonResponse(req, { error: 'Too many attempts, try again later' }, 429);
  }

  const secretKey = Deno.env.get('PAYMOB_SECRET_KEY') ?? '';
  const publicKey = Deno.env.get('PAYMOB_PUBLIC_KEY') ?? '';
  const integrationId = Number(Deno.env.get('PAYMOB_CARD_INTEGRATION_ID') ?? '');
  if (!secretKey || !publicKey || !Number.isInteger(integrationId) || integrationId <= 0) {
    console.error('paymob-create-payment: not configured', {
      secret_key: secretKey !== '',
      public_key: publicKey !== '',
      card_integration_id: Number.isInteger(integrationId) && integrationId > 0,
    });
    return jsonResponse(req, { error: 'Card payments are not available right now' }, 503);
  }

  // the database decides whether this client may pay this invoice by card, and what the amount is
  const { data: context, error: contextError } = await admin.rpc('card_payment_context', { _payment_id: paymentId, _user_id: user.id });
  if (contextError || !context) {
    const code = contextError?.code ?? '';
    if (code === '55000') return jsonResponse(req, { error: 'Card payments are switched off' }, 409);
    if (code === '42501') return jsonResponse(req, { error: 'This invoice is not open for payment' }, 404);
    if (code === '22023') return jsonResponse(req, { error: contextError?.message ?? 'This invoice can not be paid by card' }, 409);
    console.error('paymob-create-payment: context failed', { code, message: contextError?.message });
    return jsonResponse(req, { error: 'The card payment could not be started' }, 500);
  }

  let amountCents: number;
  try {
    amountCents = amountToCents(context.amount);
  } catch {
    return jsonResponse(req, { error: 'This invoice amount can not be paid by card' }, 409);
  }

  // the Paymob card integration is set up for certain currencies only (default USD; PAYMOB_CURRENCIES = comma separated list)
  const currency = String(context.currency ?? 'USD').toUpperCase();
  const allowedCurrencies = (Deno.env.get('PAYMOB_CURRENCIES') ?? 'USD').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (!allowedCurrencies.includes(currency)) {
    return jsonResponse(req, { error: `Card payment is not available for invoices in ${currency}. Please pay by bank transfer.` }, 409);
  }

  const isAdmin = hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES);
  const reference = String(context.reference ?? context.invoice_number ?? 'INV');
  const intention = buildIntention({
    amountCents,
    currency,
    integrationId,
    specialReference: `${reference}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
    itemName: String(context.invoice_number ?? reference),
    description: String(context.description ?? 'Invoice payment'),
    name: context.client_name,
    email: context.client_email,
    phone: context.client_phone,
    notificationUrl: `${functionsUrl()}/paymob-webhook`,
    redirectionUrl: `${SITE_URL}/client/payments`,
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(intention),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error('paymob-create-payment: Paymob could not be reached', err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { error: 'The payment provider could not be reached, please try again' }, 502);
  }
  const text = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(text);
  } catch {
    // not JSON: handled below
  }

  const clientSecret = typeof result.client_secret === 'string' ? result.client_secret : '';
  const paymentKeys = Array.isArray(result.payment_keys) ? (result.payment_keys as Array<Record<string, unknown>>) : [];
  const orderId = result.intention_order_id ?? paymentKeys[0]?.order_id ?? null;
  if (!response.ok || !clientSecret || orderId === null || orderId === undefined || String(orderId) === '') {
    // what Paymob answered is only shown to administrators (it can name the setting that is wrong); a client secret is never logged or shown
    const detail = clientSecret ? `No order id in the answer. Fields: ${Object.keys(result).join(', ')}` : text.slice(0, 300);
    console.error('paymob-create-payment: intention refused', { status: response.status, detail });
    return jsonResponse(
      req,
      { error: 'The card payment could not be started', ...(isAdmin ? { provider_status: response.status, provider_message: detail } : {}) },
      502,
    );
  }

  // remember the Paymob order BEFORE the client can pay, so that the callback can be matched to this invoice
  const { error: attemptError } = await admin.rpc('register_card_attempt', {
    _payment_id: paymentId,
    _provider: 'paymob',
    _order_id: String(orderId),
    _intention_id: result.id === undefined || result.id === null ? null : String(result.id).slice(0, 100),
  });
  if (attemptError) {
    console.error('paymob-create-payment: attempt not saved', { code: attemptError.code, message: attemptError.message });
    return jsonResponse(req, { error: 'The card payment could not be started' }, 500);
  }

  return jsonResponse(req, { ok: true, checkout_url: checkoutUrl(baseUrl(), publicKey, clientSecret) });
});
