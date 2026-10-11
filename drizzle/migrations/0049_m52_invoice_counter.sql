-- M52: the administrator can see and change the counter of the invoice numbers (INV-<year>-<6 digits>)
-- Invoice numbers come from the sequence public.invoice_number_seq (used by the trigger payments_set_identifiers).
-- This migration adds a history table and two functions; nothing that exists is changed.

CREATE TABLE IF NOT EXISTS public.invoice_counter_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  old_next bigint NOT NULL CHECK (old_next >= 1),
  new_next bigint NOT NULL CHECK (new_next BETWEEN 1 AND 999999),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 300)
);

ALTER TABLE public.invoice_counter_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.invoice_counter_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.invoice_counter_changes TO authenticated;

CREATE POLICY "Administrators read the invoice counter history"
  ON public.invoice_counter_changes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER audit_invoice_counter_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_counter_changes
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- Reads the counter: the number the next invoice gets, the highest number on an invoice of this year, the last 20 changes.
CREATE OR REPLACE FUNCTION public.admin_get_invoice_counter()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _year text := to_char(now(), 'YYYY');
  _last bigint;
  _called boolean;
  _next bigint;
  _highest bigint;
  _total bigint;
  _hist jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an administrator can see the invoice number counter' USING ERRCODE = '42501';
  END IF;
  SELECT s.last_value, s.is_called INTO _last, _called FROM public.invoice_number_seq s;
  _next := CASE WHEN _called THEN _last + 1 ELSE _last END;
  SELECT COALESCE(max((regexp_match(p.invoice_number, '^INV-' || _year || '-([0-9]{1,9})$'))[1]::bigint), 0)
    INTO _highest
    FROM public.payments p
   WHERE p.invoice_number LIKE 'INV-' || _year || '-%';
  SELECT count(*) INTO _total FROM public.payments p WHERE p.invoice_number IS NOT NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'changed_at', h.changed_at,
           'changed_by_name', COALESCE(pr.display_name, 'An administrator'),
           'old_next', h.old_next,
           'new_next', h.new_next,
           'reason', h.reason) ORDER BY h.changed_at DESC), '[]'::jsonb)
    INTO _hist
    FROM (SELECT * FROM public.invoice_counter_changes ORDER BY changed_at DESC LIMIT 20) h
    LEFT JOIN public.profiles pr ON pr.user_id = h.changed_by;
  RETURN jsonb_build_object(
    'year', _year::integer,
    'next_number', _next,
    'next_invoice_number', 'INV-' || _year || '-' || lpad(_next::text, 6, '0'),
    'highest_used', _highest,
    'lowest_allowed_next', _highest + 1,
    'invoices_total', _total,
    'history', _hist
  );
END;
$function$;

-- Moves the counter: the next invoice gets the number _next. Refused when it would repeat a number of this year.
CREATE OR REPLACE FUNCTION public.admin_set_invoice_counter(_next bigint, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r text := btrim(COALESCE(_reason, ''));
  _year text := to_char(now(), 'YYYY');
  _last bigint;
  _called boolean;
  _cur bigint;
  _highest bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an administrator can change the invoice number counter' USING ERRCODE = '42501';
  END IF;
  IF _next IS NULL OR _next < 1 OR _next > 999999 THEN
    RAISE EXCEPTION 'The next invoice number must be a whole number from 1 to 999999' USING ERRCODE = '22023';
  END IF;
  IF char_length(_r) < 5 OR char_length(_r) > 300 THEN
    RAISE EXCEPTION 'Write the reason for the change (5 to 300 characters)' USING ERRCODE = '22023';
  END IF;
  -- no invoice can be created while the counter is checked and moved (the lock is released at the end of this call)
  PERFORM set_config('lock_timeout', '5000', true);
  LOCK TABLE public.payments IN SHARE ROW EXCLUSIVE MODE;
  SELECT s.last_value, s.is_called INTO _last, _called FROM public.invoice_number_seq s;
  _cur := CASE WHEN _called THEN _last + 1 ELSE _last END;
  IF _next = _cur THEN
    RAISE EXCEPTION 'The counter is already at this number' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max((regexp_match(p.invoice_number, '^INV-' || _year || '-([0-9]{1,9})$'))[1]::bigint), 0)
    INTO _highest
    FROM public.payments p
   WHERE p.invoice_number LIKE 'INV-' || _year || '-%';
  IF _next <= _highest THEN
    RAISE EXCEPTION 'The next number must be at least % (INV-%-% is already used).',
      _highest + 1, _year, lpad(_highest::text, 6, '0') USING ERRCODE = '22023';
  END IF;
  PERFORM setval('public.invoice_number_seq', _next, false);
  INSERT INTO public.invoice_counter_changes (changed_by, old_next, new_next, reason)
  VALUES (auth.uid(), _cur, _next, _r);
  RETURN public.admin_get_invoice_counter();
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_invoice_counter() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_invoice_counter() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_invoice_counter(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_invoice_counter(bigint, text) TO authenticated;