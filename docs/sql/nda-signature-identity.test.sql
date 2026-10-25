-- Adversarial tests for nda-signature-identity.sql. ONE rolled-back transaction: run on a scratch copy (nothing kept).
-- Each check raises on failure. ND01-ND22.
BEGIN;

-- Fixtures: admin AD; clients CA (Acme) and CB (Beta); consultants K and U (verified, related to CA via projects; U also
-- to CB), X (verified, unrelated), L (verified, has a LEGACY NDA with CA signed before this file).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000da001', 'ad@platform.test'), ('00000000-0000-0000-0000-0000000da002', 'ca@acme.test'),
  ('00000000-0000-0000-0000-0000000da003', 'cb@beta.test'), ('00000000-0000-0000-0000-0000000da004', 'k@cons.test'),
  ('00000000-0000-0000-0000-0000000da005', 'u@cons.test'), ('00000000-0000-0000-0000-0000000da006', 'x@cons.test'),
  ('00000000-0000-0000-0000-0000000da007', 'l@cons.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000da001', 'admin'), ('00000000-0000-0000-0000-0000000da002', 'client'), ('00000000-0000-0000-0000-0000000da003', 'client'),
  ('00000000-0000-0000-0000-0000000da004', 'consultant'), ('00000000-0000-0000-0000-0000000da005', 'consultant'),
  ('00000000-0000-0000-0000-0000000da006', 'consultant'), ('00000000-0000-0000-0000-0000000da007', 'consultant')
ON CONFLICT DO NOTHING;
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000dc004', '00000000-0000-0000-0000-0000000da004'),
  ('00000000-0000-0000-0000-0000000dc005', '00000000-0000-0000-0000-0000000da005'),
  ('00000000-0000-0000-0000-0000000dc006', '00000000-0000-0000-0000-0000000da006'),
  ('00000000-0000-0000-0000-0000000dc007', '00000000-0000-0000-0000-0000000da007');
SET LOCAL session_replication_role = replica;  -- plain fixture values (verification is guarded by triggers)
UPDATE public.consultants SET verification_status = 'verified' WHERE id IN
  ('00000000-0000-0000-0000-0000000dc004', '00000000-0000-0000-0000-0000000dc005', '00000000-0000-0000-0000-0000000dc006', '00000000-0000-0000-0000-0000000dc007');
INSERT INTO public.client_profiles (user_id, company_name) VALUES
  ('00000000-0000-0000-0000-0000000da002', 'Acme Trading'), ('00000000-0000-0000-0000-0000000da003', 'Beta Foods')
ON CONFLICT DO NOTHING;
INSERT INTO public.projects (client_id, consultant_id, title) VALUES
  ('00000000-0000-0000-0000-0000000da002', '00000000-0000-0000-0000-0000000dc004', 'FI support'),
  ('00000000-0000-0000-0000-0000000da002', '00000000-0000-0000-0000-0000000dc005', 'MM support'),
  ('00000000-0000-0000-0000-0000000da003', '00000000-0000-0000-0000-0000000dc005', 'SD support');
-- legacy NDA (signed by both before the stricter step)
INSERT INTO public.nda_agreements (id, consultant_id, client_id, signature_data, signature_type, nda_content, signed_at, client_signature_data, client_signature_type, client_signer_name, client_signed_at)
VALUES ('00000000-0000-0000-0000-0000000dd001', '00000000-0000-0000-0000-0000000dc007', '00000000-0000-0000-0000-0000000da002', 'Layla Samir', 'type',
        'Legacy NDA text between the consultant and Acme Trading, version 2 with 16 clauses.', now() - interval '30 days',
        'Omar Fathy', 'type', 'Omar Fathy', now() - interval '29 days');
SET LOCAL session_replication_role = origin;
DELETE FROM public.platform_settings WHERE key = 'nda_signature';

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
-- run SQL as a database role (+ user), return '' or the error text
CREATE OR REPLACE FUNCTION pg_temp.err_as(_role text, _u uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_u);
  EXECUTE format('SET LOCAL ROLE %I', _role);
  EXECUTE _sql;
  RESET ROLE;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
-- run a query returning one value as a role (+ user)
CREATE OR REPLACE FUNCTION pg_temp.val_as(_role text, _u uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM pg_temp.as_user(_u);
  EXECUTE format('SET LOCAL ROLE %I', _role);
  EXECUTE _sql INTO v;
  RESET ROLE;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.png() RETURNS text LANGUAGE sql AS $$
  SELECT 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAyCAYAAACXpx/YAAABoElEQVR4nO2bMRLCMAwEE95BzaN4II+i5h+hYiZAkrEdSzqdbxsahrG1OUUmMC/LMgleLtELELZIMDkSTM5Qgq+3+7J+HYF5hCFrT+jr+Zi91+INveCStDKLphVc24ZZJVMKLmnJW+9hlEwluPZeO8K9mUbwGVnMaU4vuFcKWdOcVvDRENUqhVFySsHWIphadirBngljSXOaryq9C147eaMCn2CEJGVu2dCCEeQirqUGSMHIxcyWZijBFkcfC5AvwF9gBGcq2jTlWW+44CyF2gO9ZYcKzi73A/I+QgQjF6QV1D25C0YtRC/QWrabYHaxa5D2ai44y9HHAoQ0mwpGupKjiK6BieDoTaERWY/ugiV3n4iW3U2wxJbhXacuz4Mltxzv58ynEiyx5/Bo2U2CRz769MY6JNWClVobrNJcLFhi7bGocdGQJbk+WAxghwmW2Dh6texdwZIbTw8Hf4IlFouzPjYT/PuhkhtPa8s+bNESi0VLmsN/dCfqqUmzBCelNM1p/nwmvik9MyvBBKylKsGEfKRupVoJJkcJJkeCyXkDCRqo2BXLOJ0AAAAASUVORK5CYII='
$$;
-- an uploaded signature file (the edge function writes these with the service key)
CREATE OR REPLACE FUNCTION pg_temp.obj(_u uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE p text := 'signatures/' || _u || '/' || gen_random_uuid() || '.png';
BEGIN
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('nda-documents', p, '{"mimetype": "image/png"}'::jsonb);
  RETURN p;
END $$;
-- a valid signing payload for _u; _x overrides keys
CREATE OR REPLACE FUNCTION pg_temp.pl(_u uuid, _x jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'party', 'consultant', 'kind', 'signature', 'method', 'draw',
    'png_base64', pg_temp.png(), 'image_sha256', encode(sha256(decode(pg_temp.png(), 'base64')), 'hex'), 'image_path', pg_temp.obj(_u),
    'metrics', jsonb_build_object('strokes', 2, 'points', 80, 'length', 420, 'width', 260, 'height', 70),
    'signer_name', 'Karim Hassan', 'id_type', 'passport', 'id_country', 'EG', 'id_masked', 'A1****789',
    'id_cipher', 'v1.0123abcd.AAAAAAAAAAAAAAAA.BBBBBBBBBBBB', 'authorised', true, 'agreed', true,
    'user_agent_hash', repeat('a', 64), 'ip', '203.0.113.9',
    'nda_content', 'Non-Disclosure Agreement v2 between the consultant and the client. Sixteen clauses follow.') || _x
$$;
CREATE OR REPLACE FUNCTION pg_temp.sign(_u uuid, _x jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE p jsonb := pg_temp.pl(_u, _x); r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.nda_sign_record(_u, p);
  RESET ROLE;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.sign_err(_u uuid, _x jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE p jsonb := pg_temp.pl(_u, _x);
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM public.nda_sign_record(_u, p);
  RESET ROLE;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

DO $$
DECLARE
  ad uuid := '00000000-0000-0000-0000-0000000da001'; ca uuid := '00000000-0000-0000-0000-0000000da002'; cb uuid := '00000000-0000-0000-0000-0000000da003';
  k uuid := '00000000-0000-0000-0000-0000000da004'; u uuid := '00000000-0000-0000-0000-0000000da005'; x uuid := '00000000-0000-0000-0000-0000000da006';
  l uuid := '00000000-0000-0000-0000-0000000da007';
  kc uuid := '00000000-0000-0000-0000-0000000dc004'; uc uuid := '00000000-0000-0000-0000-0000000dc005'; xc uuid := '00000000-0000-0000-0000-0000000dc006';
  lc uuid := '00000000-0000-0000-0000-0000000dc007'; legacy uuid := '00000000-0000-0000-0000-0000000dd001';
  r jsonb; s jsonb; nda uuid; nda2 uuid; sig_k uuid; sig_c uuid; e text; n int; t timestamptz;
  kx jsonb;
BEGIN
  kx := jsonb_build_object('consultant_id', kc, 'client_id', ca);

  -- ND01 defaults: typed signature OFF, IP storage OFF, 5 years, 24 h reminders.
  s := public.nda_sig_settings();
  IF (s ->> 'allow_typed_signature')::boolean OR (s ->> 'store_ip')::boolean OR (s ->> 'id_retention_years')::int <> 5 OR (s ->> 'reminder_hours')::int <> 24 THEN
    RAISE EXCEPTION 'ND01 defaults %', s;
  END IF;

  -- ND02 the old direct paths are closed (consultant insert, admin insert, client_sign_nda, the signing RPC from the browser).
  e := pg_temp.err_as('authenticated', k, format($q$INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, signature_type, nda_content) VALUES (%L, %L, 'Karim', 'type', 'Some NDA text that is long enough')$q$, kc, ca));
  IF e = '' THEN RAISE EXCEPTION 'ND02 consultant direct insert allowed'; END IF;
  e := pg_temp.err_as('authenticated', ad, format($q$INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, signature_type, nda_content) VALUES (%L, %L, 'Karim', 'type', 'Some NDA text that is long enough')$q$, kc, ca));
  IF e NOT LIKE '%nda_sign_in_portal%' THEN RAISE EXCEPTION 'ND02 admin insert: %', e; END IF;
  e := pg_temp.err_as('authenticated', ca, format($q$SELECT public.client_sign_nda(%L, 'x', 'type', 'Omar Fathy')$q$, legacy));
  IF e NOT LIKE '%permission denied%' THEN RAISE EXCEPTION 'ND02 client_sign_nda: %', e; END IF;
  e := pg_temp.err_as('authenticated', k, format($q$SELECT public.nda_sign_record(%L, '{}'::jsonb)$q$, k));
  IF e NOT LIKE '%permission denied%' THEN RAISE EXCEPTION 'ND02 sign_record from browser: %', e; END IF;
  e := pg_temp.err_as('service_role', null, format($q$INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, signature_type, nda_content) VALUES (%L, %L, 'Karim', 'type', 'Some NDA text that is long enough')$q$, kc, ca));
  IF e NOT LIKE '%nda_sign_in_portal%' THEN RAISE EXCEPTION 'ND02 backend direct insert: %', e; END IF;

  -- ND03 every item is checked server-side.
  IF pg_temp.sign_err(k, kx || '{"signer_name": "Karim"}') NOT LIKE '%nda_name_invalid%' THEN RAISE EXCEPTION 'ND03 one word'; END IF;
  IF pg_temp.sign_err(k, kx || '{"signer_name": "Karim 2 Hassan"}') NOT LIKE '%nda_name_invalid%' THEN RAISE EXCEPTION 'ND03 digits'; END IF;
  IF pg_temp.sign_err(k, kx || '{"id_masked": "AB12"}') NOT LIKE '%nda_id_invalid%' THEN RAISE EXCEPTION 'ND03 masked'; END IF;
  IF pg_temp.sign_err(k, kx || '{"id_type": "national_id", "id_masked": "1**4"}') NOT LIKE '%nda_id_invalid%' THEN RAISE EXCEPTION 'ND03 national too short'; END IF;
  IF pg_temp.sign_err(k, kx || '{"id_type": "driving_licence"}') NOT LIKE '%nda_id_type_invalid%' THEN RAISE EXCEPTION 'ND03 id type'; END IF;
  IF pg_temp.sign_err(k, kx || '{"id_country": "IL"}') NOT LIKE '%nda_id_country_invalid%' THEN RAISE EXCEPTION 'ND03 country'; END IF;
  IF pg_temp.sign_err(k, kx || '{"id_cipher": "1234567890"}') NOT LIKE '%nda_id_cipher_invalid%' THEN RAISE EXCEPTION 'ND03 cipher'; END IF;
  IF pg_temp.sign_err(k, kx || '{"method": "typed"}') NOT LIKE '%nda_typed_not_allowed%' THEN RAISE EXCEPTION 'ND03 typed'; END IF;
  -- empty pad, a dot, a tiny scribble
  IF pg_temp.sign_err(k, kx || '{"metrics": {"strokes": 0, "points": 0, "length": 0, "width": 0, "height": 0}}') NOT LIKE '%nda_signature_too_small%' THEN RAISE EXCEPTION 'ND03 empty'; END IF;
  IF pg_temp.sign_err(k, kx || '{"metrics": {"strokes": 1, "points": 2, "length": 1, "width": 1, "height": 1}}') NOT LIKE '%nda_signature_too_small%' THEN RAISE EXCEPTION 'ND03 dot'; END IF;
  IF pg_temp.sign_err(k, kx || '{"metrics": {"strokes": 1, "points": 40, "length": 300, "width": 30, "height": 10}}') NOT LIKE '%nda_signature_too_small%' THEN RAISE EXCEPTION 'ND03 too small'; END IF;
  -- not a PNG (an SVG, a GIF), a hash that does not match, a file that was never uploaded
  IF pg_temp.sign_err(k, kx || jsonb_build_object('png_base64', encode(convert_to('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>' || repeat(' ', 120), 'UTF8'), 'base64')))
     NOT LIKE '%nda_signature_image_invalid%' THEN RAISE EXCEPTION 'ND03 svg'; END IF;
  IF pg_temp.sign_err(k, kx || jsonb_build_object('png_base64', 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')) NOT LIKE '%nda_signature_image_invalid%' THEN RAISE EXCEPTION 'ND03 gif'; END IF;
  IF pg_temp.sign_err(k, kx || jsonb_build_object('image_sha256', repeat('0', 64))) NOT LIKE '%nda_signature_hash_mismatch%' THEN RAISE EXCEPTION 'ND03 hash'; END IF;
  IF pg_temp.sign_err(k, kx || jsonb_build_object('image_path', 'signatures/' || k || '/' || gen_random_uuid() || '.png')) NOT LIKE '%nda_signature_file_missing%' THEN RAISE EXCEPTION 'ND03 file'; END IF;
  IF pg_temp.sign_err(k, kx || jsonb_build_object('image_path', 'signatures/' || u || '/' || gen_random_uuid() || '.png')) NOT LIKE '%nda_signature_file_missing%' THEN RAISE EXCEPTION 'ND03 other user file'; END IF;
  IF pg_temp.sign_err(k, kx || '{"authorised": false}') NOT LIKE '%nda_confirmation_required%' THEN RAISE EXCEPTION 'ND03 authorised'; END IF;
  IF pg_temp.sign_err(k, kx - 'agreed') NOT LIKE '%nda_confirmation_required%' THEN RAISE EXCEPTION 'ND03 agreed'; END IF;
  IF pg_temp.sign_err(k, kx || '{"job_title": "Call me on +966 55 123 4567"}') NOT LIKE '%nda_contact_details%' THEN RAISE EXCEPTION 'ND03 contact filter'; END IF;
  -- legitimate names from other scripts and with hyphen / apostrophe pass the name rule
  IF NOT public.nda_name_ok('مُحَمَّد بن سلمان') OR NOT public.nda_name_ok('Jean-Luc O''Neil') OR NOT public.nda_name_ok('Ana María López') THEN RAISE EXCEPTION 'ND03 legit names'; END IF;

  -- ND04 the signer must be that party: X is not related to CA, K can not sign as consultant X, nobody signs for himself.
  IF pg_temp.sign_err(x, jsonb_build_object('consultant_id', xc, 'client_id', ca)) NOT LIKE '%nda_no_relation%' THEN RAISE EXCEPTION 'ND04 relation'; END IF;
  IF pg_temp.sign_err(k, jsonb_build_object('consultant_id', xc, 'client_id', ca)) NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND04 other consultant'; END IF;
  IF pg_temp.sign_err(ad, jsonb_build_object('consultant_id', kc, 'client_id', ca)) NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND04 admin for consultant'; END IF;
  IF pg_temp.sign_err(k, jsonb_build_object('consultant_id', kc, 'client_id', k)) NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND04 self'; END IF;

  -- ND05 the consultant signs: NDA row (same columns as before), evidence, identity, event; client must be told; no IP stored.
  r := pg_temp.sign(k, kx);
  nda := (r ->> 'nda_id')::uuid; sig_k := (r ->> 'signature_id')::uuid;
  IF (r ->> 'idempotent')::boolean OR r -> 'notify' ->> 'user_id' <> ca::text OR r -> 'notify' ->> 'kind' <> 'needs_signature' THEN RAISE EXCEPTION 'ND05 result %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nda_agreements WHERE id = nda AND signed_at IS NOT NULL AND client_signed_at IS NULL AND signature_type = 'draw'
                   AND signature_data LIKE 'data:image/png;base64,%' AND ip_address IS NULL AND revoked_at IS NULL) THEN RAISE EXCEPTION 'ND05 nda row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nda_signatures g JOIN public.nda_signatory_identity i ON i.signature_id = g.id
                  WHERE g.id = sig_k AND g.party = 'consultant' AND g.signer_name = 'Karim Hassan' AND g.id_masked = 'A1****789' AND g.ip_address IS NULL
                    AND g.document_hash = public.nda_doc_hash((SELECT nda_content FROM public.nda_agreements WHERE id = nda))
                    AND g.image_sha256 = encode(sha256(decode(pg_temp.png(), 'base64')), 'hex') AND i.id_cipher IS NOT NULL AND i.user_id = k) THEN RAISE EXCEPTION 'ND05 evidence'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = ca AND type = 'nda') THEN RAISE EXCEPTION 'ND05 client notified'; END IF;

  -- ND06 idempotent double submit: same result, still one NDA, one evidence row.
  r := pg_temp.sign(k, kx);
  IF NOT (r ->> 'idempotent')::boolean OR (r ->> 'signature_id')::uuid <> sig_k THEN RAISE EXCEPTION 'ND06 idempotent %', r; END IF;
  IF (SELECT count(*) FROM public.nda_agreements WHERE consultant_id = kc AND client_id = ca) <> 1
     OR (SELECT count(*) FROM public.nda_signatures WHERE nda_id = nda) <> 1 THEN RAISE EXCEPTION 'ND06 duplicates'; END IF;

  -- ND07 nobody signs the other side: K as client, CB on Acme's NDA, the admin for the client.
  IF pg_temp.sign_err(k, jsonb_build_object('party', 'client', 'nda_id', nda, 'job_title', 'Lead', 'company_name', 'Acme Trading')) NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND07 consultant as client'; END IF;
  IF pg_temp.sign_err(cb, jsonb_build_object('party', 'client', 'nda_id', nda, 'job_title', 'Lead', 'company_name', 'Beta Foods')) NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND07 other client'; END IF;
  IF pg_temp.sign_err(ad, jsonb_build_object('party', 'client', 'nda_id', nda, 'job_title', 'Lead', 'company_name', 'Acme Trading')) NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND07 admin as client'; END IF;
  -- a client signing on behalf of the company needs job title + company
  IF pg_temp.sign_err(ca, jsonb_build_object('party', 'client', 'nda_id', nda, 'signer_name', 'Omar Fathy')) NOT LIKE '%nda_company_details_required%' THEN RAISE EXCEPTION 'ND07 company'; END IF;

  -- ND08 the client countersigns: in force, gates see it (has_active_nda, support-agreement crew check); consultant told.
  r := pg_temp.sign(ca, jsonb_build_object('party', 'client', 'nda_id', nda, 'signer_name', 'Omar Fathy', 'job_title', 'IT Director', 'company_name', 'Acme Trading',
                                           'id_type', 'national_id', 'id_country', 'SA', 'id_masked', '10*****321'));
  sig_c := (r ->> 'signature_id')::uuid;
  IF r -> 'notify' ->> 'kind' <> 'fully_signed' OR r -> 'notify' ->> 'user_id' <> k::text THEN RAISE EXCEPTION 'ND08 notify %', r; END IF;
  IF (SELECT client_signed_at FROM public.nda_agreements WHERE id = nda) IS NULL OR (SELECT client_signer_name FROM public.nda_agreements WHERE id = nda) <> 'Omar Fathy' THEN RAISE EXCEPTION 'ND08 row'; END IF;
  IF pg_temp.val_as('authenticated', ca, format('SELECT public.has_active_nda(%L, %L)::text', kc, ca)) <> 'true' THEN RAISE EXCEPTION 'ND08 has_active_nda'; END IF;
  IF to_regprocedure('public.sa_member_nda_ok(uuid,uuid)') IS NOT NULL AND NOT public.sa_member_nda_ok(ca, kc) THEN RAISE EXCEPTION 'ND08 sa gate'; END IF;
  s := (pg_temp.val_as('authenticated', k, format('SELECT public.nda_signature_status(%L)::text', nda)))::jsonb;
  IF s ->> 'my_party' <> 'consultant' OR (s -> 'client' ->> 'legacy')::boolean OR s -> 'client' -> 'evidence' ->> 'id_masked' <> '10*****321'
     OR (s -> 'client' -> 'evidence') ? 'id_cipher' OR s::text LIKE '%v1.0123abcd%' THEN RAISE EXCEPTION 'ND08 status %', s; END IF;

  -- ND09 privacy: other users see nothing; the other party sees masked evidence but never an identity row or the ciphertext.
  IF pg_temp.val_as('authenticated', cb, format('SELECT count(*)::text FROM public.nda_signatures WHERE nda_id = %L', nda)) <> '0' THEN RAISE EXCEPTION 'ND09 other client evidence'; END IF;
  IF pg_temp.val_as('authenticated', x, 'SELECT count(*)::text FROM public.nda_signatory_identity') <> '0' THEN RAISE EXCEPTION 'ND09 other consultant identity'; END IF;
  IF pg_temp.val_as('authenticated', k, format('SELECT count(*)::text FROM public.nda_signatures WHERE nda_id = %L', nda)) <> '2' THEN RAISE EXCEPTION 'ND09 party evidence'; END IF;
  IF pg_temp.val_as('authenticated', k, 'SELECT count(*)::text FROM public.nda_signatory_identity') <> '1' THEN RAISE EXCEPTION 'ND09 only own identity'; END IF;
  IF pg_temp.err_as('authenticated', k, 'SELECT id_cipher FROM public.nda_signatory_identity') NOT LIKE '%permission denied%' THEN RAISE EXCEPTION 'ND09 cipher column (own)'; END IF;
  IF pg_temp.err_as('authenticated', ad, 'SELECT id_cipher FROM public.nda_signatory_identity') NOT LIKE '%permission denied%' THEN RAISE EXCEPTION 'ND09 cipher column (admin)'; END IF;
  IF pg_temp.err_as('authenticated', k, 'SELECT ip_address, image_path FROM public.nda_signatures') NOT LIKE '%permission denied%' THEN RAISE EXCEPTION 'ND09 ip column'; END IF;
  IF pg_temp.err_as('authenticated', cb, format('SELECT public.nda_signature_status(%L)', nda)) NOT LIKE '%nda_not_found%' THEN RAISE EXCEPTION 'ND09 status third party'; END IF;
  IF pg_temp.val_as('authenticated', ca, 'SELECT count(*)::text FROM public.nda_signature_events') <> '0' THEN RAISE EXCEPTION 'ND09 events admin only'; END IF;

  -- ND10 append-only: evidence, identity, logs (also for the database owner and admins); signed NDA columns frozen for admins.
  BEGIN UPDATE public.nda_signatures SET signer_name = 'Someone Else' WHERE id = sig_k; RAISE EXCEPTION 'ND10 evidence update allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%nda_record_immutable%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.nda_signatory_identity WHERE signature_id = sig_k; RAISE EXCEPTION 'ND10 identity delete allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%nda_record_immutable%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.nda_signatory_identity SET id_masked = 'ZZ****999' WHERE signature_id = sig_k; RAISE EXCEPTION 'ND10 identity update allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%nda_record_immutable%' THEN RAISE; END IF; END;
  e := pg_temp.err_as('authenticated', ad, format($q$UPDATE public.nda_agreements SET client_signer_name = 'Admin Override' WHERE id = %L$q$, nda));
  IF e NOT LIKE '%can not be edited%' THEN RAISE EXCEPTION 'ND10 admin edits signature: %', e; END IF;
  IF pg_temp.err_as('authenticated', ad, format('DELETE FROM public.nda_agreements WHERE id = %L', nda)) = '' THEN RAISE EXCEPTION 'ND10 admin deletes signed NDA with evidence'; END IF;

  -- ND11 full ID number: only the signer and admins (with a reason); every read logged.
  BEGIN
    SET LOCAL ROLE service_role;
    BEGIN PERFORM public.nda_identity_cipher_for(cb, sig_k, 'curious about it'); RAISE EXCEPTION 'ND11 third party read';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%nda_forbidden%' THEN RAISE; END IF; END;
    BEGIN PERFORM public.nda_identity_cipher_for(ca, sig_k, 'other party wants it'); RAISE EXCEPTION 'ND11 other party read';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%nda_forbidden%' THEN RAISE; END IF; END;
    BEGIN PERFORM public.nda_identity_cipher_for(ad, sig_k, 'short'); RAISE EXCEPTION 'ND11 admin without reason';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%nda_reason_required%' THEN RAISE; END IF; END;
    r := public.nda_identity_cipher_for(ad, sig_k, 'Court request 2026/117 identity check');
    IF r ->> 'cipher' NOT LIKE 'v1.%' THEN RAISE EXCEPTION 'ND11 admin cipher'; END IF;
    r := public.nda_identity_cipher_for(k, sig_k, NULL);
    RESET ROLE;
  END;
  IF (SELECT count(*) FROM public.nda_identity_access_log WHERE signature_id = sig_k AND actor = ad AND actor_role = 'admin' AND reason LIKE 'Court request%') <> 1
     OR (SELECT count(*) FROM public.nda_identity_access_log WHERE signature_id = sig_k AND actor = k AND actor_role = 'self') <> 1 THEN RAISE EXCEPTION 'ND11 log'; END IF;
  IF pg_temp.val_as('authenticated', k, 'SELECT count(*)::text FROM public.nda_identity_access_log') <> '2' THEN RAISE EXCEPTION 'ND11 signer sees who read'; END IF;

  -- ND12 legacy NDA: still signed for every gate, marked legacy, new signature refused, details can be added (never changes the NDA).
  IF pg_temp.val_as('authenticated', ca, format('SELECT public.has_active_nda(%L, %L)::text', lc, ca)) <> 'true' THEN RAISE EXCEPTION 'ND12 legacy has_active_nda'; END IF;
  IF to_regprocedure('public.sa_member_nda_ok(uuid,uuid)') IS NOT NULL AND NOT public.sa_member_nda_ok(ca, lc) THEN RAISE EXCEPTION 'ND12 legacy sa gate'; END IF;
  s := (pg_temp.val_as('authenticated', ca, format('SELECT public.nda_signature_status(%L)::text', legacy)))::jsonb;
  IF NOT (s -> 'client' ->> 'legacy')::boolean OR NOT (s -> 'consultant' ->> 'legacy')::boolean THEN RAISE EXCEPTION 'ND12 legacy flags %', s; END IF;
  IF pg_temp.sign_err(l, jsonb_build_object('consultant_id', lc, 'client_id', ca, 'signer_name', 'Layla Samir')) NOT LIKE '%nda_already_signed%' THEN RAISE EXCEPTION 'ND12 resign'; END IF;
  t := (SELECT signed_at FROM public.nda_agreements WHERE id = legacy);
  r := pg_temp.sign(l, jsonb_build_object('kind', 'supplement', 'nda_id', legacy, 'signer_name', 'Layla Samir'));
  IF (SELECT signed_at FROM public.nda_signatures WHERE id = (r ->> 'signature_id')::uuid) <> t OR (SELECT signed_at FROM public.nda_agreements WHERE id = legacy) <> t
     OR (SELECT kind FROM public.nda_signatures WHERE id = (r ->> 'signature_id')::uuid) <> 'supplement' OR r ? 'notify' AND r -> 'notify' <> 'null'::jsonb THEN RAISE EXCEPTION 'ND12 supplement %', r; END IF;
  s := (pg_temp.val_as('authenticated', ca, format('SELECT public.nda_signature_status(%L)::text', legacy)))::jsonb;
  IF (s -> 'consultant' ->> 'legacy')::boolean OR NOT (s -> 'client' ->> 'legacy')::boolean THEN RAISE EXCEPTION 'ND12 after supplement %', s; END IF;

  -- ND13 reminders: consultant -> client once per 24 h; client -> consultant only while the consultant has not signed.
  r := pg_temp.sign(u, jsonb_build_object('consultant_id', uc, 'client_id', ca, 'signer_name', 'Yousef Adel'));
  nda2 := (r ->> 'nda_id')::uuid;
  SET LOCAL ROLE service_role;
  r := public.nda_reminder_record(u, nda2, NULL, NULL);
  RESET ROLE;
  IF r ->> 'user_id' <> ca::text OR r ->> 'kind' <> 'reminder' THEN RAISE EXCEPTION 'ND13 reminder %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = ca AND title LIKE 'Reminder:%') THEN RAISE EXCEPTION 'ND13 in-app reminder'; END IF;
  e := pg_temp.err_as('service_role', null, format('SELECT public.nda_reminder_record(%L, %L, NULL, NULL)', u, nda2));
  IF e NOT LIKE '%nda_reminder_too_soon%' THEN RAISE EXCEPTION 'ND13 rate limit: %', e; END IF;
  e := pg_temp.err_as('service_role', null, format('SELECT public.nda_reminder_record(%L, %L, NULL, NULL)', ca, nda2));
  IF e NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND13 client reminds via consultant NDA: %', e; END IF;
  e := pg_temp.err_as('service_role', null, format('SELECT public.nda_reminder_record(%L, NULL, %L, %L)', ca, kc, ca));
  IF e NOT LIKE '%nda_nothing_to_remind%' THEN RAISE EXCEPTION 'ND13 already signed: %', e; END IF;
  e := pg_temp.err_as('service_role', null, format('SELECT public.nda_reminder_record(%L, NULL, %L, %L)', ca, xc, ca));
  IF e NOT LIKE '%nda_no_relation%' THEN RAISE EXCEPTION 'ND13 unrelated consultant: %', e; END IF;
  e := pg_temp.err_as('service_role', null, format('SELECT public.nda_reminder_record(%L, NULL, %L, %L)', cb, uc, ca));
  IF e NOT LIKE '%nda_not_your_party%' THEN RAISE EXCEPTION 'ND13 reminder for another company: %', e; END IF;
  s := (pg_temp.val_as('authenticated', u, format('SELECT public.nda_signature_status(%L)::text', nda2)))::jsonb;
  IF s ->> 'last_reminder_at' IS NULL THEN RAISE EXCEPTION 'ND13 last reminder shown'; END IF;
  -- client -> consultant before the consultant signed (U and Beta Foods)
  SET LOCAL ROLE service_role;
  r := public.nda_reminder_record(cb, NULL, uc, cb);
  RESET ROLE;
  IF r ->> 'user_id' <> u::text THEN RAISE EXCEPTION 'ND13 client reminder %', r; END IF;

  -- ND14 settings: only admins, values bounded.
  IF pg_temp.err_as('authenticated', ca, $q$SELECT public.nda_admin_set_signing_settings('{"allow_typed_signature": true}'::jsonb)$q$) NOT LIKE '%nda_forbidden%' THEN RAISE EXCEPTION 'ND14 client'; END IF;
  IF pg_temp.err_as('authenticated', ad, $q$SELECT public.nda_admin_set_signing_settings('{"reminder_hours": 1}'::jsonb)$q$) NOT LIKE '%nda_settings_invalid%' THEN RAISE EXCEPTION 'ND14 bounds'; END IF;
  IF pg_temp.err_as('authenticated', ad, $q$SELECT public.nda_admin_set_signing_settings('{"secret": 1}'::jsonb)$q$) NOT LIKE '%nda_settings_invalid%' THEN RAISE EXCEPTION 'ND14 unknown key'; END IF;
  PERFORM pg_temp.val_as('authenticated', ad, $q$SELECT public.nda_admin_set_signing_settings('{"allow_typed_signature": true, "store_ip": true}'::jsonb, 'pilot')::text$q$);

  -- ND15 typed signature (setting ON) and IP stored only while store_ip is ON.
  r := pg_temp.sign(u, jsonb_build_object('consultant_id', uc, 'client_id', cb, 'signer_name', 'Yousef Adel', 'method', 'typed',
                                          'metrics', '{"strokes": 0, "points": 0, "length": 0, "width": 0, "height": 0}'::jsonb));
  IF NOT EXISTS (SELECT 1 FROM public.nda_signatures WHERE id = (r ->> 'signature_id')::uuid AND method = 'typed' AND ip_address = '203.0.113.9')
     OR (SELECT signature_type FROM public.nda_agreements WHERE id = (r ->> 'nda_id')::uuid) <> 'type' THEN RAISE EXCEPTION 'ND15 typed + ip'; END IF;

  -- ND16 revoked NDA can not be countersigned; revoking stays possible for the client.
  e := pg_temp.err_as('authenticated', ca, format('UPDATE public.nda_agreements SET revoked_at = now() WHERE id = %L', nda2));
  IF e <> '' OR (SELECT revoked_at FROM public.nda_agreements WHERE id = nda2) IS NULL THEN RAISE EXCEPTION 'ND16 revoke: %', e; END IF;
  IF pg_temp.sign_err(ca, jsonb_build_object('party', 'client', 'nda_id', nda2, 'signer_name', 'Omar Fathy', 'job_title', 'IT Director', 'company_name', 'Acme Trading'))
     NOT LIKE '%nda_revoked%' THEN RAISE EXCEPTION 'ND16 sign revoked'; END IF;

  -- ND17 download log: parties only.
  IF pg_temp.val_as('authenticated', ca, format('SELECT public.nda_log_download(%L)::text', nda)) <> 'true' THEN RAISE EXCEPTION 'ND17 party download'; END IF;
  IF pg_temp.err_as('authenticated', cb, format('SELECT public.nda_log_download(%L)', nda)) NOT LIKE '%nda_not_found%' THEN RAISE EXCEPTION 'ND17 third party download'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nda_signature_events WHERE action = 'download' AND actor = ca AND nda_id = nda) THEN RAISE EXCEPTION 'ND17 logged'; END IF;

  -- ND18 admin screen: list + access log, admins only, masked values only.
  s := (pg_temp.val_as('authenticated', ad, 'SELECT public.nda_admin_signatures(NULL, 50)::text'))::jsonb;
  IF jsonb_array_length(s) < 3 OR s::text LIKE '%v1.0123abcd%' THEN RAISE EXCEPTION 'ND18 admin list'; END IF;
  IF pg_temp.err_as('authenticated', k, 'SELECT public.nda_admin_signatures(NULL, 50)') NOT LIKE '%nda_forbidden%' THEN RAISE EXCEPTION 'ND18 non-admin list'; END IF;
  IF jsonb_array_length((pg_temp.val_as('authenticated', ad, format('SELECT public.nda_admin_access_log(%L)::text', sig_k)))::jsonb) <> 2 THEN RAISE EXCEPTION 'ND18 access log'; END IF;

  -- ND19 retention: N years after revocation the ciphertext goes, evidence (name, masked ID, hashes, times) stays.
  UPDATE public.nda_agreements SET revoked_at = now() - interval '6 years' WHERE id = nda2;  -- owner context: back-date for the test
  n := public.nda_identity_retention_sweep();
  IF n < 1 OR EXISTS (SELECT 1 FROM public.nda_signatory_identity i JOIN public.nda_signatures g ON g.id = i.signature_id WHERE g.nda_id = nda2 AND i.id_cipher IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.nda_signatures g JOIN public.nda_signatory_identity i ON i.signature_id = g.id
                     WHERE g.nda_id = nda2 AND g.id_masked = 'A1****789' AND i.anonymised_reason = 'retention_period_ended') THEN RAISE EXCEPTION 'ND19 retention'; END IF;
  IF EXISTS (SELECT 1 FROM public.nda_signatory_identity WHERE signature_id = sig_k AND id_cipher IS NULL) THEN RAISE EXCEPTION 'ND19 active NDA kept'; END IF;

  -- ND20 account erasure: the person's numbers go at once; reading then fails; evidence stays.
  IF pg_temp.err_as('authenticated', ca, format('SELECT public.nda_identity_erase_user(%L)', k)) NOT LIKE '%nda_forbidden%' THEN RAISE EXCEPTION 'ND20 non-admin erase'; END IF;
  IF pg_temp.val_as('authenticated', ad, format($q$SELECT public.nda_identity_erase_user(%L, 'account deleted')::text$q$, k))::int < 1 THEN RAISE EXCEPTION 'ND20 erase'; END IF;
  e := pg_temp.err_as('service_role', null, format($q$SELECT public.nda_identity_cipher_for(%L, %L, 'Court request 2026/118 identity check')$q$, ad, sig_k));
  IF e NOT LIKE '%nda_identity_anonymised%' THEN RAISE EXCEPTION 'ND20 read after erase: %', e; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nda_signatures WHERE id = sig_k AND id_masked = 'A1****789') THEN RAISE EXCEPTION 'ND20 evidence kept'; END IF;

  -- ND21 rate limit on signing attempts (10 per hour per person).
  FOR n IN 1..10 LOOP
    INSERT INTO public.nda_signature_events (actor, action) VALUES (x, 'sign');
  END LOOP;
  IF pg_temp.sign_err(x, jsonb_build_object('consultant_id', xc, 'client_id', ca)) NOT LIKE '%nda_rate_limited%' THEN RAISE EXCEPTION 'ND21 rate limit'; END IF;

  -- ND22 PNG check helper: real PNG passes, SVG text and truncated files fail.
  IF public.nda_png_info(decode(pg_temp.png(), 'base64')) ->> 'width' <> '120'
     OR public.nda_png_info(convert_to('<svg>' || repeat('x', 200) || '</svg>', 'UTF8')) IS NOT NULL
     OR public.nda_png_info(substring(decode(pg_temp.png(), 'base64') FROM 1 FOR 200)) IS NOT NULL THEN RAISE EXCEPTION 'ND22 png'; END IF;

  RAISE NOTICE 'nda-signature-identity: all 22 checks passed';
END $$;

ROLLBACK;
