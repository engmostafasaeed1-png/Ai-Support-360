-- Feature U post-apply checks. Runs inside one transaction and rolls everything back (no data is kept).
-- Needs user ids 1 (client) and 9 (admin) to exist with those roles, as in a scratch database.
BEGIN;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-000000000001'::uuid AS client,
  '00000000-0000-0000-0000-000000000009'::uuid AS admin;
GRANT SELECT ON _ids TO authenticated, service_role;
CREATE TEMP TABLE _out (k text PRIMARY KEY, v text);
GRANT ALL ON _out TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.as_role(_role text, _u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', _role)::text, true);
$$;

-- 1. Browser roles cannot call the submit function or write tables directly.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_role('authenticated', (SELECT client FROM _ids));
DO $$ BEGIN
  BEGIN PERFORM public.submit_feedback(auth.uid(), NULL, '{"type":"bug"}'); RAISE EXCEPTION 'submit callable by users';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.feedback_reports (type, title, description) VALUES ('bug', 'abc', 'abcdefghijk'); RAISE EXCEPTION 'direct insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- 2. The service submits for the client: tags stripped, card number and token masked, query string dropped.
SET LOCAL ROLE service_role;
SELECT pg_temp.as_role('service_role', NULL);
INSERT INTO _out SELECT 'r1', (public.submit_feedback((SELECT client FROM _ids), NULL, jsonb_build_object(
  'type', 'bug', 'severity', 'blocks', 'title', '<b>Save fails</b>',
  'description', 'Card 4111 1111 1111 1111 and token abcdefghijklmnopqrstuvwxyz0123456789ABCD broke it',
  'route', '/client/tickets?token=secret#x', 'consent_contact', true, 'context', jsonb_build_object('lang', 'ar'))))->>'id';
DO $$ DECLARE r public.feedback_reports; BEGIN
  SELECT * INTO r FROM public.feedback_reports WHERE id = (SELECT v::uuid FROM _out WHERE k = 'r1');
  IF r.title <> 'Save fails' THEN RAISE EXCEPTION 'html not stripped: %', r.title; END IF;
  IF r.description LIKE '%4111%' OR r.description LIKE '%abcdefghijklmnop%' THEN RAISE EXCEPTION 'secrets not masked: %', r.description; END IF;
  IF r.route <> '/client/tickets' THEN RAISE EXCEPTION 'query kept: %', r.route; END IF;
  IF r.role <> 'client' OR NOT r.consent_contact THEN RAISE EXCEPTION 'role/consent wrong'; END IF;
END $$;

-- 3. Validation: bad type, short description; severity dropped for non-bugs.
DO $$ BEGIN
  BEGIN PERFORM public.submit_feedback((SELECT client FROM _ids), NULL, '{"type":"spam","title":"abc","description":"0123456789"}');
    RAISE EXCEPTION 'bad type accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'invalid_type' THEN RAISE; END IF; END;
  BEGIN PERFORM public.submit_feedback((SELECT client FROM _ids), NULL, '{"type":"idea","title":"abc","description":"short"}');
    RAISE EXCEPTION 'short description accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'invalid_description' THEN RAISE; END IF; END;
END $$;
INSERT INTO _out SELECT 'r2', (public.submit_feedback((SELECT client FROM _ids), NULL,
  '{"type":"idea","severity":"blocks","title":"Dark mode","description":"Please add a darker theme"}'))->>'id';
DO $$ BEGIN
  IF (SELECT severity FROM public.feedback_reports WHERE id = (SELECT v::uuid FROM _out WHERE k = 'r2')) IS NOT NULL THEN
    RAISE EXCEPTION 'severity kept for idea'; END IF;
END $$;

-- 4. Rate limit: at most 5 per hour per user (refused attempts count towards the limit too).
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..10 LOOP
    BEGIN
      PERFORM public.submit_feedback((SELECT client FROM _ids), NULL, '{"type":"question","title":"How?","description":"How does billing work?"}');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'rate_limited' THEN INSERT INTO _out VALUES ('limited_at', i::text); EXIT; END IF; RAISE;
    END;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM _out WHERE k = 'limited_at') THEN RAISE EXCEPTION 'user rate limit not applied'; END IF;
  IF (SELECT count(*) FROM public.feedback_reports WHERE user_id = (SELECT client FROM _ids)) > 5 THEN RAISE EXCEPTION 'more than 5 stored'; END IF;
END $$;

-- 5. Visitors: honeypot dropped silently, too-fast refused, 3 per hour per IP hash.
DO $$ DECLARE i int; ok int := 0; BEGIN
  IF (public.submit_feedback(NULL, 'hash-hash-hash-hash', '{"website":"x","type":"bug","title":"abc","description":"0123456789"}'))->>'dropped' <> 'true' THEN
    RAISE EXCEPTION 'honeypot not dropped'; END IF;
  BEGIN PERFORM public.submit_feedback(NULL, 'hash-hash-hash-hash', '{"type":"bug","title":"abc","description":"0123456789","elapsed_ms":200}');
    RAISE EXCEPTION 'too fast accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'too_fast' THEN RAISE; END IF; END;
  FOR i IN 1..5 LOOP
    BEGIN
      PERFORM public.submit_feedback(NULL, 'hash-hash-hash-hash', '{"type":"compliment","title":"Nice","description":"Great service overall","elapsed_ms":9000}');
      ok := ok + 1;
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'rate_limited' THEN RAISE; END IF; END;
  END LOOP;
  IF ok <> 3 THEN RAISE EXCEPTION 'visitor limit wrong: %', ok; END IF;
END $$;

-- 6. Attachments: max 3, path must belong to the report, only images.
DO $$ DECLARE r uuid := (SELECT v::uuid FROM _out WHERE k = 'r1'); BEGIN
  PERFORM public.feedback_add_attachments(r, jsonb_build_array(
    jsonb_build_object('path', r || '/a.png', 'content_type', 'image/png', 'size', 1000),
    jsonb_build_object('path', r || '/b.webp', 'content_type', 'image/webp', 'size', 2000)));
  BEGIN PERFORM public.feedback_add_attachments(r, jsonb_build_array(
      jsonb_build_object('path', r || '/c.png', 'content_type', 'image/png', 'size', 1),
      jsonb_build_object('path', r || '/d.png', 'content_type', 'image/png', 'size', 1)));
    RAISE EXCEPTION 'fourth file accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'too_many_files' THEN RAISE; END IF; END;
  BEGIN PERFORM public.feedback_add_attachments(r, jsonb_build_array(jsonb_build_object('path', 'other/x.png', 'content_type', 'image/png', 'size', 1)));
    RAISE EXCEPTION 'foreign path accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'invalid_path' THEN RAISE; END IF; END;
  BEGIN PERFORM public.feedback_add_attachments(r, jsonb_build_array(jsonb_build_object('path', r || '/x.svg', 'content_type', 'image/svg+xml', 'size', 1)));
    RAISE EXCEPTION 'svg accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT attachments FROM public.feedback_reports WHERE id = r) <> 2 THEN RAISE EXCEPTION 'count wrong'; END IF;
END $$;
RESET ROLE;

-- 7. Blocking bug alerted the admin.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT admin FROM _ids) AND type = 'feedback_blocker') THEN
    RAISE EXCEPTION 'admin not alerted'; END IF;
END $$;

-- 8. RLS: the client sees no table rows, only their own reports through my_feedback.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_role('authenticated', (SELECT client FROM _ids));
DO $$ BEGIN
  IF (SELECT count(*) FROM public.feedback_reports) <> 0 THEN RAISE EXCEPTION 'client reads table'; END IF;
  IF jsonb_array_length(public.my_feedback()) < 2 THEN RAISE EXCEPTION 'my_feedback missing rows'; END IF;
  BEGIN PERFORM public.feedback_admin_update(ARRAY[(SELECT v::uuid FROM _out WHERE k = 'r1')], '{"status":"fixed"}');
    RAISE EXCEPTION 'client updated'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 9. The admin reads all, updates status (audited, thank-you sent), notes stay internal, replies are visible.
SELECT pg_temp.as_role('authenticated', (SELECT admin FROM _ids));
DO $$ DECLARE r uuid := (SELECT v::uuid FROM _out WHERE k = 'r1'); ev uuid; BEGIN
  IF (SELECT count(*) FROM public.feedback_reports) < 5 THEN RAISE EXCEPTION 'admin cannot read'; END IF;
  IF public.feedback_admin_update(ARRAY[r], '{"status":"fixed","priority":"high","admin_notes":"internal only"}') <> 1 THEN RAISE EXCEPTION 'update count'; END IF;
  ev := public.feedback_admin_reply(r, 'Thanks, it is fixed now');
  IF ev IS NULL THEN RAISE EXCEPTION 'reply missing'; END IF;
  IF (public.feedback_admin_counts())->>'fixed' <> '1' THEN RAISE EXCEPTION 'counts wrong'; END IF;
  BEGIN PERFORM public.feedback_admin_update(ARRAY[r], jsonb_build_object('duplicate_of', r)); RAISE EXCEPTION 'self duplicate';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'invalid_duplicate' THEN RAISE; END IF; END;
  INSERT INTO _out VALUES ('ev', ev::text);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'feedback.update') THEN RAISE EXCEPTION 'not audited'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT client FROM _ids) AND type = 'feedback_fixed') THEN RAISE EXCEPTION 'no thank-you'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_role('authenticated', (SELECT client FROM _ids));
DO $$ DECLARE mine jsonb := public.my_feedback(); BEGIN
  IF mine::text LIKE '%internal only%' THEN RAISE EXCEPTION 'internal note leaked'; END IF;
  IF mine::text NOT LIKE '%it is fixed now%' THEN RAISE EXCEPTION 'reply not visible'; END IF;
END $$;
RESET ROLE;

-- 10. Reply e-mail claim works once (consent given) and only for the service.
SET LOCAL ROLE service_role;
SELECT pg_temp.as_role('service_role', NULL);
DO $$ DECLARE c jsonb; BEGIN
  c := public.feedback_reply_email_claim((SELECT v::uuid FROM _out WHERE k = 'ev'));
  IF c IS NULL OR c->>'lang' <> 'ar' THEN RAISE EXCEPTION 'claim failed: %', c; END IF;
  IF public.feedback_reply_email_claim((SELECT v::uuid FROM _out WHERE k = 'ev')) IS NOT NULL THEN RAISE EXCEPTION 'claimed twice'; END IF;
END $$;
RESET ROLE;

-- 11. Retention: old screenshots are handed out once, then the old report is removed.
UPDATE public.feedback_attachments SET created_at = now() - interval '400 days';
UPDATE public.feedback_reports SET created_at = now() - interval '800 days' WHERE id = (SELECT v::uuid FROM _out WHERE k = 'r1');
SET LOCAL ROLE service_role;
DO $$ DECLARE a jsonb; b jsonb; BEGIN
  a := public.feedback_claim_retention(50);
  IF jsonb_array_length(a->'paths') <> 2 THEN RAISE EXCEPTION 'paths: %', a; END IF;
  b := public.feedback_claim_retention(50);
  IF jsonb_array_length(b->'paths') <> 0 THEN RAISE EXCEPTION 'paths repeated'; END IF;
  IF EXISTS (SELECT 1 FROM public.feedback_reports WHERE id = (SELECT v::uuid FROM _out WHERE k = 'r1')) THEN RAISE EXCEPTION 'old report kept'; END IF;
END $$;
RESET ROLE;

SELECT 'feedback checks passed' AS result;
ROLLBACK;
