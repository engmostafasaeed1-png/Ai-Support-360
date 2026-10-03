-- Billing M16 (phase 1 of the manual bank-transfer money flow): bank details, commission, invoices, payments to confirm, payouts.
-- A. The administrator sets the platform bank details, the commission percent and an optional VAT percent in platform_settings (validated by a trigger).
-- B. Clients see the bank details only while they owe an invoice (function get_payment_instructions).
-- C. Consultants enter their own payout bank details (table consultant_payout_details, owner + administrators only; a change must be verified again).
-- D. Invoices (payments): a unique reference code and invoice number, the client can report a bank transfer, the administrator confirms it (admin_confirm_payment),
--    which creates the consultant's payout = invoice minus the platform commission. The commission is stored ONLY on the payout, never on the invoice the client reads.
-- E. Payouts: the administrator moves them pending -> processing -> completed (with the bank reference) or failed (admin_set_payout_status); the consultant is told.
-- F. An approved timesheet creates the invoice by itself (respond_to_timesheet); the administrator can also create an invoice (admin_create_invoice).

-- ===== A. settings validation =====
CREATE FUNCTION public.guard_payment_settings()
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
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_payment_settings() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_payment_settings BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_settings();

CREATE FUNCTION public.payment_commission_percent()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NULLIF(ps.value #>> '{}', '')::numeric FROM public.platform_settings ps WHERE ps.key = 'commission_percent' LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.payment_commission_percent() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.payment_vat_percent()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NULLIF(ps.value #>> '{}', '')::numeric FROM public.platform_settings ps WHERE ps.key = 'vat_percent' LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.payment_vat_percent() FROM PUBLIC, anon, authenticated;

-- ===== B. the bank details are shown only to an administrator or to a client who owes an invoice =====
CREATE FUNCTION public.get_payment_instructions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.has_role(auth.uid(), 'admin')
     OR EXISTS (SELECT 1 FROM public.payments p WHERE p.client_id = auth.uid() AND p.status::text = 'pending') THEN
    RETURN (SELECT ps.value FROM public.platform_settings ps WHERE ps.key = 'platform_bank_details' LIMIT 1);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_payment_instructions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_instructions() TO authenticated;

-- ===== C. the consultant's payout bank details =====
CREATE TABLE public.consultant_payout_details (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  account_holder text NOT NULL CHECK (char_length(account_holder) BETWEEN 2 AND 120),
  bank_name text NOT NULL CHECK (char_length(bank_name) BETWEEN 2 AND 120),
  iban text CHECK (iban IS NULL OR iban ~ '^[A-Za-z0-9 ]{8,42}$'),
  account_number text CHECK (account_number IS NULL OR account_number ~ '^[A-Za-z0-9 -]{4,40}$'),
  swift_bic text CHECK (swift_bic IS NULL OR swift_bic ~ '^[A-Za-z0-9]{8,11}$'),
  country text CHECK (country IS NULL OR char_length(country) BETWEEN 2 AND 60),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_details_one_identifier CHECK (iban IS NOT NULL OR account_number IS NOT NULL)
);
ALTER TABLE public.consultant_payout_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants read own payout details or administrators" ON public.consultant_payout_details
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_payout_details.consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Consultants add own payout details" ON public.consultant_payout_details
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_payout_details.consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Consultants change own payout details" ON public.consultant_payout_details
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_payout_details.consultant_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_payout_details.consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Administrators manage payout details" ON public.consultant_payout_details
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE FUNCTION public.guard_payout_details()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_untrusted_writer() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified_at := NULL;
      NEW.verified_by := NULL;
    ELSE
      IF NEW.consultant_id IS DISTINCT FROM OLD.consultant_id THEN
        RAISE EXCEPTION 'The payout details belong to one consultant' USING ERRCODE = '42501';
      END IF;
      IF ROW(NEW.account_holder, NEW.bank_name, NEW.iban, NEW.account_number, NEW.swift_bic, NEW.country, NEW.currency)
         IS DISTINCT FROM ROW(OLD.account_holder, OLD.bank_name, OLD.iban, OLD.account_number, OLD.swift_bic, OLD.country, OLD.currency) THEN
        NEW.verified_at := NULL;
        NEW.verified_by := NULL;
      ELSE
        NEW.verified_at := OLD.verified_at;
        NEW.verified_by := OLD.verified_by;
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_payout_details() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_payout_details BEFORE INSERT OR UPDATE ON public.consultant_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.guard_payout_details();

CREATE FUNCTION public.notify_payout_details_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _admin record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = NEW.consultant_id AND c.user_id = auth.uid()) THEN
    RETURN NEW;
  END IF;
  -- saving the same details again tells nobody anything
  IF TG_OP = 'UPDATE' AND ROW(NEW.account_holder, NEW.bank_name, NEW.iban, NEW.account_number, NEW.swift_bic, NEW.country, NEW.currency)
     IS NOT DISTINCT FROM ROW(OLD.account_holder, OLD.bank_name, OLD.iban, OLD.account_number, OLD.swift_bic, OLD.country, OLD.currency) THEN
    RETURN NEW;
  END IF;
  -- at most 5 notices an hour per consultant, so that the administrators are not flooded
  IF NOT public.check_rate_limit('payout-details-notice:' || auth.uid()::text, 5, 3600) THEN
    RETURN NEW;
  END IF;
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin.user_id, 'Payout details changed',
      'A consultant added or changed the bank details for payouts. Check them before the next payout.', 'payment', '/admin/payments');
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_payout_details_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_payout_details_change AFTER INSERT OR UPDATE ON public.consultant_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.notify_payout_details_change();

-- ===== D. invoices (payments): reference code, invoice number, bank-transfer report and confirmation fields =====
CREATE SEQUENCE public.invoice_number_seq START 1;

ALTER TABLE public.payments
  ADD COLUMN kind text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'milestone_funding', 'subscription', 'vmware_subscription')),
  ADD COLUMN reference text,
  ADD COLUMN timesheet_id uuid REFERENCES public.ticket_timesheet_submissions(id) ON DELETE SET NULL,
  ADD COLUMN milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL,
  ADD COLUMN client_reported_at timestamptz,
  ADD COLUMN client_transfer_reference text CHECK (client_transfer_reference IS NULL OR char_length(client_transfer_reference) <= 120),
  ADD COLUMN client_transfer_date date,
  ADD COLUMN client_note text CHECK (client_note IS NULL OR char_length(client_note) <= 500),
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN confirmed_by uuid,
  ADD COLUMN bank_reference text CHECK (bank_reference IS NULL OR char_length(bank_reference) <= 120),
  ADD COLUMN received_amount numeric(12,2),
  ADD COLUMN rejection_note text CHECK (rejection_note IS NULL OR char_length(rejection_note) <= 500),
  ADD COLUMN provider text NOT NULL DEFAULT 'manual_bank',
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT payments_vat_within_amount CHECK (COALESCE(vat_amount, 0) >= 0 AND COALESCE(vat_amount, 0) <= amount);
CREATE UNIQUE INDEX payments_reference_key ON public.payments (reference) WHERE reference IS NOT NULL;
CREATE UNIQUE INDEX payments_one_per_timesheet ON public.payments (timesheet_id) WHERE timesheet_id IS NOT NULL;

CREATE FUNCTION public.payments_set_identifiers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reference IS NULL THEN
    NEW.reference := 'QT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  END IF;
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.payments_set_identifiers() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_payments_set_identifiers BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_set_identifiers();

-- the consultant is told that the platform received the client's money (not that the money reached them)
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
        'The platform received the client''s payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || '. Your payout, after the platform commission, is prepared by the administrator.',
        'payment',
        '/consultant/earnings'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== E. payouts: link to the invoice, commission, bank reference =====
ALTER TABLE public.payouts
  ADD COLUMN payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  ADD COLUMN milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL,
  ADD COLUMN gross_amount numeric(12,2),
  ADD COLUMN commission_percent numeric(5,2),
  ADD COLUMN commission_amount numeric(12,2),
  ADD COLUMN bank_reference text CHECK (bank_reference IS NULL OR char_length(bank_reference) <= 120),
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN processed_by uuid,
  ADD COLUMN note text CHECK (note IS NULL OR char_length(note) <= 500),
  ADD CONSTRAINT payouts_amount_not_negative CHECK (amount >= 0);
CREATE UNIQUE INDEX payouts_one_per_payment ON public.payouts (payment_id) WHERE payment_id IS NOT NULL;

-- ===== F. the actions =====
-- the client tells the administrator that the bank transfer was made
CREATE FUNCTION public.client_report_payment(_payment_id uuid, _transfer_reference text, _transfer_date date, _note text DEFAULT NULL)
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
REVOKE ALL ON FUNCTION public.client_report_payment(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_report_payment(uuid, text, date, text) TO authenticated;

-- the administrator confirms that the money arrived: the invoice is paid and the consultant's payout is created
CREATE FUNCTION public.admin_confirm_payment(_payment_id uuid, _bank_reference text, _received_amount numeric DEFAULT NULL, _note text DEFAULT NULL)
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
  IF _p.consultant_id IS NOT NULL AND _p.kind = 'invoice' THEN
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
    _base := _p.amount - COALESCE(_p.vat_amount, 0);
    _comm := round(_base * _pct / 100, 2);
    INSERT INTO public.payouts (consultant_id, amount, currency, status, reference, payment_id, gross_amount, commission_percent, commission_amount)
    VALUES (_p.consultant_id, _base - _comm, COALESCE(_p.currency, 'USD'), 'pending', 'payment:' || _p.id::text, _p.id, _base, _pct, _comm);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_confirm_payment(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment(uuid, text, numeric, text) TO authenticated;

-- the administrator did not find the transfer the client reported
CREATE FUNCTION public.admin_reject_payment_report(_payment_id uuid, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _p record;
  _n text := left(btrim(COALESCE(_note, '')), 500);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an administrator can answer a payment report' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.client_id, p.status, p.client_reported_at, p.amount, p.currency, p.invoice_number, p.reference INTO _p
  FROM public.payments p WHERE p.id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = '42704';
  END IF;
  IF _p.status::text <> 'pending' OR _p.client_reported_at IS NULL THEN
    RAISE EXCEPTION 'There is no open report on this invoice' USING ERRCODE = '42501';
  END IF;
  IF _n = '' THEN
    RAISE EXCEPTION 'Tell the client why the transfer was not found' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payments SET client_reported_at = NULL, rejection_note = _n WHERE id = _p.id;
  PERFORM public.safe_insert_notification(_p.client_id, 'Payment not found',
    'We could not find your transfer for invoice ' || COALESCE(_p.invoice_number, _p.reference, '') || ': ' || _n, 'payment', '/client/payments');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_reject_payment_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment_report(uuid, text) TO authenticated;

-- the administrator pays the consultant by bank transfer and records it
CREATE FUNCTION public.admin_set_payout_status(_payout_id uuid, _status text, _bank_reference text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _po record;
  _user uuid;
  _ref text := left(btrim(COALESCE(_bank_reference, '')), 120);
  _n text := left(btrim(COALESCE(_note, '')), 500);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an administrator can process a payout' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('pending', 'processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'Unknown payout status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _po FROM public.payouts WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found' USING ERRCODE = '42704';
  END IF;
  IF NOT ((_po.status::text = 'pending' AND _status IN ('processing', 'completed', 'failed'))
       OR (_po.status::text = 'processing' AND _status IN ('completed', 'failed', 'pending'))
       OR (_po.status::text = 'failed' AND _status = 'pending')) THEN
    RAISE EXCEPTION 'A % payout can not become %', _po.status::text, _status USING ERRCODE = '42501';
  END IF;
  IF _status IN ('processing', 'completed') AND NOT EXISTS (SELECT 1 FROM public.consultant_payout_details d WHERE d.consultant_id = _po.consultant_id) THEN
    RAISE EXCEPTION 'The consultant has not entered bank details for payouts yet' USING ERRCODE = '22023';
  END IF;
  IF _status = 'completed' AND _ref = '' THEN
    RAISE EXCEPTION 'Enter the bank reference of the transfer you made' USING ERRCODE = '22023';
  END IF;
  IF _status = 'failed' AND _n = '' THEN
    RAISE EXCEPTION 'Write why the payout failed (the consultant will read it)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payouts
  SET status = _status::public.payout_status,
      payout_method = CASE WHEN _status IN ('processing', 'completed') THEN 'bank_transfer' ELSE payout_method END,
      bank_reference = CASE WHEN _ref <> '' THEN _ref ELSE bank_reference END,
      paid_at = CASE WHEN _status = 'completed' THEN now() WHEN _status = 'pending' THEN NULL ELSE paid_at END,
      processed_by = auth.uid(),
      note = NULLIF(_n, '')
  WHERE id = _po.id;
  SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = _po.consultant_id;
  IF _user IS NOT NULL THEN
    IF _status = 'processing' THEN
      PERFORM public.safe_insert_notification(_user, 'Payout in progress',
        'Your payout of ' || _po.amount::text || ' ' || COALESCE(_po.currency, 'USD') || ' is being prepared.', 'payment', '/consultant/earnings');
    ELSIF _status = 'completed' THEN
      PERFORM public.safe_insert_notification(_user, 'Payout sent',
        'Your payout of ' || _po.amount::text || ' ' || COALESCE(_po.currency, 'USD') || ' was transferred to your bank account (reference ' || _ref || ').', 'payment', '/consultant/earnings');
    ELSIF _status = 'failed' THEN
      PERFORM public.safe_insert_notification(_user, 'Payout problem',
        'Your payout of ' || _po.amount::text || ' ' || COALESCE(_po.currency, 'USD') || ' could not be sent: ' || _n, 'payment', '/consultant/earnings');
    END IF;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_payout_status(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_payout_status(uuid, text, text, text) TO authenticated;

-- the administrator issues an invoice by hand (sessions, extra work)
CREATE FUNCTION public.admin_create_invoice(_client_id uuid, _consultant_id uuid, _ticket_id uuid, _amount numeric, _currency text, _description text, _vat_amount numeric DEFAULT 0, _due_days integer DEFAULT 14)
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
    'An invoice of ' || _amount::text || ' ' || _cur || ' is ready. Open Payments & Invoices for the bank details and the payment reference.', 'payment', '/client/payments');
  RETURN _id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_create_invoice(uuid, uuid, uuid, numeric, text, text, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_invoice(uuid, uuid, uuid, numeric, text, text, numeric, integer) TO authenticated;

-- an approved timesheet is billed: one invoice per timesheet (the live function of M14 plus the invoice)
CREATE OR REPLACE FUNCTION public.respond_to_timesheet(_submission_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _name text;
  _t record;
  _ts record;
  _cons uuid;
  _vat numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT s.id, s.status, s.submitted_by, s.ticket_id INTO _s
  FROM public.ticket_timesheet_submissions s JOIN public.tickets t ON t.id = s.ticket_id
  WHERE s.id = _submission_id AND t.client_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet not found' USING ERRCODE = '42501';
  END IF;
  IF _s.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted timesheet can be approved or sent back' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('timesheet-respond:' || auth.uid()::text, 60, 3600) THEN
    RAISE EXCEPTION 'Too many answers in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  IF _approve THEN
    SELECT p.display_name INTO _name FROM public.profiles p WHERE p.user_id = auth.uid();
    UPDATE public.ticket_timesheet_submissions
    SET status = 'signed', signed_at = now(), signed_by_name = COALESCE(NULLIF(btrim(_name), ''), 'Client'), signature_method = 'in_app'
    WHERE id = _s.id;
    -- bill the approved hours (only for hours filed by a consultant)
    SELECT t.client_id, t.title INTO _t FROM public.tickets t WHERE t.id = _s.ticket_id;
    SELECT x.total_hours, x.total_cost, x.cost_currency INTO _ts FROM public.ticket_timesheet_submissions x WHERE x.id = _s.id;
    SELECT c.id INTO _cons FROM public.consultants c WHERE c.user_id = _s.submitted_by;
    IF _cons IS NOT NULL AND COALESCE(_ts.total_cost, 0) > 0 THEN
      _vat := round(_ts.total_cost * COALESCE(public.payment_vat_percent(), 0) / 100, 2);
      INSERT INTO public.payments (client_id, consultant_id, ticket_id, timesheet_id, amount, vat_amount, currency, status, kind, description, due_date, payment_method)
      VALUES (_t.client_id, _cons, _s.ticket_id, _s.id, _ts.total_cost + _vat, _vat, COALESCE(NULLIF(btrim(_ts.cost_currency), ''), 'USD'), 'pending', 'invoice',
              'Timesheet: ' || rtrim(rtrim(to_char(COALESCE(_ts.total_hours, 0), 'FM999990.00'), '0'), '.') || ' h on "' || left(COALESCE(_t.title, 'ticket'), 80) || '"', now() + interval '14 days', 'bank_transfer')
      ON CONFLICT (timesheet_id) WHERE timesheet_id IS NOT NULL DO NOTHING;
      IF FOUND THEN
        PERFORM public.safe_insert_notification(auth.uid(), 'Invoice created',
          'An invoice of ' || (_ts.total_cost + _vat)::text || ' ' || COALESCE(NULLIF(btrim(_ts.cost_currency), ''), 'USD') || ' was created for the approved timesheet. Open Payments & Invoices for the bank details.', 'payment', '/client/payments');
      END IF;
    END IF;
  ELSE
    UPDATE public.ticket_timesheet_submissions
    SET status = 'draft',
        notes = left(COALESCE(notes || E'\n', '') || 'Sent back by the client' || COALESCE(': ' || NULLIF(left(btrim(_note), 500), ''), ''), 4000)
    WHERE id = _s.id;
  END IF;
  IF _s.submitted_by IS DISTINCT FROM auth.uid() THEN
    PERFORM public.safe_insert_notification(_s.submitted_by,
      CASE WHEN _approve THEN 'Timesheet approved' ELSE 'Timesheet sent back' END,
      CASE WHEN _approve THEN 'The client approved your timesheet.' ELSE 'The client sent your timesheet back with a note. Review it and submit it again.' END,
      'ticket', '/consultant/tickets/' || _s.ticket_id::text);
  END IF;
END;
$function$;