-- M65: consultant bank details, private by design.
--  * only the consultant (own row) and administrators can read them; no view, no realtime, no public table access
--  * the consultant can no longer write the table directly: saving goes through save_payout_details(), which checks the IBAN, SWIFT and
--    notes, REQUIRES the acknowledgement of the disclaimer (stored with its version and time) and resets the verification when a detail changes
--  * every save / acknowledgement / verification is logged without values (payout_details_log)
--  * admin_payout_details_status() lets the admin lists show Missing / Waiting / Verified without reading the numbers

ALTER TABLE public.consultant_payout_details
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_version text;

-- IBAN check (ISO 13616 mod 97)
CREATE OR REPLACE FUNCTION public.iban_valid(_iban text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $function$
DECLARE
  _s text := upper(regexp_replace(COALESCE(_iban, ''), '\s', '', 'g'));
  _r text;
  _rem bigint := 0;
  _i int;
  _ch text;
BEGIN
  IF _s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' THEN
    RETURN false;
  END IF;
  _r := substr(_s, 5) || substr(_s, 1, 4);
  FOR _i IN 1..length(_r) LOOP
    _ch := substr(_r, _i, 1);
    IF _ch ~ '[0-9]' THEN
      _rem := (_rem * 10 + _ch::int) % 97;
    ELSE
      _rem := (_rem * 100 + (ascii(_ch) - 55)) % 97;
    END IF;
  END LOOP;
  RETURN _rem = 1;
END
$function$;

-- audit log (no values, only who did what and when)
CREATE TABLE IF NOT EXISTS public.payout_details_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('saved', 'acknowledged', 'verified', 'unverified')),
  actor uuid,
  actor_role text,
  disclaimer_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payout_details_log_consultant_idx ON public.payout_details_log (consultant_id, created_at DESC);
ALTER TABLE public.payout_details_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Administrators and the owner read the payout details log" ON public.payout_details_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = payout_details_log.consultant_id AND c.user_id = auth.uid()));
REVOKE ALL ON public.payout_details_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payout_details_log TO authenticated;

-- table privileges: nobody anonymous; the consultant reads only (RLS: own row); administrators read and set the verification
DROP POLICY IF EXISTS "Consultants add own payout details" ON public.consultant_payout_details;
DROP POLICY IF EXISTS "Consultants change own payout details" ON public.consultant_payout_details;
REVOKE ALL ON public.consultant_payout_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consultant_payout_details TO authenticated;
GRANT UPDATE (verified_at, verified_by) ON public.consultant_payout_details TO authenticated;

-- log the administrator's verification
CREATE OR REPLACE FUNCTION public.log_payout_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at AND auth.uid() IS NOT NULL THEN
    INSERT INTO public.payout_details_log (consultant_id, action, actor, actor_role)
    VALUES (NEW.consultant_id, CASE WHEN NEW.verified_at IS NULL THEN 'unverified' ELSE 'verified' END, auth.uid(),
            CASE WHEN public.has_role(auth.uid(), 'admin'::app_role) THEN 'admin' ELSE 'consultant' END);
  END IF;
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS trg_log_payout_verification ON public.consultant_payout_details;
CREATE TRIGGER trg_log_payout_verification AFTER UPDATE OF verified_at ON public.consultant_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.log_payout_verification();

-- the only way for a consultant to save the details
CREATE OR REPLACE FUNCTION public.save_payout_details(
  _account_holder text, _bank_name text, _iban text, _account_number text, _swift_bic text,
  _country text, _currency text, _notes text, _acknowledged boolean, _ack_version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _cons uuid;
  _holder text := btrim(COALESCE(_account_holder, ''));
  _bank text := btrim(COALESCE(_bank_name, ''));
  _ib text := NULLIF(upper(regexp_replace(COALESCE(_iban, ''), '\s', '', 'g')), '');
  _acc text := NULLIF(regexp_replace(COALESCE(_account_number, ''), '\s', '', 'g'), '');
  _sw text := NULLIF(upper(btrim(COALESCE(_swift_bic, ''))), '');
  _co text := NULLIF(btrim(COALESCE(_country, '')), '');
  _cur text := upper(btrim(COALESCE(_currency, 'USD')));
  _nt text := NULLIF(btrim(COALESCE(_notes, '')), '');
  _old public.consultant_payout_details;
  _changed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT id INTO _cons FROM public.consultants WHERE user_id = auth.uid();
  IF _cons IS NULL THEN RAISE EXCEPTION 'Bank details are for consultant accounts' USING ERRCODE = '42501'; END IF;
  IF _acknowledged IS NOT TRUE OR COALESCE(btrim(_ack_version), '') = '' OR char_length(_ack_version) > 20 THEN
    RAISE EXCEPTION 'Please read the disclaimer and confirm it before saving your bank details' USING ERRCODE = '22023';
  END IF;
  IF char_length(_holder) < 2 OR char_length(_holder) > 120 OR char_length(_bank) < 2 OR char_length(_bank) > 120 THEN
    RAISE EXCEPTION 'The account holder and the bank name need 2 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF _ib IS NULL AND _acc IS NULL THEN
    RAISE EXCEPTION 'Enter an IBAN or an account number' USING ERRCODE = '22023';
  END IF;
  IF _ib IS NOT NULL AND NOT public.iban_valid(_ib) THEN
    RAISE EXCEPTION 'The IBAN is not valid: check the letters and digits' USING ERRCODE = '22023';
  END IF;
  IF _acc IS NOT NULL AND _acc !~ '^[A-Za-z0-9-]{4,34}$' THEN
    RAISE EXCEPTION 'The account number must have 4 to 34 letters, digits or dashes' USING ERRCODE = '22023';
  END IF;
  IF _sw IS NOT NULL AND _sw !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' THEN
    RAISE EXCEPTION 'The SWIFT / BIC must have 8 or 11 letters and digits' USING ERRCODE = '22023';
  END IF;
  IF _cur !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'The currency must be a 3-letter code such as USD' USING ERRCODE = '22023';
  END IF;
  IF _co IS NOT NULL AND (char_length(_co) < 2 OR char_length(_co) > 60) THEN
    RAISE EXCEPTION 'The country needs 2 to 60 characters' USING ERRCODE = '22023';
  END IF;
  IF _nt IS NOT NULL AND (char_length(_nt) > 500 OR public.contact_details_in_text(_nt)) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names in the notes' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('payout-save:' || auth.uid()::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many attempts. Please wait a while and try again.' USING ERRCODE = '54000';
  END IF;

  SELECT * INTO _old FROM public.consultant_payout_details WHERE consultant_id = _cons FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.consultant_payout_details (consultant_id, account_holder, bank_name, iban, account_number, swift_bic, country, currency, notes, acknowledged_at, acknowledged_version)
    VALUES (_cons, _holder, _bank, _ib, _acc, _sw, _co, _cur, _nt, now(), btrim(_ack_version));
    _changed := true;
  ELSE
    _changed := ROW(_old.account_holder, _old.bank_name, _old.iban, _old.account_number, _old.swift_bic, _old.country, _old.currency)
                IS DISTINCT FROM ROW(_holder, _bank, _ib, _acc, _sw, _co, _cur);
    UPDATE public.consultant_payout_details
       SET account_holder = _holder, bank_name = _bank, iban = _ib, account_number = _acc, swift_bic = _sw, country = _co, currency = _cur, notes = _nt,
           acknowledged_at = now(), acknowledged_version = btrim(_ack_version),
           verified_at = CASE WHEN _changed THEN NULL ELSE verified_at END,
           verified_by = CASE WHEN _changed THEN NULL ELSE verified_by END
     WHERE consultant_id = _cons;
  END IF;
  INSERT INTO public.payout_details_log (consultant_id, action, actor, actor_role, disclaimer_version)
  VALUES (_cons, CASE WHEN _changed THEN 'saved' ELSE 'acknowledged' END, auth.uid(), 'consultant', btrim(_ack_version));
END
$function$;
REVOKE ALL ON FUNCTION public.save_payout_details(text, text, text, text, text, text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payout_details(text, text, text, text, text, text, text, text, boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.iban_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iban_valid(text) TO authenticated;

-- administrators: the state of every consultant's bank details, without the numbers
CREATE OR REPLACE FUNCTION public.admin_payout_details_status()
RETURNS TABLE(consultant_id uuid, state text, acknowledged boolean, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT c.id,
         CASE WHEN d.consultant_id IS NULL THEN 'missing' WHEN d.verified_at IS NOT NULL THEN 'verified' ELSE 'waiting' END,
         COALESCE(d.acknowledged_at IS NOT NULL, false),
         d.updated_at
    FROM public.consultants c
    LEFT JOIN public.consultant_payout_details d ON d.consultant_id = c.id
   WHERE public.has_role(auth.uid(), 'admin'::app_role)
$function$;
REVOKE ALL ON FUNCTION public.admin_payout_details_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_details_status() TO authenticated;
