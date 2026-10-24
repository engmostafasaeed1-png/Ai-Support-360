-- Adversarial tests for ticket-brd.sql. ONE rolled-back transaction: run on a scratch copy (nothing is kept).
-- Each check raises on failure. BR01-BR22.
BEGIN;

-- Fixtures. Client C owns ticket T; consultant K is the ticket's consultant with an NDA signed by both parties;
-- bidder B has no assignment; team member M is "ready" on the team but has no NDA; admin A; outsider O.
--   A  00..a1        C  00..c1        K user 00..d1 / consultant 00..dc01
--   B user 00..b1 / consultant 00..bc01    M user 00..e1 / consultant 00..ec01    O 00..f9    T 00..aaa1
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-00000000dc01', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000ec01', '00000000-0000-0000-0000-0000000000e1');
INSERT INTO public.tickets (id, client_id, consultant_id, title, sap_module, status)
  VALUES ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000dc01',
          'MIRO invoices blocked', 'MM', 'in_progress');
INSERT INTO public.ticket_team_members (ticket_id, consultant_id, status, is_legacy)
  VALUES ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000ec01', 'ready', false),
         ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000bc01', 'invited', false);
INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content, signed_at, client_signed_at)
  VALUES ('00000000-0000-0000-0000-00000000dc01', '00000000-0000-0000-0000-0000000000c1', 'sig', 'nda', now(), now());
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('ticket-documents', '00000000-0000-0000-0000-00000000aaa1/brd/BRD_v1.pdf'),
  ('ticket-documents', '00000000-0000-0000-0000-00000000aaa1/brd/BRD_v2.pdf');
DELETE FROM public.platform_settings WHERE key = 'ticket_brd';

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.doc(_title text, _body text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('language', 'en', 'template', 'standard',
    'control', jsonb_build_object('title', _title, 'status', 'draft'),
    'sections', jsonb_build_array(jsonb_build_object('key', 'purpose', 'visible', true, 'html', _body)),
    'requirements', '[]'::jsonb, 'questions', '[]'::jsonb)
$$;

DO $$
DECLARE
  t uuid := '00000000-0000-0000-0000-00000000aaa1';
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  c uuid := '00000000-0000-0000-0000-0000000000c1';
  k uuid := '00000000-0000-0000-0000-0000000000d1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  m uuid := '00000000-0000-0000-0000-0000000000e1';
  o uuid := '00000000-0000-0000-0000-0000000000f9';
  j jsonb; n int; ok boolean; doc1 uuid; doc2 uuid; rev int;
BEGIN
  -- BR01 signed-out callers get no role and nothing else
  PERFORM pg_temp.as_user(NULL);
  j := public.brd_get(t);
  IF j ->> 'role' IS NOT NULL OR j ? 'ticket' THEN RAISE EXCEPTION 'BR01 anonymous read %', j; END IF;

  -- BR02 the reader rule: client, admin, assigned consultant with both-signed NDA; never bidder, unsigned team member, outsider
  IF public.brd_role_for(t, c) <> 'client' OR public.brd_role_for(t, a) <> 'admin' OR public.brd_role_for(t, k) <> 'consultant' THEN
    RAISE EXCEPTION 'BR02 expected readers missing';
  END IF;
  IF public.brd_role_for(t, b) IS NOT NULL THEN RAISE EXCEPTION 'BR02 bidder is a reader'; END IF;
  IF public.brd_role_for(t, m) IS NOT NULL THEN RAISE EXCEPTION 'BR02 team member without NDA is a reader'; END IF;
  IF public.brd_role_for(t, o) IS NOT NULL THEN RAISE EXCEPTION 'BR02 outsider is a reader'; END IF;

  -- BR03 feature OFF by default: client cannot write, admin can try it
  IF public.brd_can_write_for(t, c) THEN RAISE EXCEPTION 'BR03 client can write while feature is off'; END IF;
  IF NOT public.brd_can_write_for(t, a) THEN RAISE EXCEPTION 'BR03 admin cannot write while feature is off'; END IF;
  PERFORM pg_temp.as_user(c);
  BEGIN
    PERFORM public.brd_save_draft(t, pg_temp.doc('x', '<p>x</p>'), NULL);
    RAISE EXCEPTION 'BR03 client saved while off';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- BR04 settings: only admins, only known keys and sane values
  BEGIN
    PERFORM public.admin_brd_set_settings('{"enabled": true}');
    RAISE EXCEPTION 'BR04 client changed settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.as_user(a);
  BEGIN
    PERFORM public.admin_brd_set_settings('{"evil": 1}');
    RAISE EXCEPTION 'BR04 unknown key accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_brd_set_settings('{"draft_model": "x; drop table"}');
    RAISE EXCEPTION 'BR04 bad model accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  j := public.admin_brd_set_settings('{"enabled": true, "ai_calls_per_ticket_per_day": 2}');
  IF NOT (j ->> 'enabled')::boolean OR (j ->> 'require_nda')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'BR04 settings not merged %', j; END IF;
  SELECT count(*) INTO n FROM public.audit_logs WHERE action = 'brd_settings_changed';
  IF n < 1 THEN RAISE EXCEPTION 'BR04 settings change not audited'; END IF;

  -- BR05 client creates the draft; contact details are masked; unsafe markup is refused
  PERFORM pg_temp.as_user(c);
  j := public.brd_save_draft(t, pg_temp.doc('MIRO BRD', '<p>Mail me at someone@example.com</p>'), NULL);
  IF (j ->> 'rev')::int <> 1 OR NOT (j ->> 'masked')::boolean OR (j -> 'content')::text LIKE '%example.com%' THEN
    RAISE EXCEPTION 'BR05 draft not created/masked %', j;
  END IF;
  BEGIN
    PERFORM public.brd_save_draft(t, pg_temp.doc('x', '<p>hi</p><script>alert(1)</script>'), 1);
    RAISE EXCEPTION 'BR05 script accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.brd_save_draft(t, pg_temp.doc('x', '<p onclick="x()">hi</p>'), 1);
    RAISE EXCEPTION 'BR05 event handler accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- BR06 stale autosave from another tab is refused, never silently overwrites
  j := public.brd_save_draft(t, pg_temp.doc('MIRO BRD', '<p>second</p>'), 1);
  rev := (j ->> 'rev')::int;
  BEGIN
    PERFORM public.brd_save_draft(t, pg_temp.doc('MIRO BRD', '<p>stale</p>'), 1);
    RAISE EXCEPTION 'BR06 stale draft accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;

  -- BR07 version numbering v1, v2; Final stored as final
  j := public.brd_save_version(t, pg_temp.doc('MIRO BRD', '<p>first version</p>'), 'First draft', 'draft', rev);
  IF (j ->> 'version')::int <> 1 THEN RAISE EXCEPTION 'BR07 first version is %', j ->> 'version'; END IF;
  j := public.brd_save_version(t, pg_temp.doc('MIRO BRD', '<p>second version</p>'), 'Approved', 'final', (j ->> 'rev')::int);
  IF (j ->> 'version')::int <> 2 OR j #>> '{content,control,status}' <> 'final' THEN RAISE EXCEPTION 'BR07 second version %', j; END IF;
  rev := (j ->> 'rev')::int;

  -- BR08 versions are immutable and cannot be deleted, even by a privileged session
  BEGIN
    UPDATE public.ticket_brd_versions SET content = '{}'::jsonb WHERE ticket_id = t AND version = 1;
    RAISE EXCEPTION 'BR08 version content changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.ticket_brd_versions WHERE ticket_id = t AND version = 1;
    RAISE EXCEPTION 'BR08 version deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- BR09 restore creates a new version (v3) instead of rewinding
  j := public.brd_restore_version(t, 1, 'Back to v1 wording');
  IF (j ->> 'version')::int <> 3 THEN RAISE EXCEPTION 'BR09 restore made %', j ->> 'version'; END IF;
  SELECT restored_from INTO n FROM public.ticket_brd_versions WHERE ticket_id = t AND version = 3;
  IF n <> 1 THEN RAISE EXCEPTION 'BR09 restored_from %', n; END IF;

  -- BR10 before anything is attached the consultant sees no version and cannot open one
  PERFORM pg_temp.as_user(k);
  j := public.brd_get(t);
  IF jsonb_array_length(j -> 'versions') <> 0 OR j -> 'brd' ->> 'draft' IS NOT NULL THEN RAISE EXCEPTION 'BR10 consultant sees unattached work %', j; END IF;
  BEGIN
    PERFORM public.brd_get_version(t, 1);
    RAISE EXCEPTION 'BR10 consultant opened unattached version';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- BR11 consultants cannot write, attach or save
  BEGIN
    PERFORM public.brd_save_draft(t, pg_temp.doc('x', '<p>x</p>'), NULL);
    RAISE EXCEPTION 'BR11 consultant saved';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.brd_attach(t, 1, t || '/brd/BRD_v1.pdf', 5000, false);
    RAISE EXCEPTION 'BR11 consultant attached';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- BR12 attach checks path and file; re-attaching keeps the older PDF listed as superseded
  PERFORM pg_temp.as_user(c);
  BEGIN
    PERFORM public.brd_attach(t, 1, '00000000-0000-0000-0000-000000000bad/brd/x.pdf', 5000, false);
    RAISE EXCEPTION 'BR12 foreign path accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.brd_attach(t, 1, t || '/brd/missing.pdf', 5000, false);
    RAISE EXCEPTION 'BR12 missing file accepted';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  j := public.brd_attach(t, 1, t || '/brd/BRD_v1.pdf', 5000, false);
  doc1 := (j ->> 'document_id')::uuid;
  IF j ->> 'file_name' !~ '^BRD_00000000_v1_\d{4}-\d{2}-\d{2}\.pdf$' THEN RAISE EXCEPTION 'BR12 file name %', j ->> 'file_name'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = k;
  IF n <> 0 THEN RAISE EXCEPTION 'BR12 notified without the tick'; END IF;
  j := public.brd_attach(t, 2, t || '/brd/BRD_v2.pdf', 6000, true);
  doc2 := (j ->> 'document_id')::uuid;
  IF (j ->> 'notified')::int <> 1 THEN RAISE EXCEPTION 'BR12 notified % (expected only the NDA-cleared consultant)', j ->> 'notified'; END IF;
  IF (SELECT superseded_at FROM public.ticket_documents WHERE id = doc1) IS NULL THEN RAISE EXCEPTION 'BR12 v1 not superseded'; END IF;
  IF (SELECT shared_version FROM public.ticket_brds WHERE ticket_id = t) <> 2 THEN RAISE EXCEPTION 'BR12 shared marker'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id IN (b, m)) THEN RAISE EXCEPTION 'BR12 bidder/team member notified'; END IF;

  -- BR13 the consultant now reads attached versions only; views are logged once per 10 minutes
  PERFORM pg_temp.as_user(k);
  j := public.brd_get(t);
  IF jsonb_array_length(j -> 'versions') <> 2 OR j -> 'access_log' <> '[]'::jsonb OR j ? 'usage' THEN RAISE EXCEPTION 'BR13 consultant view %', j -> 'versions'; END IF;
  PERFORM public.brd_get_version(t, 2);
  PERFORM public.brd_get_version(t, 2);
  PERFORM public.brd_log_access(t, 2, 'download');
  SELECT count(*) INTO n FROM public.ticket_brd_access_log WHERE ticket_id = t AND viewer_id = k;
  IF n <> 2 THEN RAISE EXCEPTION 'BR13 access log rows %', n; END IF;
  BEGIN
    PERFORM public.brd_get_version(t, 3);
    RAISE EXCEPTION 'BR13 consultant opened unattached v3';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- BR14 the bidder and the unsigned team member still see nothing, even after attachment
  PERFORM pg_temp.as_user(b);
  IF public.brd_get(t) ->> 'role' IS NOT NULL OR public.brd_file_readable(t || '/brd/BRD_v2.pdf') THEN RAISE EXCEPTION 'BR14 bidder reads'; END IF;
  PERFORM pg_temp.as_user(m);
  IF public.brd_get(t) ->> 'role' IS NOT NULL OR public.brd_file_readable(t || '/brd/BRD_v2.pdf') THEN RAISE EXCEPTION 'BR14 team member reads'; END IF;

  -- BR15 comments: contact details refused (M60), suggestions allowed, client notified
  PERFORM pg_temp.as_user(k);
  BEGIN
    PERFORM public.brd_add_comment(t, 2, 'functional', 'Call me on +20 100 123 4567', NULL, 'comment', NULL);
    RAISE EXCEPTION 'BR15 phone number accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.brd_add_comment(t, 3, 'functional', 'Question', NULL, 'comment', NULL);
    RAISE EXCEPTION 'BR15 comment on unattached version';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.brd_add_comment(t, 2, 'functional', 'Is REQ-002 only for company code 1000?', NULL, 'suggestion', '<p>Only company code 1000.</p>');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = c AND type = 'brd';
  IF n <> 1 THEN RAISE EXCEPTION 'BR15 client notices %', n; END IF;

  -- BR16 the client sees the access log and the consultant's comment under the privacy name
  PERFORM pg_temp.as_user(c);
  j := public.brd_get(t);
  IF jsonb_array_length(j -> 'access_log') <> 2 OR jsonb_array_length(j -> 'comments') <> 1 OR jsonb_array_length(j -> 'versions') <> 3 THEN
    RAISE EXCEPTION 'BR16 client view %', j;
  END IF;

  -- BR17 BRD rows cannot be written directly by signed-in browsers (only through the functions)
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.ticket_documents (ticket_id, uploaded_by, file_name, file_url, doc_type, brd_version)
    VALUES (t, c, 'fake.pdf', t || '/brd/fake.pdf', 'brd', 1);
    RAISE EXCEPTION 'BR17 direct BRD row insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.ticket_documents SET unattached_at = now() WHERE id = doc2;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'BR17 direct BRD row update'; END IF;
  DELETE FROM public.ticket_documents WHERE id = doc2;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'BR17 direct BRD row delete'; END IF;
  BEGIN
    PERFORM 1 FROM public.ticket_brds;
    RAISE EXCEPTION 'BR17 BRD table readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM storage.objects WHERE name = t || '/brd/BRD_v2.pdf';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'BR17 BRD file deleted'; END IF;
  EXECUTE 'RESET ROLE';

  -- BR18 unattach: the previous attachment becomes current again and the consultant loses v2
  PERFORM pg_temp.as_user(c);
  IF NOT public.brd_unattach(doc2, 'Wrong file') THEN RAISE EXCEPTION 'BR18 unattach refused'; END IF;
  IF (SELECT superseded_at FROM public.ticket_documents WHERE id = doc1) IS NOT NULL THEN RAISE EXCEPTION 'BR18 v1 not current again'; END IF;
  IF (SELECT shared_version FROM public.ticket_brds WHERE ticket_id = t) <> 1 THEN RAISE EXCEPTION 'BR18 shared marker'; END IF;
  PERFORM pg_temp.as_user(k);
  IF public.brd_file_readable(t || '/brd/BRD_v2.pdf') OR NOT public.brd_file_readable(t || '/brd/BRD_v1.pdf') THEN RAISE EXCEPTION 'BR18 file access'; END IF;

  -- BR19 NDA revoked: the consultant loses access at once
  UPDATE public.nda_agreements SET revoked_at = now() WHERE consultant_id = '00000000-0000-0000-0000-00000000dc01';
  IF public.brd_role_for(t, k) IS NOT NULL OR public.brd_file_readable(t || '/brd/BRD_v1.pdf') THEN RAISE EXCEPTION 'BR19 revoked NDA still reads'; END IF;
  UPDATE public.nda_agreements SET revoked_at = NULL WHERE consultant_id = '00000000-0000-0000-0000-00000000dc01';

  -- BR20 AI limits per ticket (setting 2) and only for writers
  IF (public.brd_ai_claim(t, k, 'draft') ->> 'ok')::boolean THEN RAISE EXCEPTION 'BR20 consultant AI call allowed'; END IF;
  IF NOT (public.brd_ai_claim(t, c, 'draft') ->> 'ok')::boolean THEN RAISE EXCEPTION 'BR20 first call refused'; END IF;
  IF NOT (public.brd_ai_claim(t, c, 'section') ->> 'ok')::boolean THEN RAISE EXCEPTION 'BR20 second call refused'; END IF;
  j := public.brd_ai_claim(t, c, 'improve');
  IF (j ->> 'ok')::boolean OR j ->> 'reason' <> 'ticket_limit' THEN RAISE EXCEPTION 'BR20 limit not enforced %', j; END IF;

  -- BR21 closed ticket: read-only for the client until an admin reopens editing
  UPDATE public.tickets SET status = 'closed' WHERE id = t;
  IF public.brd_can_write_for(t, c) THEN RAISE EXCEPTION 'BR21 client writes on closed ticket'; END IF;
  PERFORM pg_temp.as_user(a);
  PERFORM public.admin_brd_unlock(t, true, 'Client asked for a fix');
  IF NOT public.brd_can_write_for(t, c) THEN RAISE EXCEPTION 'BR21 reopen did not work'; END IF;
  -- archive is admin-only, soft and audited
  IF NOT public.brd_archive_version(t, 1, 'Duplicate') THEN RAISE EXCEPTION 'BR21 archive refused'; END IF;
  IF (SELECT count(*) FROM public.ticket_brd_versions WHERE ticket_id = t) <> 3 THEN RAISE EXCEPTION 'BR21 archive deleted a version'; END IF;

  -- BR22 deleting the ticket removes everything (retention), the guards allow only that cascade
  DELETE FROM public.tickets WHERE id = t;
  IF EXISTS (SELECT 1 FROM public.ticket_brds WHERE ticket_id = t) OR EXISTS (SELECT 1 FROM public.ticket_brd_versions WHERE ticket_id = t)
     OR EXISTS (SELECT 1 FROM public.ticket_brd_events WHERE ticket_id = t) OR EXISTS (SELECT 1 FROM public.ticket_documents WHERE ticket_id = t) THEN
    RAISE EXCEPTION 'BR22 data left after ticket deletion';
  END IF;

  RAISE NOTICE 'ticket-brd: all 22 checks passed';
END $$;

ROLLBACK;
