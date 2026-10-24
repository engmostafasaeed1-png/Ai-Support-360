-- Adversarial tests for solution-architecture.sql. ONE rolled-back transaction: run on a scratch copy (nothing is
-- kept). Each check raises on failure. SA01-SA20.
BEGIN;

-- Fixtures.
--   A admin 00..5a1   C client 00..5c1 (ticket T, ticket T2)   C2 other client 00..5c2 (ticket TX)
--   K consultant on T with an NDA signed by both (user 00..5d1 / consultant 00..5dc1)
--   K2 consultant on T2 without NDA (user 00..5d2 / consultant 00..5dc2)   B bidder, no assignment (00..5b1 / 00..5bc1)
--   Company Q: manager MG 00..5e1 (writer), member MB 00..5e2 (reader), outsider O 00..5f9; company ticket TQ
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000005a1', 'sa-a@example.test'), ('00000000-0000-0000-0000-0000000005c1', 'sa-c@example.test'),
  ('00000000-0000-0000-0000-0000000005c2', 'sa-c2@example.test'), ('00000000-0000-0000-0000-0000000005d1', 'sa-k@example.test'),
  ('00000000-0000-0000-0000-0000000005d2', 'sa-k2@example.test'), ('00000000-0000-0000-0000-0000000005b1', 'sa-b@example.test'),
  ('00000000-0000-0000-0000-0000000005e1', 'sa-mg@example.test'), ('00000000-0000-0000-0000-0000000005e2', 'sa-mb@example.test'),
  ('00000000-0000-0000-0000-0000000005f9', 'sa-o@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000005a1', 'admin'), ('00000000-0000-0000-0000-0000000005c1', 'client'),
  ('00000000-0000-0000-0000-0000000005c2', 'client'), ('00000000-0000-0000-0000-0000000005e1', 'client'),
  ('00000000-0000-0000-0000-0000000005e2', 'client'), ('00000000-0000-0000-0000-0000000005f9', 'client')
ON CONFLICT DO NOTHING;
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-000000005dc1', '00000000-0000-0000-0000-0000000005d1'),
  ('00000000-0000-0000-0000-000000005dc2', '00000000-0000-0000-0000-0000000005d2'),
  ('00000000-0000-0000-0000-000000005bc1', '00000000-0000-0000-0000-0000000005b1');
INSERT INTO public.tenants (id, name, slug) VALUES ('00000000-0000-0000-0000-00000000500a', 'Quartz Ltd', 'sa-quartz-test');
INSERT INTO public.tenant_members (tenant_id, user_id, org_role, accepted_at) VALUES
  ('00000000-0000-0000-0000-00000000500a', '00000000-0000-0000-0000-0000000005e1', 'manager', now()),
  ('00000000-0000-0000-0000-00000000500a', '00000000-0000-0000-0000-0000000005e2', 'member', now());
INSERT INTO public.tickets (id, client_id, consultant_id, title, sap_module, status) VALUES
  ('00000000-0000-0000-0000-00000000a5a1', '00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-000000005dc1', 'S/4 finance redesign', 'FI', 'in_progress'),
  ('00000000-0000-0000-0000-00000000a5a2', '00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-000000005dc2', 'EWM interface', 'EWM', 'in_progress'),
  ('00000000-0000-0000-0000-00000000a5a3', '00000000-0000-0000-0000-0000000005c2', NULL, 'Other company ticket', 'SD', 'new');
INSERT INTO public.tickets (id, client_id, tenant_id, title, sap_module, status) VALUES
  ('00000000-0000-0000-0000-00000000a5a4', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000500a', 'Company rollout', 'MM', 'new');
INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, signature_type, nda_content, signed_at, client_signed_at)
  VALUES ('00000000-0000-0000-0000-000000005dc1', '00000000-0000-0000-0000-0000000005c1', 'sig', 'typed', 'nda', now(), now());
DELETE FROM public.platform_settings WHERE key IN ('solution_architecture', 'ticket_brd');

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.content(_type text, _html text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('schema', 1, 'type', _type, 'language', 'en', 'systems', '[]'::jsonb,
    'sections', jsonb_build_array(jsonb_build_object('key', 'context', 'html', _html,
      'trace', jsonb_build_array(jsonb_build_object('ticket_ref', '0000000A', 'req_id', 'REQ-001')),
      'diagrams', jsonb_build_array(jsonb_build_object('id', 'dabcdefgh', 'kind', 'mermaid', 'source', 'graph LR' || chr(10) || 'A-->B', 'caption', 'Flow')))))
$$;

DO $$
DECLARE
  a uuid := '00000000-0000-0000-0000-0000000005a1';
  c uuid := '00000000-0000-0000-0000-0000000005c1';
  c2 uuid := '00000000-0000-0000-0000-0000000005c2';
  k uuid := '00000000-0000-0000-0000-0000000005d1';
  k2 uuid := '00000000-0000-0000-0000-0000000005d2';
  b uuid := '00000000-0000-0000-0000-0000000005b1';
  mg uuid := '00000000-0000-0000-0000-0000000005e1';
  mb uuid := '00000000-0000-0000-0000-0000000005e2';
  o uuid := '00000000-0000-0000-0000-0000000005f9';
  q uuid := '00000000-0000-0000-0000-00000000500a';
  t uuid := '00000000-0000-0000-0000-00000000a5a1';
  t2 uuid := '00000000-0000-0000-0000-00000000a5a2';
  tx uuid := '00000000-0000-0000-0000-00000000a5a3';
  tq uuid := '00000000-0000-0000-0000-00000000a5a4';
  doc uuid; doc2 uuid; qdoc uuid; j jsonb; n int; r text; att uuid; pdf text;
BEGIN
  -- SA01 signed-out callers get nothing
  PERFORM pg_temp.as_user(NULL);
  IF (public.sa_public_settings() ->> 'enabled')::boolean THEN RAISE EXCEPTION 'SA01 feature on by default'; END IF;
  BEGIN PERFORM public.sa_list(q, false); RAISE EXCEPTION 'SA01 anonymous list'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- SA02 feature OFF by default: nobody creates; settings only by admins, known keys only
  PERFORM pg_temp.as_user(c);
  BEGIN PERFORM public.sa_create(NULL, '{"type":"hld","title":"x"}'); RAISE EXCEPTION 'SA02 created while off'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.admin_sa_set_settings('{"enabled": true}'); RAISE EXCEPTION 'SA02 client changed settings'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.as_user(a);
  BEGIN PERFORM public.admin_sa_set_settings('{"evil": 1}'); RAISE EXCEPTION 'SA02 unknown key'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.admin_sa_set_settings('{"ai_model": "x; drop"}'); RAISE EXCEPTION 'SA02 bad model'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.admin_sa_set_settings('{"enabled": true}');
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'solution_architecture_settings_changed' AND user_id = a) THEN RAISE EXCEPTION 'SA02 no audit'; END IF;
  IF (public.sa_public_settings() ->> 'ai_enabled')::boolean THEN RAISE EXCEPTION 'SA02 AI on by default'; END IF;

  -- SA03 client creates a private document linked to an own ticket; another client's ticket cannot be linked
  PERFORM pg_temp.as_user(c);
  BEGIN
    PERFORM public.sa_create(NULL, jsonb_build_object('type', 'hld', 'title', 'Bad', 'tickets', jsonb_build_array(tx)));
    RAISE EXCEPTION 'SA03 linked a foreign ticket';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN PERFORM public.sa_create(NULL, '{"type":"hld","title":"x","status":"approved"}'); RAISE EXCEPTION 'SA03 created approved'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  doc := public.sa_create(NULL, jsonb_build_object('type', 'hld', 'title', 'Finance HLD', 'owner_name', 'Lead architect', 'sap_area', 'FI',
                          'confidentiality', 'private', 'tickets', jsonb_build_array(t, t2)));
  IF public.sa_role_for(doc, c) <> 'client' OR public.sa_role_for(doc, a) <> 'admin' THEN RAISE EXCEPTION 'SA03 owner roles'; END IF;
  IF jsonb_array_length((public.sa_get(doc) -> 'doc' -> 'draft') -> 'sections') <> 12 THEN RAISE EXCEPTION 'SA03 HLD template not used'; END IF;

  -- SA04 another client: no role, no list row, no read, no write
  IF public.sa_role_for(doc, c2) IS NOT NULL OR public.sa_role_for(doc, o) IS NOT NULL THEN RAISE EXCEPTION 'SA04 other client has a role'; END IF;
  PERFORM pg_temp.as_user(c2);
  j := public.sa_get(doc);
  IF j ? 'doc' OR j ->> 'role' IS NOT NULL THEN RAISE EXCEPTION 'SA04 other client read %', j; END IF;
  IF jsonb_array_length(public.sa_list(NULL, true)) <> 0 THEN RAISE EXCEPTION 'SA04 other client listed it'; END IF;
  BEGIN PERFORM public.sa_save_draft(doc, pg_temp.content('hld', '<p>x</p>'), NULL); RAISE EXCEPTION 'SA04 other client wrote'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- SA05 private document: even the assigned consultant with NDA sees nothing
  PERFORM pg_temp.as_user(c);
  PERFORM public.sa_save_version(doc, pg_temp.content('hld', '<p>Target landscape v1</p>'), 'first', NULL);
  IF public.sa_role_for(doc, k) IS NOT NULL THEN RAISE EXCEPTION 'SA05 private document visible to consultant'; END IF;

  -- SA06 shared: the assigned consultant with both-signed NDA reads; NDA gate and bidders
  PERFORM public.sa_update_meta(doc, '{"confidentiality": "shared"}');
  IF public.sa_role_for(doc, k) IS DISTINCT FROM 'consultant' THEN RAISE EXCEPTION 'SA06 shared consultant not a reader'; END IF;
  IF public.sa_role_for(doc, k2) IS NOT NULL THEN RAISE EXCEPTION 'SA06 consultant without NDA is a reader'; END IF;
  IF public.sa_role_for(doc, b) IS NOT NULL THEN RAISE EXCEPTION 'SA06 bidder is a reader'; END IF;
  UPDATE public.nda_agreements SET revoked_at = now() WHERE consultant_id = '00000000-0000-0000-0000-000000005dc1';
  IF public.sa_role_for(doc, k) IS NOT NULL THEN RAISE EXCEPTION 'SA06 revoked NDA still reads'; END IF;
  UPDATE public.nda_agreements SET revoked_at = NULL WHERE consultant_id = '00000000-0000-0000-0000-000000005dc1';

  -- SA07 shared consultant is read-only: no draft, no writes, versions readable and logged, comments allowed
  PERFORM pg_temp.as_user(k);
  j := public.sa_get(doc);
  IF j -> 'doc' -> 'draft' <> 'null'::jsonb OR (j ->> 'can_write')::boolean OR j ? 'access_log' THEN RAISE EXCEPTION 'SA07 consultant saw draft or log %', j -> 'doc'; END IF;
  BEGIN PERFORM public.sa_save_draft(doc, pg_temp.content('hld', '<p>hack</p>'), NULL); RAISE EXCEPTION 'SA07 consultant wrote'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.sa_set_status(doc, 'approved', ''); RAISE EXCEPTION 'SA07 consultant approved'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.sa_update_meta(doc, '{"title": "mine"}'); RAISE EXCEPTION 'SA07 consultant renamed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  j := public.sa_get_version(doc, 1);
  IF j ->> 'version' <> '1' THEN RAISE EXCEPTION 'SA07 version not readable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sa_access_log WHERE doc_id = doc AND viewer_id = k AND action = 'view') THEN RAISE EXCEPTION 'SA07 view not logged'; END IF;
  PERFORM public.sa_add_comment(doc, 1, 'context', 'Please add the interface to the bank.', NULL, 'comment', NULL);
  BEGIN
    PERFORM public.sa_add_comment(doc, 1, 'context', 'mail me at someone@example.com', NULL, 'comment', NULL);
    RAISE EXCEPTION 'SA07 contact details accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN PERFORM public.sa_set_comment_status((SELECT id FROM public.sa_comments WHERE doc_id = doc LIMIT 1), 'resolved'); RAISE EXCEPTION 'SA07 consultant resolved'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- SA08 tables are closed to browsers
  IF has_table_privilege('authenticated', 'public.sa_documents', 'SELECT') OR has_table_privilege('authenticated', 'public.sa_versions', 'UPDATE')
     OR has_table_privilege('anon', 'public.sa_systems', 'SELECT') OR has_table_privilege('authenticated', 'public.sa_comments', 'INSERT') THEN
    RAISE EXCEPTION 'SA08 table privilege granted';
  END IF;
  IF has_function_privilege('authenticated', 'public.sa_ai_claim(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sa_store_draft(uuid, uuid, jsonb, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SA08 internal function callable';
  END IF;

  -- SA09 versions are immutable and numbered; restore makes a new version
  PERFORM pg_temp.as_user(c);
  j := public.sa_save_version(doc, pg_temp.content('hld', '<p>Target landscape v2</p>'), 'second', NULL);
  IF (j ->> 'version')::int <> 2 THEN RAISE EXCEPTION 'SA09 numbering %', j; END IF;
  BEGIN UPDATE public.sa_versions SET content = '{}' WHERE doc_id = doc AND version = 1; RAISE EXCEPTION 'SA09 version changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.sa_versions WHERE doc_id = doc AND version = 1; RAISE EXCEPTION 'SA09 version deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  j := public.sa_restore_version(doc, 1, 'back to v1');
  IF (j ->> 'version')::int <> 3 OR (SELECT restored_from FROM public.sa_versions WHERE doc_id = doc AND version = 3) <> 1 THEN RAISE EXCEPTION 'SA09 restore'; END IF;
  BEGIN
    PERFORM public.sa_save_draft(doc, pg_temp.content('hld', '<p>stale</p>'), 1);
    RAISE EXCEPTION 'SA09 stale draft accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;

  -- SA10 status rules: approve needs a version; new version of an approved doc goes back to review; archive needs a reason
  doc2 := public.sa_create(NULL, jsonb_build_object('type', 'adr', 'title', 'ADR 1'));
  BEGIN PERFORM public.sa_set_status(doc2, 'approved', ''); RAISE EXCEPTION 'SA10 approved without version'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  j := public.sa_set_status(doc, 'approved', 'ok');
  IF (j ->> 'approved_version')::int <> 3 THEN RAISE EXCEPTION 'SA10 approved version %', j; END IF;
  j := public.sa_save_version(doc, pg_temp.content('hld', '<p>v4</p>'), 'change after approval', NULL);
  IF j ->> 'status' <> 'in_review' THEN RAISE EXCEPTION 'SA10 approved doc not back in review'; END IF;
  BEGIN PERFORM public.sa_set_status(doc2, 'archived', ''); RAISE EXCEPTION 'SA10 archived without reason'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- SA11 content rules: markup allowlist, unknown pictures, wrong template, wrong type
  BEGIN PERFORM public.sa_save_draft(doc, pg_temp.content('hld', '<p>x</p><script>alert(1)</script>'), NULL); RAISE EXCEPTION 'SA11 script'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_save_draft(doc, pg_temp.content('hld', '<p onclick="x()">x</p>'), NULL); RAISE EXCEPTION 'SA11 handler'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_save_draft(doc, pg_temp.content('hld', '<p>javascript:alert(1)</p>'), NULL); RAISE EXCEPTION 'SA11 js url'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_save_draft(doc, pg_temp.content('adr', '<p>x</p>'), NULL); RAISE EXCEPTION 'SA11 wrong type'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.sa_save_draft(doc, jsonb_build_object('schema', 1, 'type', 'hld', 'language', 'en', 'systems', '[]'::jsonb,
      'sections', jsonb_build_array(jsonb_build_object('key', 'cutover_tasks', 'html', ''))), NULL);
    RAISE EXCEPTION 'SA11 foreign section';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.sa_save_draft(doc, jsonb_build_object('schema', 1, 'type', 'hld', 'language', 'en', 'systems', '[]'::jsonb,
      'sections', jsonb_build_array(jsonb_build_object('key', 'context', 'html', '', 'diagrams',
        jsonb_build_array(jsonb_build_object('id', 'dqwertyui', 'kind', 'image', 'asset_id', gen_random_uuid()))))), NULL);
    RAISE EXCEPTION 'SA11 unknown picture';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  j := public.sa_save_draft(doc, pg_temp.content('hld', '<p>Call 0044 20 7946 0958 for details</p>'), NULL);
  IF (j ->> 'masked')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'SA11 phone number not masked'; END IF;

  -- SA12 landscape register refuses credentials and stays inside the company
  BEGIN PERFORM public.sa_landscape_save(NULL, '{"name":"S4 PRD","role":"PRD","notes":"password: Secret123"}'); RAISE EXCEPTION 'SA12 password stored'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_landscape_save(NULL, '{"name":"S4 PRD","role":"PRD","notes":"Kennwort Initial1"}'); RAISE EXCEPTION 'SA12 kennwort stored'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_landscape_save(NULL, '{"name":"S4 PRD","role":"PRD","notes":"كلمة المرور 1234"}'); RAISE EXCEPTION 'SA12 arabic password stored'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_landscape_save(NULL, '{"name":"S4 PRD","role":"PRD","notes":"hana://SYSTEM:Manager1@10.0.0.5:30015"}'); RAISE EXCEPTION 'SA12 connection string stored'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_landscape_save(NULL, '{"name":"S4 PRD","role":"PRD","product":"key sk-abcdefghijklmnopqrstuvwxyz"}'); RAISE EXCEPTION 'SA12 api key stored'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_landscape_save(NULL, '{"name":"S4 PRD","role":"PROD"}'); RAISE EXCEPTION 'SA12 bad role'; EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.sa_landscape_save(NULL, '{"name":"S/4HANA Production","sid":"PRD","role":"PRD","product":"S/4HANA","release":"2023 FPS02","hosting":"rise","notes":"Passive standby in second region"}');
  IF jsonb_array_length(public.sa_landscape_list(NULL)) <> 1 THEN RAISE EXCEPTION 'SA12 clean row not stored'; END IF;
  PERFORM pg_temp.as_user(c2);
  IF jsonb_array_length(public.sa_landscape_list(NULL)) <> 0 THEN RAISE EXCEPTION 'SA12 other client sees landscape'; END IF;
  BEGIN PERFORM public.sa_ticket_systems(t); RAISE EXCEPTION 'SA12 other client reads ticket systems'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- SA13 company documents: manager writes, member reads and comments only, outsider nothing
  PERFORM pg_temp.as_user(mb);
  BEGIN PERFORM public.sa_create(q, '{"type":"blueprint","title":"Member doc"}'); RAISE EXCEPTION 'SA13 member created'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.as_user(mg);
  qdoc := public.sa_create(q, jsonb_build_object('type', 'blueprint', 'title', 'Company blueprint', 'tickets', jsonb_build_array(tq)));
  BEGIN PERFORM public.sa_set_links(qdoc, ARRAY[t], NULL); RAISE EXCEPTION 'SA13 linked a personal ticket of another account'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.sa_save_version(qdoc, pg_temp.content('blueprint', '<p>Blueprint</p>'), '', NULL);
  IF public.sa_role_for(qdoc, mb) <> 'company' OR public.sa_role_for(qdoc, o) IS NOT NULL OR public.sa_role_for(qdoc, c) IS NOT NULL THEN
    RAISE EXCEPTION 'SA13 company roles';
  END IF;
  PERFORM pg_temp.as_user(mb);
  IF jsonb_array_length(public.sa_list(q, false)) <> 1 THEN RAISE EXCEPTION 'SA13 member does not see the company list'; END IF;
  BEGIN PERFORM public.sa_save_draft(qdoc, pg_temp.content('blueprint', '<p>x</p>'), NULL); RAISE EXCEPTION 'SA13 member wrote'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.sa_add_comment(qdoc, 1, 'context', 'Looks good', NULL, 'comment', NULL);
  PERFORM pg_temp.as_user(o);
  BEGIN PERFORM public.sa_list(q, false); RAISE EXCEPTION 'SA13 outsider listed the company'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- SA14 storage rules: pictures and PDFs follow the document rule
  PERFORM pg_temp.as_user(c);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('ticket-documents', 'arch/' || doc || '/0123456789abcdef01234567.png');
  j := public.sa_asset_register(doc, 'arch/' || doc || '/0123456789abcdef01234567.png', 'landscape.png', 'image/png', 2048);
  BEGIN PERFORM public.sa_asset_register(doc, 'arch/' || doc || '/0123456789abcdef01234568.html', 'x.html', 'text/html', 10); RAISE EXCEPTION 'SA14 html accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.sa_asset_register(doc, 'arch/' || doc || '/0123456789abcdef01234569.png', 'big.png', 'image/png', 9000000); RAISE EXCEPTION 'SA14 big accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT public.sa_asset_can_insert('arch/' || doc || '/0123456789abcdef0123456a.svg') THEN RAISE EXCEPTION 'SA14 writer cannot upload'; END IF;
  IF public.sa_asset_can_insert('arch/' || doc || '/evil.php') THEN RAISE EXCEPTION 'SA14 bad name allowed'; END IF;
  PERFORM pg_temp.as_user(c2);
  IF public.sa_asset_readable('arch/' || doc || '/0123456789abcdef01234567.png') THEN RAISE EXCEPTION 'SA14 other client reads picture'; END IF;
  IF public.sa_asset_can_insert('arch/' || doc || '/0123456789abcdef0123456b.png') THEN RAISE EXCEPTION 'SA14 other client uploads'; END IF;
  PERFORM pg_temp.as_user(k);
  IF NOT public.sa_asset_readable('arch/' || doc || '/0123456789abcdef01234567.png') THEN RAISE EXCEPTION 'SA14 shared consultant cannot see picture'; END IF;
  IF public.sa_asset_can_insert('arch/' || doc || '/0123456789abcdef0123456c.png') THEN RAISE EXCEPTION 'SA14 consultant uploads'; END IF;
  pdf := t || '/architecture/' || doc || '/ARCH_HLD_v4.pdf';
  IF public.sa_pdf_can_insert(pdf) THEN RAISE EXCEPTION 'SA14 consultant uploads PDF'; END IF;

  -- SA15 attach to ticket: only to linked tickets; consultant sees the attached row; unattach hides it
  PERFORM pg_temp.as_user(c);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('ticket-documents', pdf);
  BEGIN PERFORM public.sa_attach(doc, tx, 4, tx || '/architecture/' || doc || '/A.pdf', 5000, false); RAISE EXCEPTION 'SA15 attached to unlinked ticket'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT public.sa_pdf_can_insert(pdf) THEN RAISE EXCEPTION 'SA15 writer cannot upload PDF'; END IF;
  j := public.sa_attach(doc, t, 4, pdf, 5000, true);
  att := (j ->> 'document_id')::uuid;
  IF (j ->> 'notified')::int <> 1 THEN RAISE EXCEPTION 'SA15 consultant not notified %', j; END IF;
  PERFORM pg_temp.as_user(k);
  IF NOT public.sa_doc_row_visible(doc, NULL) OR NOT public.sa_pdf_readable(pdf) THEN RAISE EXCEPTION 'SA15 consultant cannot open attached'; END IF;
  BEGIN UPDATE public.ticket_documents SET file_url = 'x' WHERE id = att; RAISE EXCEPTION 'SA15 attached row changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.as_user(c2);
  IF public.sa_doc_row_visible(doc, NULL) OR public.sa_pdf_readable(pdf) THEN RAISE EXCEPTION 'SA15 other client opens attached'; END IF;
  PERFORM pg_temp.as_user(c);
  PERFORM public.sa_unattach(att, 'wrong version');
  PERFORM pg_temp.as_user(k);
  IF public.sa_pdf_readable(pdf) THEN RAISE EXCEPTION 'SA15 unattached PDF still readable'; END IF;

  -- SA16 archive is soft and closes consultant access; documents are never deleted
  PERFORM pg_temp.as_user(c);
  PERFORM public.sa_set_status(doc, 'archived', 'replaced by new HLD');
  IF public.sa_role_for(doc, k) IS NOT NULL THEN RAISE EXCEPTION 'SA16 consultant reads archived'; END IF;
  BEGIN PERFORM public.sa_save_draft(doc, pg_temp.content('hld', '<p>x</p>'), NULL); RAISE EXCEPTION 'SA16 wrote archived'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.sa_set_status(doc, 'approved', ''); RAISE EXCEPTION 'SA16 archived to approved'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.sa_set_status(doc, 'draft', 'back');
  IF (SELECT count(*) FROM public.sa_versions WHERE doc_id = doc) <> 4 THEN RAISE EXCEPTION 'SA16 versions lost'; END IF;

  -- SA17 audit trail holds the lifecycle
  SELECT count(DISTINCT action) INTO n FROM public.sa_events WHERE doc_id = doc AND action IN ('create', 'version', 'restore', 'status', 'archive', 'attach', 'unattach', 'sharing', 'picture');
  IF n <> 9 THEN RAISE EXCEPTION 'SA17 audit events %', n; END IF;
  BEGIN UPDATE public.sa_events SET action = 'x' WHERE doc_id = doc; RAISE EXCEPTION 'SA17 audit changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- SA18 AI stays off until the owner switches it on, then limits apply
  IF (public.sa_ai_claim(doc, c, 'arch_draft') ->> 'reason') <> 'ai_off' THEN RAISE EXCEPTION 'SA18 AI ran while off'; END IF;
  PERFORM pg_temp.as_user(a);
  PERFORM public.admin_sa_set_settings('{"ai_enabled": true, "ai_calls_per_doc_per_day": 1}');
  IF (public.sa_ai_claim(doc, c, 'arch_draft') ->> 'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'SA18 first AI call refused'; END IF;
  IF (public.sa_ai_claim(doc, c, 'arch_review') ->> 'reason') <> 'doc_limit' THEN RAISE EXCEPTION 'SA18 limit not applied'; END IF;
  IF (public.sa_ai_claim(doc, k, 'arch_review') ->> 'reason') <> 'not_allowed' THEN RAISE EXCEPTION 'SA18 consultant ran AI'; END IF;

  -- SA19 templates match the screen model (archModel.ts TYPE_SECTIONS)
  IF public.sa_type_sections('hld') <> ARRAY['context', 'scope', 'principles', 'target_landscape', 'components', 'integrations', 'data_flows', 'security', 'non_functional', 'risks', 'decisions', 'open_points']
     OR public.sa_type_sections('adr') <> ARRAY['context', 'decision_drivers', 'options', 'decision', 'consequences'] OR public.sa_type_sections('nope') IS NOT NULL THEN
    RAISE EXCEPTION 'SA19 templates differ';
  END IF;

  -- SA20 feature switched off again: clients stop writing, readers keep reading
  PERFORM public.admin_sa_set_settings('{"enabled": false}');
  IF public.sa_can_write_for(qdoc, mg) THEN RAISE EXCEPTION 'SA20 writes while off'; END IF;
  IF public.sa_role_for(qdoc, mg) <> 'client' THEN RAISE EXCEPTION 'SA20 reading stopped'; END IF;

  RAISE NOTICE 'solution-architecture: all 20 checks passed';
END $$;

ROLLBACK;
