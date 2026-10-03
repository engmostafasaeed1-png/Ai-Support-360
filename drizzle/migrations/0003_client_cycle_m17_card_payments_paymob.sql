-- M17 (card payments through a provider, Paymob first): the browser never confirms a payment. A verified provider callback does,
-- through apply_provider_payment, which books the payment exactly like an administrator's confirmation (invoice paid, one payout after commission).
-- A. What the invoice remembers about card attempts, and the log of provider events (idempotent: the same event is applied once).
-- B. The administrator's switch (platform_settings key card_payments_enabled) and the function that tells the screens whether to offer cards.
-- C. Functions for the edge functions only (service role): check an invoice before a card payment starts, record the attempt, apply a callback.

-- ===== A. invoice columns, attempts, provider events =====
ALTER TABLE public.payments
  ADD COLUMN provider_transaction_id text CHECK (provider_transaction_id IS NULL OR char_length(provider_transaction_id) <= 64),
  ADD COLUMN provider_status text CHECK (provider_status IS NULL OR provider_status IN ('initiated', 'paid', 'failed', 'refunded', 'voided')),
  ADD COLUMN card_started_at timestamptz;
CREATE UNIQUE INDEX payments_provider_txn_key ON public.payments (provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;

-- one row per card attempt (one provider order each): a callback is matched by the order id that the provider signs,
-- never by a field the sender could change
CREATE TABLE public.payment_card_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider ~ '^[a-z_]{2,30}$'),
  provider_order_id text NOT NULL CHECK (provider_order_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  provider_intention_id text CHECK (provider_intention_id IS NULL OR char_length(provider_intention_id) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id)
);
CREATE INDEX payment_card_attempts_payment_idx ON public.payment_card_attempts (payment_id);
ALTER TABLE public.payment_card_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_card_attempts FROM anon, authenticated;

CREATE TABLE public.payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider ~ '^[a-z_]{2,30}$'),
  event_key text NOT NULL,
  order_id text,
  transaction_id text,
  kind text NOT NULL CHECK (kind IN ('paid', 'failed', 'refunded', 'voided')),
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  amount numeric(12,2),
  currency text,
  outcome text,
  detail text,
  delivered_via text NOT NULL DEFAULT 'webhook',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(payload::text) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_key)
);
CREATE INDEX payment_provider_events_payment_idx ON public.payment_provider_events (payment_id);
ALTER TABLE public.payment_provider_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_provider_events FROM anon, authenticated;
GRANT SELECT ON public.payment_provider_events TO authenticated;
CREATE POLICY "Administrators read provider events" ON public.payment_provider_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== B. the switch =====
-- guard_payment_settings (M16) learns one more key; everything else in it is unchanged
CREATE OR REPLACE FUNCTION public.guard_payment_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _v jsonb := NEW.value;
  _num numeric;
  _max numeric;
  _k text;
  _allowed text[] := ARRAY['beneficiary', 'bank_name', 'iban', 'account_number', 'swift', 'currency', 'country', 'instructions'];
BEGIN
  IF NEW.key IN ('commission_percent', 'vat_percent') THEN
    IF jsonb_typeof(_v) = 'number' THEN
      _num := (_v #>> '{}')::numeric;
    ELSIF jsonb_typeof(_v) = 'string' AND (_v #>> '{}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN
      _num := btrim(_v #>> '{}')::numeric;
    ELSE
      RAISE EXCEPTION 'The % must be a number', replace(NEW.key, '_', ' ') USING ERRCODE = '22023';
    END IF;
    _max := CASE WHEN NEW.key = 'commission_percent' THEN 60 ELSE 30 END;
    IF _num < 0 OR _num > _max THEN
      RAISE EXCEPTION 'The % must be between 0 and % percent', replace(NEW.key, '_', ' '), _max USING ERRCODE = '22023';
    END IF;
    NEW.value := to_jsonb(round(_num, 2));
  ELSIF NEW.key = 'platform_bank_details' THEN
    IF jsonb_typeof(_v) <> 'object' THEN
      RAISE EXCEPTION 'The bank details must be an object' USING ERRCODE = '22023';
    END IF;
    FOR _k IN SELECT jsonb_object_keys(_v) LOOP
      IF NOT (_k = ANY (_allowed)) THEN
        RAISE EXCEPTION 'Unknown bank detail: %', _k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_each(_v) e WHERE jsonb_typeof(e.value) <> 'string' OR char_length(e.value #>> '{}') > 1000) THEN
      RAISE EXCEPTION 'Each bank detail must be text of at most 1000 characters' USING ERRCODE = '22023';
    END IF;
    IF char_length(COALESCE(_v ->> 'iban', '')) > 42 OR char_length(COALESCE(_v ->> 'swift', '')) > 11
       OR char_length(COALESCE(_v ->> 'account_number', '')) > 40
       OR char_length(COALESCE(_v ->> 'beneficiary', '')) > 120 OR char_length(COALESCE(_v ->> 'bank_name', '')) > 120 THEN
      RAISE EXCEPTION 'A bank detail is too long' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(_v ->> 'currency', '') <> '' AND (_v ->> 'currency') !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'The currency must be a 3-letter code such as USD' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.key = 'card_payments_enabled' THEN
    IF jsonb_typeof(_v) <> 'boolean' THEN
      RAISE EXCEPTION 'Card payments must be switched on or off' USING ERRCODE = '22023';
    END IF;
    IF _v = 'true'::jsonb AND NOT EXISTS (
         SELECT 1 FROM public.platform_settings ps WHERE ps.key = 'commission_percent' AND NULLIF(ps.value #>> '{}', '') IS NOT NULL) THEN
      RAISE EXCEPTION 'Set the platform commission before you switch card payments on' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_payment_settings() FROM PUBLIC, anon, authenticated;

-- the screens ask this before they show "Pay by card" (only a yes or no leaves the database)
CREATE FUNCTION public.card_payments_enabled()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT ps.value = 'true'::jsonb FROM public.platform_settings ps WHERE ps.key = 'card_payments_enabled' LIMIT 1), false)
$function$;
REVOKE ALL ON FUNCTION public.card_payments_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.card_payments_enabled() TO authenticated;

-- ===== C. functions for the edge functions (service role only) =====
CREATE FUNCTION public.notify_payment_admins(_title text, _body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _admin record;
BEGIN
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin.user_id, left(_title, 120), left(_body, 500), 'payment', '/admin/payments');
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_payment_admins(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_payment_admins(text, text) TO service_role;

-- everything the edge function may use to start a card payment, after the checks that decide whether it is allowed
CREATE FUNCTION public.card_payment_context(_payment_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _name text;
  _phone text;
  _email text;
BEGIN
  IF NOT public.card_payments_enabled() THEN
    RAISE EXCEPTION 'Card payments are switched off' USING ERRCODE = '55000';
  END IF;
  SELECT p.* INTO _p FROM public.payments p WHERE p.id = _payment_id AND p.client_id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
  END IF;
  IF _p.status::text <> 'pending' OR _p.kind <> 'invoice' THEN
    RAISE EXCEPTION 'Only an open invoice can be paid by card' USING ERRCODE = '42501';
  END IF;
  IF _p.consultant_id IS NOT NULL AND public.payment_commission_percent() IS NULL THEN
    RAISE EXCEPTION 'The platform is not ready for this card payment yet' USING ERRCODE = '22023';
  END IF;
  SELECT pr.display_name, pr.phone INTO _name, _phone FROM public.profiles pr WHERE pr.user_id = _user_id;
  SELECT u.email INTO _email FROM auth.users u WHERE u.id = _user_id;
  RETURN jsonb_build_object(
    'payment_id', _p.id, 'amount', _p.amount, 'currency', upper(COALESCE(_p.currency, 'USD')), 'vat_amount', COALESCE(_p.vat_amount, 0),
    'description', _p.description, 'invoice_number', _p.invoice_number, 'reference', _p.reference,
    'client_name', _name, 'client_phone', _phone, 'client_email', _email);
END;
$function$;
REVOKE ALL ON FUNCTION public.card_payment_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_payment_context(uuid, uuid) TO service_role;

-- the provider order was created: remember it so that its callback can be matched
CREATE FUNCTION public.register_card_attempt(_payment_id uuid, _provider text, _order_id text, _intention_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(btrim(_provider), '') = '' OR COALESCE(btrim(_order_id), '') = '' THEN
    RAISE EXCEPTION 'Invalid card attempt' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = _payment_id AND p.status::text = 'pending') THEN
    RAISE EXCEPTION 'Only an open invoice can be paid' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.payment_card_attempts (payment_id, provider, provider_order_id, provider_intention_id)
  VALUES (_payment_id, _provider, _order_id, _intention_id);
  UPDATE public.payments SET provider_status = 'initiated', card_started_at = now() WHERE id = _payment_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.register_card_attempt(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_card_attempt(uuid, text, text, text) TO service_role;

-- a signature-checked provider callback is applied here; the same provider event is applied only once.
-- Returns: applied | duplicate | recorded | unknown_order | already_paid | mismatch | error (anything unusual also tells the administrators)
CREATE FUNCTION public.apply_provider_payment(
  _provider text, _order_id text, _transaction_id text, _kind text, _amount numeric, _currency text,
  _source text DEFAULT 'webhook', _payload jsonb DEFAULT '{}'::jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _event_id uuid;
  _key text;
  _pid uuid;
  _p record;
  _pct numeric;
  _base numeric;
  _comm numeric;
  _result text;
  _detail text;
  _label text;
  _money text;
BEGIN
  IF COALESCE(_provider, '') !~ '^[a-z_]{2,30}$'
     OR COALESCE(_order_id, '') !~ '^[A-Za-z0-9_-]{1,64}$'
     OR COALESCE(_transaction_id, '') !~ '^[A-Za-z0-9_-]{1,64}$'
     OR COALESCE(_currency, '') !~ '^[A-Za-z]{3}$'
     OR _kind IS NULL OR _kind NOT IN ('paid', 'failed', 'refunded', 'voided')
     OR _source IS NULL OR _source NOT IN ('webhook', 'redirect')
     OR _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Invalid provider event' USING ERRCODE = '22023';
  END IF;
  _money := round(_amount, 2)::text || ' ' || upper(_currency);
  _key := _provider || ':' || _transaction_id || ':' || _kind;

  -- a delivery that was already handled is not handled again; one that ended in an error may be tried again
  INSERT INTO public.payment_provider_events (provider, event_key, order_id, transaction_id, kind, amount, currency, delivered_via, payload)
  VALUES (_provider, _key, _order_id, _transaction_id, _kind, _amount, upper(_currency), _source, COALESCE(_payload, '{}'::jsonb))
  ON CONFLICT (provider, event_key) DO UPDATE
    SET delivered_via = CASE WHEN position(EXCLUDED.delivered_via IN payment_provider_events.delivered_via) = 0
                             THEN payment_provider_events.delivered_via || ',' || EXCLUDED.delivered_via ELSE payment_provider_events.delivered_via END,
        payload = EXCLUDED.payload
    WHERE payment_provider_events.outcome = 'error'
  RETURNING id INTO _event_id;
  IF _event_id IS NULL THEN
    UPDATE public.payment_provider_events e SET delivered_via = e.delivered_via || ',' || _source
    WHERE e.provider = _provider AND e.event_key = _key AND position(_source IN e.delivered_via) = 0;
    RETURN 'duplicate';
  END IF;

  BEGIN
    SELECT a.payment_id INTO _pid FROM public.payment_card_attempts a WHERE a.provider = _provider AND a.provider_order_id = _order_id;
    IF _pid IS NOT NULL THEN
      SELECT * INTO _p FROM public.payments WHERE id = _pid FOR UPDATE;
      IF NOT FOUND THEN
        _pid := NULL;
      END IF;
    END IF;

    IF _pid IS NULL THEN
      _result := 'unknown_order';
      PERFORM public.notify_payment_admins('Card payment not matched',
        'The payment provider reported a ' || _kind || ' (' || _money || ', transaction ' || _transaction_id || ') for an order this platform has no invoice for. Check the provider dashboard.');
    ELSE
      _label := COALESCE(_p.invoice_number, _p.reference, _pid::text);
      IF _kind = 'failed' THEN
        UPDATE public.payments SET provider_status = 'failed' WHERE id = _pid AND status::text = 'pending';
        _result := 'recorded';
      ELSIF _kind IN ('refunded', 'voided') THEN
        UPDATE public.payments SET provider_status = _kind WHERE id = _pid;
        _result := 'recorded';
        PERFORM public.notify_payment_admins('Card payment ' || _kind,
          'The provider ' || _kind || ' the card payment of ' || _money || ' for invoice ' || _label || '. The invoice and the payout are not changed automatically: decide what to do.');
      ELSIF _p.status::text <> 'pending' THEN
        _result := 'already_paid';
        PERFORM public.notify_payment_admins('Possible double payment',
          'A card payment of ' || _money || ' (transaction ' || _transaction_id || ') arrived for invoice ' || _label || ', which is no longer open (status: ' || _p.status::text || '). If it is a duplicate, refund it at the provider.');
      ELSIF upper(_currency) IS DISTINCT FROM upper(COALESCE(_p.currency, 'USD')) OR _amount IS DISTINCT FROM _p.amount THEN
        _result := 'mismatch';
        PERFORM public.notify_payment_admins('Card payment does not match the invoice',
          'The provider reported ' || _money || ' (transaction ' || _transaction_id || ') for invoice ' || _label || ' (' || round(_p.amount, 2)::text || ' ' || COALESCE(_p.currency, 'USD') || '). The invoice stays open: check the provider dashboard.');
      ELSIF _p.consultant_id IS NOT NULL AND _p.kind = 'invoice' AND public.payment_commission_percent() IS NULL THEN
        _result := 'error';
        _detail := 'the platform commission is not set';
      ELSE
        UPDATE public.payments
        SET status = 'completed', paid_at = now(), provider = _provider, provider_transaction_id = _transaction_id, provider_status = 'paid',
            payment_method = 'card', bank_reference = left(_provider || ' ' || _transaction_id, 120), received_amount = _amount, rejection_note = NULL
        WHERE id = _pid;
        IF _p.consultant_id IS NOT NULL AND _p.kind = 'invoice' THEN
          _pct := public.payment_commission_percent();
          _base := _p.amount - COALESCE(_p.vat_amount, 0);
          _comm := round(_base * _pct / 100, 2);
          INSERT INTO public.payouts (consultant_id, amount, currency, status, reference, payment_id, gross_amount, commission_percent, commission_amount)
          VALUES (_p.consultant_id, _base - _comm, COALESCE(_p.currency, 'USD'), 'pending', 'payment:' || _p.id::text, _p.id, _base, _pct, _comm);
        END IF;
        _result := 'applied';
        PERFORM public.notify_payment_admins('Card payment received',
          'Invoice ' || _label || ' was paid by card (' || _money || '). It is marked paid' || CASE WHEN _p.consultant_id IS NOT NULL THEN ' and the consultant payout is waiting for you.' ELSE '.' END);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    _result := 'error';
    _detail := left(SQLERRM, 300);
  END;

  IF _result = 'error' THEN
    PERFORM public.notify_payment_admins('Card payment needs your attention',
      'A card payment of ' || _money || ' (transaction ' || _transaction_id || ') could not be applied: ' || COALESCE(_detail, 'unknown reason')
      || '. The invoice stays open. After you fix the cause, confirm it by hand in Payments & payouts (bank reference: ' || _provider || ' ' || _transaction_id || ').');
  END IF;
  UPDATE public.payment_provider_events SET outcome = _result, detail = _detail, payment_id = _pid WHERE id = _event_id;
  RETURN _result;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_provider_payment(text, text, text, text, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_provider_payment(text, text, text, text, numeric, text, text, jsonb) TO service_role;