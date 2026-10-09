-- M34 pricing v2: the price of consultant work comes from the timesheet that the client approved.
--   consultant fee   = billable hours x the hourly rate that the client approved           (paid to the consultant in full)
--   + service fee    = 10 % of the fee                                                      (the portal owner)
--   + processing fee = 5 % of the fee                                                       (the card payment provider)
--   = subtotal; + VAT 15 % of the subtotal = the total that the client pays (card or bank transfer)
-- The three percentages are settings of the administrator (platform_settings). Invoices made before this migration keep the old
-- rules (payments.pricing_model = 'legacy': the commission is taken from the consultant's share).
-- Consultant work is billed in ONE way: the approved timesheet (the free-form consultant invoice is switched off).
-- Subscription plans are not offered any more (a switch brings them back; no plan data is deleted). The plan price function had a bug
-- (an error whenever no voucher code was given); it is fixed here so that the switch can be used.

-- ================================================================== 1. settings and their guard
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
  IF NEW.key IN ('commission_percent', 'vat_percent', 'service_fee_percent', 'processing_fee_percent') THEN
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
  ELSIF NEW.key = 'subscription_plans_enabled' THEN
    IF jsonb_typeof(_v) <> 'boolean' THEN
      RAISE EXCEPTION 'Subscription plans must be switched on or off' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO public.platform_settings (key, value) VALUES
  ('service_fee_percent', '10'::jsonb),
  ('processing_fee_percent', '5'::jsonb),
  ('subscription_plans_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value) VALUES ('vat_percent', '15'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ================================================================== 2. readers of the settings (not callable from the browser)
CREATE OR REPLACE FUNCTION public.payment_service_fee_percent()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(ps.value #>> '{}', '')::numeric FROM public.platform_settings ps WHERE ps.key = 'service_fee_percent' LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.payment_processing_fee_percent()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(ps.value #>> '{}', '')::numeric FROM public.platform_settings ps WHERE ps.key = 'processing_fee_percent' LIMIT 1
$function$;

-- ================================================================== 3. columns
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS base_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS service_fee_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS service_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS processing_fee_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS processing_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_percent numeric(5,2);

ALTER TABLE public.payments
  ADD CONSTRAINT payments_pricing_model_check CHECK (pricing_model IN ('legacy', 'v2')),
  ADD CONSTRAINT payments_v2_breakdown_check CHECK (
    pricing_model <> 'v2' OR (
      base_amount IS NOT NULL AND base_amount > 0
      AND service_fee_percent IS NOT NULL AND service_fee_amount IS NOT NULL AND service_fee_amount >= 0
      AND processing_fee_percent IS NOT NULL AND processing_fee_amount IS NOT NULL AND processing_fee_amount >= 0
      AND vat_percent IS NOT NULL AND vat_amount IS NOT NULL
      AND amount = base_amount + service_fee_amount + processing_fee_amount + vat_amount));

ALTER TABLE public.ticket_timesheet_submissions
  ADD COLUMN IF NOT EXISTS service_fee_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS service_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS processing_fee_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS processing_fee_amount numeric(12,2);

-- ================================================================== 4. the calculation (one function, used by every flow)
CREATE OR REPLACE FUNCTION public.pricing_breakdown(_base numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _svc numeric;
  _prc numeric;
  _vat numeric;
  _b numeric;
  _sf numeric;
  _pf numeric;
  _sub numeric;
  _v numeric;
BEGIN
  IF _base IS NULL OR _base < 0 OR _base > 10000000 THEN
    RAISE EXCEPTION 'The amount must be between 0 and 10,000,000' USING ERRCODE = '22023';
  END IF;
  _svc := public.payment_service_fee_percent();
  _prc := public.payment_processing_fee_percent();
  _vat := public.payment_vat_percent();
  IF _svc IS NULL OR _prc IS NULL OR _vat IS NULL THEN
    RAISE EXCEPTION 'The pricing is not set up yet (service fee, processing fee and VAT)' USING ERRCODE = '22023';
  END IF;
  _b := round(_base, 2);
  _sf := round(_b * _svc / 100, 2);
  _pf := round(_b * _prc / 100, 2);
  _sub := _b + _sf + _pf;
  _v := round(_sub * _vat / 100, 2);
  RETURN jsonb_build_object(
    'base', _b,
    'service_fee_percent', _svc, 'service_fee', _sf,
    'processing_fee_percent', _prc, 'processing_fee', _pf,
    'fees', _sf + _pf,
    'subtotal', _sub,
    'vat_percent', _vat, 'vat', _v,
    'total', _sub + _v);
END;
$function$;

-- the percentages are public information (the pricing page and the calculators show them)
CREATE OR REPLACE FUNCTION public.pricing_terms()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'service_fee_percent', public.payment_service_fee_percent(),
    'processing_fee_percent', public.payment_processing_fee_percent(),
    'vat_percent', public.payment_vat_percent(),
    'plans_enabled', COALESCE((SELECT lower(ps.value #>> '{}') = 'true' FROM public.platform_settings ps WHERE ps.key = 'subscription_plans_enabled' LIMIT 1), false),
    'cards_enabled', public.card_payments_enabled())
$function$;

-- ================================================================== 5. the approval of a timesheet creates the invoice
CREATE OR REPLACE FUNCTION public.respond_to_timesheet(_submission_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _name text;
  _title text;
  _cons uuid;
  _n text := left(btrim(COALESCE(_note, '')), 1000);
  _cur text;
  _q jsonb;
  _base numeric;
  _grand numeric;
  _billed numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT s.id, s.status, s.submitted_by, s.ticket_id, s.total_hours, s.billable_hours, s.total_cost, s.cost_currency, t.client_id, t.title INTO _s
    FROM public.ticket_timesheet_submissions s JOIN public.tickets t ON t.id = s.ticket_id
   WHERE s.id = _submission_id AND t.client_id = auth.uid()
   FOR UPDATE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet not found' USING ERRCODE = '42501';
  END IF;
  IF _s.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted timesheet can be approved or sent back' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve AND char_length(_n) < 3 THEN
    RAISE EXCEPTION 'Please tell the consultant what to change' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('timesheet-respond:' || auth.uid()::text, 60, 3600) THEN
    RAISE EXCEPTION 'Too many answers in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  _cur := COALESCE(NULLIF(btrim(_s.cost_currency), ''), 'USD');
  _title := left(COALESCE(_s.title, 'ticket'), 80);
  _billed := COALESCE(NULLIF(_s.billable_hours, 0), _s.total_hours, 0);
  IF _approve THEN
    SELECT p.display_name INTO _name FROM public.profiles p WHERE p.user_id = auth.uid();
    _base := round(COALESCE(_s.total_cost, 0), 2);
    _q := public.pricing_breakdown(_base);
    _grand := (_q ->> 'total')::numeric;
    UPDATE public.ticket_timesheet_submissions
       SET status = 'signed', signed_at = now(), signed_by_name = COALESCE(NULLIF(btrim(_name), ''), 'Client'), signature_method = 'in_app',
           vat_percent = (_q ->> 'vat_percent')::numeric, vat_amount = (_q ->> 'vat')::numeric, grand_total = _grand,
           service_fee_percent = (_q ->> 'service_fee_percent')::numeric, service_fee_amount = (_q ->> 'service_fee')::numeric,
           processing_fee_percent = (_q ->> 'processing_fee_percent')::numeric, processing_fee_amount = (_q ->> 'processing_fee')::numeric
     WHERE id = _s.id;
    IF _n <> '' THEN
      INSERT INTO public.ticket_timesheet_comments (submission_id, author_id, author_role, kind, body) VALUES (_s.id, auth.uid(), 'client', 'approval', _n);
    END IF;
    -- bill the approved hours (only for hours filed by a consultant): fee + service fee + processing fee + VAT
    SELECT c.id INTO _cons FROM public.consultants c WHERE c.user_id = _s.submitted_by;
    IF _cons IS NOT NULL AND _base > 0 THEN
      INSERT INTO public.payments (client_id, consultant_id, ticket_id, timesheet_id, amount, vat_amount, currency, status, kind, description, due_date, payment_method,
                                   pricing_model, base_amount, service_fee_percent, service_fee_amount, processing_fee_percent, processing_fee_amount, vat_percent)
      VALUES (_s.client_id, _cons, _s.ticket_id, _s.id, _grand, (_q ->> 'vat')::numeric, _cur, 'pending', 'invoice',
              'Timesheet: ' || public.ts_num(_billed) || ' h on "' || _title || '"', now() + interval '14 days', 'bank_transfer',
              'v2', _base, (_q ->> 'service_fee_percent')::numeric, (_q ->> 'service_fee')::numeric,
              (_q ->> 'processing_fee_percent')::numeric, (_q ->> 'processing_fee')::numeric, (_q ->> 'vat_percent')::numeric)
      ON CONFLICT (timesheet_id) WHERE timesheet_id IS NOT NULL DO NOTHING;
      IF FOUND THEN
        PERFORM public.safe_insert_notification(auth.uid(), 'Invoice created',
          'An invoice of ' || public.ts_num(_grand) || ' ' || _cur || ' was created for the approved timesheet: the consultant fee of '
            || public.ts_num(_base) || ' ' || _cur || ' plus the platform and payment fees plus VAT. Open Payments & Invoices to pay.', 'payment', '/client/payments');
      END IF;
    END IF;
  ELSE
    UPDATE public.ticket_timesheet_submissions SET status = 'changes_requested' WHERE id = _s.id;
    INSERT INTO public.ticket_timesheet_comments (submission_id, author_id, author_role, kind, body) VALUES (_s.id, auth.uid(), 'client', 'change_request', _n);
  END IF;
  IF _s.submitted_by IS DISTINCT FROM auth.uid() THEN
    PERFORM public.safe_insert_notification(_s.submitted_by,
      CASE WHEN _approve THEN 'Timesheet approved' ELSE 'Timesheet needs changes' END,
      CASE WHEN _approve
           THEN 'The client approved your timesheet (' || public.ts_num(_billed) || ' h, ' || public.ts_num(round(COALESCE(_s.total_cost, 0), 2)) || ' ' || _cur || ') on "' || _title
                || '". Your fee is paid out after the client has paid the invoice.'
           ELSE 'The client asked for changes on "' || _title || '": ' || left(_n, 200)
      END,
      'ticket', '/consultant/tickets/' || _s.ticket_id::text);
  END IF;
END;
$function$;

-- ================================================================== 6. a payment is confirmed: the payout is the consultant fee
CREATE OR REPLACE FUNCTION public.admin_confirm_payment(_payment_id uuid, _bank_reference text, _received_amount numeric DEFAULT NULL::numeric, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _pct numeric;
  _recv numeric;
  _base numeric;
  _comm numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an administrator can confirm a payment' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = '42704';
  END IF;
  IF _p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'This payment is already %', _p.status::text USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(_bank_reference, '')) = '' THEN
    RAISE EXCEPTION 'Enter the bank reference of the incoming transfer' USING ERRCODE = '22023';
  END IF;
  _recv := COALESCE(_received_amount, _p.amount);
  IF _recv < _p.amount THEN
    RAISE EXCEPTION 'The amount received is lower than the invoice amount' USING ERRCODE = '22023';
  END IF;
  IF _p.consultant_id IS NOT NULL AND _p.kind = 'invoice' AND _p.pricing_model <> 'v2' THEN
    _pct := public.payment_commission_percent();
    IF _pct IS NULL THEN
      RAISE EXCEPTION 'Set the platform commission first (Payments, Settings)' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.payments
  SET status = 'completed', paid_at = now(), confirmed_by = auth.uid(), bank_reference = left(btrim(_bank_reference), 120),
      received_amount = _recv, rejection_note = NULL, payment_method = COALESCE(payment_method, 'bank_transfer')
  WHERE id = _p.id;
  IF _p.consultant_id IS NOT NULL AND _p.kind = 'invoice' THEN
    IF _p.pricing_model = 'v2' THEN
      -- the consultant gets the whole fee; the service fee is the income of the portal, the processing fee pays the card provider
      INSERT INTO public.payouts (consultant_id, amount, currency, status, reference, payment_id, gross_amount, commission_percent, commission_amount)
      VALUES (_p.consultant_id, _p.base_amount, COALESCE(_p.currency, 'USD'), 'pending', 'payment:' || _p.id::text, _p.id, _p.base_amount, 0, 0);
    ELSE
      _base := _p.amount - COALESCE(_p.vat_amount, 0);
      _comm := round(_base * _pct / 100, 2);
      INSERT INTO public.payouts (consultant_id, amount, currency, status, reference, payment_id, gross_amount, commission_percent, commission_amount)
      VALUES (_p.consultant_id, _base - _comm, COALESCE(_p.currency, 'USD'), 'pending', 'payment:' || _p.id::text, _p.id, _base, _pct, _comm);
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_provider_payment(_provider text, _order_id text, _transaction_id text, _kind text, _amount numeric, _currency text, _source text DEFAULT 'webhook'::text, _payload jsonb DEFAULT '{}'::jsonb)
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
      ELSIF _p.consultant_id IS NOT NULL AND _p.kind = 'invoice' AND _p.pricing_model <> 'v2' AND public.payment_commission_percent() IS NULL THEN
        _result := 'error';
        _detail := 'the platform commission is not set';
      ELSE
        UPDATE public.payments
        SET status = 'completed', paid_at = now(), provider = _provider, provider_transaction_id = _transaction_id, provider_status = 'paid',
            payment_method = 'card', bank_reference = left(_provider || ' ' || _transaction_id, 120), received_amount = _amount, rejection_note = NULL
        WHERE id = _pid;
        IF _p.consultant_id IS NOT NULL AND _p.kind = 'invoice' THEN
          IF _p.pricing_model = 'v2' THEN
            INSERT INTO public.payouts (consultant_id, amount, currency, status, reference, payment_id, gross_amount, commission_percent, commission_amount)
            VALUES (_p.consultant_id, _p.base_amount, COALESCE(_p.currency, 'USD'), 'pending', 'payment:' || _p.id::text, _p.id, _p.base_amount, 0, 0);
          ELSE
            _pct := public.payment_commission_percent();
            _base := _p.amount - COALESCE(_p.vat_amount, 0);
            _comm := round(_base * _pct / 100, 2);
            INSERT INTO public.payouts (consultant_id, amount, currency, status, reference, payment_id, gross_amount, commission_percent, commission_amount)
            VALUES (_p.consultant_id, _base - _comm, COALESCE(_p.currency, 'USD'), 'pending', 'payment:' || _p.id::text, _p.id, _base, _pct, _comm);
          END IF;
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

CREATE OR REPLACE FUNCTION public.card_payment_context(_payment_id uuid, _user_id uuid)
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
  IF _p.consultant_id IS NOT NULL AND _p.pricing_model <> 'v2' AND public.payment_commission_percent() IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.notify_payment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Payment Confirmed',
      'Your payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || ' (invoice ' || COALESCE(NEW.invoice_number, NEW.reference, '') || ') was confirmed.',
      'payment',
      '/client/payments'
    );
    SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
    IF _consultant_user_id IS NOT NULL AND NEW.kind = 'invoice' THEN
      INSERT INTO public.notifications (user_id, title, body, type, link)
      VALUES (
        _consultant_user_id,
        'Client payment received',
        CASE WHEN NEW.pricing_model = 'v2'
             THEN 'The platform received the client''s payment for invoice ' || COALESCE(NEW.invoice_number, NEW.reference, '') || '. Your fee of ' || NEW.base_amount || ' ' || COALESCE(NEW.currency, 'USD') || ' is prepared for payout by the administrator.'
             ELSE 'The platform received the client''s payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || '. Your payout, after the platform commission, is prepared by the administrator.'
        END,
        'payment',
        '/consultant/earnings'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ================================================================== 7. consultant work is billed through the approved timesheet only
CREATE OR REPLACE FUNCTION public.send_ticket_invoice(_ticket_id uuid, _lines jsonb, _vat_percent numeric, _currency text, _timesheet_id uuid, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Invoices are created automatically when the client approves your timesheet. Submit the hours in the timesheet of the ticket.' USING ERRCODE = '42501';
END $function$;

-- ================================================================== 8. subscription plans are off unless the administrator switches them on
CREATE OR REPLACE FUNCTION public.client_subscribe_plan(_plan_id uuid, _tickets integer, _voucher_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q jsonb; vid uuid; sub_id uuid; pay_id uuid; final numeric; free_m integer; pname text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NOT public.has_role(auth.uid(),'client') THEN RAISE EXCEPTION 'Only clients can subscribe'; END IF;
  IF NOT COALESCE((SELECT lower(ps.value #>> '{}') = 'true' FROM public.platform_settings ps WHERE ps.key = 'subscription_plans_enabled' LIMIT 1), false) THEN
    RAISE EXCEPTION 'Subscription plans are not offered. You pay for the hours of each timesheet that you approve.' USING ERRCODE = '55000';
  END IF;
  IF NULLIF(btrim(_voucher_code),'') IS NOT NULL THEN
    PERFORM 1 FROM vouchers WHERE code = upper(btrim(_voucher_code)) FOR UPDATE;
  END IF;
  q := public.quote_plan_price(_plan_id, _tickets, _voucher_code);
  IF q->>'voucher_error' IS NOT NULL THEN RAISE EXCEPTION '%', q->>'voucher_error'; END IF;
  vid := (q->>'voucher_id')::uuid; final := (q->>'final')::numeric; free_m := (q->>'free_months')::integer;
  SELECT name INTO pname FROM subscription_plans WHERE id = _plan_id;
  IF free_m = 0 AND final > 0 THEN
    INSERT INTO payments (client_id, amount, vat_amount, currency, status, kind, description, due_date, payment_method)
    VALUES (auth.uid(), final, 0, q->>'currency', 'pending', 'subscription',
      format('%s plan — up to %s tickets/month (first month)', pname, _tickets), now() + interval '7 days', 'bank_transfer')
    RETURNING id INTO pay_id;
  END IF;
  INSERT INTO client_plan_subscriptions (client_id, plan_id, tickets_per_month, base_monthly_price, voucher_id, discount_amount, final_monthly_price, free_until, payment_id, status)
  VALUES (auth.uid(), _plan_id, _tickets, (q->>'base')::numeric, vid, (q->>'discount')::numeric, final,
    CASE WHEN free_m > 0 THEN now() + make_interval(months => free_m) END, pay_id,
    CASE WHEN pay_id IS NULL THEN 'active' ELSE 'pending' END)
  RETURNING id INTO sub_id;
  IF vid IS NOT NULL THEN UPDATE vouchers SET used_count = used_count + 1, updated_at = now() WHERE id = vid; END IF;
  RETURN sub_id;
END $function$;

-- the price of a plan without a voucher stopped with "record v is not assigned yet" (v.id was read although no voucher was looked up)
CREATE OR REPLACE FUNCTION public.quote_plan_price(_plan_id uuid, _tickets integer, _voucher_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p record; v record; t jsonb; base numeric; disc numeric := 0; free_m integer := 0; msg text := NULL; vid uuid := NULL;
BEGIN
  IF _tickets IS NULL OR _tickets < 1 OR _tickets > 100000 THEN RAISE EXCEPTION 'Enter a ticket count of at least 1'; END IF;
  SELECT * INTO p FROM subscription_plans WHERE id = _plan_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not available'; END IF;
  base := p.price_monthly;
  IF jsonb_array_length(COALESCE(p.ticket_tiers,'[]'::jsonb)) > 0 THEN
    base := NULL;
    FOR t IN SELECT * FROM jsonb_array_elements(p.ticket_tiers) LOOP
      IF _tickets >= (t->>'min')::numeric AND (t->>'max' IS NULL OR _tickets <= (t->>'max')::numeric) THEN
        base := (t->>'price')::numeric; EXIT;
      END IF;
    END LOOP;
    IF base IS NULL THEN RAISE EXCEPTION 'No price range covers % tickets on this plan', _tickets; END IF;
  END IF;
  IF NULLIF(btrim(_voucher_code),'') IS NOT NULL THEN
    SELECT * INTO v FROM vouchers WHERE code = upper(btrim(_voucher_code));
    IF NOT FOUND OR NOT v.is_active THEN msg := 'Voucher code is not valid';
    ELSIF v.expires_at IS NOT NULL AND v.expires_at < now() THEN msg := 'Voucher has expired';
    ELSIF v.max_uses IS NOT NULL AND v.used_count >= v.max_uses THEN msg := 'Voucher has been fully used';
    ELSIF v.plan_id IS NOT NULL AND v.plan_id <> _plan_id THEN msg := 'Voucher does not apply to this plan';
    ELSIF v.discount_type = 'percent' THEN disc := round(base * v.value / 100, 2); vid := v.id;
    ELSIF v.discount_type = 'fixed' THEN disc := LEAST(v.value, base); vid := v.id;
    ELSE free_m := v.value::integer; vid := v.id;
    END IF;
  END IF;
  RETURN jsonb_build_object('base', base, 'discount', disc, 'final', base - disc, 'free_months', free_m,
    'currency', COALESCE(p.currency,'USD'), 'voucher_id', vid, 'voucher_error', msg);
END $function$;

-- ================================================================== 9. who may run what (new functions get the default grants: close them first)
REVOKE ALL ON FUNCTION public.payment_service_fee_percent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payment_processing_fee_percent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pricing_breakdown(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_service_fee_percent() TO service_role;
GRANT EXECUTE ON FUNCTION public.payment_processing_fee_percent() TO service_role;
GRANT EXECUTE ON FUNCTION public.pricing_breakdown(numeric) TO service_role;
REVOKE ALL ON FUNCTION public.pricing_terms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing_terms() TO anon, authenticated, service_role;