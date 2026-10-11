-- M54: business invoices.
-- A company can save its business details (name, tax number, address ...) and ask for its invoices to be issued as business invoices.
-- An invoice that exists can be re-issued with the details: the number and the amounts never change, the invoice gets a revision.
-- The printable invoice page reads everything from one function (get_invoice_document). Nothing that exists is changed:
-- payments only get three new columns.

-- 1. the business details of a company (one row per company)
CREATE TABLE IF NOT EXISTS public.tenant_billing_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  issue_business_invoices boolean NOT NULL DEFAULT false,
  business_name text,
  tax_number text,
  commercial_registration text,
  address_line text,
  city text,
  country text,
  postal_code text,
  billing_email text,
  phone text,
  reference_note text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_billing_text_lengths CHECK (
    char_length(COALESCE(business_name, '')) <= 200 AND char_length(COALESCE(tax_number, '')) <= 50
    AND char_length(COALESCE(commercial_registration, '')) <= 50 AND char_length(COALESCE(address_line, '')) <= 300
    AND char_length(COALESCE(city, '')) <= 100 AND char_length(COALESCE(country, '')) <= 100
    AND char_length(COALESCE(postal_code, '')) <= 20 AND char_length(COALESCE(billing_email, '')) <= 200
    AND char_length(COALESCE(phone, '')) <= 40 AND char_length(COALESCE(reference_note, '')) <= 200),
  CONSTRAINT tenant_billing_required_when_on CHECK (
    NOT issue_business_invoices OR (
      char_length(btrim(COALESCE(business_name, ''))) >= 2
      AND char_length(btrim(COALESCE(address_line, ''))) >= 3
      AND char_length(btrim(COALESCE(country, ''))) >= 2))
);

ALTER TABLE public.tenant_billing_details ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_billing_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tenant_billing_details TO authenticated;

CREATE POLICY "Members read the business details of their company"
  ON public.tenant_billing_details
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_member(auth.uid(), tenant_id)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE TRIGGER audit_tenant_billing_details
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_billing_details
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- 2. the business details on an invoice: a copy made when the invoice is issued or re-issued, and the history of the copies
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS buyer_details jsonb,
  ADD COLUMN IF NOT EXISTS buyer_details_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_details_at timestamptz;

CREATE TABLE IF NOT EXISTS public.payment_buyer_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  details jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('issued', 'reissued')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, revision)
);

ALTER TABLE public.payment_buyer_revisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_buyer_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_buyer_revisions TO authenticated;

CREATE POLICY "Clients and administrators read the revisions of an invoice"
  ON public.payment_buyer_revisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_id AND p.client_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 3. helpers (not callable from the app): a copy of the details of a company, and a text cleaner that refuses bad input
CREATE OR REPLACE FUNCTION public.billing_snapshot(_d public.tenant_billing_details)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'business_name', btrim(COALESCE(_d.business_name, '')),
    'tax_number', btrim(COALESCE(_d.tax_number, '')),
    'commercial_registration', btrim(COALESCE(_d.commercial_registration, '')),
    'address_line', btrim(COALESCE(_d.address_line, '')),
    'city', btrim(COALESCE(_d.city, '')),
    'country', btrim(COALESCE(_d.country, '')),
    'postal_code', btrim(COALESCE(_d.postal_code, '')),
    'billing_email', btrim(COALESCE(_d.billing_email, '')),
    'phone', btrim(COALESCE(_d.phone, '')),
    'reference_note', btrim(COALESCE(_d.reference_note, ''))
  )
$function$;

CREATE OR REPLACE FUNCTION public.clean_billing_text(_v text, _max integer, _label text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _t text := regexp_replace(btrim(COALESCE(_v, '')), '\s+', ' ', 'g');
BEGIN
  IF _t ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '% contains a character that is not allowed', _label USING ERRCODE = '22023';
  END IF;
  IF char_length(_t) > _max THEN
    RAISE EXCEPTION '% can have at most % characters', _label, _max USING ERRCODE = '22023';
  END IF;
  RETURN NULLIF(_t, '');
END;
$function$;

-- 4. a new invoice of a company that issues business invoices carries the details from the start
CREATE OR REPLACE FUNCTION public.payments_set_buyer_details()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _d public.tenant_billing_details;
BEGIN
  IF NEW.buyer_details IS NULL AND NEW.tenant_id IS NOT NULL THEN
    SELECT * INTO _d FROM public.tenant_billing_details t WHERE t.tenant_id = NEW.tenant_id AND t.issue_business_invoices;
    IF FOUND THEN
      NEW.buyer_details := public.billing_snapshot(_d);
      NEW.buyer_details_revision := 1;
      NEW.buyer_details_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_payments_set_buyer_details
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_set_buyer_details();

CREATE OR REPLACE FUNCTION public.payments_log_buyer_details()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.buyer_details IS NOT NULL AND NEW.buyer_details_revision >= 1 THEN
    INSERT INTO public.payment_buyer_revisions (payment_id, revision, details, source, created_by)
    VALUES (NEW.id, NEW.buyer_details_revision, NEW.buyer_details, 'issued', auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_payments_log_buyer_details
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_log_buyer_details();

-- 5. the owner or an administrator of a company saves its business details
CREATE OR REPLACE FUNCTION public.save_tenant_billing_details(_tenant_id uuid, _details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _issue boolean := false;
  _name text;
  _tax text;
  _cr text;
  _addr text;
  _city text;
  _country text;
  _zip text;
  _email text;
  _phone text;
  _ref text;
  _row public.tenant_billing_details;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = _tenant_id AND m.user_id = _uid AND m.accepted_at IS NOT NULL AND m.org_role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only an owner or an administrator of the company can change its business invoice details' USING ERRCODE = '42501';
  END IF;
  IF _details IS NULL OR jsonb_typeof(_details) <> 'object' THEN
    RAISE EXCEPTION 'The business details are missing' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_details -> 'issue_business_invoices') = 'boolean' THEN
    _issue := (_details ->> 'issue_business_invoices')::boolean;
  END IF;
  _name := public.clean_billing_text(_details ->> 'business_name', 200, 'The business name');
  _tax := public.clean_billing_text(_details ->> 'tax_number', 50, 'The tax number');
  _cr := public.clean_billing_text(_details ->> 'commercial_registration', 50, 'The commercial registration number');
  _addr := public.clean_billing_text(_details ->> 'address_line', 300, 'The address');
  _city := public.clean_billing_text(_details ->> 'city', 100, 'The city');
  _country := public.clean_billing_text(_details ->> 'country', 100, 'The country');
  _zip := public.clean_billing_text(_details ->> 'postal_code', 20, 'The postal code');
  _email := public.clean_billing_text(_details ->> 'billing_email', 200, 'The billing e-mail');
  _phone := public.clean_billing_text(_details ->> 'phone', 40, 'The phone number');
  _ref := public.clean_billing_text(_details ->> 'reference_note', 200, 'The reference');
  IF _email IS NOT NULL AND _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid billing e-mail address' USING ERRCODE = '22023';
  END IF;
  IF _tax IS NOT NULL AND char_length(_tax) < 3 THEN
    RAISE EXCEPTION 'The tax number is too short' USING ERRCODE = '22023';
  END IF;
  IF _issue AND (_name IS NULL OR char_length(_name) < 2 OR _addr IS NULL OR char_length(_addr) < 3 OR _country IS NULL OR char_length(_country) < 2) THEN
    RAISE EXCEPTION 'To issue business invoices enter the business name, the address and the country' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.tenant_billing_details AS t
    (tenant_id, issue_business_invoices, business_name, tax_number, commercial_registration, address_line, city, country,
     postal_code, billing_email, phone, reference_note, updated_by)
  VALUES (_tenant_id, _issue, _name, _tax, _cr, _addr, _city, _country, _zip, _email, _phone, _ref, _uid)
  ON CONFLICT (tenant_id) DO UPDATE SET
    issue_business_invoices = EXCLUDED.issue_business_invoices,
    business_name = EXCLUDED.business_name,
    tax_number = EXCLUDED.tax_number,
    commercial_registration = EXCLUDED.commercial_registration,
    address_line = EXCLUDED.address_line,
    city = EXCLUDED.city,
    country = EXCLUDED.country,
    postal_code = EXCLUDED.postal_code,
    billing_email = EXCLUDED.billing_email,
    phone = EXCLUDED.phone,
    reference_note = EXCLUDED.reference_note,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING t.* INTO _row;
  RETURN public.billing_snapshot(_row) || jsonb_build_object('issue_business_invoices', _row.issue_business_invoices, 'updated_at', _row.updated_at);
END;
$function$;

-- 6. the customer re-issues one of its invoices with the business details of its company (number and amounts stay the same)
CREATE OR REPLACE FUNCTION public.reissue_invoice_with_business_details(_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _p public.payments;
  _d public.tenant_billing_details;
  _snap jsonb;
  _rev integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42704';
  END IF;
  IF _p.client_id <> _uid THEN
    RAISE EXCEPTION 'You can only change your own invoices' USING ERRCODE = '42501';
  END IF;
  IF _p.tenant_id IS NULL THEN
    RAISE EXCEPTION 'This invoice is not linked to a company' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_tenant_member(_uid, _p.tenant_id) THEN
    RAISE EXCEPTION 'You are not a member of the company of this invoice' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _d FROM public.tenant_billing_details t WHERE t.tenant_id = _p.tenant_id;
  IF NOT FOUND
     OR char_length(btrim(COALESCE(_d.business_name, ''))) < 2
     OR char_length(btrim(COALESCE(_d.address_line, ''))) < 3
     OR char_length(btrim(COALESCE(_d.country, ''))) < 2 THEN
    RAISE EXCEPTION 'Save the business details of your company first (name, address and country)' USING ERRCODE = '22023';
  END IF;
  _snap := public.billing_snapshot(_d);
  IF _p.buyer_details IS NOT DISTINCT FROM _snap THEN
    RAISE EXCEPTION 'This invoice already has these business details' USING ERRCODE = '22023';
  END IF;
  _rev := _p.buyer_details_revision + 1;
  UPDATE public.payments
     SET buyer_details = _snap, buyer_details_revision = _rev, buyer_details_at = now()
   WHERE id = _p.id;
  INSERT INTO public.payment_buyer_revisions (payment_id, revision, details, source, created_by)
  VALUES (_p.id, _rev, _snap, 'reissued', _uid);
  RETURN jsonb_build_object('payment_id', _p.id, 'invoice_number', _p.invoice_number, 'revision', _rev, 'buyer_details', _snap);
END;
$function$;

-- 7. the seller on the invoices: the company that issues them (the administrator edits it)
INSERT INTO public.platform_settings (key, value)
VALUES ('invoice_seller_details', jsonb_build_object(
  'legal_name', 'Qurtuba Tech for Software',
  'legal_name_ar', '',
  'address_line', 'Apartment 301, Third Floor, Building 301, Gardenia Compound, Suez Road, First Settlement',
  'city', 'New Cairo, Cairo',
  'country', 'Egypt',
  'postal_code', '',
  'commercial_registration', '226435',
  'tax_number', '',
  'email', 'info@qurtubatalks.com',
  'phone', '',
  'website', 'https://www.aisupport360.com',
  'footer_note', ''))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_invoice_seller_details()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT s.value INTO _v FROM public.platform_settings s WHERE s.key = 'invoice_seller_details';
  RETURN COALESCE(_v, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_invoice_seller_details(_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _name text;
  _email text;
  _web text;
  _v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an administrator can change the seller details of the invoices' USING ERRCODE = '42501';
  END IF;
  IF _details IS NULL OR jsonb_typeof(_details) <> 'object' THEN
    RAISE EXCEPTION 'The seller details are missing' USING ERRCODE = '22023';
  END IF;
  _name := public.clean_billing_text(_details ->> 'legal_name', 200, 'The legal name');
  IF _name IS NULL OR char_length(_name) < 2 THEN
    RAISE EXCEPTION 'Enter the legal name of the company that issues the invoices' USING ERRCODE = '22023';
  END IF;
  _email := public.clean_billing_text(_details ->> 'email', 200, 'The e-mail');
  IF _email IS NOT NULL AND _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid e-mail address' USING ERRCODE = '22023';
  END IF;
  _web := public.clean_billing_text(_details ->> 'website', 200, 'The website');
  IF _web IS NOT NULL AND _web !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'The website must start with https:// or http://' USING ERRCODE = '22023';
  END IF;
  _v := jsonb_build_object(
    'legal_name', _name,
    'legal_name_ar', COALESCE(public.clean_billing_text(_details ->> 'legal_name_ar', 200, 'The legal name in Arabic'), ''),
    'address_line', COALESCE(public.clean_billing_text(_details ->> 'address_line', 300, 'The address'), ''),
    'city', COALESCE(public.clean_billing_text(_details ->> 'city', 100, 'The city'), ''),
    'country', COALESCE(public.clean_billing_text(_details ->> 'country', 100, 'The country'), ''),
    'postal_code', COALESCE(public.clean_billing_text(_details ->> 'postal_code', 20, 'The postal code'), ''),
    'commercial_registration', COALESCE(public.clean_billing_text(_details ->> 'commercial_registration', 50, 'The commercial registration number'), ''),
    'tax_number', COALESCE(public.clean_billing_text(_details ->> 'tax_number', 50, 'The tax number'), ''),
    'email', COALESCE(_email, ''),
    'phone', COALESCE(public.clean_billing_text(_details ->> 'phone', 40, 'The phone number'), ''),
    'website', COALESCE(_web, ''),
    'footer_note', COALESCE(public.clean_billing_text(_details ->> 'footer_note', 500, 'The footer note'), '')
  );
  INSERT INTO public.platform_settings (key, value) VALUES ('invoice_seller_details', _v)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN _v;
END;
$function$;

-- 8. everything the printable invoice page shows (the customer of the invoice and the administrators may read it)
CREATE OR REPLACE FUNCTION public.get_invoice_document(_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _p public.payments;
  _consultant text;
  _ticket_title text;
  _ticket_module text;
  _client_name text;
  _client_email text;
  _revs jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42704';
  END IF;
  IF _p.client_id <> _uid AND NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'You can not open this invoice' USING ERRCODE = '42501';
  END IF;
  SELECT pr.display_name INTO _consultant
    FROM public.consultants c JOIN public.profiles pr ON pr.user_id = c.user_id WHERE c.id = _p.consultant_id;
  SELECT t.title, t.sap_module::text INTO _ticket_title, _ticket_module FROM public.tickets t WHERE t.id = _p.ticket_id;
  SELECT pr.display_name INTO _client_name FROM public.profiles pr WHERE pr.user_id = _p.client_id;
  SELECT u.email INTO _client_email FROM auth.users u WHERE u.id = _p.client_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('revision', r.revision, 'source', r.source, 'created_at', r.created_at) ORDER BY r.revision), '[]'::jsonb)
    INTO _revs FROM public.payment_buyer_revisions r WHERE r.payment_id = _p.id;
  RETURN jsonb_build_object(
    'id', _p.id,
    'invoice_number', _p.invoice_number,
    'kind', _p.kind,
    'status', _p.status::text,
    'currency', COALESCE(_p.currency, 'USD'),
    'issued_at', _p.created_at,
    'due_date', _p.due_date,
    'paid_at', _p.paid_at,
    'payment_method', _p.payment_method,
    'description', _p.description,
    'ticket_title', _ticket_title,
    'ticket_module', _ticket_module,
    'consultant_name', _consultant,
    'pricing_model', COALESCE(_p.pricing_model, 'legacy'),
    'amount', _p.amount,
    'vat_amount', COALESCE(_p.vat_amount, 0),
    'base_amount', _p.base_amount,
    'service_fee_percent', _p.service_fee_percent,
    'service_fee_amount', _p.service_fee_amount,
    'processing_fee_percent', _p.processing_fee_percent,
    'processing_fee_amount', _p.processing_fee_amount,
    'vat_percent', _p.vat_percent,
    'seller', public.get_invoice_seller_details(),
    'buyer', CASE WHEN _p.buyer_details IS NULL
                  THEN jsonb_build_object('type', 'personal', 'name', COALESCE(_client_name, ''), 'email', COALESCE(_client_email, ''))
                  ELSE jsonb_build_object('type', 'business') || _p.buyer_details END,
    'revision', _p.buyer_details_revision,
    'revision_at', _p.buyer_details_at,
    'revisions', _revs
  );
END;
$function$;

-- 9. who may call what
REVOKE ALL ON FUNCTION public.billing_snapshot(public.tenant_billing_details) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clean_billing_text(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_set_buyer_details() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_log_buyer_details() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_tenant_billing_details(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_billing_details(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.reissue_invoice_with_business_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reissue_invoice_with_business_details(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_invoice_seller_details() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_seller_details() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_save_invoice_seller_details(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_invoice_seller_details(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.get_invoice_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_document(uuid) TO authenticated;