-- Checks for docs/sql/interview-voice.sql. Scratch database only, after the file is applied. One transaction, rolled
-- back; raises on the first failed check. Names V01-V12 are listed in docs/interview-voice.md.
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _u IS NULL THEN '' ELSE json_build_object('sub', _u, 'role', 'authenticated')::text END, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.set_voice(_patch jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.platform_settings (key, value) VALUES ('interview_voice', _patch)
  ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || excluded.value;
$$;
CREATE OR REPLACE FUNCTION pg_temp.claim(_u uuid, _i uuid, _ctx text, _s numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.voice_claim_segment(_u, _i, _ctx, _s, 1000, 0, 'openai/gpt-transcribe');
$$;

CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
GRANT SELECT ON t TO anon, authenticated;
DO $$
DECLARE a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
        ca uuid := gen_random_uuid(); cb uuid := gen_random_uuid(); ia uuid := gen_random_uuid(); ib uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (a, 'voice-a@example.test'), (b, 'voice-b@example.test'), (adm, 'voice-admin@example.test');
  INSERT INTO public.profiles (user_id, display_name) VALUES (a, 'Voice A'), (b, 'Voice B'), (adm, 'Voice Admin');
  INSERT INTO public.user_roles (user_id, role) VALUES (adm, 'admin');
  INSERT INTO public.consultants (id, user_id) VALUES (ca, a), (cb, b);
  INSERT INTO public.interview_sessions (id, consultant_id, status, interview_type) VALUES (ia, ca, 'in_progress', 'ai'), (ib, cb, 'in_progress', 'ai');
  INSERT INTO t VALUES ('a', a), ('b', b), ('adm', adm), ('ia', ia), ('ib', ib);
END $$;

-- V01 anonymous visitors cannot call any voice function
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.voice_log_answer(uuid, text, text, text, integer, boolean, integer)', 'EXECUTE'), 'V01 anon log');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.admin_interview_voice_metrics(integer)', 'EXECUTE'), 'V01 anon metrics');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.voice_claim_segment(uuid, uuid, text, numeric, integer, integer, text)', 'EXECUTE'), 'V01 anon claim');

-- V02 signed-in users cannot claim minutes, finish segments or read settings directly (service role only)
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_claim_segment(uuid, uuid, text, numeric, integer, integer, text)', 'EXECUTE'), 'V02 claim');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_finish_segment(uuid, text, integer, text, boolean, numeric, text, text, text, jsonb)', 'EXECUTE'), 'V02 finish');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_settings()', 'EXECUTE'), 'V02 settings');
SELECT pg_temp.check(has_function_privilege('service_role', 'public.voice_claim_segment(uuid, uuid, text, numeric, integer, integer, text)', 'EXECUTE'), 'V02 service claim');

-- V03 no browser access to the metric tables
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.voice_transcription_segments', 'SELECT'), 'V03 segments select');
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.voice_transcription_segments', 'INSERT'), 'V03 segments insert');
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.voice_answer_events', 'SELECT'), 'V03 answers select');
SELECT pg_temp.check(NOT has_table_privilege('anon', 'public.voice_answer_events', 'INSERT'), 'V03 answers insert');

-- V04 interview cap: 5 minutes = ten 30-second segments, the eleventh is refused
SELECT pg_temp.set_voice('{"server_stt": true, "max_minutes_interview": 5, "max_minutes_day": 90, "dictation_minutes_day": 20}');
SELECT pg_temp.check((pg_temp.claim((SELECT v FROM t WHERE k = 'a'), (SELECT v FROM t WHERE k = 'ia'), 'interview', 30)->>'ok')::boolean, 'V04 claim ' || n)
FROM generate_series(1, 10) n;
SELECT pg_temp.check(pg_temp.claim((SELECT v FROM t WHERE k = 'a'), (SELECT v FROM t WHERE k = 'ia'), 'interview', 30)->>'reason' = 'interview_cap', 'V04 interview cap');

-- V05 failed segments do not use minutes; a segment is finished only once
DO $$
DECLARE r jsonb; id uuid;
BEGIN
  UPDATE public.voice_transcription_segments SET status = 'failed' WHERE interview_id = (SELECT v FROM t WHERE k = 'ia')
    AND id IN (SELECT id FROM public.voice_transcription_segments WHERE interview_id = (SELECT v FROM t WHERE k = 'ia') LIMIT 1);
  r := pg_temp.claim((SELECT v FROM t WHERE k = 'a'), (SELECT v FROM t WHERE k = 'ia'), 'interview', 30);
  PERFORM pg_temp.check((r->>'ok')::boolean, 'V05 freed minutes after a failure');
  id := (r->>'id')::uuid;
  PERFORM pg_temp.check(public.voice_finish_segment(id, 'ok', 900, 'en', true, 29.5, NULL, NULL, 'we post with miro', '[{"from":"miro","to":"MIRO"}]'), 'V05 first finish');
  PERFORM pg_temp.check(NOT public.voice_finish_segment(id, 'failed', 1, NULL, false, NULL, 'late', NULL, NULL, NULL), 'V05 second finish ignored');
  PERFORM pg_temp.check((SELECT status = 'ok' AND audio_seconds = 29.5 AND corrected FROM public.voice_transcription_segments WHERE voice_transcription_segments.id = id), 'V05 stored result');
END $$;

-- V06 day cap across interviews and dictation (10 minutes): B uses 9.5 min of dictation-free interview time, then 60 s more is refused
SELECT pg_temp.set_voice('{"max_minutes_interview": 120, "max_minutes_day": 10}');
SELECT pg_temp.check((pg_temp.claim((SELECT v FROM t WHERE k = 'b'), (SELECT v FROM t WHERE k = 'ib'), 'interview', 30)->>'ok')::boolean, 'V06 claim ' || n)
FROM generate_series(1, 19) n;
SELECT pg_temp.check(pg_temp.claim((SELECT v FROM t WHERE k = 'b'), NULL, 'dictation', 31)->>'reason' = 'day_cap', 'V06 day cap');

-- V07 dictation cap and switch-off
SELECT pg_temp.set_voice('{"max_minutes_day": 90, "dictation_minutes_day": 0}');
SELECT pg_temp.check(pg_temp.claim((SELECT v FROM t WHERE k = 'a'), NULL, 'dictation', 5)->>'reason' = 'dictation_cap', 'V07 dictation cap');
SELECT pg_temp.set_voice('{"server_stt": false, "dictation_minutes_day": 20}');
SELECT pg_temp.check(pg_temp.claim((SELECT v FROM t WHERE k = 'a'), NULL, 'dictation', 5)->>'reason' = 'disabled', 'V07 disabled');
SELECT pg_temp.set_voice('{"server_stt": true}');

-- V08 segment length and bad requests
SELECT pg_temp.check(pg_temp.claim((SELECT v FROM t WHERE k = 'a'), NULL, 'dictation', 40)->>'reason' = 'too_long', 'V08 too long');
SELECT pg_temp.check(pg_temp.claim((SELECT v FROM t WHERE k = 'a'), NULL, 'interview', 5)->>'reason' = 'bad_request', 'V08 interview without id');
SELECT pg_temp.check(pg_temp.claim((SELECT v FROM t WHERE k = 'a'), NULL, 'other', 5)->>'reason' = 'bad_request', 'V08 unknown context');

-- V09 dictation never keeps the transcript
DO $$
DECLARE r jsonb := pg_temp.claim((SELECT v FROM t WHERE k = 'a'), NULL, 'dictation', 5);
BEGIN
  PERFORM public.voice_finish_segment((r->>'id')::uuid, 'ok', 500, 'ar', false, 5, NULL, NULL, 'private ticket text', NULL);
  PERFORM pg_temp.check((SELECT raw_text IS NULL FROM public.voice_transcription_segments WHERE id = (r->>'id')::uuid), 'V09 no dictation text');
END $$;

-- V10 answer events: own interview only, valid values only
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT v FROM t WHERE k = 'a'));
SELECT pg_temp.check(public.voice_log_answer((SELECT v FROM t WHERE k = 'ia'), 'interview', 'server', NULL, 3, true, 120), 'V10 own answer');
SELECT pg_temp.check(public.voice_log_answer((SELECT v FROM t WHERE k = 'ia'), 'interview', 'webspeech', 'server_failed', 1, false, 40), 'V10 fallback answer');
SELECT pg_temp.check(public.voice_log_answer(NULL, 'dictation', 'server', NULL, 1, false, 10), 'V10 dictation answer');
DO $$ BEGIN
  PERFORM public.voice_log_answer((SELECT v FROM t WHERE k = 'ib'), 'interview', 'server', NULL, 1, false, 10);
  RAISE EXCEPTION 'FAILED: V10 logged for another consultant''s interview';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM public.voice_log_answer((SELECT v FROM t WHERE k = 'ia'), 'interview', 'magic', NULL, 1, false, 10);
  RAISE EXCEPTION 'FAILED: V10 invalid engine accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;

-- V11 metrics are for administrators only
DO $$ BEGIN
  PERFORM * FROM public.admin_interview_voice_metrics(30);
  RAISE EXCEPTION 'FAILED: V11 consultant read the metrics';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM * FROM public.admin_interview_voice_segments((SELECT v FROM t WHERE k = 'ia'));
  RAISE EXCEPTION 'FAILED: V11 consultant read the segments';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- V12 an administrator sees per-interview numbers and the audit trail
SELECT pg_temp.as_user((SELECT v FROM t WHERE k = 'adm'));
SELECT pg_temp.check((SELECT segments = 11 AND failed_segments = 1 AND answers = 2 AND voice_answers = 2 AND edited_answers = 1 AND fallback_answers = 1 AND consultant_name = 'Voice A'
  FROM public.admin_interview_voice_metrics(30) WHERE interview_id = (SELECT v FROM t WHERE k = 'ia')), 'V12 metrics row');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.admin_interview_voice_segments((SELECT v FROM t WHERE k = 'ia')) WHERE raw_text = 'we post with miro' AND corrected), 'V12 audit trail');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.admin_interview_voice_metrics(30) WHERE interview_id IS NULL AND answers = 1), 'V12 dictation row');
RESET ROLE;

ROLLBACK;
