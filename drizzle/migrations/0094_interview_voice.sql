-- Interview voice: server speech-to-text settings, audio-minute caps and quality metrics (docs/interview-voice.md).
-- PREPARED, NOT APPLIED. The owner reviews and applies it. Safe to re-run.
--
-- What it adds
--   * platform_settings key interview_voice (server transcription on, audio storage OFF, caps 40 min / interview,
--     90 min / user / 24 h, 20 min dictation / user / 24 h, 30 s segments). Nothing is overwritten when the key exists.
--   * voice_transcription_segments: one row per recorded segment, written only by the voice-transcribe function through
--     the service-only voice_claim_segment / voice_finish_segment. No audio. Interview segments keep the raw transcript and
--     the list of SAP spelling fixes for the admin audit; dictation text is never kept.
--   * voice_answer_events: one row per submitted answer (engine used, fallback, edited or not), written by the signed-in
--     user through voice_log_answer, only for their own interview.
--   * admin_interview_voice_metrics / admin_interview_voice_segments: administrators-only reads for the AI Interviewer
--     Training page (Voice tab).
-- Until this file is applied voice-transcribe answers "not_ready" and every microphone keeps the browser's recogniser.
--
-- Audio storage (optional): only when an administrator turns "store interview audio" on. Create the private bucket
-- `interview-audio` (not public, no policies: service role only) at the same time; without it the copy is skipped.

-- ---------------------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
VALUES ('interview_voice', jsonb_build_object(
  'server_stt', true, 'store_audio', false, 'post_correct', true,
  'max_minutes_interview', 40, 'max_minutes_day', 90, 'dictation_minutes_day', 20, 'max_segment_seconds', 30))
ON CONFLICT (key) DO NOTHING;

-- Same defaults and limits as supabase/functions/_shared/voiceSettings.ts (normalizeVoiceSettings).
CREATE OR REPLACE FUNCTION public.voice_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT coalesce((SELECT value FROM public.platform_settings WHERE key = 'interview_voice' LIMIT 1), '{}'::jsonb) AS v),
  n AS (
    SELECT
      CASE WHEN jsonb_typeof(v->'server_stt') = 'boolean' THEN (v->>'server_stt')::boolean ELSE true END AS server_stt,
      CASE WHEN jsonb_typeof(v->'store_audio') = 'boolean' THEN (v->>'store_audio')::boolean ELSE false END AS store_audio,
      CASE WHEN jsonb_typeof(v->'post_correct') = 'boolean' THEN (v->>'post_correct')::boolean ELSE true END AS post_correct,
      CASE WHEN jsonb_typeof(v->'max_minutes_interview') = 'number' THEN least(120, greatest(5, round((v->>'max_minutes_interview')::numeric))) ELSE 40 END AS max_minutes_interview,
      CASE WHEN jsonb_typeof(v->'max_minutes_day') = 'number' THEN least(480, greatest(10, round((v->>'max_minutes_day')::numeric))) ELSE 90 END AS max_minutes_day,
      CASE WHEN jsonb_typeof(v->'dictation_minutes_day') = 'number' THEN least(120, greatest(0, round((v->>'dictation_minutes_day')::numeric))) ELSE 20 END AS dictation_minutes_day,
      CASE WHEN jsonb_typeof(v->'max_segment_seconds') = 'number' THEN least(30, greatest(10, round((v->>'max_segment_seconds')::numeric))) ELSE 30 END AS max_segment_seconds
    FROM s
  )
  SELECT to_jsonb(n) FROM n;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables (no browser access: RLS on, no policies, privileges revoked)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voice_transcription_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  interview_id uuid,
  context text NOT NULL CHECK (context IN ('interview', 'dictation')),
  model text NOT NULL,
  segment_index integer NOT NULL DEFAULT 0 CHECK (segment_index BETWEEN 0 AND 5000),
  audio_seconds numeric(6,2) NOT NULL CHECK (audio_seconds > 0 AND audio_seconds <= 31),
  bytes integer NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'failed')),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms BETWEEN 0 AND 600000),
  language text CHECK (language IS NULL OR length(language) <= 10),
  corrected boolean NOT NULL DEFAULT false,
  corrections jsonb CHECK (corrections IS NULL OR jsonb_typeof(corrections) = 'array'),
  raw_text text CHECK (raw_text IS NULL OR length(raw_text) <= 4000),
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 40),
  audio_path text CHECK (audio_path IS NULL OR length(audio_path) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (context = 'dictation' OR interview_id IS NOT NULL),
  CHECK (context = 'interview' OR raw_text IS NULL)
);
CREATE INDEX IF NOT EXISTS voice_segments_user_time_idx ON public.voice_transcription_segments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_segments_interview_idx ON public.voice_transcription_segments (interview_id, created_at) WHERE interview_id IS NOT NULL;
ALTER TABLE public.voice_transcription_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_transcription_segments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.voice_transcription_segments TO service_role;

CREATE TABLE IF NOT EXISTS public.voice_answer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  interview_id uuid,
  context text NOT NULL CHECK (context IN ('interview', 'dictation')),
  engine text NOT NULL CHECK (engine IN ('server', 'webspeech', 'typed')),
  fallback text CHECK (fallback IS NULL OR fallback IN ('server_failed', 'rate_limited', 'quota', 'disabled', 'not_ready', 'unsupported', 'permission', 'device')),
  segments integer NOT NULL DEFAULT 0 CHECK (segments BETWEEN 0 AND 500),
  edited boolean NOT NULL DEFAULT false,
  chars integer NOT NULL DEFAULT 0 CHECK (chars BETWEEN 0 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_answers_user_time_idx ON public.voice_answer_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_answers_interview_idx ON public.voice_answer_events (interview_id) WHERE interview_id IS NOT NULL;
ALTER TABLE public.voice_answer_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_answer_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.voice_answer_events TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Service-only: claim minutes for one segment, then record the result
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_claim_segment(
  _user_id uuid, _interview_id uuid, _context text, _seconds numeric, _bytes integer, _segment integer, _model text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s jsonb := public.voice_settings();
  used_day numeric;
  used_scope numeric;
  new_id uuid;
BEGIN
  IF _user_id IS NULL OR _context NOT IN ('interview', 'dictation') OR (_context = 'interview' AND _interview_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_request');
  END IF;
  IF _seconds IS NULL OR _seconds <= 0 OR _seconds > (s->>'max_segment_seconds')::numeric + 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_long');
  END IF;
  IF NOT (s->>'server_stt')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  -- one claim at a time per user, so two parallel uploads cannot both pass the cap
  PERFORM pg_advisory_xact_lock(hashtextextended('voice-claim:' || _user_id::text, 0));

  SELECT coalesce(sum(audio_seconds), 0) INTO used_day
  FROM public.voice_transcription_segments
  WHERE user_id = _user_id AND status IN ('pending', 'ok') AND created_at > now() - interval '24 hours';
  IF used_day + _seconds > (s->>'max_minutes_day')::numeric * 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'day_cap');
  END IF;

  IF _context = 'interview' THEN
    SELECT coalesce(sum(audio_seconds), 0) INTO used_scope
    FROM public.voice_transcription_segments
    WHERE interview_id = _interview_id AND status IN ('pending', 'ok');
    IF used_scope + _seconds > (s->>'max_minutes_interview')::numeric * 60 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'interview_cap');
    END IF;
  ELSE
    SELECT coalesce(sum(audio_seconds), 0) INTO used_scope
    FROM public.voice_transcription_segments
    WHERE user_id = _user_id AND context = 'dictation' AND status IN ('pending', 'ok') AND created_at > now() - interval '24 hours';
    IF used_scope + _seconds > (s->>'dictation_minutes_day')::numeric * 60 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'dictation_cap');
    END IF;
  END IF;

  INSERT INTO public.voice_transcription_segments (user_id, interview_id, context, model, segment_index, audio_seconds, bytes)
  VALUES (_user_id, CASE WHEN _context = 'interview' THEN _interview_id END, _context, left(coalesce(_model, 'unknown'), 80),
          least(greatest(coalesce(_segment, 0), 0), 5000), round(_seconds, 2), greatest(coalesce(_bytes, 0), 0))
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('ok', true, 'id', new_id, 'used_seconds_day', used_day + _seconds);
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_finish_segment(
  _id uuid, _status text, _latency_ms integer, _language text, _corrected boolean, _seconds numeric,
  _error text, _audio_path text, _raw_text text, _corrections jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.voice_transcription_segments SET
    status = CASE WHEN _status = 'ok' THEN 'ok' ELSE 'failed' END,
    latency_ms = CASE WHEN _latency_ms IS NULL THEN NULL ELSE least(greatest(_latency_ms, 0), 600000) END,
    language = left(_language, 10),
    corrected = coalesce(_corrected, false),
    audio_seconds = CASE WHEN _seconds > 0 THEN least(round(_seconds, 2), 31) ELSE audio_seconds END,
    error_code = left(_error, 40),
    audio_path = left(_audio_path, 300),
    raw_text = CASE WHEN context = 'interview' THEN left(_raw_text, 4000) END,
    corrections = CASE WHEN jsonb_typeof(_corrections) = 'array' THEN _corrections END,
    finished_at = now()
  WHERE id = _id AND status = 'pending';
  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Signed-in users: one event per submitted answer (own interview only)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_log_answer(
  _interview_id uuid, _context text, _engine text, _fallback text, _segments integer, _edited boolean, _chars integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF _context NOT IN ('interview', 'dictation') OR _engine NOT IN ('server', 'webspeech', 'typed')
     OR (_fallback IS NOT NULL AND _fallback NOT IN ('server_failed', 'rate_limited', 'quota', 'disabled', 'not_ready', 'unsupported', 'permission', 'device'))
     OR (_context = 'interview' AND _interview_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid voice event' USING ERRCODE = '22023';
  END IF;
  IF _context = 'interview' AND NOT EXISTS (
    SELECT 1 FROM public.interview_sessions s JOIN public.consultants c ON c.id = s.consultant_id
    WHERE s.id = _interview_id AND c.user_id = uid
  ) THEN
    RAISE EXCEPTION 'Not your interview' USING ERRCODE = '42501';
  END IF;
  -- bounded: a script cannot fill the table
  IF (SELECT count(*) FROM public.voice_answer_events WHERE user_id = uid AND created_at > now() - interval '1 hour') >= 200 THEN
    RETURN false;
  END IF;
  INSERT INTO public.voice_answer_events (user_id, interview_id, context, engine, fallback, segments, edited, chars)
  VALUES (uid, CASE WHEN _context = 'interview' THEN _interview_id END, _context, _engine, _fallback,
          least(greatest(coalesce(_segments, 0), 0), 500), coalesce(_edited, false), least(greatest(coalesce(_chars, 0), 0), 20000));
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Administrators: quality metrics (no audio, no answer text in the summary)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_interview_voice_metrics(_days integer DEFAULT 30)
RETURNS TABLE (
  interview_id uuid, consultant_name text, started_at timestamptz, model text,
  segments integer, failed_segments integer, audio_minutes numeric, avg_latency_ms integer, corrected_segments integer,
  answers integer, server_answers integer, webspeech_answers integer, typed_answers integer, fallback_answers integer,
  voice_answers integer, edited_answers integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  since timestamptz := now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 365));
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH seg AS (
    SELECT g.interview_id, min(g.created_at) AS first_at, string_agg(DISTINCT g.model, ', ') AS model,
           count(*)::int AS segments, count(*) FILTER (WHERE g.status = 'failed')::int AS failed_segments,
           round(coalesce(sum(g.audio_seconds) FILTER (WHERE g.status = 'ok'), 0) / 60.0, 2) AS audio_minutes,
           round(avg(g.latency_ms) FILTER (WHERE g.status = 'ok'))::int AS avg_latency_ms,
           count(*) FILTER (WHERE g.corrected)::int AS corrected_segments
    FROM public.voice_transcription_segments g WHERE g.created_at > since GROUP BY g.interview_id
  ), ans AS (
    SELECT a.interview_id, min(a.created_at) AS first_at, count(*)::int AS answers,
           count(*) FILTER (WHERE a.engine = 'server')::int AS server_answers,
           count(*) FILTER (WHERE a.engine = 'webspeech')::int AS webspeech_answers,
           count(*) FILTER (WHERE a.engine = 'typed')::int AS typed_answers,
           count(*) FILTER (WHERE a.fallback IS NOT NULL)::int AS fallback_answers,
           count(*) FILTER (WHERE a.engine <> 'typed')::int AS voice_answers,
           count(*) FILTER (WHERE a.engine <> 'typed' AND a.edited)::int AS edited_answers
    FROM public.voice_answer_events a WHERE a.created_at > since GROUP BY a.interview_id
  ), keys AS (
    SELECT seg.interview_id FROM seg UNION SELECT ans.interview_id FROM ans
  )
  SELECT k.interview_id,
         (SELECT p.display_name FROM public.interview_sessions s JOIN public.consultants c ON c.id = s.consultant_id
            JOIN public.profiles p ON p.user_id = c.user_id WHERE s.id = k.interview_id LIMIT 1),
         least(seg.first_at, ans.first_at), seg.model,
         coalesce(seg.segments, 0), coalesce(seg.failed_segments, 0), coalesce(seg.audio_minutes, 0), seg.avg_latency_ms, coalesce(seg.corrected_segments, 0),
         coalesce(ans.answers, 0), coalesce(ans.server_answers, 0), coalesce(ans.webspeech_answers, 0), coalesce(ans.typed_answers, 0),
         coalesce(ans.fallback_answers, 0), coalesce(ans.voice_answers, 0), coalesce(ans.edited_answers, 0)
  FROM keys k
  LEFT JOIN seg ON seg.interview_id IS NOT DISTINCT FROM k.interview_id
  LEFT JOIN ans ON ans.interview_id IS NOT DISTINCT FROM k.interview_id
  ORDER BY least(seg.first_at, ans.first_at) DESC NULLS LAST
  LIMIT 300;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_interview_voice_segments(_interview_id uuid)
RETURNS TABLE (
  segment_index integer, created_at timestamptz, status text, audio_seconds numeric, latency_ms integer, language text,
  corrected boolean, corrections jsonb, raw_text text, error_code text, has_audio boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT g.segment_index, g.created_at, g.status, g.audio_seconds, g.latency_ms, g.language, g.corrected, g.corrections, g.raw_text,
         g.error_code, g.audio_path IS NOT NULL
  FROM public.voice_transcription_segments g
  WHERE g.interview_id = _interview_id
  ORDER BY g.created_at, g.segment_index
  LIMIT 500;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges: default deny, then exactly who may call what
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.voice_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.voice_claim_segment(uuid, uuid, text, numeric, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.voice_finish_segment(uuid, text, integer, text, boolean, numeric, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.voice_log_answer(uuid, text, text, text, integer, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_interview_voice_metrics(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_interview_voice_segments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voice_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.voice_claim_segment(uuid, uuid, text, numeric, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.voice_finish_segment(uuid, text, integer, text, boolean, numeric, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.voice_log_answer(uuid, text, text, text, integer, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_interview_voice_metrics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_interview_voice_segments(uuid) TO authenticated;
