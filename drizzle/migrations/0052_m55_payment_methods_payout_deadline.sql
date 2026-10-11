-- M55: payment methods and the payout deadline.
-- Cards (Visa and Mastercard) are the main way to pay. Bank transfer is a permission that only an administrator gives, to a whole company or to one invoice.
-- While the card switch (platform_settings.card_payments_enabled) is OFF, bank transfer stays open for everybody, so nobody is blocked before cards are live.
-- The platform pays the consultant within 15 business days (Sunday to Thursday) after it received the client's payment: every payout gets a due date.
-- Nothing that exists is removed. Changed: the two bank-transfer functions, the notice to the consultant, and one new column of payouts.

-- 1. who may pay by bank transfer: a whole company, or one invoice (the rows exist only while the permission is given)
CREATE TABLE IF NOT EXISTS public.bank_transfer_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  note text,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_transfer_permissions_note_len CHECK (char_length(COALESCE(note, '')) <= 300)
);

CREATE TABLE IF NOT EXISTS public.invoice_bank_transfer_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  note text,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_bank_transfer_grants_note_len CHECK (char_length(COALESCE(note, '')) <= 300)
);

-- every change (also a withdrawal) is written down; nobody can edit or delete these rows
CREATE TABLE IF NOT EXISTS public.bank_transfer_permission_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('company', 'invoice')),
  tenant_id uuid,
  payment_id uuid,
  allowed boolean NOT NULL,
  note text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_transfer_permission_log_note_len CHECK (char_length(COALESCE(note, '')) <= 300)
);

-- the bank account that clients pay into: the platform account (platform_settings.platform_bank_details) is used for every invoice,
-- unless the administrator gave one invoice an account of its own. Only administrators read these tables; a client gets the account
-- of its own open invoice through get_payment_instructions (and only when it may pay by bank transfer).
CREATE TABLE IF NOT EXISTS public.invoice_bank_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  details jsonb NOT NULL,
  note text,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_bank_accounts_object CHECK (jsonb_typeof(details) = 'object'),
  CONSTRAINT invoice_bank_accounts_note_len CHECK (char_length(COALESCE(note, '')) <= 300)
);

-- every change of an account is written down without the full number (for example "IBAN ending 7001"); nobody can edit or delete these rows
CREATE TABLE IF NOT EXISTS public.bank_account_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('all', 'invoice')),
  payment_id uuid,
  action text NOT NULL CHECK (action IN ('set', 'removed')),
  summary text,
  note text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_account_change_log_text_len CHECK (char_length(COALESCE(summary, '')) <= 300 AND char_length(COALESCE(note, '')) <= 300)
);

ALTER TABLE public.bank_transfer_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_bank_transfer_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transfer_permission_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_change_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bank_transfer_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invoice_bank_transfer_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bank_transfer_permission_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invoice_bank_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bank_account_change_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bank_transfer_permissions TO authenticated;
GRANT SELECT ON TABLE public.invoice_bank_transfer_grants TO authenticated;
GRANT SELECT ON TABLE public.bank_transfer_permission_log TO authenticated;
GRANT SELECT ON TABLE public.invoice_bank_accounts TO authenticated;
GRANT SELECT ON TABLE public.bank_account_change_log TO authenticated;

DROP POLICY IF EXISTS "Administrators read the invoice bank accounts" ON public.invoice_bank_accounts;
CREATE POLICY "Administrators read the invoice bank accounts"
  ON public.invoice_bank_accounts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Administrators read the bank account change log" ON public.bank_account_change_log;
CREATE POLICY "Administrators read the bank account change log"
  ON public.bank_account_change_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Administrators read the bank transfer permissions" ON public.bank_transfer_permissions;
CREATE POLICY "Administrators read the bank transfer permissions"
  ON public.bank_transfer_permissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Administrators read the invoice bank transfer grants" ON public.invoice_bank_transfer_grants;
CREATE POLICY "Administrators read the invoice bank transfer grants"
  ON public.invoice_bank_transfer_grants
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Administrators read the bank transfer permission log" ON public.bank_transfer_permission_log;
CREATE POLICY "Administrators read the bank transfer permission log"
  ON public.bank_transfer_permission_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS audit_bank_transfer_permissions ON public.bank_transfer_permissions;
CREATE TRIGGER audit_bank_transfer_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.bank_transfer_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

DROP TRIGGER IF EXISTS audit_invoice_bank_transfer_grants ON public.invoice_bank_transfer_grants;
CREATE TRIGGER audit_invoice_bank_transfer_grants
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_bank_transfer_grants
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- 2. business days: Friday and Saturday are the weekend, public holidays are not excluded
CREATE OR REPLACE FUNCTION public.add_business_days(_from date, _days integer)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _d date := _from;
  _left integer := GREATEST(COALESCE(_days, 0), 0);
BEGIN
  IF _from IS NULL THEN
    RETURN NULL;
  END IF;
  IF _left > 3650 THEN
    RAISE EXCEPTION 'Too many days' USING ERRCODE = '22023';
  END IF;
  WHILE _left > 0 LOOP
    _d := _d + 1;
    IF EXTRACT(DOW FROM _d) NOT IN (5, 6) THEN
      _left := _left - 1;
    END IF;
  END LOOP;
  RETURN _d;
END;
$function$;

-- the day by which the platform pays the consultant: 15 business days after the client's payment was received
CREATE OR REPLACE FUNCTION public.payout_due_date(_received date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT public.add_business_days(_received, 15)
$function$;

-- 3. every payout gets its due date when it is created (a payout that is created with a date keeps it)
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS due_by date;

CREATE OR REPLACE FUNCTION public.payouts_set_due_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.due_by IS NULL THEN
    NEW.due_by := public.payout_due_date((now() AT TIME ZONE 'Africa/Cairo')::date);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_payouts_set_due_by ON public.payouts;
CREATE TRIGGER trg_payouts_set_due_by
  BEFORE INSERT ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.payouts_set_due_by();

-- the payouts that exist already: counted from the day they were created
UPDATE public.payouts
SET due_by = public.payout_due_date((created_at AT TIME ZONE 'Africa/Cairo')::date)
WHERE due_by IS NULL;

-- 4. may this invoice be paid by bank transfer? Yes when cards are off (nobody is blocked), or the administrator allowed the company or the invoice.
-- An invoice that comes from a ticket belongs to the company of the ticket. An invoice without a ticket (made by hand) has no company:
-- then the company of the client counts (the client is a member of a company that was allowed).
CREATE OR REPLACE FUNCTION public.bank_transfer_company_allowed(_payment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = _payment_id
      AND (
        (p.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bank_transfer_permissions t WHERE t.tenant_id = p.tenant_id))
        OR (p.tenant_id IS NULL AND EXISTS (SELECT 1 FROM public.tenant_members m JOIN public.bank_transfer_permissions t ON t.tenant_id = m.tenant_id WHERE m.user_id = p.client_id))
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.bank_transfer_available(_payment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT public.card_payments_enabled()
      OR EXISTS (SELECT 1 FROM public.invoice_bank_transfer_grants g WHERE g.payment_id = _payment_id)
      OR public.bank_transfer_company_allowed(_payment_id)
$function$;

-- what the client sees for one invoice: the ways to pay
CREATE OR REPLACE FUNCTION public.get_payment_methods(_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _cards boolean := public.card_payments_enabled();
  _why text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.client_id, p.tenant_id INTO _p FROM public.payments p WHERE p.id = _payment_id;
  IF NOT FOUND OR NOT (_p.client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
  END IF;
  _why := CASE
    WHEN NOT _cards THEN 'cards_off'
    WHEN EXISTS (SELECT 1 FROM public.invoice_bank_transfer_grants g WHERE g.payment_id = _p.id) THEN 'invoice'
    WHEN public.bank_transfer_company_allowed(_p.id) THEN 'company'
    ELSE NULL
  END;
  RETURN jsonb_build_object('card', _cards, 'bank_transfer', _why IS NOT NULL, 'bank_transfer_reason', _why);
END;
$function$;

-- the bank account is shown only to an administrator and to the client of an open invoice that may be paid by bank transfer (nobody else, a consultant included).
-- With the id of an invoice: the account of that invoice (its own account when the administrator set one, else the platform account).
-- Without an id (older screens): the platform account, but not while an open invoice of the client has an account of its own (that screen could show the wrong one).
DROP FUNCTION IF EXISTS public.get_payment_instructions();

CREATE OR REPLACE FUNCTION public.get_payment_instructions(_payment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _default jsonb;
  _own jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT ps.value INTO _default FROM public.platform_settings ps WHERE ps.key = 'platform_bank_details' LIMIT 1;
  IF _payment_id IS NOT NULL THEN
    IF public.has_role(auth.uid(), 'admin'::app_role)
       OR EXISTS (SELECT 1 FROM public.payments p WHERE p.id = _payment_id AND p.client_id = auth.uid() AND p.status::text = 'pending' AND public.bank_transfer_available(p.id)) THEN
      SELECT a.details INTO _own FROM public.invoice_bank_accounts a WHERE a.payment_id = _payment_id;
      RETURN COALESCE(_own, _default);
    END IF;
    RETURN NULL;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN _default;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.client_id = auth.uid() AND p.status::text = 'pending' AND public.bank_transfer_available(p.id))
     AND NOT EXISTS (SELECT 1 FROM public.payments p JOIN public.invoice_bank_accounts a ON a.payment_id = p.id
                     WHERE p.client_id = auth.uid() AND p.status::text = 'pending' AND public.bank_transfer_available(p.id)) THEN
    RETURN _default;
  END IF;
  RETURN NULL;
END;
$function$;

-- a client can report a bank transfer only for an invoice that may be paid that way
CREATE OR REPLACE FUNCTION public.client_report_payment(_payment_id uuid, _transfer_reference text, _transfer_date date, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _admin record;
  _ref text := left(btrim(COALESCE(_transfer_reference, '')), 120);
  _n text := left(btrim(COALESCE(_note, '')), 500);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT p.id, p.status, p.amount, p.currency, p.invoice_number, p.reference INTO _p
  FROM public.payments p WHERE p.id = _payment_id AND p.client_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
  END IF;
  IF _p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'Only an open invoice can be reported as paid' USING ERRCODE = '42501';
  END IF;
  IF NOT public.bank_transfer_available(_p.id) THEN
    RAISE EXCEPTION 'Bank transfer is not enabled for this invoice. Pay by card, or ask the platform administrator to allow bank transfer for your company.' USING ERRCODE = '42501';
  END IF;
  IF _ref = '' THEN
    RAISE EXCEPTION 'Enter the reference of your bank transfer' USING ERRCODE = '22023';
  END IF;
  IF _transfer_date IS NULL OR _transfer_date > current_date + 1 OR _transfer_date < current_date - 90 THEN
    RAISE EXCEPTION 'Enter the date of the transfer (within the last 90 days)' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('payment-report:' || auth.uid()::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many reports in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  UPDATE public.payments
  SET client_reported_at = now(), client_transfer_reference = _ref, client_transfer_date = _transfer_date,
      client_note = NULLIF(_n, ''), rejection_note = NULL
  WHERE id = _p.id;
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin.user_id, 'Payment reported',
      'A client reported a bank transfer of ' || _p.amount::text || ' ' || COALESCE(_p.currency, 'USD') || ' for invoice ' || COALESCE(_p.invoice_number, _p.reference, '') || '. Check the bank account and confirm it.',
      'payment', '/admin/payments');
  END LOOP;
END;
$function$;

-- 5. the administrator gives or withdraws the permission
CREATE OR REPLACE FUNCTION public.admin_set_company_bank_transfer(_tenant_id uuid, _allowed boolean, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _owner record;
  _n text := left(btrim(COALESCE(_note, '')), 300);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an administrator can change who may pay by bank transfer' USING ERRCODE = '42501';
  END IF;
  IF _allowed IS NULL THEN
    RAISE EXCEPTION 'Choose allow or do not allow' USING ERRCODE = '22023';
  END IF;
  SELECT t.id, t.name INTO _t FROM public.tenants t WHERE t.id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found' USING ERRCODE = '42704';
  END IF;
  IF _allowed THEN
    INSERT INTO public.bank_transfer_permissions (tenant_id, note, granted_by, granted_at)
    VALUES (_t.id, NULLIF(_n, ''), auth.uid(), now())
    ON CONFLICT (tenant_id) DO UPDATE SET note = EXCLUDED.note, granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at;
  ELSE
    DELETE FROM public.bank_transfer_permissions WHERE tenant_id = _t.id;
  END IF;
  INSERT INTO public.bank_transfer_permission_log (scope, tenant_id, allowed, note, changed_by)
  VALUES ('company', _t.id, _allowed, NULLIF(_n, ''), auth.uid());
  FOR _owner IN SELECT m.user_id FROM public.tenant_members m WHERE m.tenant_id = _t.id AND m.org_role = 'owner' LOOP
    PERFORM public.safe_insert_notification(_owner.user_id,
      CASE WHEN _allowed THEN 'Bank transfer is available' ELSE 'Bank transfer is switched off' END,
      CASE WHEN _allowed THEN 'The platform administrator allowed bank transfer for the invoices of ' || _t.name || '. You can choose it when you pay an invoice.'
           ELSE 'Bank transfer is no longer available for the invoices of ' || _t.name || '. You can pay by card.' END,
      'payment', '/client/payments');
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_invoice_bank_transfer(_payment_id uuid, _allowed boolean, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _n text := left(btrim(COALESCE(_note, '')), 300);
  _label text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an administrator can change who may pay by bank transfer' USING ERRCODE = '42501';
  END IF;
  IF _allowed IS NULL THEN
    RAISE EXCEPTION 'Choose allow or do not allow' USING ERRCODE = '22023';
  END IF;
  SELECT p.id, p.client_id, p.tenant_id, p.status, p.invoice_number, p.reference INTO _p FROM public.payments p WHERE p.id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42704';
  END IF;
  IF _allowed AND _p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'Bank transfer can only be allowed for an open invoice' USING ERRCODE = '42501';
  END IF;
  _label := COALESCE(_p.invoice_number, _p.reference, _p.id::text);
  IF _allowed THEN
    INSERT INTO public.invoice_bank_transfer_grants (payment_id, note, granted_by, granted_at)
    VALUES (_p.id, NULLIF(_n, ''), auth.uid(), now())
    ON CONFLICT (payment_id) DO UPDATE SET note = EXCLUDED.note, granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at;
  ELSE
    DELETE FROM public.invoice_bank_transfer_grants WHERE payment_id = _p.id;
  END IF;
  INSERT INTO public.bank_transfer_permission_log (scope, tenant_id, payment_id, allowed, note, changed_by)
  VALUES ('invoice', _p.tenant_id, _p.id, _allowed, NULLIF(_n, ''), auth.uid());
  IF _p.client_id IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_p.client_id,
      CASE WHEN _allowed THEN 'Bank transfer is available' ELSE 'Bank transfer is switched off' END,
      CASE WHEN _allowed THEN 'The platform administrator allowed bank transfer for invoice ' || _label || '. Open the invoice to see the bank details.'
           ELSE 'Bank transfer is no longer available for invoice ' || _label || '. You can pay by card.' END,
      'payment', '/client/payments');
  END IF;
END;
$function$;

-- 6. the notice to the consultant says when the platform pays
CREATE OR REPLACE FUNCTION public.notify_payment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
  _due text;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    _due := trim(to_char(public.payout_due_date((COALESCE(NEW.paid_at, now()) AT TIME ZONE 'Africa/Cairo')::date), 'Mon FMDD, YYYY'));
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      NEW.client_id,
      'Payment Confirmed',
      'Your payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || ' (invoice ' || COALESCE(NEW.invoice_number, NEW.reference, '') || ') was confirmed.',
      'payment',
      '/client/payments',
      NEW.tenant_id
    );
    SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
    IF _consultant_user_id IS NOT NULL AND NEW.kind = 'invoice' THEN
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (
        _consultant_user_id,
        'Client payment received',
        CASE WHEN NEW.pricing_model = 'v2'
          THEN 'The platform received the client''s payment for invoice ' || COALESCE(NEW.invoice_number, NEW.reference, '') || '. Your fee of ' || NEW.base_amount || ' ' || COALESCE(NEW.currency, 'USD') || ' is prepared for payout. You will be paid within 15 business days, by ' || _due || '.'
          ELSE 'The platform received the client''s payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || '. Your payout, after the platform commission, is prepared. You will be paid within 15 business days, by ' || _due || '.'
        END,
        'payment',
        '/consultant/earnings',
        NEW.tenant_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- the invoice that an administrator makes by hand: the notice no longer promises bank details (a client pays by card; bank details are shown only to who may use them)
CREATE OR REPLACE FUNCTION public.admin_create_invoice(_client_id uuid, _consultant_id uuid, _ticket_id uuid, _amount numeric, _currency text, _description text, _vat_amount numeric DEFAULT 0, _due_days integer DEFAULT 14)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _cur text := upper(btrim(COALESCE(_currency, '')));
  _d text := left(btrim(COALESCE(_description, '')), 300);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an administrator can create an invoice' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 10000000 THEN
    RAISE EXCEPTION 'The amount must be between 0.01 and 10,000,000' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_vat_amount, 0) < 0 OR COALESCE(_vat_amount, 0) > _amount THEN
    RAISE EXCEPTION 'The VAT amount must be between 0 and the invoice amount' USING ERRCODE = '22023';
  END IF;
  IF _cur !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'The currency must be a 3-letter code such as USD' USING ERRCODE = '22023';
  END IF;
  IF char_length(_d) < 3 THEN
    RAISE EXCEPTION 'Describe what the invoice is for' USING ERRCODE = '22023';
  END IF;
  IF _due_days IS NULL OR _due_days < 1 OR _due_days > 180 THEN
    RAISE EXCEPTION 'The payment term must be between 1 and 180 days' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _client_id) THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = '42704';
  END IF;
  IF _consultant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _consultant_id) THEN
    RAISE EXCEPTION 'Consultant not found' USING ERRCODE = '42704';
  END IF;
  IF _ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = _client_id) THEN
    RAISE EXCEPTION 'The ticket does not belong to this client' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payments (client_id, consultant_id, ticket_id, amount, vat_amount, currency, status, kind, description, due_date, payment_method)
  VALUES (_client_id, _consultant_id, _ticket_id, _amount, COALESCE(_vat_amount, 0), _cur, 'pending', 'invoice', _d, now() + make_interval(days => _due_days), 'bank_transfer')
  RETURNING id INTO _id;
  PERFORM public.safe_insert_notification(_client_id, 'New invoice',
    'An invoice of ' || _amount::text || ' ' || _cur || ' is ready. Open Payments & Invoices to pay it.', 'payment', '/client/payments');
  RETURN _id;
END;
$function$;

-- 6b. the bank account of one invoice, and the history of the changes of the accounts
-- a short description of an account for the history (never the full number)
CREATE OR REPLACE FUNCTION public.bank_account_summary(_details jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT left(concat_ws(', ',
    NULLIF(btrim(_details ->> 'beneficiary'), ''),
    NULLIF(btrim(_details ->> 'bank_name'), ''),
    CASE WHEN COALESCE(_details ->> 'iban', '') <> '' THEN 'IBAN ending ' || right(regexp_replace(_details ->> 'iban', '\s', '', 'g'), 4)
         WHEN COALESCE(_details ->> 'account_number', '') <> '' THEN 'account ending ' || right(regexp_replace(_details ->> 'account_number', '\s', '', 'g'), 4)
    END), 300)
$function$;

-- the account of an invoice: the same details as the platform account; the account holder and the IBAN or the account number are required
CREATE OR REPLACE FUNCTION public.clean_bank_account(_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _allowed text[] := ARRAY['beneficiary', 'bank_name', 'iban', 'account_number', 'swift', 'currency', 'country', 'instructions'];
  _k text;
  _v text;
  _out jsonb := '{}'::jsonb;
BEGIN
  IF _details IS NULL OR jsonb_typeof(_details) <> 'object' THEN
    RAISE EXCEPTION 'The bank details must be an object' USING ERRCODE = '22023';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_details) LOOP
    IF NOT (_k = ANY (_allowed)) THEN
      RAISE EXCEPTION 'Unknown bank detail: %', _k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_details -> _k) <> 'string' THEN
      RAISE EXCEPTION 'Each bank detail must be text' USING ERRCODE = '22023';
    END IF;
    _v := btrim(_details ->> _k);
    IF char_length(_v) > 1000 THEN
      RAISE EXCEPTION 'Each bank detail must be at most 1000 characters' USING ERRCODE = '22023';
    END IF;
    IF _k <> 'instructions' AND _v ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'A control character is not allowed in a bank detail' USING ERRCODE = '22023';
    END IF;
    IF _v <> '' THEN
      _out := _out || jsonb_build_object(_k, CASE WHEN _k = 'currency' THEN upper(_v) ELSE _v END);
    END IF;
  END LOOP;
  IF char_length(COALESCE(_out ->> 'iban', '')) > 42 OR char_length(COALESCE(_out ->> 'swift', '')) > 11
     OR char_length(COALESCE(_out ->> 'account_number', '')) > 40
     OR char_length(COALESCE(_out ->> 'beneficiary', '')) > 120 OR char_length(COALESCE(_out ->> 'bank_name', '')) > 120 THEN
    RAISE EXCEPTION 'A bank detail is too long' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_out ->> 'currency', '') <> '' AND (_out ->> 'currency') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'The currency must be a 3-letter code such as USD' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_out ->> 'beneficiary', '') = '' OR (COALESCE(_out ->> 'iban', '') = '' AND COALESCE(_out ->> 'account_number', '') = '') THEN
    RAISE EXCEPTION 'Enter the account holder and the IBAN or the account number' USING ERRCODE = '22023';
  END IF;
  RETURN _out;
END;
$function$;

-- the administrator gives one invoice an account of its own, or takes it away again (empty details: the invoice uses the platform account)
CREATE OR REPLACE FUNCTION public.admin_set_invoice_bank_account(_payment_id uuid, _details jsonb, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _clean jsonb;
  _n text := left(btrim(COALESCE(_note, '')), 300);
  _label text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an administrator can change the bank account of an invoice' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.client_id, p.status, p.invoice_number, p.reference INTO _p FROM public.payments p WHERE p.id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42704';
  END IF;
  _label := COALESCE(_p.invoice_number, _p.reference, _p.id::text);
  IF _details IS NULL OR _details = '{}'::jsonb THEN
    DELETE FROM public.invoice_bank_accounts WHERE payment_id = _p.id;
    IF FOUND THEN
      INSERT INTO public.bank_account_change_log (scope, payment_id, action, summary, note, changed_by)
      VALUES ('invoice', _p.id, 'removed', 'the invoice uses the platform account again', NULLIF(_n, ''), auth.uid());
      IF _p.client_id IS NOT NULL AND _p.status::text = 'pending' THEN
        PERFORM public.safe_insert_notification(_p.client_id, 'Bank details updated',
          'The bank details for invoice ' || _label || ' were updated. Open the invoice and use the details shown there.', 'payment', '/client/payments');
      END IF;
    END IF;
    RETURN;
  END IF;
  IF _p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'The bank account can only be changed for an open invoice' USING ERRCODE = '42501';
  END IF;
  _clean := public.clean_bank_account(_details);
  INSERT INTO public.invoice_bank_accounts (payment_id, details, note, set_by, set_at)
  VALUES (_p.id, _clean, NULLIF(_n, ''), auth.uid(), now())
  ON CONFLICT (payment_id) DO UPDATE SET details = EXCLUDED.details, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
  INSERT INTO public.bank_account_change_log (scope, payment_id, action, summary, note, changed_by)
  VALUES ('invoice', _p.id, 'set', public.bank_account_summary(_clean), NULLIF(_n, ''), auth.uid());
  IF _p.client_id IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_p.client_id, 'Bank details updated',
      'The bank details for invoice ' || _label || ' were updated. Open the invoice and use the details shown there.', 'payment', '/client/payments');
  END IF;
END;
$function$;

-- a change of the platform account (the one for all invoices) is written down, and the clients who have an open invoice that uses it are told
CREATE OR REPLACE FUNCTION public.platform_bank_details_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.bank_account_change_log (scope, action, summary, changed_by)
  VALUES ('all', 'set', public.bank_account_summary(NEW.value), auth.uid());
  FOR _c IN
    SELECT DISTINCT p.client_id FROM public.payments p
    WHERE p.status::text = 'pending' AND p.client_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoice_bank_accounts a WHERE a.payment_id = p.id)
      AND public.bank_transfer_available(p.id)
  LOOP
    PERFORM public.safe_insert_notification(_c.client_id, 'Bank details updated',
      'The bank details for paying your open invoices by bank transfer were updated. Always use the details shown on the invoice.', 'payment', '/client/payments');
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_platform_bank_details_changed ON public.platform_settings;
CREATE TRIGGER trg_platform_bank_details_changed
  AFTER INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW WHEN (NEW.key = 'platform_bank_details')
  EXECUTE FUNCTION public.platform_bank_details_changed();

-- 7. who may call what
REVOKE ALL ON FUNCTION public.bank_account_summary(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clean_bank_account(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_bank_details_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payment_instructions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_instructions(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_invoice_bank_account(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_invoice_bank_account(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.add_business_days(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_due_date(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payouts_set_due_by() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bank_transfer_available(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bank_transfer_company_allowed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payment_methods(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_methods(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_company_bank_transfer(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_company_bank_transfer(uuid, boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_invoice_bank_transfer(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_invoice_bank_transfer(uuid, boolean, text) TO authenticated;