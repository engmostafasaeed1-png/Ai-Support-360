-- Checks for docs/sql/interview-knowledge.sql. Run AFTER applying it. Everything is rolled back.
-- Each block raises an exception with its test name when a rule is broken; a clean run ends with "ALL PASSED".

BEGIN;

-- Fixtures: one admin, two consultants with sessions, documents and chunks (written as the service role).
DO $$
DECLARE
  _admin uuid := '00000000-0000-4000-8000-0000000000a1';
  _u1 uuid := '00000000-0000-4000-8000-0000000000c1';
  _u2 uuid := '00000000-0000-4000-8000-0000000000c2';
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_admin, 'ik-admin@example.test'), (_u1, 'ik-c1@example.test'), (_u2, 'ik-c2@example.test') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (_admin, 'admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.consultants (id, user_id) VALUES ('00000000-0000-4000-8000-00000000c001', _u1), ('00000000-0000-4000-8000-00000000c002', _u2);
  INSERT INTO public.consultant_skills (consultant_id, sap_module, proficiency_level, years_experience, sap_version)
    VALUES ('00000000-0000-4000-8000-00000000c001', 'SAP FI', 4, 8, 'S/4HANA 2023'),
           ('00000000-0000-4000-8000-00000000c001', 'SAP MM', 3, 4, NULL),
           ('00000000-0000-4000-8000-00000000c002', 'SAP SD', 5, 12, 'ECC 6.0 EHP8');
  INSERT INTO public.interview_sessions (id, consultant_id, interview_type, status)
    VALUES ('00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-00000000c001', 'ai', 'completed'),
           ('00000000-0000-4000-8000-0000000005e2', '00000000-0000-4000-8000-00000000c002', 'ai', 'completed');
  INSERT INTO public.interview_answers (interview_id, question, answer_transcript, question_order, score, sap_module, question_source)
    VALUES ('00000000-0000-4000-8000-0000000005e1', 'Q1', 'A1', 1, 70, 'SAP FI', '{"type":"document","module":"SAP FI","version":"S/4HANA 2023","document_ids":["d"],"chunk_ids":["c"]}'),
           ('00000000-0000-4000-8000-0000000005e2', 'Q1', 'A1', 1, 80, 'SAP SD', '{"type":"generated_from_profile","module":"SAP SD","version":"ECC 6.0 EHP8"}');
  INSERT INTO public.interview_knowledge_documents (id, title, sap_module, sap_version, file_name, storage_path, file_kind, size_bytes, sha256, status, chunk_count, rights_confirmed, rights_confirmed_by, uploaded_by, enabled)
    VALUES ('00000000-0000-4000-8000-0000000000d1', 'FI 2023 notes', 'SAP FI', 'S/4HANA 2023', 'fi.md', '00000000-0000-4000-8000-0000000000d1/fi.md', 'md', 100, repeat('a', 64), 'ready', 2, true, _admin, _admin, true),
           ('00000000-0000-4000-8000-0000000000d2', 'FI general', 'FI', NULL, 'fi2.md', '00000000-0000-4000-8000-0000000000d2/fi2.md', 'md', 100, repeat('b', 64), 'ready', 1, true, _admin, _admin, true),
           ('00000000-0000-4000-8000-0000000000d3', 'FI ECC', 'SAP FI', 'ECC 6.0 EHP8', 'fi3.md', '00000000-0000-4000-8000-0000000000d3/fi3.md', 'md', 100, repeat('c', 64), 'ready', 1, true, _admin, _admin, true),
           ('00000000-0000-4000-8000-0000000000d4', 'FI disabled', 'SAP FI', NULL, 'fi4.md', '00000000-0000-4000-8000-0000000000d4/fi4.md', 'md', 100, repeat('d', 64), 'ready', 1, true, _admin, _admin, false),
           ('00000000-0000-4000-8000-0000000000d5', 'Fiori', 'SAP Fiori', NULL, 'fiori.md', '00000000-0000-4000-8000-0000000000d5/fiori.md', 'md', 100, repeat('e', 64), 'ready', 1, true, _admin, _admin, true);
  INSERT INTO public.interview_knowledge_chunks (document_id, chunk_no, body, sap_module, sap_version)
    VALUES ('00000000-0000-4000-8000-0000000000d1', 1, 'Universal Journal ACDOCA replaces BSEG totals in S/4HANA 2023 document splitting', 'SAP FI', 'S/4HANA 2023'),
           ('00000000-0000-4000-8000-0000000000d1', 2, 'Asset accounting new depreciation run', 'SAP FI', 'S/4HANA 2023'),
           ('00000000-0000-4000-8000-0000000000d2', 1, 'General ledger period close checklist', 'FI', NULL),
           ('00000000-0000-4000-8000-0000000000d3', 1, 'Classic GL migration ECC only', 'SAP FI', 'ECC 6.0 EHP8'),
           ('00000000-0000-4000-8000-0000000000d4', 1, 'Disabled document text', 'SAP FI', NULL),
           ('00000000-0000-4000-8000-0000000000d5', 1, 'Fiori launchpad tiles', 'SAP Fiori', NULL);
  INSERT INTO public.interview_plans (interview_id, consultant_id, status, questions) VALUES ('00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-00000000c001', 'ready', '[{"key_points":"secret"}]');
  INSERT INTO public.interview_question_log (consultant_id, interview_id, question_hash) VALUES ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000005e1', 'abcdef0123');
END $$;

-- T01 consultants cannot read documents, chunks, plans (key points) or the question log
DO $$ DECLARE n integer; BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
  SELECT count(*) INTO n FROM public.interview_knowledge_documents; IF n <> 0 THEN RAISE EXCEPTION 'T01 consultant reads documents'; END IF;
  SELECT count(*) INTO n FROM public.interview_knowledge_chunks; IF n <> 0 THEN RAISE EXCEPTION 'T01 consultant reads chunks'; END IF;
  SELECT count(*) INTO n FROM public.interview_plans; IF n <> 0 THEN RAISE EXCEPTION 'T01 consultant reads plans'; END IF;
  SELECT count(*) INTO n FROM public.interview_question_log; IF n <> 0 THEN RAISE EXCEPTION 'T01 consultant reads question log'; END IF;
  RESET ROLE;
END $$;

-- T02 consultants read their own answers but never question_source
DO $$ DECLARE n integer; BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
  SELECT count(*) INTO n FROM public.interview_answers WHERE question IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'T02 own answers not readable (%)', n; END IF;
  BEGIN
    PERFORM question_source FROM public.interview_answers;
    RAISE EXCEPTION 'T02 question_source readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.interview_answers (interview_id, question, question_order, question_source)
      VALUES ('00000000-0000-4000-8000-0000000005e1', 'x', 9, '{"type":"document"}');
    RAISE EXCEPTION 'T02 question_source writable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END $$;

-- T03 anonymous visitors cannot read answers at all
DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.interview_answers;
    RAISE EXCEPTION 'T03 anon reads answers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END $$;

-- T04 service-only functions refuse signed-in users; the public flag is readable and OFF by default
DO $$ DECLARE b boolean; BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
  BEGIN PERFORM public.ik_search_chunks('SAP FI', NULL, '{}', 3); RAISE EXCEPTION 'T04 search callable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.ik_claim_document('00000000-0000-4000-8000-0000000000d1'); RAISE EXCEPTION 'T04 claim callable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.ik_coverage(30); RAISE EXCEPTION 'T04 coverage callable by consultant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.admin_interview_question_sources('00000000-0000-4000-8000-0000000005e1'); RAISE EXCEPTION 'T04 sources callable by consultant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT public.ik_public_enabled() INTO b;
  IF b IS DISTINCT FROM false AND NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'interview_knowledge') THEN RAISE EXCEPTION 'T04 feature on by default'; END IF;
  RESET ROLE;
END $$;

-- T05 search: module first, other releases excluded, release-less documents included, disabled excluded, no "fi" -> "fiori"
DO $$ DECLARE ids uuid[]; first_doc uuid; BEGIN
  SET LOCAL ROLE service_role;
  SELECT array_agg(document_id ORDER BY rank DESC), (array_agg(document_id ORDER BY rank DESC))[1] INTO ids, first_doc
    FROM public.ik_search_chunks('FI', 'S/4HANA 2023', ARRAY['acdoca', 'splitting'], 8);
  IF first_doc <> '00000000-0000-4000-8000-0000000000d1' THEN RAISE EXCEPTION 'T05 exact release not first'; END IF;
  IF NOT ('00000000-0000-4000-8000-0000000000d2' = ANY (ids)) THEN RAISE EXCEPTION 'T05 release-less doc missing'; END IF;
  IF '00000000-0000-4000-8000-0000000000d3' = ANY (ids) THEN RAISE EXCEPTION 'T05 other release included'; END IF;
  IF '00000000-0000-4000-8000-0000000000d4' = ANY (ids) THEN RAISE EXCEPTION 'T05 disabled doc included'; END IF;
  IF '00000000-0000-4000-8000-0000000000d5' = ANY (ids) THEN RAISE EXCEPTION 'T05 fiori matched fi'; END IF;
  RESET ROLE;
END $$;

-- T06 extraction claim: once, again only after 10 minutes, at most 5 attempts
DO $$ DECLARE a boolean; b boolean; c boolean; BEGIN
  SET LOCAL ROLE service_role;
  a := public.ik_claim_document('00000000-0000-4000-8000-0000000000d2');
  b := public.ik_claim_document('00000000-0000-4000-8000-0000000000d2');
  IF NOT a OR b THEN RAISE EXCEPTION 'T06 double claim'; END IF;
  UPDATE public.interview_knowledge_documents SET claimed_at = now() - interval '11 minutes' WHERE id = '00000000-0000-4000-8000-0000000000d2';
  c := public.ik_claim_document('00000000-0000-4000-8000-0000000000d2');
  IF NOT c THEN RAISE EXCEPTION 'T06 stale claim not taken over'; END IF;
  UPDATE public.interview_knowledge_documents SET attempts = 5, status = 'failed' WHERE id = '00000000-0000-4000-8000-0000000000d2';
  IF public.ik_claim_document('00000000-0000-4000-8000-0000000000d2') THEN RAISE EXCEPTION 'T06 attempts cap'; END IF;
  UPDATE public.interview_knowledge_documents SET attempts = 0, status = 'ready', claimed_at = NULL WHERE id = '00000000-0000-4000-8000-0000000000d2';
  RESET ROLE;
END $$;

-- T07 admin coverage: declared module/version without documents shows 0; documents and questions counted
DO $$ DECLARE r record; BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  SELECT * INTO r FROM public.ik_coverage(30) WHERE public.ik_module_key(sap_module) = 'sd';
  IF r IS NULL OR r.documents <> 0 OR r.consultants <> 1 OR r.questions_asked <> 1 THEN RAISE EXCEPTION 'T07 SD row wrong: %', r; END IF;
  SELECT * INTO r FROM public.ik_coverage(30) WHERE public.ik_module_key(sap_module) = 'fi' AND public.ik_version_key(sap_version) = 's/4hana 2023';
  IF r IS NULL OR r.documents <> 1 OR r.module_documents < 2 OR r.questions_asked <> 1 OR r.avg_score <> 70 THEN RAISE EXCEPTION 'T07 FI 2023 row wrong: %', r; END IF;
  IF (SELECT count(*) FROM public.admin_interview_question_sources('00000000-0000-4000-8000-0000000005e1') WHERE question_source->>'type' = 'document') <> 1 THEN
    RAISE EXCEPTION 'T07 admin cannot read sources';
  END IF;
  IF (SELECT count(*) FROM public.interview_plans) <> 1 THEN RAISE EXCEPTION 'T07 admin cannot read plans'; END IF;
  RESET ROLE;
END $$;

-- T08 version per module: own update allowed, bounded length, no markup
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
  UPDATE public.consultant_skills SET sap_version = 'S/4HANA 2022' WHERE sap_module = 'SAP MM' AND consultant_id = '00000000-0000-4000-8000-00000000c001';
  IF NOT FOUND THEN RAISE EXCEPTION 'T08 own version not updatable'; END IF;
  BEGIN
    UPDATE public.consultant_skills SET sap_version = repeat('x', 61) WHERE sap_module = 'SAP MM' AND consultant_id = '00000000-0000-4000-8000-00000000c001';
    RAISE EXCEPTION 'T08 long version accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.consultant_skills SET sap_version = '<script>' WHERE sap_module = 'SAP MM' AND consultant_id = '00000000-0000-4000-8000-00000000c001';
    RAISE EXCEPTION 'T08 markup accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
END $$;

-- T09 version options: everyone signed in reads, only admins write
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
  BEGIN
    INSERT INTO public.sap_version_options (module_key, label) VALUES ('s4hana', 'S/4HANA 2099');
    RAISE EXCEPTION 'T09 consultant wrote options';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  INSERT INTO public.sap_version_options (module_key, label) VALUES ('s4hana', 'S/4HANA 2099');
  RESET ROLE;
END $$;

-- T10 never repeat: the same question hash cannot be logged twice for one consultant (another consultant may get it)
DO $$ BEGIN
  BEGIN
    INSERT INTO public.interview_question_log (consultant_id, question_hash) VALUES ('00000000-0000-4000-8000-00000000c001', 'abcdef0123');
    RAISE EXCEPTION 'T10 repeat accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO public.interview_question_log (consultant_id, question_hash) VALUES ('00000000-0000-4000-8000-00000000c002', 'abcdef0123');
END $$;

-- T11 documents: the rights confirmation is required, size is capped, the same file cannot be uploaded twice
DO $$ BEGIN
  BEGIN
    INSERT INTO public.interview_knowledge_documents (title, sap_module, file_name, storage_path, file_kind, size_bytes, sha256, rights_confirmed, rights_confirmed_by, uploaded_by)
      VALUES ('x', 'FI', 'x.md', '00000000-0000-4000-8000-0000000000f1/x.md', 'md', 10, repeat('f', 64), false, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'T11 unconfirmed document accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.interview_knowledge_documents (title, sap_module, file_name, storage_path, file_kind, size_bytes, sha256, rights_confirmed, rights_confirmed_by, uploaded_by)
      VALUES ('x', 'FI', 'x.md', '00000000-0000-4000-8000-0000000000f2/x.md', 'md', 10485761, repeat('9', 64), true, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'T11 oversize accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.interview_knowledge_documents (title, sap_module, file_name, storage_path, file_kind, size_bytes, sha256, rights_confirmed, rights_confirmed_by, uploaded_by)
      VALUES ('dup', 'FI', 'x.md', '00000000-0000-4000-8000-0000000000f3/x.md', 'md', 10, repeat('a', 64), true, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'T11 duplicate file accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.interview_knowledge_documents (title, sap_module, file_name, storage_path, file_kind, size_bytes, sha256, rights_confirmed, rights_confirmed_by, uploaded_by)
      VALUES ('x', 'FI', '../etc/passwd', '00000000-0000-4000-8000-0000000000f4/x.md', 'md', 10, repeat('7', 64), true, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'T11 unsafe file name accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- T12 metadata changes reach the chunks (module/version filters stay correct); deleting a document deletes its chunks
DO $$ DECLARE n integer; BEGIN
  UPDATE public.interview_knowledge_documents SET sap_version = 'S/4HANA 2022' WHERE id = '00000000-0000-4000-8000-0000000000d1';
  SELECT count(*) INTO n FROM public.interview_knowledge_chunks WHERE document_id = '00000000-0000-4000-8000-0000000000d1' AND sap_version = 'S/4HANA 2022';
  IF n <> 2 THEN RAISE EXCEPTION 'T12 chunks not synced'; END IF;
  DELETE FROM public.interview_knowledge_documents WHERE id = '00000000-0000-4000-8000-0000000000d1';
  SELECT count(*) INTO n FROM public.interview_knowledge_chunks WHERE document_id = '00000000-0000-4000-8000-0000000000d1';
  IF n <> 0 THEN RAISE EXCEPTION 'T12 chunks left behind'; END IF;
END $$;

-- T13 signed-in users cannot write documents, chunks, plans or the log directly
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  BEGIN UPDATE public.interview_knowledge_documents SET enabled = false; RAISE EXCEPTION 'T13 direct document write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.interview_knowledge_chunks; RAISE EXCEPTION 'T13 direct chunk delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.interview_plans SET status = 'failed'; RAISE EXCEPTION 'T13 direct plan write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.interview_question_log; RAISE EXCEPTION 'T13 direct log delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END $$;

DO $$ BEGIN RAISE NOTICE 'interview-knowledge: ALL PASSED'; END $$;
ROLLBACK;
