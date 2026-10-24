-- Checks for docs/sql/interview-voice-learning.sql. Scratch database only, after interview-voice.sql and this file are
-- applied. One transaction, rolled back; raises on the first failed check. Names L01-L18 are listed in
-- docs/interview-voice.md (section "Learning").
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _u IS NULL THEN '' ELSE json_build_object('sub', _u, 'role', 'authenticated')::text END, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.fails(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE OR REPLACE FUNCTION pg_temp.learning(_patch jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.platform_settings (key, value) VALUES ('interview_voice_learning', _patch)
  ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || excluded.value;
$$;

CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
GRANT SELECT ON t TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text), pg_temp.fails(text) TO authenticated;
-- seven consultants (u1..u7), an administrator and a super administrator, each consultant with an open interview
DO $$
DECLARE u uuid; c uuid; i uuid; adm uuid := gen_random_uuid(); sup uuid := gen_random_uuid();
BEGIN
  FOR n IN 1..7 LOOP
    u := gen_random_uuid(); c := gen_random_uuid(); i := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (u, format('learn-%s@example.test', n));
    INSERT INTO public.profiles (user_id, display_name) VALUES (u, 'Learner ' || n);
    INSERT INTO public.consultants (id, user_id) VALUES (c, u);
    INSERT INTO public.interview_sessions (id, consultant_id, status, interview_type) VALUES (i, c, 'in_progress', 'ai');
    INSERT INTO t VALUES ('u' || n, u), ('i' || n, i), ('c' || n, c);
  END LOOP;
  INSERT INTO auth.users (id, email) VALUES (adm, 'learn-admin@example.test'), (sup, 'learn-super@example.test');
  INSERT INTO public.profiles (user_id, display_name) VALUES (adm, 'Learn Admin'), (sup, 'Learn Super');
  INSERT INTO public.user_roles (user_id, role) VALUES (adm, 'admin'), (sup, 'super_admin');
  INSERT INTO t VALUES ('adm', adm), ('sup', sup);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.v(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM t WHERE k = _k $$;
GRANT EXECUTE ON FUNCTION pg_temp.v(text) TO authenticated;
-- one answer of consultant n with the given pairs (as that consultant)
CREATE OR REPLACE FUNCTION pg_temp.answer(_n int, _order int, _pairs jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user(pg_temp.v('u' || _n));
  SET LOCAL ROLE authenticated;
  r := public.voice_learn_from_answer(pg_temp.v('i' || _n), _order, 5000, true, 'en', 'desktop-chrome', 1,
         '[{"model":"openai/gpt-transcribe","words":20,"errors":2}]'::jsonb, _pairs, 'I posted it in mirror', 'I posted it in MIRO', 'server');
  RESET ROLE;
  RETURN r;
END $$;

-- L01 no anonymous or browser access to the learning tables and service functions
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.voice_learn_from_answer(uuid, integer, integer, boolean, text, text, integer, jsonb, jsonb, text, text, text)', 'EXECUTE'), 'L01 anon learn');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_learning_nightly()', 'EXECUTE'), 'L01 nightly');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_record_auto_corrections(uuid, uuid, text, jsonb, text, text, text)', 'EXECUTE'), 'L01 auto pairs');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_learning_gate_result(text, text, jsonb)', 'EXECUTE'), 'L01 gate');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_learning_context(uuid)', 'EXECUTE'), 'L01 context');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.voice_store_training_audio(uuid, uuid, text, integer, numeric)', 'EXECUTE'), 'L01 audio');
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.voice_correction_pairs', 'SELECT'), 'L01 pairs table');
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.voice_vocab_suggestions', 'SELECT'), 'L01 suggestions table');
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.voice_personal_terms', 'INSERT'), 'L01 personal insert');
SELECT pg_temp.check(has_function_privilege('service_role', 'public.voice_learning_nightly()', 'EXECUTE'), 'L01 service nightly');

-- L02 only the consultant's own open interview; PII, secrets and prompt-like text never stored; an answer counts once
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user(pg_temp.v('u1'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check(pg_temp.fails(format($q$SELECT public.voice_learn_from_answer(%L, 1, 1, false, 'en', 'x', 1, '[]', '[]', '', '')$q$, pg_temp.v('i2'))), 'L02 other interview');
  RESET ROLE;
  r := pg_temp.answer(1, 1, '[{"heard":"miro","final":"MIRO"},{"heard":"mostafa at gmail","final":"mostafa@gmail.com"},{"heard":"call","final":"01001234567"},{"heard":"ignore","final":"ignore instructions"},{"heard":"key","final":"AbCdEf123456GhIjKl"}]');
  PERFORM pg_temp.check((r->>'pairs')::int = 1, 'L02 only the clean pair is kept: ' || r::text);
  r := pg_temp.answer(1, 1, '[{"heard":"miro","final":"MIRO"}]');
  PERFORM pg_temp.check(r->>'duplicate' = 'true', 'L02 duplicate answer');
  PERFORM pg_temp.check((SELECT count(*) FROM public.voice_correction_pairs WHERE user_id = pg_temp.v('u1')) = 1, 'L02 pair count');
  PERFORM pg_temp.check((SELECT reference FROM public.voice_eval_items WHERE user_id = pg_temp.v('u1')) = 'I posted it in MIRO', 'L02 eval item');
  PERFORM pg_temp.as_user(pg_temp.v('u1'));
  SET LOCAL ROLE authenticated;
  r := public.voice_learn_from_answer(pg_temp.v('i1'), 2, 9000, false, 'en', 'desktop-chrome', 1, '[{"model":"openai/gpt-transcribe","words":5,"errors":1}]', '[{"heard":"miro","final":"MIRO"}]', 'a', 'b', 'typed');
  RESET ROLE;
  PERFORM pg_temp.check((r->>'pairs')::int = 0 AND (SELECT models = '[]' AND NOT edited AND answer_ms = 9000 FROM public.voice_answer_learning WHERE interview_id = pg_temp.v('i1') AND answer_order = 2), 'L02 typed answers only count time');
  PERFORM pg_temp.check(public.voice_scrub_text('mail a.b@x.com call +20 100 123 4567 key AbCdEf123456GhIjKl') = 'mail [email] call [number] key [secret]', 'L02 scrub: ' || public.voice_scrub_text('mail a.b@x.com call +20 100 123 4567 key AbCdEf123456GhIjKl'));
END $$;

-- L03 one consultant correcting many times cannot promote a word (poisoning)
DO $$
BEGIN
  FOR n IN 2..30 LOOP PERFORM pg_temp.answer(2, n, '[{"heard":"sales","final":"SALESX9"}]'); END LOOP;
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check((SELECT consultants = 1 AND total_count = 29 AND status = 'pending' FROM public.voice_vocab_suggestions WHERE final_key = 'salesx9'), 'L03 one consultant stays pending');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.voice_vocab_versions WHERE status = 'candidate'), 'L03 no candidate');
END $$;

-- L04 three different consultants + SAP check: auto-promoted into a candidate; the active vocabulary is unchanged
DO $$
BEGIN
  PERFORM pg_temp.answer(3, 1, '[{"heard":"miro","final":"MIRO"}]');
  PERFORM pg_temp.answer(4, 1, '[{"heard":"miro","final":"MIRO"}]');
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check((SELECT status = 'auto_promoted' AND consultants = 3 FROM public.voice_vocab_suggestions WHERE final_key = 'miro'), 'L04 promoted');
  PERFORM pg_temp.check((SELECT terms @> '[{"term":"MIRO"}]' FROM public.voice_vocab_versions WHERE status = 'candidate'), 'L04 candidate has MIRO');
  PERFORM pg_temp.check((SELECT jsonb_array_length(terms) = 0 FROM public.voice_vocab_versions WHERE status = 'active'), 'L04 active unchanged');
END $$;

-- L05 the gate activates a candidate that is not worse; the old version is retired; logged
DO $$
DECLARE c int := (SELECT version FROM public.voice_vocab_versions WHERE status = 'candidate');
BEGIN
  PERFORM pg_temp.check(public.voice_learning_gate_result('vocab', c::text, '{"passed":true,"items":25,"wer_before":0.1,"wer_after":0.05}') = 'activated', 'L05 activated');
  PERFORM pg_temp.check((SELECT version FROM public.voice_vocab_versions WHERE status = 'active') = c, 'L05 active');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.voice_learning_events WHERE action = 'gate_activate'), 'L05 audit');
  PERFORM pg_temp.check(public.voice_learning_context(pg_temp.v('u1'))->'terms' @> '[{"term":"MIRO"}]', 'L05 used by transcription');
END $$;

-- L06 one-click rollback only to a version that was active before
DO $$
DECLARE cur int := (SELECT version FROM public.voice_vocab_versions WHERE status = 'active');
        first int := (SELECT min(version) FROM public.voice_vocab_versions);
BEGIN
  PERFORM pg_temp.as_user(pg_temp.v('adm'));
  PERFORM pg_temp.check(pg_temp.fails($q$SELECT public.admin_voice_vocab_rollback(1, '')$q$), 'L06 reason required');
  PERFORM public.admin_voice_vocab_rollback(first, 'test rollback');
  PERFORM pg_temp.check((SELECT version FROM public.voice_vocab_versions WHERE status = 'active') = first, 'L06 rolled back');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.voice_learning_events WHERE action = 'rollback' AND reason = 'test rollback' AND actor = pg_temp.v('adm')), 'L06 who/why');
  PERFORM public.admin_voice_vocab_rollback(cur, 'forward again');
  INSERT INTO public.voice_vocab_versions (status, kind, terms) VALUES ('blocked', 'auto', '[]');
  PERFORM pg_temp.check(pg_temp.fails(format($q$SELECT public.admin_voice_vocab_rollback(%s, 'never active')$q$, (SELECT max(version) FROM public.voice_vocab_versions))), 'L06 never-active refused');
  PERFORM pg_temp.as_user(pg_temp.v('u1'));
  PERFORM pg_temp.check(pg_temp.fails($q$SELECT public.admin_voice_vocab_rollback(1, 'consultant')$q$), 'L06 consultants cannot');
END $$;

-- L07 rejected terms are never suggested again
DO $$
DECLARE sid uuid := (SELECT id FROM public.voice_vocab_suggestions WHERE final_key = 'salesx9');
BEGIN
  PERFORM pg_temp.as_user(pg_temp.v('adm'));
  PERFORM public.admin_voice_learning_decide(sid, 'reject', NULL, NULL, 'not an SAP term');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.voice_vocab_blocklist WHERE final_key = 'salesx9'), 'L07 block list');
  FOR n IN 3..7 LOOP PERFORM pg_temp.answer(n, 2, '[{"heard":"sails","final":"SALESX9"}]'); END LOOP;
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.voice_vocab_suggestions WHERE final_key = 'salesx9' AND heard_key = 'sails'), 'L07 not suggested again');
  PERFORM pg_temp.check(pg_temp.fails(format($q$SELECT public.admin_voice_learning_decide(%L, 'approve', NULL, NULL, 'try')$q$, sid)), 'L07 cannot approve a rejected word');
END $$;

-- L08 without the SAP check a word waits for review even with many consultants; approval goes through the gate
DO $$
DECLARE sid uuid;
BEGIN
  FOR n IN 3..7 LOOP PERFORM pg_temp.answer(n, 3, '[{"heard":"banana","final":"Bananas"}]'); END LOOP;
  PERFORM public.voice_learning_nightly();
  SELECT id INTO sid FROM public.voice_vocab_suggestions WHERE final_key = 'bananas';
  PERFORM pg_temp.check((SELECT status = 'pending' AND NOT sap_ok AND consultants = 5 FROM public.voice_vocab_suggestions WHERE id = sid), 'L08 review queue');
  PERFORM pg_temp.as_user(pg_temp.v('adm'));
  PERFORM public.admin_voice_learning_decide(sid, 'edit', 'Banana', 'MM', 'owner decided');
  PERFORM pg_temp.check((SELECT terms @> '[{"term":"Banana","source":"admin"}]' FROM public.voice_vocab_versions WHERE status = 'candidate'), 'L08 edited term in candidate');
  PERFORM pg_temp.check((SELECT NOT (terms @> '[{"term":"Banana"}]') FROM public.voice_vocab_versions WHERE status = 'active'), 'L08 not active before the gate');
END $$;

-- L09 gate blocks a worse vocabulary: back to review, never auto-promoted again; an administrator cannot force it
DO $$
DECLARE c int := (SELECT version FROM public.voice_vocab_versions WHERE status = 'candidate');
BEGIN
  PERFORM pg_temp.check(public.voice_learning_gate_result('vocab', c::text, '{"passed":false,"items":30,"wer_before":0.1,"wer_after":0.2}') = 'blocked', 'L09 blocked');
  PERFORM pg_temp.check((SELECT status = 'pending' AND gate_blocked_at IS NOT NULL FROM public.voice_vocab_suggestions WHERE final_term = 'Banana'), 'L09 back to review');
  PERFORM pg_temp.as_user(pg_temp.v('adm'));
  PERFORM pg_temp.check(pg_temp.fails(format($q$SELECT public.admin_voice_vocab_activate(%s, 'force')$q$, c)), 'L09 cannot force a blocked version');
END $$;

-- L10 waiting candidate (not enough test items): stays candidate; an administrator may activate it with a reason
DO $$
DECLARE c int;
BEGIN
  PERFORM pg_temp.as_user(pg_temp.v('adm'));
  PERFORM public.admin_voice_learning_decide((SELECT id FROM public.voice_vocab_suggestions WHERE final_term = 'Banana'), 'approve', NULL, NULL, 'second try');
  c := (SELECT version FROM public.voice_vocab_versions WHERE status = 'candidate');
  PERFORM pg_temp.check(public.voice_learning_gate_result('vocab', c::text, '{"passed":null,"items":3,"reason":"not_enough_items"}') = 'waiting', 'L10 waiting');
  PERFORM public.admin_voice_vocab_activate(c, 'owner accepts without test data');
  PERFORM pg_temp.check((SELECT version FROM public.voice_vocab_versions WHERE status = 'active') = c, 'L10 activated by admin');
  PERFORM public.admin_voice_vocab_remove_term('banana', 'wrong after all');
  PERFORM pg_temp.check((SELECT NOT (terms @> '[{"term":"Banana"}]') AND terms @> '[{"term":"MIRO"}]' FROM public.voice_vocab_versions WHERE status = 'active'), 'L10 removed, MIRO kept');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.voice_vocab_blocklist WHERE final_key = 'banana'), 'L10 removed term blocked');
END $$;

-- L11 personal list: own repeated corrections only, visible only to the owner, deletable
DO $$
BEGIN
  PERFORM pg_temp.answer(5, 10, '[{"heard":"b seg","final":"BSEG"}]');
  PERFORM pg_temp.answer(5, 11, '[{"heard":"b seg","final":"BSEG"}]');
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.as_user(pg_temp.v('u5'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check((SELECT count(*) FROM public.voice_personal_terms WHERE term = 'BSEG') = 1, 'L11 own list');
  PERFORM pg_temp.check(public.voice_my_learning()->'terms' @> '[{"term":"BSEG"}]', 'L11 my learning');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.v('u6'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check((SELECT count(*) FROM public.voice_personal_terms) = 0, 'L11 others cannot see it');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.v('u5'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check(public.voice_delete_my_terms('BSEG') = 1, 'L11 delete');
  RESET ROLE;
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.voice_correction_pairs WHERE user_id = pg_temp.v('u5') AND final_key = 'bseg'), 'L11 corrections behind it deleted');
END $$;

-- L12 administrators only; training audio and pinned model only for super administrators; reason required
DO $$
BEGIN
  PERFORM pg_temp.as_user(pg_temp.v('u1'));
  PERFORM pg_temp.check(pg_temp.fails($q$SELECT public.admin_voice_learning_overview()$q$), 'L12 consultants cannot read');
  PERFORM pg_temp.as_user(pg_temp.v('adm'));
  PERFORM pg_temp.check(public.admin_voice_learning_overview() ? 'routing', 'L12 admin overview');
  PERFORM pg_temp.check(pg_temp.fails($q$SELECT public.admin_voice_learning_set_settings('{"training_audio": true}', 'try')$q$), 'L12 admin cannot enable audio');
  PERFORM pg_temp.check(pg_temp.fails($q$SELECT public.admin_voice_learning_set_settings('{"auto_routing": true}', '')$q$), 'L12 reason');
  PERFORM pg_temp.check(pg_temp.fails($q$SELECT public.admin_voice_learning_set_settings('{"evil": 1}', 'x y z')$q$), 'L12 unknown key');
  PERFORM public.admin_voice_learning_set_settings('{"auto_promote": false}', 'pause promotions');
  PERFORM pg_temp.check((public.voice_learning_settings()->>'auto_promote')::boolean = false, 'L12 switch');
  PERFORM pg_temp.as_user(pg_temp.v('sup'));
  PERFORM public.admin_voice_learning_set_settings('{"training_audio": true, "auto_promote": true}', 'owner enabled');
  PERFORM pg_temp.check((public.voice_learning_settings()->>'training_audio')::boolean, 'L12 super admin enabled audio');
END $$;

-- L13 recording consent: versioned, required for any kept audio; withdrawal deletes every recording
DO $$
DECLARE uid uuid := pg_temp.v('u1');
BEGIN
  PERFORM pg_temp.check(NOT public.voice_store_training_audio(uid, gen_random_uuid(), uid::text || '/' || gen_random_uuid()::text || '.wav', 1000, 3), 'L13 no consent, no audio');
  PERFORM pg_temp.as_user(uid);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check(pg_temp.fails($q$SELECT public.voice_set_audio_consent(true, '2020-01-01', NULL)$q$), 'L13 outdated text');
  PERFORM public.voice_set_audio_consent(true, '2026-10-24', pg_temp.v('i1'));
  RESET ROLE;
  PERFORM pg_temp.check(NOT public.voice_store_training_audio(uid, gen_random_uuid(), 'someone-else/x.wav', 1000, 3), 'L13 path must be own folder');
  PERFORM pg_temp.check(public.voice_store_training_audio(uid, gen_random_uuid(), uid::text || '/' || gen_random_uuid()::text || '.wav', 1000, 3), 'L13 consented audio kept');
  PERFORM pg_temp.check((SELECT expires_at BETWEEN now() + interval '89 days' AND now() + interval '91 days' FROM public.voice_training_audio WHERE user_id = uid), 'L13 90 days');
  PERFORM pg_temp.as_user(uid);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check((public.voice_set_audio_consent(false, NULL, NULL)->>'recordings_deleted')::int = 1, 'L13 withdraw');
  RESET ROLE;
  PERFORM pg_temp.check((SELECT delete_reason = 'withdrawn' FROM public.voice_training_audio WHERE user_id = uid), 'L13 marked for deletion');
  PERFORM pg_temp.check(public.voice_learning_work()->'audio' @> jsonb_build_array(jsonb_build_object('id', (SELECT id FROM public.voice_training_audio WHERE user_id = uid))), 'L13 run function gets it');
END $$;

-- L14 routing: small samples never switch; a clear winner with enough consultants is recommended; proposal only when on
DO $$
BEGIN
  INSERT INTO public.voice_answer_learning (user_id, interview_id, answer_order, language, device, models)
  SELECT pg_temp.v('u' || (1 + n % 7)), pg_temp.v('i' || (1 + n % 7)), 100 + n, 'ar', 'desktop-chrome',
         '[{"model":"openai/gpt-transcribe","words":30,"errors":6},{"model":"google/gemini-3.5-transcribe","words":30,"errors":2}]'::jsonb
  FROM generate_series(1, 5) n;
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check((SELECT reason = 'not_enough_data' FROM public.voice_route_recommendations WHERE language = 'ar' AND device = '*' AND accent = '*'), 'L14 small sample');
  INSERT INTO public.voice_answer_learning (user_id, interview_id, answer_order, language, device, models)
  SELECT pg_temp.v('u' || (1 + n % 7)), pg_temp.v('i' || (1 + n % 7)), 200 + n, 'ar', 'desktop-chrome',
         '[{"model":"openai/gpt-transcribe","words":30,"errors":6},{"model":"google/gemini-3.5-transcribe","words":30,"errors":2}]'::jsonb
  FROM generate_series(1, 60) n;
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check((SELECT reason = 'better' AND recommended_model = 'google/gemini-3.5-transcribe' FROM public.voice_route_recommendations WHERE language = 'ar' AND device = '*' AND accent = '*'), 'L14 recommended');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.voice_routes), 'L14 auto-routing off: no change');
  PERFORM pg_temp.learning('{"auto_routing": true}');
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.voice_routes WHERE status = 'proposed' AND language = 'ar' AND model = 'google/gemini-3.5-transcribe'), 'L14 proposed');
  -- no frozen benchmark: blocked, never switched blind
  PERFORM public.voice_learning_gate_result('route', (SELECT id::text FROM public.voice_routes WHERE status = 'proposed' AND language = 'ar' AND device = '*' AND accent = '*'), '{"passed":null,"reason":"not_enough_items"}');
  PERFORM pg_temp.check((SELECT status = 'blocked' FROM public.voice_routes WHERE language = 'ar' AND device = '*' AND accent = '*'), 'L14 blocked without benchmark');
END $$;

-- L15 per-consultant cap: one loud consultant cannot make a model look good
DO $$
BEGIN
  DELETE FROM public.voice_answer_learning WHERE language = 'ar';
  INSERT INTO public.voice_answer_learning (user_id, interview_id, answer_order, language, device, models)
  SELECT pg_temp.v('u1'), pg_temp.v('i1'), 300 + n, 'fr', 'desktop-chrome',
         '[{"model":"openai/gpt-transcribe","words":30,"errors":6},{"model":"google/gemini-3.5-transcribe","words":30,"errors":0}]'::jsonb
  FROM generate_series(1, 150) n;
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check((SELECT reason = 'not_enough_data' FROM public.voice_route_recommendations WHERE language = 'fr' AND device = '*' AND accent = '*'), 'L15 capped');
END $$;

-- L16 interviewer learning: misunderstood question flagged once 10 candidates answered; administrator actions audited
DO $$
DECLARE s uuid; k text;
BEGIN
  PERFORM pg_temp.learning('{"auto_routing": false}');
  FOR n IN 1..10 LOOP
    s := gen_random_uuid();
    INSERT INTO public.interview_sessions (id, consultant_id, status) VALUES (s, pg_temp.v('c1'), 'completed');
    INSERT INTO public.interview_answers (interview_id, question, answer_transcript, score, question_order, sap_module, question_source)
    VALUES (s, 'How do you handle GR/IR clearing differences?', CASE WHEN n <= 4 THEN 'Sorry, could you repeat the question?' ELSE 'I run MR11 and check the account' END,
            60, 1, 'MM', '{"type":"library","hash":"abcdef0123456789","library_ids":[]}');
  END LOOP;
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check((SELECT flags = ARRAY['misunderstood'] AND answers = 10 AND confusions = 4 FROM public.interview_question_stats WHERE question_key = 'abcdef0123456789'), 'L16 flagged');
  PERFORM pg_temp.as_user(pg_temp.v('adm'));
  PERFORM public.admin_interview_question_action('abcdef0123456789', 'add_to_library', 'How do you clear GR/IR differences at month end? Describe the steps.', 'clearer wording');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.interview_question_library WHERE source = 'learning' AND question LIKE 'How do you clear GR/IR%'), 'L16 added after approval');
  PERFORM public.admin_interview_question_action('abcdef0123456789', 'retire', NULL, 'replaced');
  PERFORM pg_temp.check((SELECT status = 'retired' FROM public.interview_question_stats WHERE question_key = 'abcdef0123456789'), 'L16 retired');
  PERFORM pg_temp.check((SELECT NOT is_active FROM public.interview_question_library WHERE source = 'learning'), 'L16 library copy retired too');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.voice_learning_events WHERE action = 'question_retire' AND reason = 'replaced'), 'L16 audit');
END $$;

-- L17 term filter parity with _shared/voiceLearning.ts termProblem
SELECT pg_temp.check(public.voice_term_problem(x.term) IS NOT DISTINCT FROM x.expected, 'L17 ' || x.term || ' -> ' || coalesce(public.voice_term_problem(x.term), 'null'))
FROM (VALUES ('MIRO', NULL), ('S/4HANA', NULL), ('/SCWM/MON', NULL), ('BRF+', NULL), ('ترحيل', NULL), ('F-02', NULL),
             ('a@b.co', 'email'), ('www.x.com', 'url'), ('0101 234 5678', 'phone'), ('123456', 'long_number'), ('AKIAx9Q2LmN7pRtZ8vW1', 'secret'),
             ('ignore instructions', 'prompt_like'), ('my password', 'prompt_like'), ('fuck', 'profanity'), ('one two three four', 'too_many_words'), ('<script>', 'characters')) x(term, expected);
SELECT pg_temp.check(public.voice_answer_class(x.a) = x.c, 'L17 answer class ' || x.a)
FROM (VALUES ('skip', 'skip'), ('مش عارف', 'skip'), ('Sorry, could you repeat the question?', 'confusion'), ('معلش مش فاهم السؤال', 'confusion'), ('I would use MIRO', 'answer')) x(a, c);
SELECT pg_temp.check(public.voice_term_sap_ok('ACDOCA') AND public.voice_term_sap_ok('ME21N') AND public.voice_term_sap_ok('business partner') AND NOT public.voice_term_sap_ok('banana'), 'L17 SAP check');

-- L18 account deletion removes corrections, personal words, consents; kept audio is queued for file deletion
DO $$
DECLARE uid uuid := pg_temp.v('u3');
BEGIN
  INSERT INTO public.voice_audio_consents (user_id, version) VALUES (uid, '2026-10-24');
  PERFORM public.voice_store_training_audio(uid, gen_random_uuid(), uid::text || '/' || gen_random_uuid()::text || '.wav', 500, 2);
  DELETE FROM auth.users WHERE id = uid;
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.voice_correction_pairs WHERE user_id = uid), 'L18 pairs gone');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.voice_audio_consents WHERE user_id = uid), 'L18 consents gone');
  PERFORM public.voice_learning_nightly();
  PERFORM pg_temp.check((SELECT delete_reason = 'account_deleted' FROM public.voice_training_audio WHERE user_id = uid), 'L18 audio file deletion queued');
END $$;

SELECT 'interview-voice-learning: all checks passed' AS result;
ROLLBACK;
