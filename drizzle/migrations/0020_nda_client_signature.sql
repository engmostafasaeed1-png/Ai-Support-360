ALTER TABLE public.nda_agreements
  ADD COLUMN IF NOT EXISTS client_signature_data text,
  ADD COLUMN IF NOT EXISTS client_signature_type text,
  ADD COLUMN IF NOT EXISTS client_signer_name text,
  ADD COLUMN IF NOT EXISTS client_signed_at timestamptz;

CREATE OR REPLACE FUNCTION public.guard_nda_revocation()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.nda_client_sign', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.consultant_id, NEW.client_id, NEW.signature_data, NEW.signature_type, NEW.nda_content, NEW.ip_address, NEW.signed_at, NEW.created_at,
         NEW.client_signature_data, NEW.client_signature_type, NEW.client_signer_name, NEW.client_signed_at)
     IS DISTINCT FROM ROW(OLD.consultant_id, OLD.client_id, OLD.signature_data, OLD.signature_type, OLD.nda_content, OLD.ip_address, OLD.signed_at, OLD.created_at,
         OLD.client_signature_data, OLD.client_signature_type, OLD.client_signer_name, OLD.client_signed_at) THEN
    RAISE EXCEPTION 'A signed NDA can not be edited; it can only be revoked' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This NDA is already revoked' USING ERRCODE = '42501';
  END IF;
  IF NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'The only change allowed on a signed NDA is to revoke it' USING ERRCODE = '42501';
  END IF;
  NEW.revoked_at := now();
  NEW.revoked_by := auth.uid();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_sign_nda(_nda_id uuid, _signature text, _signature_type text, _signer_name text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _row public.nda_agreements;
  _consultant_user uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _row FROM public.nda_agreements WHERE id = _nda_id FOR UPDATE;
  IF NOT FOUND OR _row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'NDA not found' USING ERRCODE = '42501';
  END IF;
  IF _row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This NDA is revoked' USING ERRCODE = '22023'; END IF;
  IF _row.client_signed_at IS NOT NULL THEN RAISE EXCEPTION 'You already signed this NDA' USING ERRCODE = '22023'; END IF;
  IF _signature_type NOT IN ('type','draw') THEN RAISE EXCEPTION 'Unknown signature type' USING ERRCODE = '22023'; END IF;
  IF _signature IS NULL OR length(btrim(_signature)) < 2 OR length(_signature) > 400000 THEN
    RAISE EXCEPTION 'A signature is required (and must be smaller than 400 KB)' USING ERRCODE = '22023';
  END IF;
  IF _signer_name IS NULL OR length(btrim(_signer_name)) < 2 OR length(_signer_name) > 120 THEN
    RAISE EXCEPTION 'Please enter your full name' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.nda_client_sign', '1', true);
  UPDATE public.nda_agreements
     SET client_signature_data = _signature,
         client_signature_type = _signature_type,
         client_signer_name = btrim(_signer_name),
         client_signed_at = now()
   WHERE id = _nda_id;
  PERFORM set_config('app.nda_client_sign', '0', true);

  SELECT user_id INTO _consultant_user FROM public.consultants WHERE id = _row.consultant_id;
  IF _consultant_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (_consultant_user, 'NDA fully signed',
            btrim(_signer_name) || ' signed the NDA for the client. The fully signed copy is ready to download.',
            'nda', '/consultant/requests');
  END IF;
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (auth.uid(), 'NDA fully signed',
          'You signed the NDA. Both signatures are now on the document and it is ready to download.',
          'nda', '/client/contracts');
END;
$function$;

REVOKE ALL ON FUNCTION public.client_sign_nda(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_sign_nda(uuid, text, text, text) TO authenticated;