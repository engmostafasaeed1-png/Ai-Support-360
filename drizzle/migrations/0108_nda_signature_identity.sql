-- =====================================================================================================================
-- NDA signing: free-hand signature + full legal name + ID document + authorisation (both parties).
-- Prepared for owner review. NOT APPLIED. Re-runnable (CREATE OR REPLACE / IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- What changes
--  * Signing happens only through public.nda_sign_record, called by the nda-signature edge function with the caller's
--    verified user id. The function validates everything the browser sends (signature strokes + PNG bytes + SHA-256,
--    name, ID type / country / masked form, authorisation, job title + company for clients) and writes the SAME
--    nda_agreements columns as before (signed_at / client_signed_at ...), so every gate that reads them (has_active_nda,
--    team gates, SLA, BRD, support agreements, ticket tracking) keeps working unchanged.
--  * The direct paths are closed: no INSERT policy for consultants, client_sign_nda no longer executable, and the guard
--    triggers refuse any signature change by signed-in users, admins and backend code outside the signing functions.
--    Admins can still revoke; nobody can sign for someone else.
--  * Evidence (append-only): public.nda_signatures, one row per party per NDA version (document hash): name, masked ID,
--    type + country, signature image path + SHA-256, size, stroke metrics, user agent hash, server time; IP only when
--    the admin setting store_ip is ON (default OFF).
--  * The ID number: public.nda_signatory_identity keeps only an AES-256-GCM ciphertext written by the edge function with
--    the backend secret NDA_ID_ENCRYPTION_KEY (never in the database) plus the masked form. Signed-in users cannot
--    select the ciphertext column at all; the signer and admins read the number only through the edge function, and
--    every read is written to the append-only public.nda_identity_access_log.
--  * Retention: setting id_retention_years (default 5) after the NDA is revoked; erased accounts are anonymised at once.
--    Anonymising removes only the ciphertext; hash, masked form and timestamps stay as evidence.
--  * Legacy NDAs signed before this file keep counting as signed; they simply have no evidence row ("legacy").
-- =====================================================================================================================

-- ------------------------------------------------------------------ settings

INSERT INTO public.platform_settings (key, value)
VALUES ('nda_signature', '{"allow_typed_signature": false, "store_ip": false, "id_retention_years": 5, "reminder_hours": 24}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nda_sig_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH raw AS (
    SELECT COALESCE((SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value END FROM public.platform_settings WHERE key = 'nda_signature'), '{}'::jsonb) AS v
  )
  SELECT jsonb_build_object(
    'allow_typed_signature', COALESCE(CASE WHEN jsonb_typeof(v -> 'allow_typed_signature') = 'boolean' THEN (v ->> 'allow_typed_signature')::boolean END, false),
    'store_ip', COALESCE(CASE WHEN jsonb_typeof(v -> 'store_ip') = 'boolean' THEN (v ->> 'store_ip')::boolean END, false),
    'id_retention_years', LEAST(30, GREATEST(1, COALESCE(CASE WHEN jsonb_typeof(v -> 'id_retention_years') = 'number' THEN (v ->> 'id_retention_years')::numeric::int END, 5))),
    'reminder_hours', LEAST(168, GREATEST(24, COALESCE(CASE WHEN jsonb_typeof(v -> 'reminder_hours') = 'number' THEN (v ->> 'reminder_hours')::numeric::int END, 24))))
  FROM raw
$$;

-- ------------------------------------------------------------------ helpers

CREATE OR REPLACE FUNCTION public.nda_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role))
$$;

-- 'client' / 'consultant' / NULL: the role of a user in one NDA
CREATE OR REPLACE FUNCTION public.nda_party_of(_nda uuid, _uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _uid IS NULL THEN NULL WHEN n.client_id = _uid THEN 'client' WHEN c.user_id = _uid THEN 'consultant' END
  FROM public.nda_agreements n LEFT JOIN public.consultants c ON c.id = n.consultant_id
  WHERE n.id = _nda
$$;

CREATE OR REPLACE FUNCTION public.nda_doc_hash(_content text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(COALESCE(_content, ''), 'UTF8')), 'hex')
$$;

-- Full legal name: two or more words, letters of any script (Arabic incl. harakat), hyphen / apostrophe / dot.
CREATE OR REPLACE FUNCTION public.nda_name_ok(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  n text := btrim(regexp_replace(COALESCE(_name, ''), '\s+', ' ', 'g'));
  w text[];
BEGIN
  IF n = '' OR length(n) > 120 THEN RETURN false; END IF;
  IF n !~ '^[[:alpha:]\u064B-\u065F\u0670 ''’.-]+$' THEN RETURN false; END IF;
  w := array_remove(regexp_split_to_array(n, ' '), '');
  IF (SELECT count(*) FROM unnest(w) x WHERE x ~ '[[:alpha:]]') < 2 THEN RETURN false; END IF;
  IF length(regexp_replace(n, '[^[:alpha:]]', '', 'g')) < 3 THEN RETURN false; END IF;
  RETURN true;
END $$;

-- Masked ID shape per type (same rule as _shared/ndaSignature.ts maskedIdOk)
CREATE OR REPLACE FUNCTION public.nda_masked_ok(_type text, _masked text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(_masked ~ '^[A-Z0-9]{1,2}\*+[A-Z0-9]{1,3}$'
    AND CASE _type WHEN 'passport' THEN length(_masked) BETWEEN 6 AND 12 WHEN 'national_id' THEN length(_masked) BETWEEN 5 AND 20 ELSE false END, false)
$$;

-- Contact-details filter (M60) for job title / company; names are never filtered (letters only anyway).
CREATE OR REPLACE FUNCTION public.nda_text_ok(_t text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _t IS NULL OR _t = '' THEN RETURN true; END IF;
  IF to_regprocedure('public.contact_details_in_text(text)') IS NOT NULL THEN
    RETURN NOT public.contact_details_in_text(_t);
  END IF;
  RETURN _t !~* '([a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,})|(https?://|www\.)|(\+|\m00)\d[\d\s().-]{7,}\d';
END $$;

-- Real PNG (signature, IHDR first, IEND last) -> {"width","height"}; NULL for anything else (SVG, GIF, JPEG, junk).
CREATE OR REPLACE FUNCTION public.nda_png_info(_b bytea)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _b IS NULL OR length(_b) < 100 OR length(_b) > 300000 THEN NULL
    WHEN substring(_b FROM 1 FOR 8) <> '\x89504e470d0a1a0a'::bytea THEN NULL
    WHEN substring(_b FROM 13 FOR 4) <> '\x49484452'::bytea THEN NULL
    WHEN substring(_b FROM length(_b) - 7 FOR 4) <> '\x49454e44'::bytea THEN NULL
    ELSE jsonb_build_object(
      'width', (get_byte(_b, 16)::bigint << 24) + (get_byte(_b, 17) << 16) + (get_byte(_b, 18) << 8) + get_byte(_b, 19),
      'height', (get_byte(_b, 20)::bigint << 24) + (get_byte(_b, 21) << 16) + (get_byte(_b, 22) << 8) + get_byte(_b, 23))
  END
$$;

-- Name of the signer as the OTHER party may see it (consultant names follow the viewer rule).
CREATE OR REPLACE FUNCTION public.nda_party_display(_nda uuid, _party text, _viewer uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _party
    WHEN 'consultant' THEN COALESCE(public.consultant_name_for(n.consultant_id, _viewer), 'The consultant')
    ELSE COALESCE(NULLIF(btrim(cp.company_name), ''), NULLIF(btrim(pr.display_name), ''), 'The client') END
  FROM public.nda_agreements n
  LEFT JOIN public.client_profiles cp ON cp.user_id = n.client_id
  LEFT JOIN public.profiles pr ON pr.user_id = n.client_id
  WHERE n.id = _nda
$$;

-- ------------------------------------------------------------------ evidence tables

CREATE TABLE IF NOT EXISTS public.nda_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nda_id uuid NOT NULL REFERENCES public.nda_agreements(id),
  party text NOT NULL CHECK (party IN ('client', 'consultant')),
  kind text NOT NULL DEFAULT 'signature' CHECK (kind IN ('signature', 'supplement')),
  method text NOT NULL CHECK (method IN ('draw', 'typed')),
  signer_user_id uuid NOT NULL,
  signer_name text NOT NULL CHECK (length(signer_name) BETWEEN 3 AND 120),
  job_title text CHECK (job_title IS NULL OR length(job_title) BETWEEN 2 AND 80),
  company_name text CHECK (company_name IS NULL OR length(company_name) BETWEEN 2 AND 160),
  id_type text NOT NULL CHECK (id_type IN ('national_id', 'passport')),
  id_country text NOT NULL CHECK (id_country ~ '^[A-Z]{2}$' AND id_country <> 'IL'),
  id_masked text NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  image_path text NOT NULL,
  image_sha256 text NOT NULL CHECK (image_sha256 ~ '^[0-9a-f]{64}$'),
  image_bytes integer NOT NULL,
  image_width integer NOT NULL,
  image_height integer NOT NULL,
  stroke_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent_hash text CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'),
  ip_address text,
  signed_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nda_signatures_one_per_party_version UNIQUE (nda_id, party, document_hash)
);
CREATE INDEX IF NOT EXISTS nda_signatures_signer_idx ON public.nda_signatures (signer_user_id);

CREATE TABLE IF NOT EXISTS public.nda_signatory_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_id uuid NOT NULL UNIQUE REFERENCES public.nda_signatures(id),
  user_id uuid NOT NULL,
  id_type text NOT NULL CHECK (id_type IN ('national_id', 'passport')),
  id_country text NOT NULL CHECK (id_country ~ '^[A-Z]{2}$' AND id_country <> 'IL'),
  id_masked text NOT NULL,
  id_cipher text CHECK (id_cipher IS NULL OR id_cipher ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  anonymised_at timestamptz,
  anonymised_reason text,
  CONSTRAINT nda_identity_cipher_or_anonymised CHECK ((id_cipher IS NULL) = (anonymised_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS nda_signatory_identity_user_idx ON public.nda_signatory_identity (user_id);

CREATE TABLE IF NOT EXISTS public.nda_identity_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES public.nda_signatory_identity(id),
  signature_id uuid NOT NULL,
  actor uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('admin', 'self')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nda_identity_access_log_identity_idx ON public.nda_identity_access_log (identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.nda_signature_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nda_id uuid,
  consultant_id uuid,
  client_id uuid,
  actor uuid,
  action text NOT NULL CHECK (action IN ('sign', 'supplement', 'remind', 'download', 'view_full_id', 'anonymise', 'settings')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nda_signature_events_actor_idx ON public.nda_signature_events (actor, action, created_at DESC);
CREATE INDEX IF NOT EXISTS nda_signature_events_pair_idx ON public.nda_signature_events (consultant_id, client_id, action, created_at DESC);

-- Grants: signed-in users read only the columns meant for them (never the ciphertext, the image path, the IP or the
-- user agent hash); nobody writes these tables directly - the SECURITY DEFINER functions below do.
REVOKE ALL ON public.nda_signatures, public.nda_signatory_identity, public.nda_identity_access_log, public.nda_signature_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, nda_id, party, kind, method, signer_user_id, signer_name, job_title, company_name, id_type, id_country, id_masked,
              document_hash, image_sha256, signed_at, captured_at) ON public.nda_signatures TO authenticated;
GRANT SELECT (id, signature_id, user_id, id_type, id_country, id_masked, created_at, anonymised_at) ON public.nda_signatory_identity TO authenticated;
GRANT SELECT ON public.nda_identity_access_log TO authenticated;
GRANT SELECT ON public.nda_signature_events TO authenticated;
GRANT SELECT ON public.nda_signatures, public.nda_signatory_identity, public.nda_identity_access_log, public.nda_signature_events TO service_role;

ALTER TABLE public.nda_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nda_signatory_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nda_identity_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nda_signature_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "NDA parties and admins read signature evidence" ON public.nda_signatures;
CREATE POLICY "NDA parties and admins read signature evidence" ON public.nda_signatures FOR SELECT TO authenticated
  USING (signer_user_id = auth.uid() OR public.nda_party_of(nda_id, auth.uid()) IS NOT NULL OR public.nda_is_admin(auth.uid()));

DROP POLICY IF EXISTS "Signer and admins read the identity record" ON public.nda_signatory_identity;
CREATE POLICY "Signer and admins read the identity record" ON public.nda_signatory_identity FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.nda_is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins and the signer read ID access log" ON public.nda_identity_access_log;
CREATE POLICY "Admins and the signer read ID access log" ON public.nda_identity_access_log FOR SELECT TO authenticated
  USING (public.nda_is_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.nda_signatory_identity i WHERE i.id = identity_id AND i.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins read NDA signature events" ON public.nda_signature_events;
CREATE POLICY "Admins read NDA signature events" ON public.nda_signature_events FOR SELECT TO authenticated
  USING (public.nda_is_admin(auth.uid()));

-- Append-only guards (also against admins and backend code)
CREATE OR REPLACE FUNCTION public.nda_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'nda_record_immutable' USING ERRCODE = '42501', HINT = 'NDA signatures, access logs and events are append-only.';
END $$;

DROP TRIGGER IF EXISTS nda_signatures_append_only ON public.nda_signatures;
CREATE TRIGGER nda_signatures_append_only BEFORE UPDATE OR DELETE ON public.nda_signatures FOR EACH ROW EXECUTE FUNCTION public.nda_append_only();
DROP TRIGGER IF EXISTS nda_signatures_no_truncate ON public.nda_signatures;
CREATE TRIGGER nda_signatures_no_truncate BEFORE TRUNCATE ON public.nda_signatures FOR EACH STATEMENT EXECUTE FUNCTION public.nda_append_only();
DROP TRIGGER IF EXISTS nda_identity_access_log_append_only ON public.nda_identity_access_log;
CREATE TRIGGER nda_identity_access_log_append_only BEFORE UPDATE OR DELETE ON public.nda_identity_access_log FOR EACH ROW EXECUTE FUNCTION public.nda_append_only();
DROP TRIGGER IF EXISTS nda_identity_access_log_no_truncate ON public.nda_identity_access_log;
CREATE TRIGGER nda_identity_access_log_no_truncate BEFORE TRUNCATE ON public.nda_identity_access_log FOR EACH STATEMENT EXECUTE FUNCTION public.nda_append_only();
DROP TRIGGER IF EXISTS nda_signature_events_append_only ON public.nda_signature_events;
CREATE TRIGGER nda_signature_events_append_only BEFORE UPDATE OR DELETE ON public.nda_signature_events FOR EACH ROW EXECUTE FUNCTION public.nda_append_only();
DROP TRIGGER IF EXISTS nda_signature_events_no_truncate ON public.nda_signature_events;
CREATE TRIGGER nda_signature_events_no_truncate BEFORE TRUNCATE ON public.nda_signature_events FOR EACH STATEMENT EXECUTE FUNCTION public.nda_append_only();

-- The identity row changes once at most: the ciphertext is removed (retention / account erasure), nothing else.
CREATE OR REPLACE FUNCTION public.nda_identity_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'nda_record_immutable' USING ERRCODE = '42501';
  END IF;
  IF current_setting('app.nda_identity_anonymise', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'nda_record_immutable' USING ERRCODE = '42501';
  END IF;
  IF ROW(NEW.id, NEW.signature_id, NEW.user_id, NEW.id_type, NEW.id_country, NEW.id_masked, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.signature_id, OLD.user_id, OLD.id_type, OLD.id_country, OLD.id_masked, OLD.created_at)
     OR OLD.id_cipher IS NULL OR NEW.id_cipher IS NOT NULL THEN
    RAISE EXCEPTION 'nda_record_immutable' USING ERRCODE = '42501';
  END IF;
  NEW.anonymised_at := now();
  NEW.anonymised_reason := left(COALESCE(NULLIF(btrim(NEW.anonymised_reason), ''), 'anonymised'), 200);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nda_signatory_identity_guard ON public.nda_signatory_identity;
CREATE TRIGGER nda_signatory_identity_guard BEFORE UPDATE OR DELETE ON public.nda_signatory_identity FOR EACH ROW EXECUTE FUNCTION public.nda_identity_guard();
DROP TRIGGER IF EXISTS nda_signatory_identity_no_truncate ON public.nda_signatory_identity;
CREATE TRIGGER nda_signatory_identity_no_truncate BEFORE TRUNCATE ON public.nda_signatory_identity FOR EACH STATEMENT EXECUTE FUNCTION public.nda_append_only();

-- ------------------------------------------------------------------ close the old signing paths

-- consultants no longer insert NDA rows themselves (the signing function does, after all checks)
DROP POLICY IF EXISTS "Verified consultants can sign NDAs for clients they work with" ON public.nda_agreements;
-- the old client countersign (typed name / any drawing) stays defined for history but nobody can call it
REVOKE EXECUTE ON FUNCTION public.client_sign_nda(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- No NDA row is created by signed-in users, admins or backend code directly; only the signing functions (owner) do.
CREATE OR REPLACE FUNCTION public.guard_nda_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- signed-in users (also admins), anonymous callers and backend code never create an NDA row directly; the signing
  -- function (owner context) validates its own values before it inserts
  IF current_user IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION 'nda_sign_in_portal' USING ERRCODE = '42501',
      HINT = 'An NDA is signed only through the signing step (drawn signature, full legal name, ID document, authorisation).';
  END IF;
  RETURN NEW;
END $$;

-- Signature columns never change outside the signing functions - also not by admins or backend code. Revoking stays
-- possible for the client (own NDAs, existing policy) and admins.
CREATE OR REPLACE FUNCTION public.guard_nda_revocation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN
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
END $$;

-- ------------------------------------------------------------------ signing (edge function only)

-- _p: party, kind ('signature' | 'supplement' = add details to a legacy signature), method ('draw' | 'typed'),
--     nda_id (client / supplement) or consultant_id + client_id + nda_content (consultant signs first),
--     png_base64, image_sha256, image_path (uploaded by the edge function to nda-documents/signatures/<actor>/<uuid>.png),
--     metrics {strokes, points, length, width, height}, signer_name, job_title, company_name, id_type, id_country,
--     id_masked, id_cipher, authorised, agreed, user_agent_hash, ip.
CREATE OR REPLACE FUNCTION public.nda_sign_record(_actor uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.nda_sig_settings();
  _party text := _p ->> 'party';
  _kind text := COALESCE(_p ->> 'kind', 'signature');
  _method text := COALESCE(_p ->> 'method', 'draw');
  _name text := btrim(regexp_replace(normalize(COALESCE(_p ->> 'signer_name', ''), NFC), '\s+', ' ', 'g'));
  _title text := NULLIF(btrim(regexp_replace(COALESCE(_p ->> 'job_title', ''), '\s+', ' ', 'g')), '');
  _company text := NULLIF(btrim(regexp_replace(COALESCE(_p ->> 'company_name', ''), '\s+', ' ', 'g')), '');
  _id_type text := _p ->> 'id_type';
  _country text := upper(COALESCE(_p ->> 'id_country', ''));
  _masked text := COALESCE(_p ->> 'id_masked', '');
  _cipher text := _p ->> 'id_cipher';
  _sha text := lower(COALESCE(_p ->> 'image_sha256', ''));
  _path text := COALESCE(_p ->> 'image_path', '');
  _m jsonb := COALESCE(_p -> 'metrics', '{}'::jsonb);
  _ua text := NULLIF(lower(COALESCE(_p ->> 'user_agent_hash', '')), '');
  _png bytea;
  _info jsonb;
  _ip text;
  _dataurl text;
  _content text;
  _nda public.nda_agreements;
  _cons public.consultants;
  _client uuid;
  _existing uuid;
  _sig_id uuid;
  _hash text;
  _signed_at timestamptz;
  _other uuid;
  _other_role text;
  _mail text;
  _lang text;
  _path_link text;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'nda_not_signed_in' USING ERRCODE = '42501'; END IF;
  -- act as the signer for the triggers that read auth.uid() (audit log, notifications, gates)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _actor::text, true);

  IF _party IS NULL OR _party NOT IN ('client', 'consultant') THEN RAISE EXCEPTION 'nda_party_invalid' USING ERRCODE = '22023'; END IF;
  IF _kind NOT IN ('signature', 'supplement') THEN RAISE EXCEPTION 'nda_kind_invalid' USING ERRCODE = '22023'; END IF;
  IF _method NOT IN ('draw', 'typed') THEN RAISE EXCEPTION 'nda_method_invalid' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.nda_signature_events e
       WHERE e.actor = _actor AND e.action IN ('sign', 'supplement') AND e.created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'nda_rate_limited' USING ERRCODE = '22023';
  END IF;

  -- (d) authorisation + agreement
  IF jsonb_typeof(_p -> 'authorised') IS DISTINCT FROM 'boolean' OR NOT (_p ->> 'authorised')::boolean
     OR jsonb_typeof(_p -> 'agreed') IS DISTINCT FROM 'boolean' OR NOT (_p ->> 'agreed')::boolean THEN
    RAISE EXCEPTION 'nda_confirmation_required' USING ERRCODE = '22023';
  END IF;

  -- (a) signature: strokes, real PNG, hash, stored file
  IF _method = 'typed' AND NOT (s ->> 'allow_typed_signature')::boolean THEN
    RAISE EXCEPTION 'nda_typed_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF _method = 'draw' AND (
       COALESCE((_m ->> 'points')::numeric, 0) < 10 OR COALESCE((_m ->> 'length')::numeric, 0) < 150
    OR COALESCE((_m ->> 'width')::numeric, 0) < 60 OR COALESCE((_m ->> 'height')::numeric, 0) < 15
    OR COALESCE((_m ->> 'points')::numeric, 0) > 6000 OR COALESCE((_m ->> 'strokes')::numeric, 0) > 60) THEN
    RAISE EXCEPTION 'nda_signature_too_small' USING ERRCODE = '22023';
  END IF;
  BEGIN
    _png := decode(regexp_replace(COALESCE(_p ->> 'png_base64', ''), '^data:image/png;base64,', ''), 'base64');
  EXCEPTION WHEN others THEN
    _png := NULL;
  END;
  _info := public.nda_png_info(_png);
  IF _info IS NULL OR (_info ->> 'width')::int NOT BETWEEN 100 AND 2400 OR (_info ->> 'height')::int NOT BETWEEN 40 AND 2400 THEN
    RAISE EXCEPTION 'nda_signature_image_invalid' USING ERRCODE = '22023';
  END IF;
  IF encode(sha256(_png), 'hex') <> _sha THEN
    RAISE EXCEPTION 'nda_signature_hash_mismatch' USING ERRCODE = '22023';
  END IF;
  IF _path !~ ('^signatures/' || _actor::text || '/[0-9a-f-]{36}\.png$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'nda-documents' AND o.name = _path) THEN
    RAISE EXCEPTION 'nda_signature_file_missing' USING ERRCODE = '22023';
  END IF;

  -- (b) full legal name, (c) ID document
  IF NOT public.nda_name_ok(_name) THEN RAISE EXCEPTION 'nda_name_invalid' USING ERRCODE = '22023'; END IF;
  IF _id_type IS NULL OR _id_type NOT IN ('national_id', 'passport') THEN RAISE EXCEPTION 'nda_id_type_invalid' USING ERRCODE = '22023'; END IF;
  IF _country !~ '^[A-Z]{2}$' OR _country = 'IL' THEN RAISE EXCEPTION 'nda_id_country_invalid' USING ERRCODE = '22023'; END IF;
  IF NOT public.nda_masked_ok(_id_type, _masked) THEN RAISE EXCEPTION 'nda_id_invalid' USING ERRCODE = '22023'; END IF;
  IF _cipher IS NULL OR _cipher !~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$' THEN
    RAISE EXCEPTION 'nda_id_cipher_invalid' USING ERRCODE = '22023';
  END IF;

  -- (e) a client signs on behalf of the company: job title + company name
  IF _party = 'client' AND (_title IS NULL OR length(_title) NOT BETWEEN 2 AND 80 OR _company IS NULL OR length(_company) NOT BETWEEN 2 AND 160) THEN
    RAISE EXCEPTION 'nda_company_details_required' USING ERRCODE = '22023';
  END IF;
  IF (_title IS NOT NULL AND length(_title) > 80) OR (_company IS NOT NULL AND length(_company) > 160) THEN
    RAISE EXCEPTION 'nda_company_details_required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.nda_text_ok(concat_ws(' ', _title, _company)) THEN RAISE EXCEPTION 'nda_contact_details' USING ERRCODE = '22023'; END IF;
  IF _ua IS NOT NULL AND _ua !~ '^[0-9a-f]{64}$' THEN _ua := NULL; END IF;
  _ip := CASE WHEN (s ->> 'store_ip')::boolean THEN left(NULLIF(btrim(COALESCE(_p ->> 'ip', '')), ''), 64) END;
  _dataurl := 'data:image/png;base64,' || replace(encode(_png, 'base64'), E'\n', '');

  IF _party = 'consultant' AND _kind = 'signature' THEN
    SELECT * INTO _cons FROM public.consultants WHERE id = NULLIF(_p ->> 'consultant_id', '')::uuid;
    IF NOT FOUND OR _cons.user_id IS DISTINCT FROM _actor THEN RAISE EXCEPTION 'nda_not_your_party' USING ERRCODE = '42501'; END IF;
    IF _cons.verification_status IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'nda_consultant_not_verified' USING ERRCODE = '42501'; END IF;
    _client := NULLIF(_p ->> 'client_id', '')::uuid;
    IF _client IS NULL OR _client = _actor THEN RAISE EXCEPTION 'nda_not_your_party' USING ERRCODE = '42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('nda-pair:' || _cons.id::text || ':' || _client::text));
    SELECT * INTO _nda FROM public.nda_agreements WHERE consultant_id = _cons.id AND client_id = _client AND revoked_at IS NULL FOR UPDATE;
    IF FOUND THEN
      SELECT id INTO _existing FROM public.nda_signatures WHERE nda_id = _nda.id AND party = 'consultant';
      IF _existing IS NOT NULL THEN
        RETURN jsonb_build_object('signature_id', _existing, 'nda_id', _nda.id, 'party', 'consultant', 'idempotent', true);
      END IF;
      RAISE EXCEPTION 'nda_already_signed' USING ERRCODE = '22023', HINT = 'Signed before the stricter signing step: use "Add my signature details".';
    END IF;
    IF NOT (public.consultant_related_to_client(_cons.id, _client, true)
            OR public.consultant_has_environment_for_client(_cons.id, _client)
            OR (to_regclass('public.sa_members') IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.sa_members m JOIN public.sa_agreements a ON a.id = m.agreement_id
                  WHERE m.consultant_id = _cons.id AND a.client_id = _client AND m.status IN ('invited', 'active')))) THEN
      RAISE EXCEPTION 'nda_no_relation' USING ERRCODE = '42501';
    END IF;
    _content := COALESCE(_p ->> 'nda_content', '');
    IF length(btrim(_content)) < 20 OR length(_content) > 200000 THEN RAISE EXCEPTION 'nda_content_invalid' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, signature_type, nda_content, ip_address, signed_at, created_at)
    VALUES (_cons.id, _client, _dataurl, CASE _method WHEN 'typed' THEN 'type' ELSE 'draw' END, _content, _ip, now(), now())
    RETURNING * INTO _nda;
    _signed_at := _nda.signed_at;
  ELSE
    SELECT * INTO _nda FROM public.nda_agreements WHERE id = NULLIF(_p ->> 'nda_id', '')::uuid FOR UPDATE;
    IF NOT FOUND OR public.nda_party_of(_nda.id, _actor) IS DISTINCT FROM _party THEN
      RAISE EXCEPTION 'nda_not_your_party' USING ERRCODE = '42501';
    END IF;
    -- the same person can never stand on both sides
    IF _nda.client_id = _actor AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _nda.consultant_id AND c.user_id = _actor) THEN
      RAISE EXCEPTION 'nda_not_your_party' USING ERRCODE = '42501';
    END IF;
    IF _nda.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'nda_revoked' USING ERRCODE = '22023'; END IF;
    SELECT id INTO _existing FROM public.nda_signatures WHERE nda_id = _nda.id AND party = _party;
    IF _kind = 'signature' THEN
      IF _nda.client_signed_at IS NOT NULL THEN
        IF _existing IS NOT NULL THEN
          RETURN jsonb_build_object('signature_id', _existing, 'nda_id', _nda.id, 'party', _party, 'idempotent', true);
        END IF;
        RAISE EXCEPTION 'nda_already_signed' USING ERRCODE = '22023', HINT = 'Signed before the stricter signing step: use "Add my signature details".';
      END IF;
      UPDATE public.nda_agreements
         SET client_signature_data = _dataurl,
             client_signature_type = CASE _method WHEN 'typed' THEN 'type' ELSE 'draw' END,
             client_signer_name = _name,
             client_signed_at = now()
       WHERE id = _nda.id
      RETURNING * INTO _nda;
      _signed_at := _nda.client_signed_at;
    ELSE
      -- supplement: details for a legacy signature; the original signing time stays the legal signing time
      IF _existing IS NOT NULL THEN
        RETURN jsonb_build_object('signature_id', _existing, 'nda_id', _nda.id, 'party', _party, 'idempotent', true);
      END IF;
      _signed_at := CASE _party WHEN 'client' THEN _nda.client_signed_at ELSE _nda.signed_at END;
      IF _signed_at IS NULL THEN RAISE EXCEPTION 'nda_not_signed_yet' USING ERRCODE = '22023'; END IF;
    END IF;
  END IF;

  _hash := public.nda_doc_hash(_nda.nda_content);
  INSERT INTO public.nda_signatures (nda_id, party, kind, method, signer_user_id, signer_name, job_title, company_name, id_type, id_country, id_masked,
                                     document_hash, image_path, image_sha256, image_bytes, image_width, image_height, stroke_metrics, user_agent_hash, ip_address, signed_at)
  VALUES (_nda.id, _party, _kind, _method, _actor, _name, _title, _company, _id_type, _country, _masked,
          _hash, _path, _sha, length(_png), (_info ->> 'width')::int, (_info ->> 'height')::int,
          jsonb_build_object('strokes', COALESCE((_m ->> 'strokes')::numeric, 0), 'points', COALESCE((_m ->> 'points')::numeric, 0),
                             'length', COALESCE((_m ->> 'length')::numeric, 0), 'width', COALESCE((_m ->> 'width')::numeric, 0), 'height', COALESCE((_m ->> 'height')::numeric, 0)),
          _ua, _ip, _signed_at)
  RETURNING id INTO _sig_id;
  INSERT INTO public.nda_signatory_identity (signature_id, user_id, id_type, id_country, id_masked, id_cipher)
  VALUES (_sig_id, _actor, _id_type, _country, _masked, _cipher);
  INSERT INTO public.nda_signature_events (nda_id, consultant_id, client_id, actor, action, detail)
  VALUES (_nda.id, _nda.consultant_id, _nda.client_id, _actor, CASE _kind WHEN 'signature' THEN 'sign' ELSE 'supplement' END,
          jsonb_build_object('party', _party, 'method', _method, 'document_hash', _hash, 'image_sha256', _sha, 'signature_id', _sig_id));

  -- who has to hear about it (in-app here; the e-mail is sent by the edge function with the returned recipient)
  IF _kind = 'signature' THEN
    IF _party = 'client' THEN
      SELECT c.user_id INTO _other FROM public.consultants c WHERE c.id = _nda.consultant_id;
      _other_role := 'consultant';
      _mail := 'fully_signed';
      _path_link := '/consultant/ndas?nda=' || _nda.id;
      IF _other IS NOT NULL THEN
        PERFORM public.safe_insert_notification(_other, 'NDA fully signed',
          public.nda_party_display(_nda.id, 'client', _other) || ' signed the NDA. The fully signed copy is ready to download.', 'nda', _path_link);
      END IF;
      PERFORM public.safe_insert_notification(_actor, 'NDA fully signed',
        'You signed the NDA. Both signatures are on the document and it is ready to download.', 'nda', '/client/contracts?nda=' || _nda.id);
    ELSE
      -- the client is told in-app by the existing notify_nda_signed trigger
      _other := _nda.client_id;
      _other_role := 'client';
      _mail := 'needs_signature';
      _path_link := '/client/contracts?nda=' || _nda.id;
    END IF;
    SELECT p.preferred_language INTO _lang FROM public.profiles p WHERE p.user_id = _other;
  END IF;

  RETURN jsonb_build_object('signature_id', _sig_id, 'nda_id', _nda.id, 'party', _party, 'idempotent', false, 'document_hash', _hash,
    'notify', CASE WHEN _other IS NOT NULL THEN jsonb_build_object('user_id', _other, 'role', _other_role, 'kind', _mail,
      'lang', CASE WHEN _lang ILIKE 'ar%' THEN 'ar' ELSE 'en' END, 'signer', public.nda_party_display(_nda.id, _party, _other), 'path', _path_link) END);
END $$;

-- ------------------------------------------------------------------ status for the NDA boxes

-- One NDA (by id) or the pair (consultant + client) as the signed-in party (or an admin) sees it. Evidence carries the
-- masked ID only. last_reminder_at is the viewer's own last reminder for this pair.
CREATE OR REPLACE FUNCTION public.nda_signature_status(_nda uuid DEFAULT NULL, _consultant uuid DEFAULT NULL, _client uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _admin boolean := public.nda_is_admin(auth.uid());
  _row public.nda_agreements;
  _party text;
  _cons_user uuid;
  _found boolean := false;
  ev jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'nda_not_signed_in' USING ERRCODE = '42501'; END IF;
  IF _nda IS NOT NULL THEN
    SELECT * INTO _row FROM public.nda_agreements WHERE id = _nda;
    _found := FOUND;
    IF NOT _found THEN RAISE EXCEPTION 'nda_not_found' USING ERRCODE = '42501'; END IF;
    _consultant := _row.consultant_id; _client := _row.client_id;
  ELSE
    IF _consultant IS NULL OR _client IS NULL THEN RAISE EXCEPTION 'nda_not_found' USING ERRCODE = '22023'; END IF;
    SELECT * INTO _row FROM public.nda_agreements WHERE consultant_id = _consultant AND client_id = _client
     ORDER BY (revoked_at IS NULL) DESC, signed_at DESC LIMIT 1;
    _found := FOUND;
  END IF;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _consultant;
  _party := CASE WHEN _client = _uid THEN 'client' WHEN _cons_user = _uid THEN 'consultant' WHEN _admin THEN 'admin' END;
  IF _party IS NULL THEN RAISE EXCEPTION 'nda_not_found' USING ERRCODE = '42501'; END IF;

  SELECT jsonb_object_agg(g.party, jsonb_build_object('signature_id', g.id, 'kind', g.kind, 'method', g.method, 'signer_name', g.signer_name,
           'job_title', g.job_title, 'company_name', g.company_name, 'id_type', g.id_type, 'id_country', g.id_country, 'id_masked', g.id_masked,
           'document_hash', g.document_hash, 'image_sha256', g.image_sha256, 'signed_at', g.signed_at, 'captured_at', g.captured_at))
    INTO ev FROM public.nda_signatures g WHERE _found AND g.nda_id = _row.id;

  RETURN jsonb_build_object(
    'available', true,
    'nda_id', CASE WHEN _found THEN _row.id END,
    'consultant_id', _consultant,
    'client_id', _client,
    'revoked_at', CASE WHEN _found THEN _row.revoked_at END,
    'document_hash', CASE WHEN _found THEN public.nda_doc_hash(_row.nda_content) END,
    'my_party', _party,
    'consultant', jsonb_build_object('signed_at', CASE WHEN _found THEN _row.signed_at END,
                                     'legacy', _found AND _row.signed_at IS NOT NULL AND NOT (COALESCE(ev, '{}'::jsonb) ? 'consultant'),
                                     'evidence', COALESCE(ev, '{}'::jsonb) -> 'consultant'),
    'client', jsonb_build_object('signed_at', CASE WHEN _found THEN _row.client_signed_at END,
                                 'legacy', _found AND _row.client_signed_at IS NOT NULL AND NOT (COALESCE(ev, '{}'::jsonb) ? 'client'),
                                 'evidence', COALESCE(ev, '{}'::jsonb) -> 'client'),
    'last_reminder_at', (SELECT max(e.created_at) FROM public.nda_signature_events e
                          WHERE e.action = 'remind' AND e.actor = _uid AND e.consultant_id = _consultant AND e.client_id = _client),
    'reminder_hours', (public.nda_sig_settings() ->> 'reminder_hours')::int);
END $$;

CREATE OR REPLACE FUNCTION public.nda_signing_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.nda_sig_settings() || jsonb_build_object('available', true)
$$;

-- "View / download": logged per party (rate-limited so the log can not be flooded).
CREATE OR REPLACE FUNCTION public.nda_log_download(_nda uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.nda_agreements;
  _party text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'nda_not_signed_in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _row FROM public.nda_agreements WHERE id = _nda;
  IF NOT FOUND THEN RAISE EXCEPTION 'nda_not_found' USING ERRCODE = '42501'; END IF;
  _party := COALESCE(public.nda_party_of(_nda, _uid), CASE WHEN public.nda_is_admin(_uid) THEN 'admin' END);
  IF _party IS NULL THEN RAISE EXCEPTION 'nda_not_found' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.nda_signature_events e WHERE e.actor = _uid AND e.action = 'download' AND e.created_at > now() - interval '1 hour') >= 60 THEN
    RETURN false;
  END IF;
  INSERT INTO public.nda_signature_events (nda_id, consultant_id, client_id, actor, action, detail)
  VALUES (_nda, _row.consultant_id, _row.client_id, _uid, 'download', jsonb_build_object('as', _party, 'fully_signed', _row.client_signed_at IS NOT NULL));
  RETURN true;
END $$;

-- ------------------------------------------------------------------ reminders (edge function only)

-- consultant -> client (an NDA waits for the client's signature) or client -> consultant (no NDA signed by the
-- consultant yet). 1 per reminder window per sender and pair; the in-app notice is a "Reminder" (pausable).
CREATE OR REPLACE FUNCTION public.nda_reminder_record(_actor uuid, _nda uuid DEFAULT NULL, _consultant uuid DEFAULT NULL, _client uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.nda_agreements;
  _target uuid;
  _role text;
  _hours int := (public.nda_sig_settings() ->> 'reminder_hours')::int;
  _last timestamptz;
  _from text;
  _link text;
  _lang text;
  _cons_user uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'nda_not_signed_in' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _actor::text, true);
  IF _nda IS NOT NULL THEN
    SELECT * INTO _row FROM public.nda_agreements WHERE id = _nda;
    IF NOT FOUND OR public.nda_party_of(_nda, _actor) IS DISTINCT FROM 'consultant' THEN RAISE EXCEPTION 'nda_not_your_party' USING ERRCODE = '42501'; END IF;
    IF _row.revoked_at IS NOT NULL OR _row.client_signed_at IS NOT NULL THEN RAISE EXCEPTION 'nda_nothing_to_remind' USING ERRCODE = '22023'; END IF;
    _consultant := _row.consultant_id; _client := _row.client_id;
    _target := _row.client_id; _role := 'client';
    _from := public.nda_party_display(_nda, 'consultant', _target);
    _link := '/client/contracts?nda=' || _nda;
  ELSE
    IF _client IS DISTINCT FROM _actor OR _consultant IS NULL THEN RAISE EXCEPTION 'nda_not_your_party' USING ERRCODE = '42501'; END IF;
    SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _consultant;
    IF _cons_user IS NULL OR _cons_user = _actor THEN RAISE EXCEPTION 'nda_not_your_party' USING ERRCODE = '42501'; END IF;
    IF EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = _consultant AND n.client_id = _client AND n.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'nda_nothing_to_remind' USING ERRCODE = '22023';
    END IF;
    IF NOT (public.consultant_related_to_client(_consultant, _client, true)
            OR (to_regclass('public.sa_members') IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.sa_members m JOIN public.sa_agreements a ON a.id = m.agreement_id
                  WHERE m.consultant_id = _consultant AND a.client_id = _client AND m.status IN ('invited', 'active')))) THEN
      RAISE EXCEPTION 'nda_no_relation' USING ERRCODE = '42501';
    END IF;
    _target := _cons_user; _role := 'consultant';
    _from := COALESCE((SELECT NULLIF(btrim(cp.company_name), '') FROM public.client_profiles cp WHERE cp.user_id = _client), 'The client');
    _link := '/consultant/ndas';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nda-remind:' || _actor::text || ':' || _consultant::text || ':' || _client::text));
  SELECT max(e.created_at) INTO _last FROM public.nda_signature_events e
   WHERE e.action = 'remind' AND e.actor = _actor AND e.consultant_id = _consultant AND e.client_id = _client;
  IF _last IS NOT NULL AND _last > now() - make_interval(hours => _hours) THEN
    RAISE EXCEPTION 'nda_reminder_too_soon' USING ERRCODE = '22023', DETAIL = (_last + make_interval(hours => _hours))::text;
  END IF;
  INSERT INTO public.nda_signature_events (nda_id, consultant_id, client_id, actor, action, detail)
  VALUES (_nda, _consultant, _client, _actor, 'remind', jsonb_build_object('to', _role));
  PERFORM public.safe_insert_notification(_target, 'Reminder: your NDA signature is needed',
    _from || ' is waiting for your signature on the NDA. Open the NDA to review and sign it.', 'nda', _link);
  SELECT p.preferred_language INTO _lang FROM public.profiles p WHERE p.user_id = _target;
  RETURN jsonb_build_object('user_id', _target, 'role', _role, 'kind', 'reminder', 'lang', CASE WHEN _lang ILIKE 'ar%' THEN 'ar' ELSE 'en' END,
                            'signer', _from, 'path', _link, 'nda_id', _nda);
END $$;

-- ------------------------------------------------------------------ full ID number (edge function only)

-- The signer (own record) or an admin (reason of 10+ characters). Every read is logged before the ciphertext is
-- returned; the edge function decrypts it with the backend key.
CREATE OR REPLACE FUNCTION public.nda_identity_cipher_for(_actor uuid, _signature uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.nda_signatory_identity;
  g public.nda_signatures;
  _self boolean;
  _admin boolean := public.nda_is_admin(_actor);
  _why text := btrim(COALESCE(_reason, ''));
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'nda_not_signed_in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.nda_signatory_identity WHERE signature_id = _signature;
  IF NOT FOUND THEN RAISE EXCEPTION 'nda_not_found' USING ERRCODE = '42501'; END IF;
  _self := i.user_id = _actor;
  IF NOT _self AND NOT _admin THEN RAISE EXCEPTION 'nda_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT _self AND length(_why) < 10 THEN RAISE EXCEPTION 'nda_reason_required' USING ERRCODE = '22023'; END IF;
  IF i.id_cipher IS NULL THEN RAISE EXCEPTION 'nda_identity_anonymised' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.nda_identity_access_log l WHERE l.actor = _actor AND l.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'nda_rate_limited' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO g FROM public.nda_signatures WHERE id = _signature;
  INSERT INTO public.nda_identity_access_log (identity_id, signature_id, actor, actor_role, reason)
  VALUES (i.id, _signature, _actor, CASE WHEN _self THEN 'self' ELSE 'admin' END, left(CASE WHEN _self AND length(_why) < 3 THEN 'own record' ELSE _why END, 500));
  INSERT INTO public.nda_signature_events (nda_id, consultant_id, client_id, actor, action, detail)
  SELECT g.nda_id, n.consultant_id, n.client_id, _actor, 'view_full_id', jsonb_build_object('signature_id', _signature, 'as', CASE WHEN _self THEN 'self' ELSE 'admin' END)
  FROM public.nda_agreements n WHERE n.id = g.nda_id;
  RETURN jsonb_build_object('cipher', i.id_cipher, 'user_id', i.user_id, 'id_type', i.id_type, 'id_country', i.id_country, 'id_masked', i.id_masked);
END $$;

-- ------------------------------------------------------------------ admin

CREATE OR REPLACE FUNCTION public.nda_admin_signatures(_q text DEFAULT NULL, _limit int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _qq text := NULLIF(btrim(COALESCE(_q, '')), '');
BEGIN
  IF NOT public.nda_is_admin(auth.uid()) THEN RAISE EXCEPTION 'nda_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x ->> 'created_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'nda_id', n.id, 'created_at', n.created_at, 'revoked_at', n.revoked_at,
        'consultant_name', COALESCE(NULLIF(btrim(pc.display_name), ''), 'Consultant'),
        'client_name', COALESCE(NULLIF(btrim(cp.company_name), ''), NULLIF(btrim(pl.display_name), ''), 'Client'),
        'consultant_signed_at', n.signed_at, 'client_signed_at', n.client_signed_at,
        'document_hash', public.nda_doc_hash(n.nda_content),
        'signatures', COALESCE((SELECT jsonb_agg(jsonb_build_object('signature_id', g.id, 'party', g.party, 'kind', g.kind, 'method', g.method,
                     'signer_name', g.signer_name, 'job_title', g.job_title, 'company_name', g.company_name, 'id_type', g.id_type, 'id_country', g.id_country,
                     'id_masked', g.id_masked, 'signed_at', g.signed_at, 'captured_at', g.captured_at, 'image_sha256', g.image_sha256,
                     'anonymised', i.anonymised_at IS NOT NULL, 'full_id_views', (SELECT count(*) FROM public.nda_identity_access_log l WHERE l.signature_id = g.id)))
                   FROM public.nda_signatures g LEFT JOIN public.nda_signatory_identity i ON i.signature_id = g.id WHERE g.nda_id = n.id), '[]'::jsonb)) AS x
      FROM public.nda_agreements n
      LEFT JOIN public.consultants c ON c.id = n.consultant_id
      LEFT JOIN public.profiles pc ON pc.user_id = c.user_id
      LEFT JOIN public.profiles pl ON pl.user_id = n.client_id
      LEFT JOIN public.client_profiles cp ON cp.user_id = n.client_id
      WHERE _qq IS NULL OR pc.display_name ILIKE '%' || _qq || '%' OR pl.display_name ILIKE '%' || _qq || '%' OR cp.company_name ILIKE '%' || _qq || '%'
         OR EXISTS (SELECT 1 FROM public.nda_signatures g WHERE g.nda_id = n.id AND g.signer_name ILIKE '%' || _qq || '%')
      ORDER BY n.created_at DESC
      LIMIT LEAST(GREATEST(COALESCE(_limit, 200), 1), 500)
    ) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.nda_admin_access_log(_signature uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.nda_is_admin(auth.uid()) THEN RAISE EXCEPTION 'nda_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('at', l.created_at, 'role', l.actor_role, 'reason', l.reason,
                     'by', COALESCE(NULLIF(btrim(p.display_name), ''), 'User')) ORDER BY l.created_at DESC)
                   FROM public.nda_identity_access_log l LEFT JOIN public.profiles p ON p.user_id = l.actor
                   WHERE l.signature_id = _signature), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.nda_admin_set_signing_settings(_patch jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur jsonb := public.nda_sig_settings();
  k text;
BEGIN
  IF NOT public.nda_is_admin(auth.uid()) THEN RAISE EXCEPTION 'nda_forbidden' USING ERRCODE = '42501'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'nda_settings_invalid' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF k NOT IN ('allow_typed_signature', 'store_ip', 'id_retention_years', 'reminder_hours') THEN RAISE EXCEPTION 'nda_settings_invalid' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF _patch ? 'allow_typed_signature' AND jsonb_typeof(_patch -> 'allow_typed_signature') <> 'boolean' THEN RAISE EXCEPTION 'nda_settings_invalid' USING ERRCODE = '22023'; END IF;
  IF _patch ? 'store_ip' AND jsonb_typeof(_patch -> 'store_ip') <> 'boolean' THEN RAISE EXCEPTION 'nda_settings_invalid' USING ERRCODE = '22023'; END IF;
  IF _patch ? 'id_retention_years' AND (jsonb_typeof(_patch -> 'id_retention_years') <> 'number' OR (_patch ->> 'id_retention_years')::numeric NOT BETWEEN 1 AND 30
       OR (_patch ->> 'id_retention_years')::numeric <> trunc((_patch ->> 'id_retention_years')::numeric)) THEN RAISE EXCEPTION 'nda_settings_invalid' USING ERRCODE = '22023'; END IF;
  IF _patch ? 'reminder_hours' AND (jsonb_typeof(_patch -> 'reminder_hours') <> 'number' OR (_patch ->> 'reminder_hours')::numeric NOT BETWEEN 24 AND 168
       OR (_patch ->> 'reminder_hours')::numeric <> trunc((_patch ->> 'reminder_hours')::numeric)) THEN RAISE EXCEPTION 'nda_settings_invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('nda_signature', cur || _patch)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.nda_signature_events (actor, action, detail)
  VALUES (auth.uid(), 'settings', jsonb_build_object('before', cur, 'after', public.nda_sig_settings(), 'reason', left(COALESCE(_reason, ''), 300)));
  RETURN public.nda_sig_settings();
END $$;

-- ------------------------------------------------------------------ retention and account erasure

-- Removes the encrypted number (never the evidence) for NDAs revoked more than id_retention_years ago and for
-- accounts that no longer exist. Daily job + callable by admins.
CREATE OR REPLACE FUNCTION public.nda_identity_retention_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _years int := (public.nda_sig_settings() ->> 'id_retention_years')::int;
  _n integer;
BEGIN
  -- signed-in callers must be admins; the daily job and backend code run without a user
  IF auth.uid() IS NOT NULL AND NOT public.nda_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'nda_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.nda_identity_anonymise', '1', true);
  UPDATE public.nda_signatory_identity i
     SET id_cipher = NULL,
         anonymised_reason = CASE WHEN NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = i.user_id) THEN 'account_erased' ELSE 'retention_period_ended' END
    FROM public.nda_signatures g JOIN public.nda_agreements n ON n.id = g.nda_id
   WHERE g.id = i.signature_id AND i.id_cipher IS NOT NULL
     AND ((n.revoked_at IS NOT NULL AND n.revoked_at + make_interval(years => _years) < now())
          OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = i.user_id));
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.nda_identity_anonymise', '0', true);
  IF _n > 0 THEN
    INSERT INTO public.nda_signature_events (actor, action, detail) VALUES (auth.uid(), 'anonymise', jsonb_build_object('source', 'retention', 'count', _n, 'years', _years));
  END IF;
  RETURN _n;
END $$;

-- Account erasure: the person's ID numbers are removed at once; name, masked form, hashes and times stay as evidence.
CREATE OR REPLACE FUNCTION public.nda_identity_erase_user(_user uuid, _reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _n integer;
BEGIN
  -- signed-in callers must be admins; the daily job and backend code run without a user
  IF auth.uid() IS NOT NULL AND NOT public.nda_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'nda_forbidden' USING ERRCODE = '42501';
  END IF;
  IF _user IS NULL THEN RAISE EXCEPTION 'nda_not_found' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.nda_identity_anonymise', '1', true);
  UPDATE public.nda_signatory_identity SET id_cipher = NULL, anonymised_reason = left('account_erased ' || COALESCE(_reason, ''), 200)
   WHERE user_id = _user AND id_cipher IS NOT NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.nda_identity_anonymise', '0', true);
  INSERT INTO public.nda_signature_events (actor, action, detail) VALUES (auth.uid(), 'anonymise', jsonb_build_object('source', 'erasure', 'user', _user, 'count', _n));
  RETURN _n;
END $$;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nda-identity-retention') THEN
      PERFORM cron.unschedule('nda-identity-retention');
    END IF;
    PERFORM cron.schedule('nda-identity-retention', '41 3 * * *', 'SELECT public.nda_identity_retention_sweep()');
  END IF;
END $$;

-- ------------------------------------------------------------------ function privileges

REVOKE ALL ON FUNCTION public.nda_sig_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_party_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_party_display(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_text_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_identity_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_sign_record(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_reminder_record(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_identity_cipher_for(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nda_signature_status(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_signing_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_log_download(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_admin_signatures(text, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_admin_access_log(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_admin_set_signing_settings(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_identity_retention_sweep() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nda_identity_erase_user(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.nda_is_admin(uuid), public.nda_party_of(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nda_signature_status(uuid, uuid, uuid), public.nda_signing_settings(), public.nda_log_download(uuid),
  public.nda_admin_signatures(text, int), public.nda_admin_access_log(uuid), public.nda_admin_set_signing_settings(jsonb, text),
  public.nda_identity_retention_sweep(), public.nda_identity_erase_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nda_sig_settings(), public.nda_sign_record(uuid, jsonb), public.nda_reminder_record(uuid, uuid, uuid, uuid),
  public.nda_identity_cipher_for(uuid, uuid, text), public.nda_signature_status(uuid, uuid, uuid), public.nda_signing_settings(),
  public.nda_identity_retention_sweep(), public.nda_identity_erase_user(uuid, text), public.nda_party_display(uuid, text, uuid) TO service_role;
