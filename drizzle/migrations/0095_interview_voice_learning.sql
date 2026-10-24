-- Interview voice LEARNING loop: learns from corrections, routes to the best model, improves the interviewer
-- (docs/interview-voice.md, section "Learning"). PREPARED, NOT APPLIED. Apply docs/sql/interview-voice.sql first.
-- Safe to re-run.
--
-- What it adds (no audio is ever needed; audio is kept only with the consultant's opt-in consent, default OFF)
--   * settings key interview_voice_learning: learning ON, auto-promotion ON with 3 different consultants, auto-routing
--     OFF, training audio OFF (90 days when on). Nothing is overwritten when the key exists.
--   * voice_correction_pairs: heard -> final (max 3 words a side, PII/secret filter in voice_term_problem), language,
--     device, model, source (consultant edit / our automatic fixes). Written only by voice_learn_from_answer (own open
--     interview) and the service-only voice_record_auto_corrections. Kept 180 days. Deleted with the account.
--   * voice_learning_nightly (pg_cron 03:17 UTC, single-flight, bounded): suggestions with the number of DIFFERENT
--     consultants; auto-promotion only when >= N consultants + legitimate token + SAP check (voice_term_sap_ok) and the
--     term was never rejected; everything else waits in the admin review queue. Promotions and approvals create a
--     CANDIDATE vocabulary version; it becomes active only after the regression gate (voice-learning-run) shows it is
--     not worse on the frozen benchmark + recent answers. Rejected terms go to a block list and are never suggested
--     again. Every change is in voice_learning_events (who, when, why) and any earlier active version can be restored.
--   * voice_personal_terms: each consultant's own repeated corrections (private hints for that consultant only, visible
--     to them with a delete button, deleted with the account).
--   * voice_answer_learning + voice_wer_daily + voice_route_recommendations + voice_routes: word error rate per model,
--     language, device and optional accent group; routing changes only with enough data and a safety margin (no
--     flapping), only when auto-routing is on, and only after the benchmark gate. Admin can pin a model.
--   * voice_audio_consents + voice_training_audio: opt-in 90-day recordings (private bucket voice-training, service role
--     only), deleted at expiry, on withdrawal, when the setting is turned off, or when the account is gone.
--   * interview_question_stats: per question average score, skip rate, "did not understand" rate, edit rate, time to
--     answer; flags and library candidates; administrators retire / edit / add to the library (audited).
-- Wake-ups of voice-learning-run use public.job_invoke_headers() (x-job-token), like every other background job.

-- ---------------------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
VALUES ('interview_voice_learning', jsonb_build_object(
  'learning', true, 'auto_promote', true, 'promote_min_consultants', 3, 'auto_routing', false, 'pinned_model', null,
  'routing_min_answers', 30, 'routing_min_words', 600, 'routing_min_consultants', 3, 'routing_margin', 0.02, 'routing_user_cap', 20,
  'regression_tolerance', 0.005, 'min_eval_items', 20, 'training_audio', false, 'audio_retention_days', 90,
  'personal_min_repeats', 2, 'personal_max_terms', 30, 'question_min_answers', 10, 'question_flag_rate', 0.4))
ON CONFLICT (key) DO NOTHING;

-- Models the platform may route to (same list as supabase/functions/_shared/voiceProviders.ts VOICE_MODELS).
CREATE OR REPLACE FUNCTION public.voice_allowed_model(_m text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT _m IN ('openai/gpt-transcribe', 'google/gemini-3.5-transcribe') $$;

-- Same defaults and limits as normalizeLearningSettings in supabase/functions/_shared/voiceLearning.ts.
CREATE OR REPLACE FUNCTION public.voice_learning_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v jsonb := coalesce((SELECT value FROM public.platform_settings WHERE key = 'interview_voice_learning' LIMIT 1), '{}'::jsonb);
  d jsonb := '{"learning":true,"auto_promote":true,"promote_min_consultants":3,"auto_routing":false,"routing_min_answers":30,
    "routing_min_words":600,"routing_min_consultants":3,"routing_margin":0.02,"routing_user_cap":20,"regression_tolerance":0.005,
    "min_eval_items":20,"training_audio":false,"audio_retention_days":90,"personal_min_repeats":2,"personal_max_terms":30,
    "question_min_answers":10,"question_flag_rate":0.4}'::jsonb;
  lim jsonb := '{"promote_min_consultants":[2,20],"routing_min_answers":[10,1000],"routing_min_words":[100,20000],
    "routing_min_consultants":[2,50],"routing_margin":[0.005,0.2],"routing_user_cap":[5,200],"regression_tolerance":[0,0.05],
    "min_eval_items":[10,500],"audio_retention_days":[1,90],"personal_min_repeats":[2,10],"personal_max_terms":[5,100],
    "question_min_answers":[5,200],"question_flag_rate":[0.1,0.9]}'::jsonb;
  out jsonb := d;
  k text;
  n numeric;
BEGIN
  FOREACH k IN ARRAY ARRAY['learning', 'auto_promote', 'auto_routing', 'training_audio'] LOOP
    IF jsonb_typeof(v->k) = 'boolean' THEN out := out || jsonb_build_object(k, (v->>k)::boolean); END IF;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(lim) LOOP
    IF jsonb_typeof(v->k) = 'number' THEN
      n := least((lim->k->>1)::numeric, greatest((lim->k->>0)::numeric, (v->>k)::numeric));
      out := out || jsonb_build_object(k, CASE WHEN k IN ('routing_margin', 'regression_tolerance', 'question_flag_rate') THEN round(n, 3) ELSE round(n) END);
    END IF;
  END LOOP;
  out := out || jsonb_build_object('pinned_model', CASE WHEN jsonb_typeof(v->'pinned_model') = 'string' AND public.voice_allowed_model(v->>'pinned_model') THEN v->>'pinned_model' END);
  RETURN out;
END;
$$;

-- Default model when nothing is routed: the primary model of interview_voice (docs/sql/interview-voice.sql).
CREATE OR REPLACE FUNCTION public.voice_default_model()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN public.voice_allowed_model(m) THEN m ELSE 'openai/gpt-transcribe' END
  FROM (SELECT (SELECT value->>'primary_model' FROM public.platform_settings WHERE key = 'interview_voice' LIMIT 1) AS m) s
$$;

CREATE OR REPLACE FUNCTION public.voice_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Term filter (mirror of cleanTerm / termKey / termProblem / scrubText / sapTermOk in _shared/voiceLearning.ts)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_clean_term(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT btrim(regexp_replace(btrim(regexp_replace(coalesce(_t, ''), '\s+', ' ', 'g')),
    '^[.,;:!?،؛؟"''“”‘’()\[\]{}«»]+|[.,;:!?،؛؟"''“”‘’()\[\]{}«»]+$', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.voice_term_key(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT lower(public.voice_clean_term(_t)) $$;

CREATE OR REPLACE FUNCTION public.voice_term_problem(_t text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  c text := public.voice_clean_term(_t);
  w text;
BEGIN
  IF c = '' THEN RETURN 'empty'; END IF;
  IF position('@' IN c) > 0 THEN RETURN 'email'; END IF;
  IF c ~* '(https?://|www\.)|\.(com|net|org|io|sa|eg|ae|co)\M' THEN RETURN 'url'; END IF;
  IF length(regexp_replace(c, '\D', '', 'g')) >= 7 THEN RETURN 'phone'; END IF;
  IF c ~ '\d{5,}' THEN RETURN 'long_number'; END IF;
  IF length(c) < 2 THEN RETURN 'too_short'; END IF;
  IF length(c) > 40 THEN RETURN 'too_long'; END IF;
  IF array_length(string_to_array(c, ' '), 1) > 3 THEN RETURN 'too_many_words'; END IF;
  IF c !~ '^[A-Za-z0-9\u0600-\u06FF/][A-Za-z0-9\u0600-\u06FF ._/&+-]*$' THEN RETURN 'characters'; END IF;
  FOREACH w IN ARRAY string_to_array(c, ' ') LOOP
    IF length(w) >= 16 AND w ~ '[a-z]' AND w ~ '[A-Z]' AND w ~ '[0-9]' THEN RETURN 'secret'; END IF;
    IF w ~* '^[0-9a-f]{12,}$' AND w ~ '[0-9]' THEN RETURN 'secret'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM regexp_split_to_table(lower(c), '[\s._/&+-]+') x
             WHERE x = ANY (ARRAY['fuck','fucking','shit','bitch','bastard','asshole','dick','cunt','whore','slut','كس','شرموط','شرموطة','عرص','منيك','خول','قحبة','زب'])) THEN
    RETURN 'profanity';
  END IF;
  IF c ~* '\m(ignore|disregard|forget)\M.*\m(previous|above|instructions?|rules?)\M' OR c ~* '\m(system|developer)\s*prompt\M'
     OR c ~* '\myou are\M' OR c ~* '\mact as\M' OR c ~* '\mjailbreak\M'
     OR c ~* '\m(password|passwd|api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|bearer)\M' OR c ~ 'تجاهل|كلمة\s*(السر|المرور)' THEN
    RETURN 'prompt_like';
  END IF;
  RETURN NULL;
END;
$$;

-- Masks personal data and secrets in a kept test text (both sides of an evaluation pair).
CREATE OR REPLACE FUNCTION public.voice_scrub_text(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(_t, ''), '[^\s@]+@[^\s@]+\.[^\s@]+', '[email]', 'g'),
            '(https?://|www\.)\S+', '[link]', 'gi'),
          '\m(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{16,}\M', '[secret]', 'g'),
        '\m(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\M', '[secret]', 'gi'),
      '\+?[0-9][0-9 ().-]{5,}[0-9]', '[number]', 'g'),
    '[0-9]{5,}', '[number]', 'g'),
  4000)
$$;

CREATE TABLE IF NOT EXISTS public.voice_sap_terms (term_key text PRIMARY KEY);
ALTER TABLE public.voice_sap_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_sap_terms FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.voice_sap_terms TO service_role;
-- SAP_CORE_TERMS + MODULE_TERMS of supabase/functions/_shared/voiceGlossary.ts (lower case; checked by src/lib/voice/voiceLearningSql.test.ts)
INSERT INTO public.voice_sap_terms (term_key) VALUES
('/iwfnd/maint_service'), ('/scwm/mon'), ('/scwm/prdi'), ('/ui2/flp'), ('abap'), ('abap cloud'), ('abap unit'),
('access control'), ('acdoca'), ('actual costing'), ('adobe forms'), ('adso'), ('alv'), ('amdp'), ('analysis for office'),
('ara'), ('ariba'), ('ariba network'), ('asset accounting'), ('atp'), ('badi'), ('bank communication management'),
('bank reconciliation'), ('bapi'), ('bex'), ('billing'), ('bkpf'), ('bom'), ('brf+'), ('bseg'), ('business partner'),
('business rules'), ('bw/4hana'), ('ca01'), ('cap'), ('cds view'), ('change request'), ('charge management'),
('cj20n'), ('cj40'), ('cj88'), ('ck11n'), ('ck40n'), ('cloud foundry'), ('cloud integration'), ('cloud integration gateway'),
('co-pa'), ('co01'), ('co02'), ('co11n'), ('collections management'), ('compensation'), ('compliance management'),
('compositeprovider'), ('concur'), ('condition technique'), ('contract management'), ('cost center'), ('cpi'),
('cr01'), ('credit block'), ('credit management'), ('cs01'), ('customs management'), ('data model'), ('datasphere'),
('dbacockpit'), ('demand planning'), ('device management'), ('dispute management'), ('document splitting'),
('dtp'), ('dunning'), ('eam'), ('ecc'), ('eclipse adt'), ('ehs'), ('ekko'), ('ekpo'), ('employee central'),
('employee central payroll'), ('enhancement spot'), ('equipment'), ('event mesh'), ('excel planning view'),
('expense report'), ('f-02'), ('f-28'), ('f-53'), ('f110'), ('faglb03'), ('fb50'), ('fb60'), ('fb70'),
('fbl1n'), ('fbl3n'), ('fbl5n'), ('fi-ca'), ('fiori'), ('fiori elements'), ('fiori launchpad'), ('firefighter'),
('forwarding order'), ('freight order'), ('freight unit'), ('fs00'), ('fscm'), ('functional location'),
('gr/ir'), ('grc'), ('gts'), ('guided buying'), ('hana'), ('handling unit'), ('ibp'), ('idoc'), ('ie01'),
('il01'), ('img'), ('in-house cash'), ('incident management'), ('info record'), ('infotype'), ('inspection lot'),
('integration center'), ('integration suite'), ('ip10'), ('ip41'), ('is-u'), ('iw21'), ('iw31'), ('iw32'),
('ke30'), ('kernel'), ('kks2'), ('ko88'), ('kp06'), ('ks01'), ('kyma'), ('learning'), ('likp'), ('ls01n'),
('lsmw'), ('lt01'), ('lt10'), ('maintenance plan'), ('mara'), ('material ledger'), ('mb52'), ('md01n'),
('md04'), ('mdg'), ('me21n'), ('me23n'), ('me2m'), ('me31k'), ('me51n'), ('meter reading'), ('migo'), ('migration cockpit'),
('miro'), ('mm01'), ('mm02'), ('mmbe'), ('mr8m'), ('mrp live'), ('network'), ('new gl'), ('ob52'), ('odata'),
('onboarding'), ('open ods view'), ('output determination'), ('pa20'), ('pa30'), ('pa40'), ('payment run'),
('payroll schema'), ('pc00_m99_calc'), ('pe01'), ('performance & goals'), ('personnel area'), ('pfcg'),
('planning area'), ('pricing procedure'), ('process chain'), ('process control'), ('product compliance'),
('production version'), ('profit center'), ('project builder'), ('provisioning'), ('pu12'), ('purchase requisition'),
('qa01'), ('qa32'), ('qe51n'), ('qm01'), ('qp01'), ('quality notification'), ('rap'), ('recruiting'), ('release strategy'),
('rfc'), ('rise with sap'), ('routing'), ('rsa1'), ('rz10'), ('s&op'), ('s/4hana'), ('sanctioned party list'),
('sap'), ('sap activate'), ('sap btp'), ('sap build'), ('sap gateway'), ('sap gui'), ('sapui5'), ('se11'),
('se18'), ('se19'), ('se24'), ('se37'), ('se38'), ('se80'), ('segw'), ('settlement'), ('sfp'), ('slp'),
('sm21'), ('sm37'), ('sm50'), ('sm66'), ('smartforms'), ('smicm'), ('sod'), ('solution manager'), ('source list'),
('sourcing'), ('spam'), ('spro'), ('st05'), ('st22'), ('stms'), ('storage bin'), ('su01'), ('su53'), ('successfactors'),
('sum'), ('supply planning'), ('transport management system'), ('transport request'), ('travel request'),
('universal journal'), ('usage decision'), ('user exit'), ('va01'), ('va02'), ('va05'), ('vbak'), ('vbap'),
('vf01'), ('vf04'), ('vk11'), ('vl01n'), ('vl02n'), ('wage type'), ('warehouse task'), ('wbs element'),
('work center')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.voice_term_sap_ok(_t text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c text := public.voice_clean_term(_t);
  pat text;
  found boolean := false;
BEGIN
  IF c = '' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.voice_sap_terms WHERE term_key = lower(c)) THEN RETURN true; END IF;
  IF c ~ '^[A-Z]{1,5}[0-9]{1,3}[A-Z]{0,2}$' OR c ~ '^/[A-Z0-9]{2,6}/[A-Z0-9_]{2,20}$' OR c ~ '^[A-Z]{1,4}-[0-9]{2}$'
     OR c ~* '^S/4\s?HANA\M' OR c ~ '^[A-Z][A-Z0-9_]{2,15}$' THEN
    RETURN true;
  END IF;
  -- knowledge base and question library (the administrators' own SAP material)
  pat := '\m' || regexp_replace(c, '([.^$*+?()\[\]{}|\\/-])', '\\\1', 'g') || '\M';
  IF to_regclass('public.interview_knowledge_chunks') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.interview_knowledge_chunks WHERE body ~* $1 LIMIT 1)' INTO found USING pat;
    IF found THEN RETURN true; END IF;
  END IF;
  IF to_regclass('public.interview_question_library') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.interview_question_library WHERE is_active AND (question ~* $1 OR coalesce(key_points, '''') ~* $1) LIMIT 1)' INTO found USING pat;
    IF found THEN RETURN true; END IF;
  END IF;
  RETURN false;
END;
$$;

-- "Did not understand" / skipped answers (mirror of classifyAnswer in _shared/questionQuality.ts).
CREATE OR REPLACE FUNCTION public.voice_answer_class(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN t = '' OR t ~* '^(skip|pass|next( question)?|no idea|not sure|i (do not|don''?t) know|no comment|لا ?أعرف|لا ?اعرف|مش عارف|معرفش|ما ?اعرف|ما ?أعرف|التالي|تخطي|السؤال التالي)[\s.!،]*$' THEN 'skip'
    WHEN t ~* '\m(i (do not|don''?t) (understand|get) (the|your|this|what)|(can|could) you (please )?(repeat|rephrase|clarify|explain the question)|what do you mean|(the )?question is (not clear|unclear)|not sure what you (mean|are asking))\M|pardon\??$|مش فاهم|ما ?فهمت|لم أفهم|لم افهم|ممكن تعيد|ممكن توضح|تقصد ايه|تقصد إيه|يعني ايه السؤال|أعد السؤال|اعد السؤال|كرر السؤال|السؤال مش واضح|السؤال غير واضح' THEN 'confusion'
    ELSE 'answer' END
  FROM (SELECT btrim(regexp_replace(coalesce(_t, ''), '\s+', ' ', 'g')) AS t) s
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables (browser access only where stated; everything else through the functions below)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voice_correction_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  interview_id uuid,
  source text NOT NULL CHECK (source IN ('consultant', 'rule', 'model')),
  heard text NOT NULL CHECK (length(heard) BETWEEN 1 AND 60),
  final text NOT NULL CHECK (length(final) BETWEEN 1 AND 60),
  heard_key text NOT NULL,
  final_key text NOT NULL,
  language text CHECK (language IS NULL OR length(language) <= 10),
  module text CHECK (module IS NULL OR length(module) <= 40),
  device text CHECK (device IS NULL OR length(device) <= 40),
  model text CHECK (model IS NULL OR length(model) <= 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_pairs_key_idx ON public.voice_correction_pairs (heard_key, final_key);
CREATE INDEX IF NOT EXISTS voice_pairs_user_idx ON public.voice_correction_pairs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_pairs_time_idx ON public.voice_correction_pairs (created_at);

CREATE TABLE IF NOT EXISTS public.voice_vocab_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heard_key text NOT NULL,
  final_key text NOT NULL,
  final_term text NOT NULL,
  module text,
  total_count integer NOT NULL DEFAULT 0,
  consultants integer NOT NULL DEFAULT 0,
  first_seen timestamptz,
  last_seen timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'auto_promoted', 'approved', 'rejected')),
  sap_ok boolean NOT NULL DEFAULT false,
  problem text,
  version_added integer,
  gate_blocked_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (heard_key, final_key)
);

CREATE TABLE IF NOT EXISTS public.voice_vocab_blocklist (
  final_key text PRIMARY KEY,
  term text NOT NULL,
  reason text,
  rejected_by uuid,
  rejected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voice_vocab_versions (
  version integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'retired', 'blocked')),
  kind text NOT NULL CHECK (kind IN ('initial', 'auto', 'admin', 'rollback')),
  terms jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(terms) = 'array'),
  reason text,
  parent_version integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  activated_by uuid,
  eval jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_vocab_one_active ON public.voice_vocab_versions ((true)) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS voice_vocab_one_candidate ON public.voice_vocab_versions ((true)) WHERE status = 'candidate';

CREATE TABLE IF NOT EXISTS public.voice_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  action text NOT NULL,
  target text,
  before jsonb,
  after jsonb,
  reason text
);
CREATE INDEX IF NOT EXISTS voice_learning_events_at_idx ON public.voice_learning_events (at DESC);

CREATE TABLE IF NOT EXISTS public.voice_personal_terms (
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  heard_key text NOT NULL,
  term_key text NOT NULL,
  heard text NOT NULL,
  term text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, heard_key, term_key)
);

CREATE TABLE IF NOT EXISTS public.voice_user_prefs (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  accent_group text CHECK (accent_group IS NULL OR accent_group IN ('egyptian', 'gulf', 'levantine', 'maghrebi', 'iraqi', 'indian', 'pakistani', 'british', 'american', 'european', 'african', 'other')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voice_answer_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  interview_id uuid NOT NULL,
  answer_order integer NOT NULL CHECK (answer_order BETWEEN 1 AND 500),
  engine text NOT NULL DEFAULT 'server' CHECK (engine IN ('server', 'webspeech', 'typed')),
  answer_ms integer CHECK (answer_ms IS NULL OR answer_ms BETWEEN 0 AND 3600000),
  edited boolean NOT NULL DEFAULT false,
  language text CHECK (language IS NULL OR length(language) <= 10),
  device text CHECK (device IS NULL OR length(device) <= 40),
  accent text,
  vocab_version integer,
  models jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(models) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, answer_order)
);
CREATE INDEX IF NOT EXISTS voice_answer_learning_time_idx ON public.voice_answer_learning (created_at DESC);
CREATE INDEX IF NOT EXISTS voice_answer_learning_user_idx ON public.voice_answer_learning (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.voice_eval_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('benchmark', 'live')),
  user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  external_id text,
  category text,
  language text,
  model text,
  reference text NOT NULL CHECK (length(reference) <= 4000),
  raw text NOT NULL DEFAULT '' CHECK (length(raw) <= 4000),
  raws jsonb CHECK (raws IS NULL OR jsonb_typeof(raws) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source = 'benchmark' OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS voice_eval_items_live_idx ON public.voice_eval_items (created_at DESC) WHERE source = 'live';

CREATE TABLE IF NOT EXISTS public.voice_wer_daily (
  day date NOT NULL,
  model text NOT NULL,
  language text NOT NULL,
  vocab_version integer NOT NULL DEFAULT 0,
  answers integer NOT NULL DEFAULT 0,
  words integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model, language, vocab_version)
);

CREATE TABLE IF NOT EXISTS public.voice_route_recommendations (
  language text NOT NULL,
  device text NOT NULL,
  accent text NOT NULL,
  current_model text NOT NULL,
  recommended_model text NOT NULL,
  reason text NOT NULL,
  stats jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (language, device, accent)
);

CREATE TABLE IF NOT EXISTS public.voice_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL,
  device text NOT NULL,
  accent text NOT NULL,
  model text NOT NULL CHECK (public.voice_allowed_model(model)),
  previous_model text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'blocked', 'retired')),
  reason text,
  stats jsonb,
  eval jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_routes_one_active ON public.voice_routes (language, device, accent) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS voice_routes_one_proposed ON public.voice_routes (language, device, accent) WHERE status = 'proposed';

CREATE TABLE IF NOT EXISTS public.voice_audio_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  version text NOT NULL CHECK (length(version) <= 20),
  interview_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE INDEX IF NOT EXISTS voice_audio_consents_user_idx ON public.voice_audio_consents (user_id, created_at DESC);

-- No foreign key on purpose: when an account is deleted the row stays until voice-learning-run removed the file.
CREATE TABLE IF NOT EXISTS public.voice_training_audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  consent_id uuid NOT NULL,
  segment_id uuid,
  path text NOT NULL UNIQUE CHECK (length(path) <= 300),
  bytes integer NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  seconds numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  delete_requested_at timestamptz,
  delete_reason text CHECK (delete_reason IS NULL OR delete_reason IN ('expired', 'withdrawn', 'setting_off', 'account_deleted', 'admin')),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS voice_training_audio_pending_idx ON public.voice_training_audio (delete_requested_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.interview_question_stats (
  question_key text PRIMARY KEY,
  question text NOT NULL,
  sap_module text,
  source_type text,
  library_id uuid,
  answers integer NOT NULL DEFAULT 0,
  skips integer NOT NULL DEFAULT 0,
  confusions integer NOT NULL DEFAULT 0,
  avg_score numeric(5,1),
  voice_answers integer NOT NULL DEFAULT 0,
  edited integer NOT NULL DEFAULT 0,
  avg_answer_ms integer,
  flags text[] NOT NULL DEFAULT '{}',
  library_candidate boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  admin_note text,
  updated_by uuid,
  updated_at timestamptz,
  first_seen timestamptz,
  last_seen timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voice_learning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result jsonb
);

-- Grants: service role only, except each consultant's own personal list and accent choice (read / delete own).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['voice_correction_pairs', 'voice_vocab_suggestions', 'voice_vocab_blocklist', 'voice_vocab_versions',
    'voice_learning_events', 'voice_personal_terms', 'voice_user_prefs', 'voice_answer_learning', 'voice_eval_items', 'voice_wer_daily',
    'voice_route_recommendations', 'voice_routes', 'voice_audio_consents', 'voice_training_audio', 'interview_question_stats', 'voice_learning_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT SELECT, DELETE ON public.voice_personal_terms TO authenticated;
DROP POLICY IF EXISTS "own personal voice terms" ON public.voice_personal_terms;
CREATE POLICY "own personal voice terms" ON public.voice_personal_terms FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "delete own personal voice terms" ON public.voice_personal_terms;
CREATE POLICY "delete own personal voice terms" ON public.voice_personal_terms FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.voice_user_prefs TO authenticated;
DROP POLICY IF EXISTS "own voice prefs" ON public.voice_user_prefs;
CREATE POLICY "own voice prefs" ON public.voice_user_prefs FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Start with an empty active vocabulary (version 1) so rollback always has a target.
INSERT INTO public.voice_vocab_versions (status, kind, terms, reason, activated_at)
SELECT 'active', 'initial', '[]'::jsonb, 'Start: no learned terms yet', now()
WHERE NOT EXISTS (SELECT 1 FROM public.voice_vocab_versions);

-- ---------------------------------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_learning_log(_action text, _target text, _before jsonb, _after jsonb, _reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ INSERT INTO public.voice_learning_events (actor, action, target, before, after, reason) VALUES (auth.uid(), _action, left(_target, 200), _before, _after, left(_reason, 500)) $$;

-- Wakes voice-learning-run only while it has work (gate checks, audio to delete). No permanent polling.
CREATE OR REPLACE FUNCTION public.voice_learning_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.voice_vocab_versions WHERE status = 'candidate')
       OR EXISTS (SELECT 1 FROM public.voice_routes WHERE status = 'proposed')
       OR EXISTS (SELECT 1 FROM public.voice_training_audio WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL)) THEN
    RETURN;
  END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/voice-learning-run';
END;
$$;

-- Adds terms to the one open candidate version (created from the active version when there is none).
CREATE OR REPLACE FUNCTION public.voice_vocab_add_to_candidate(_terms jsonb, _kind text, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cand public.voice_vocab_versions;
  base jsonb;
  merged jsonb;
BEGIN
  SELECT * INTO cand FROM public.voice_vocab_versions WHERE status = 'candidate' FOR UPDATE;
  IF cand.version IS NULL THEN
    SELECT terms INTO base FROM public.voice_vocab_versions WHERE status = 'active';
    INSERT INTO public.voice_vocab_versions (status, kind, terms, reason, parent_version, created_by)
    VALUES ('candidate', _kind, coalesce(base, '[]'::jsonb), left(_reason, 500), (SELECT version FROM public.voice_vocab_versions WHERE status = 'active'), auth.uid())
    RETURNING * INTO cand;
  END IF;
  -- a newer term for the same heard form replaces the older one (mergeTerms)
  SELECT coalesce(jsonb_agg(x.t ORDER BY x.ord), '[]'::jsonb) INTO merged FROM (
    SELECT DISTINCT ON (public.voice_term_key(t->>'heard')) t, ord
    FROM (SELECT t, ord FROM jsonb_array_elements(cand.terms) WITH ORDINALITY a(t, ord)
          UNION ALL SELECT t, 100000 + ord FROM jsonb_array_elements(_terms) WITH ORDINALITY b(t, ord)) u
    WHERE public.voice_term_problem(t->>'term') IS NULL
    ORDER BY public.voice_term_key(t->>'heard'), ord DESC
  ) x;
  UPDATE public.voice_vocab_versions SET terms = merged, eval = NULL,
    reason = left(coalesce(reason, '') || CASE WHEN reason IS NULL OR reason = '' THEN '' ELSE '; ' END || _reason, 500)
  WHERE version = cand.version;
  RETURN cand.version;
END;
$$;

-- Makes a version the active one (gate passed, administrator override, or rollback).
CREATE OR REPLACE FUNCTION public.voice_vocab_make_active(_version integer, _why text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE prev integer;
BEGIN
  SELECT version INTO prev FROM public.voice_vocab_versions WHERE status = 'active' FOR UPDATE;
  IF prev = _version THEN RETURN; END IF;
  UPDATE public.voice_vocab_versions SET status = 'retired' WHERE version = prev;
  UPDATE public.voice_vocab_versions SET status = 'active', activated_at = now(), activated_by = auth.uid() WHERE version = _version;
  PERFORM public.voice_learning_log(_why, 'vocabulary', jsonb_build_object('version', prev), jsonb_build_object('version', _version), _reason);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Signed-in consultant: learn from one submitted interview answer (own open AI interview only)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_learn_from_answer(
  _interview_id uuid, _answer_order integer, _answer_ms integer, _edited boolean, _language text, _device text,
  _vocab_version integer, _models jsonb, _pairs jsonb, _raw text, _final text, _engine text DEFAULT 'server')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  s jsonb := public.voice_learning_settings();
  acc text;
  models jsonb := '[]'::jsonb;
  m jsonb;
  p jsonb;
  heard text;
  fin text;
  n_pairs integer := 0;
  ins integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT (s->>'learning')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', 'off'); END IF;
  IF _interview_id IS NULL OR _answer_order IS NULL OR _answer_order NOT BETWEEN 1 AND 500 OR coalesce(_engine, '') NOT IN ('server', 'webspeech', 'typed') THEN
    RAISE EXCEPTION 'Invalid answer' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.interview_sessions se JOIN public.consultants c ON c.id = se.consultant_id
    WHERE se.id = _interview_id AND c.user_id = uid AND se.status IN ('pending', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Not your open interview' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.voice_answer_learning WHERE user_id = uid AND created_at > now() - interval '1 hour') >= 120 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'limited');
  END IF;
  SELECT accent_group INTO acc FROM public.voice_user_prefs WHERE user_id = uid;

  IF _engine = 'server' AND jsonb_typeof(_models) = 'array' THEN
    FOR m IN SELECT value FROM jsonb_array_elements(_models) LIMIT 3 LOOP
      IF public.voice_allowed_model(m->>'model') AND jsonb_typeof(m->'words') = 'number' AND jsonb_typeof(m->'errors') = 'number'
         AND (m->>'words')::int BETWEEN 1 AND 5000 AND (m->>'errors')::int BETWEEN 0 AND (m->>'words')::int * 3 THEN
        models := models || jsonb_build_array(jsonb_build_object('model', m->>'model', 'words', (m->>'words')::int, 'errors', (m->>'errors')::int));
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.voice_answer_learning (user_id, interview_id, answer_order, engine, answer_ms, edited, language, device, accent, vocab_version, models)
  VALUES (uid, _interview_id, _answer_order, _engine, CASE WHEN _answer_ms BETWEEN 0 AND 3600000 THEN _answer_ms END, _engine <> 'typed' AND coalesce(_edited, false),
          left(lower(_language), 10), left(_device, 40), acc, _vocab_version, models)
  ON CONFLICT (interview_id, answer_order) DO NOTHING;
  GET DIAGNOSTICS ins = ROW_COUNT;
  IF ins = 0 THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;

  IF _engine = 'server' AND jsonb_typeof(_pairs) = 'array' THEN
    FOR p IN SELECT value FROM jsonb_array_elements(_pairs) LIMIT 20 LOOP
      heard := public.voice_clean_term(p->>'heard');
      fin := public.voice_clean_term(p->>'final');
      CONTINUE WHEN heard = fin OR public.voice_term_problem(heard) IS NOT NULL OR public.voice_term_problem(fin) IS NOT NULL;
      INSERT INTO public.voice_correction_pairs (user_id, interview_id, source, heard, final, heard_key, final_key, language, device, model)
      VALUES (uid, _interview_id, 'consultant', heard, fin, lower(heard), lower(fin), left(lower(_language), 10), left(_device, 40), left(models->0->>'model', 80));
      n_pairs := n_pairs + 1;
    END LOOP;
  END IF;

  IF _engine = 'server' AND coalesce(btrim(_raw), '') <> '' AND coalesce(btrim(_final), '') <> '' THEN
    INSERT INTO public.voice_eval_items (source, user_id, language, model, reference, raw)
    VALUES ('live', uid, left(lower(_language), 10), left(models->0->>'model', 80), public.voice_scrub_text(_final), public.voice_scrub_text(_raw));
  END IF;
  RETURN jsonb_build_object('ok', true, 'pairs', n_pairs);
END;
$$;

-- Service only (voice-transcribe): our own automatic spelling fixes, kept for the audit and statistics, not as evidence.
CREATE OR REPLACE FUNCTION public.voice_record_auto_corrections(
  _user_id uuid, _interview_id uuid, _source text, _pairs jsonb, _language text, _model text, _device text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p jsonb; heard text; fin text; n integer := 0;
BEGIN
  IF _source NOT IN ('rule', 'model') OR jsonb_typeof(_pairs) <> 'array' OR NOT (public.voice_learning_settings()->>'learning')::boolean THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id) THEN RETURN 0; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(_pairs) LIMIT 20 LOOP
    heard := public.voice_clean_term(coalesce(p->>'heard', p->>'from'));
    fin := public.voice_clean_term(coalesce(p->>'final', p->>'to'));
    CONTINUE WHEN heard = fin OR public.voice_term_problem(heard) IS NOT NULL OR public.voice_term_problem(fin) IS NOT NULL;
    INSERT INTO public.voice_correction_pairs (user_id, interview_id, source, heard, final, heard_key, final_key, language, device, model)
    VALUES (_user_id, _interview_id, _source, heard, fin, lower(heard), lower(fin), left(lower(_language), 10), left(_device, 40), left(_model, 80));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Service only (voice-transcribe): everything learned that applies to this consultant's next piece of audio.
CREATE OR REPLACE FUNCTION public.voice_learning_context(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'settings', public.voice_learning_settings(),
    'default_model', public.voice_default_model(),
    'version', (SELECT version FROM public.voice_vocab_versions WHERE status = 'active'),
    'terms', coalesce((SELECT terms FROM public.voice_vocab_versions WHERE status = 'active'), '[]'::jsonb),
    'personal', coalesce((SELECT jsonb_agg(jsonb_build_object('heard', heard, 'term', term) ORDER BY count DESC)
                          FROM public.voice_personal_terms WHERE user_id = _user_id), '[]'::jsonb),
    'accent', (SELECT accent_group FROM public.voice_user_prefs WHERE user_id = _user_id),
    'audio_consent', (SELECT id FROM public.voice_audio_consents WHERE user_id = _user_id AND withdrawn_at IS NULL AND version = '2026-10-24' ORDER BY created_at DESC LIMIT 1),
    'routes', coalesce((SELECT jsonb_agg(jsonb_build_object('language', language, 'device', device, 'accent', accent, 'model', model))
                        FROM public.voice_routes WHERE status = 'active'), '[]'::jsonb))
$$;

-- Service only (voice-transcribe): records a consented training recording (90 days by default).
CREATE OR REPLACE FUNCTION public.voice_store_training_audio(_user_id uuid, _segment_id uuid, _path text, _bytes integer, _seconds numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s jsonb := public.voice_learning_settings(); cid uuid;
BEGIN
  IF NOT (s->>'training_audio')::boolean THEN RETURN false; END IF;
  SELECT id INTO cid FROM public.voice_audio_consents WHERE user_id = _user_id AND withdrawn_at IS NULL AND version = '2026-10-24' ORDER BY created_at DESC LIMIT 1;
  IF cid IS NULL OR _path IS NULL OR _path !~ ('^' || _user_id::text || '/[0-9a-f-]{36}\.wav$') THEN RETURN false; END IF;
  INSERT INTO public.voice_training_audio (user_id, consent_id, segment_id, path, bytes, seconds, expires_at)
  VALUES (_user_id, cid, _segment_id, _path, greatest(coalesce(_bytes, 0), 0), _seconds, now() + make_interval(days => (s->>'audio_retention_days')::int))
  ON CONFLICT (path) DO NOTHING;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Signed-in user: own learned words, accent, recording consent
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_my_learning()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); s jsonb := public.voice_learning_settings(); c public.voice_audio_consents;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.voice_audio_consents WHERE user_id = uid AND withdrawn_at IS NULL ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'learning', (s->>'learning')::boolean,
    'training_audio_offered', (s->>'training_audio')::boolean,
    'retention_days', (s->>'audio_retention_days')::int,
    'consent_version', '2026-10-24',
    'consent', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('version', c.version, 'at', c.created_at, 'current', c.version = '2026-10-24') END,
    'recordings', (SELECT count(*) FROM public.voice_training_audio WHERE user_id = uid AND deleted_at IS NULL AND delete_requested_at IS NULL),
    'accent', (SELECT accent_group FROM public.voice_user_prefs WHERE user_id = uid),
    'terms', coalesce((SELECT jsonb_agg(jsonb_build_object('heard', heard, 'term', term, 'term_key', term_key, 'count', count, 'last_seen', last_seen) ORDER BY count DESC, term)
                       FROM public.voice_personal_terms WHERE user_id = uid), '[]'::jsonb));
END;
$$;

-- Deletes one learned word (by its key) or, with NULL, all of them, together with the corrections behind them.
CREATE OR REPLACE FUNCTION public.voice_delete_my_terms(_term_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); n integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.voice_personal_terms WHERE user_id = uid AND (_term_key IS NULL OR term_key = public.voice_term_key(_term_key));
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.voice_correction_pairs WHERE user_id = uid AND source = 'consultant' AND (_term_key IS NULL OR final_key = public.voice_term_key(_term_key));
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_set_my_accent(_accent text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF _accent IS NOT NULL AND _accent NOT IN ('egyptian', 'gulf', 'levantine', 'maghrebi', 'iraqi', 'indian', 'pakistani', 'british', 'american', 'european', 'african', 'other') THEN
    RAISE EXCEPTION 'Invalid accent group' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.voice_user_prefs (user_id, accent_group, updated_at) VALUES (uid, _accent, now())
  ON CONFLICT (user_id) DO UPDATE SET accent_group = EXCLUDED.accent_group, updated_at = now();
  RETURN true;
END;
$$;

-- Opt-in recording consent (default off). Withdrawing deletes every kept recording of this person.
CREATE OR REPLACE FUNCTION public.voice_set_audio_consent(_granted boolean, _version text, _interview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); n integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF coalesce(_granted, false) THEN
    IF NOT (public.voice_learning_settings()->>'training_audio')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_offered'); END IF;
    IF _version IS DISTINCT FROM '2026-10-24' THEN RAISE EXCEPTION 'Outdated consent text' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.voice_audio_consents WHERE user_id = uid AND withdrawn_at IS NULL AND version = _version) THEN
      RETURN jsonb_build_object('ok', true, 'granted', true);
    END IF;
    INSERT INTO public.voice_audio_consents (user_id, version, interview_id) VALUES (uid, _version, _interview_id);
    RETURN jsonb_build_object('ok', true, 'granted', true);
  END IF;
  UPDATE public.voice_audio_consents SET withdrawn_at = now() WHERE user_id = uid AND withdrawn_at IS NULL;
  UPDATE public.voice_training_audio SET delete_requested_at = now(), delete_reason = 'withdrawn'
  WHERE user_id = uid AND deleted_at IS NULL AND delete_requested_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.voice_learning_wake();
  RETURN jsonb_build_object('ok', true, 'granted', false, 'recordings_deleted', n);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Nightly job (pg_cron, 03:17 UTC): bounded, single-flight, no credentials
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_learning_nightly()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s jsonb := public.voice_learning_settings();
  run_id uuid;
  n_min integer := (s->>'promote_min_consultants')::int;
  new_terms jsonb;
  cand integer;
  promoted integer := 0;
  ctx record;
  st record;
  cur text;
  dflt text := public.voice_default_model();
  best text;
  best_wer numeric;
  cur_wer numeric;
  n_eligible integer;
  rec_model text;
  rec_reason text;
  stats jsonb;
  res jsonb := '{}'::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('voice-learning-nightly', 0)) THEN RETURN jsonb_build_object('skipped', 'running'); END IF;
  INSERT INTO public.voice_learning_runs (kind) VALUES ('nightly') RETURNING id INTO run_id;

  -- 1. Retention
  DELETE FROM public.voice_correction_pairs WHERE created_at < now() - interval '180 days';
  DELETE FROM public.voice_eval_items WHERE source = 'live' AND created_at < now() - interval '180 days';
  DELETE FROM public.voice_answer_learning WHERE created_at < now() - interval '365 days';
  DELETE FROM public.voice_learning_runs WHERE started_at < now() - interval '90 days';
  UPDATE public.voice_training_audio SET delete_requested_at = now(),
    delete_reason = CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = voice_training_audio.user_id) THEN 'account_deleted'
                         WHEN NOT (s->>'training_audio')::boolean THEN 'setting_off'
                         WHEN EXISTS (SELECT 1 FROM public.voice_audio_consents c WHERE c.id = voice_training_audio.consent_id AND c.withdrawn_at IS NOT NULL) THEN 'withdrawn'
                         ELSE 'expired' END
  WHERE deleted_at IS NULL AND delete_requested_at IS NULL
    AND (expires_at < now() OR NOT (s->>'training_audio')::boolean
         OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = voice_training_audio.user_id)
         OR EXISTS (SELECT 1 FROM public.voice_audio_consents c WHERE c.id = voice_training_audio.consent_id AND c.withdrawn_at IS NOT NULL));

  IF (s->>'learning')::boolean THEN
    -- 2. Suggestions: only consultants' own edits count, by number of DIFFERENT consultants
    WITH g AS (
      SELECT p.heard_key, p.final_key, count(*)::int AS total, count(DISTINCT p.user_id)::int AS consultants,
             min(p.created_at) AS first_seen, max(p.created_at) AS last_seen,
             (array_agg(p.final ORDER BY p.created_at DESC))[1] AS latest_spelling,
             mode() WITHIN GROUP (ORDER BY p.final) AS common_spelling
      FROM public.voice_correction_pairs p
      WHERE p.source = 'consultant' AND p.created_at > now() - interval '180 days'
        AND NOT EXISTS (SELECT 1 FROM public.voice_vocab_blocklist b WHERE b.final_key = p.final_key)
      GROUP BY p.heard_key, p.final_key
      ORDER BY count(DISTINCT p.user_id) DESC, count(*) DESC
      LIMIT 5000
    )
    INSERT INTO public.voice_vocab_suggestions AS v (heard_key, final_key, final_term, total_count, consultants, first_seen, last_seen, sap_ok, problem)
    SELECT g.heard_key, g.final_key, g.common_spelling, g.total, g.consultants, g.first_seen, g.last_seen,
           public.voice_term_sap_ok(g.common_spelling), public.voice_term_problem(g.common_spelling)
    FROM g
    ON CONFLICT (heard_key, final_key) DO UPDATE SET
      total_count = EXCLUDED.total_count, consultants = EXCLUDED.consultants, last_seen = EXCLUDED.last_seen,
      final_term = CASE WHEN v.status = 'pending' THEN EXCLUDED.final_term ELSE v.final_term END,
      sap_ok = EXCLUDED.sap_ok, problem = EXCLUDED.problem, updated_at = now();

    -- 3. Auto-promotion (all guards), into the one candidate version
    IF (s->>'auto_promote')::boolean THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('heard', v.heard_key, 'term', v.final_term, 'module', v.module, 'source', 'auto') ORDER BY v.consultants DESC), '[]'::jsonb),
             count(*)::int
      INTO new_terms, promoted
      FROM public.voice_vocab_suggestions v
      WHERE v.status = 'pending' AND v.problem IS NULL AND v.sap_ok AND v.consultants >= n_min AND v.gate_blocked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.voice_vocab_blocklist b WHERE b.final_key = v.final_key);
      IF promoted > 0 THEN
        cand := public.voice_vocab_add_to_candidate(new_terms, 'auto', format('auto-promoted %s term(s) (>= %s consultants each)', promoted, n_min));
        UPDATE public.voice_vocab_suggestions v SET status = 'auto_promoted', version_added = cand, decided_at = now(), updated_at = now()
        WHERE v.status = 'pending' AND v.problem IS NULL AND v.sap_ok AND v.consultants >= n_min AND v.gate_blocked_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.voice_vocab_blocklist b WHERE b.final_key = v.final_key);
        PERFORM public.voice_learning_log('auto_promote', 'vocabulary', NULL, jsonb_build_object('candidate', cand, 'terms', new_terms), 'nightly');
      END IF;
    END IF;

    -- 4. Personal hints: own repeated corrections, top N per consultant
    DELETE FROM public.voice_personal_terms WHERE user_id IS NOT NULL;
    INSERT INTO public.voice_personal_terms (user_id, heard_key, term_key, heard, term, count, last_seen)
    SELECT user_id, heard_key, final_key, heard, final, n, last_seen FROM (
      SELECT p.user_id, p.heard_key, p.final_key, (array_agg(p.heard ORDER BY p.created_at DESC))[1] AS heard,
             (array_agg(p.final ORDER BY p.created_at DESC))[1] AS final, count(*)::int AS n, max(p.created_at) AS last_seen,
             row_number() OVER (PARTITION BY p.user_id ORDER BY count(*) DESC, p.final_key) AS rn
      FROM public.voice_correction_pairs p
      WHERE p.source = 'consultant' AND NOT EXISTS (SELECT 1 FROM public.voice_vocab_blocklist b WHERE b.final_key = p.final_key)
      GROUP BY p.user_id, p.heard_key, p.final_key
      HAVING count(*) >= (s->>'personal_min_repeats')::int
    ) x WHERE rn <= (s->>'personal_max_terms')::int;
  END IF;

  -- 5. Word error rate per day, model, language and vocabulary version (trend chart)
  INSERT INTO public.voice_wer_daily (day, model, language, vocab_version, answers, words, errors)
  SELECT a.created_at::date, m->>'model', coalesce(a.language, '*'), coalesce(a.vocab_version, 0), count(*)::int, sum((m->>'words')::int)::int, sum((m->>'errors')::int)::int
  FROM public.voice_answer_learning a CROSS JOIN LATERAL jsonb_array_elements(a.models) m
  WHERE a.created_at >= (now() - interval '2 days')::date
  GROUP BY 1, 2, 3, 4
  ON CONFLICT (day, model, language, vocab_version) DO UPDATE SET answers = EXCLUDED.answers, words = EXCLUDED.words, errors = EXCLUDED.errors;

  -- 6. Routing table (decideRoute in _shared/voiceRouting.ts): last 30 days, each consultant at most routing_user_cap
  --    answers per model and context; a change needs enough data for both models and a margin, then the benchmark gate.
  DELETE FROM public.voice_route_recommendations WHERE language IS NOT NULL;
  FOR ctx IN
    WITH base AS (
      SELECT a.user_id, coalesce(nullif(split_part(a.language, '-', 1), ''), '*') AS l, coalesce(a.device, '*') AS d, coalesce(a.accent, '*') AS ac, a.created_at, m
      FROM public.voice_answer_learning a CROSS JOIN LATERAL jsonb_array_elements(a.models) m
      WHERE a.created_at > now() - interval '30 days'
    ), expanded AS (
      SELECT user_id, l, d, ac, created_at, m FROM base
      UNION ALL SELECT user_id, l, d, '*', created_at, m FROM base WHERE ac <> '*'
      UNION ALL SELECT user_id, l, '*', '*', created_at, m FROM base WHERE d <> '*' OR ac <> '*'
      UNION ALL SELECT user_id, '*', '*', '*', created_at, m FROM base WHERE l <> '*' OR d <> '*' OR ac <> '*'
    ), capped AS (
      SELECT *, row_number() OVER (PARTITION BY l, d, ac, m->>'model', user_id ORDER BY created_at DESC) AS rn FROM expanded
    )
    SELECT l, d, ac, jsonb_agg(jsonb_build_object('model', model, 'answers', answers, 'words', words, 'errors', errors, 'consultants', consultants)) AS stats
    FROM (
      SELECT l, d, ac, m->>'model' AS model, count(*)::int AS answers, sum((m->>'words')::int)::int AS words,
             sum(least((m->>'errors')::int, (m->>'words')::int * 3))::int AS errors, count(DISTINCT user_id)::int AS consultants
      FROM capped WHERE rn <= (s->>'routing_user_cap')::int
      GROUP BY l, d, ac, m->>'model'
    ) per_model
    GROUP BY l, d, ac
    ORDER BY l, d, ac
    LIMIT 300
  LOOP
    SELECT model INTO cur FROM public.voice_routes WHERE status = 'active' AND language = ctx.l AND device = ctx.d AND accent = ctx.ac;
    cur := CASE WHEN cur IS NOT NULL AND public.voice_allowed_model(cur) THEN cur ELSE dflt END;
    SELECT count(*) INTO n_eligible FROM jsonb_array_elements(ctx.stats) e
    WHERE public.voice_allowed_model(e->>'model') AND (e->>'answers')::int >= (s->>'routing_min_answers')::int
      AND (e->>'words')::int >= (s->>'routing_min_words')::int AND (e->>'consultants')::int >= (s->>'routing_min_consultants')::int;
    SELECT (e->>'errors')::numeric / nullif((e->>'words')::numeric, 0) INTO cur_wer FROM jsonb_array_elements(ctx.stats) e
    WHERE e->>'model' = cur AND (e->>'answers')::int >= (s->>'routing_min_answers')::int
      AND (e->>'words')::int >= (s->>'routing_min_words')::int AND (e->>'consultants')::int >= (s->>'routing_min_consultants')::int;
    SELECT e->>'model', (e->>'errors')::numeric / nullif((e->>'words')::numeric, 0) INTO best, best_wer FROM jsonb_array_elements(ctx.stats) e
    WHERE public.voice_allowed_model(e->>'model') AND (e->>'answers')::int >= (s->>'routing_min_answers')::int
      AND (e->>'words')::int >= (s->>'routing_min_words')::int AND (e->>'consultants')::int >= (s->>'routing_min_consultants')::int
    ORDER BY (e->>'errors')::numeric / nullif((e->>'words')::numeric, 0), (e->>'model') = cur DESC, e->>'model' LIMIT 1;
    IF n_eligible < 2 THEN rec_model := cur; rec_reason := 'not_enough_data';
    ELSIF cur_wer IS NULL THEN rec_model := cur; rec_reason := 'current_not_measured';
    ELSIF best <> cur AND best_wer + (s->>'routing_margin')::numeric < cur_wer THEN rec_model := best; rec_reason := 'better';
    ELSE rec_model := cur; rec_reason := 'keep_current';
    END IF;
    INSERT INTO public.voice_route_recommendations (language, device, accent, current_model, recommended_model, reason, stats)
    VALUES (ctx.l, ctx.d, ctx.ac, cur, rec_model, rec_reason, ctx.stats);
    IF (s->>'auto_routing')::boolean AND rec_reason = 'better' AND s->>'pinned_model' IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.voice_routes r WHERE r.language = ctx.l AND r.device = ctx.d AND r.accent = ctx.ac
                       AND r.model = rec_model AND (r.status = 'proposed' OR (r.status = 'blocked' AND r.decided_at > now() - interval '7 days'))) THEN
      INSERT INTO public.voice_routes (language, device, accent, model, previous_model, status, reason, stats)
      VALUES (ctx.l, ctx.d, ctx.ac, rec_model, cur, 'proposed', 'better measured word error rate', ctx.stats)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- 7. Interviewer learning: question statistics from completed interviews of the last 365 days
  WITH ans AS (
    SELECT coalesce(nullif(a.question_source->>'hash', ''), left(md5(lower(btrim(regexp_replace(a.question, '\s+', ' ', 'g')))), 16)) AS qkey,
           a.question, a.sap_module, a.question_source->>'type' AS source_type,
           CASE WHEN jsonb_typeof(a.question_source->'library_ids') = 'array' THEN (a.question_source->'library_ids'->>0) END AS library_id,
           a.score, public.voice_answer_class(a.answer_transcript) AS cls, a.created_at, l.edited, l.answer_ms, (l.id IS NOT NULL AND l.engine <> 'typed') AS voiced
    FROM public.interview_answers a
    JOIN public.interview_sessions se ON se.id = a.interview_id AND se.status IN ('completed', 'reviewed')
    LEFT JOIN public.voice_answer_learning l ON l.interview_id = a.interview_id AND l.answer_order = a.question_order
    WHERE a.created_at > now() - interval '365 days' AND coalesce(a.question_source->>'type', '') <> 'follow_up'
  ), agg AS (
    SELECT qkey, (array_agg(question ORDER BY created_at DESC))[1] AS question, (array_agg(sap_module ORDER BY created_at DESC))[1] AS sap_module,
           (array_agg(source_type ORDER BY created_at DESC))[1] AS source_type,
           (array_agg(library_id ORDER BY created_at DESC) FILTER (WHERE library_id ~ '^[0-9a-f-]{36}$'))[1]::uuid AS library_id,
           count(*)::int AS answers, count(*) FILTER (WHERE cls = 'skip')::int AS skips, count(*) FILTER (WHERE cls = 'confusion')::int AS confusions,
           round(avg(score), 1) AS avg_score, count(*) FILTER (WHERE voiced)::int AS voice_answers, count(*) FILTER (WHERE voiced AND edited)::int AS edited,
           round(avg(answer_ms))::int AS avg_answer_ms, min(created_at) AS first_seen, max(created_at) AS last_seen
    FROM ans GROUP BY qkey ORDER BY count(*) DESC LIMIT 5000
  )
  INSERT INTO public.interview_question_stats AS q (question_key, question, sap_module, source_type, library_id, answers, skips, confusions, avg_score,
    voice_answers, edited, avg_answer_ms, flags, library_candidate, first_seen, last_seen, computed_at)
  SELECT agg.qkey, left(agg.question, 2000), agg.sap_module, agg.source_type, agg.library_id, agg.answers, agg.skips, agg.confusions, agg.avg_score,
         agg.voice_answers, agg.edited, agg.avg_answer_ms,
         CASE WHEN agg.answers < (s->>'question_min_answers')::int THEN '{}'::text[] ELSE array_remove(ARRAY[
           CASE WHEN agg.confusions::numeric / agg.answers >= (s->>'question_flag_rate')::numeric THEN 'misunderstood' END,
           CASE WHEN agg.skips::numeric / agg.answers >= (s->>'question_flag_rate')::numeric THEN 'skipped' END,
           CASE WHEN agg.avg_score < 30 THEN 'low_score' END,
           CASE WHEN agg.voice_answers >= (s->>'question_min_answers')::int AND agg.edited::numeric / agg.voice_answers >= 0.6 THEN 'hard_to_transcribe' END], NULL) END,
         agg.library_id IS NULL AND agg.answers >= (s->>'question_min_answers')::int AND agg.avg_score BETWEEN 40 AND 85
           AND agg.confusions::numeric / agg.answers < 0.15 AND agg.skips::numeric / agg.answers < 0.15,
         agg.first_seen, agg.last_seen, now()
  FROM agg
  ON CONFLICT (question_key) DO UPDATE SET
    question = CASE WHEN q.updated_by IS NULL THEN EXCLUDED.question ELSE q.question END,
    sap_module = EXCLUDED.sap_module, source_type = EXCLUDED.source_type, library_id = coalesce(q.library_id, EXCLUDED.library_id),
    answers = EXCLUDED.answers, skips = EXCLUDED.skips, confusions = EXCLUDED.confusions, avg_score = EXCLUDED.avg_score,
    voice_answers = EXCLUDED.voice_answers, edited = EXCLUDED.edited, avg_answer_ms = EXCLUDED.avg_answer_ms, flags = EXCLUDED.flags,
    library_candidate = EXCLUDED.library_candidate AND q.library_id IS NULL, last_seen = EXCLUDED.last_seen, computed_at = now();

  res := jsonb_build_object('promoted', promoted, 'routes', (SELECT count(*) FROM public.voice_route_recommendations),
    'audio_to_delete', (SELECT count(*) FROM public.voice_training_audio WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL));
  UPDATE public.voice_learning_runs SET finished_at = now(), result = res WHERE id = run_id;
  PERFORM public.voice_learning_wake();
  RETURN res;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Service only (voice-learning-run): gate work and results, audio deletions
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voice_learning_work()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'settings', public.voice_learning_settings(),
    'active', (SELECT jsonb_build_object('version', version, 'terms', terms) FROM public.voice_vocab_versions WHERE status = 'active'),
    'candidate', (SELECT jsonb_build_object('version', version, 'terms', terms) FROM public.voice_vocab_versions WHERE status = 'candidate'),
    'routes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'language', language, 'device', device, 'accent', accent, 'model', model, 'previous_model', previous_model))
                        FROM public.voice_routes WHERE status = 'proposed'), '[]'::jsonb),
    'audio', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'path', path)) FROM (
                        SELECT id, path FROM public.voice_training_audio WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL ORDER BY delete_requested_at LIMIT 200) x), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('reference', reference, 'raw', raw, 'raws', raws, 'source', source, 'user_id', user_id)) FROM (
                        (SELECT reference, raw, raws, source, user_id FROM public.voice_eval_items WHERE source = 'benchmark' LIMIT 500)
                        UNION ALL
                        (SELECT reference, raw, raws, source, user_id FROM public.voice_eval_items WHERE source = 'live' ORDER BY created_at DESC LIMIT 500)) i), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.voice_learning_gate_result(_kind text, _id text, _eval jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE passed text := _eval->>'passed'; v integer; r public.voice_routes;
BEGIN
  IF _kind = 'vocab' THEN
    v := _id::integer;
    IF NOT EXISTS (SELECT 1 FROM public.voice_vocab_versions WHERE version = v AND status = 'candidate') THEN RETURN 'stale'; END IF;
    UPDATE public.voice_vocab_versions SET eval = _eval || jsonb_build_object('measured_at', now()) WHERE version = v;
    IF passed = 'true' THEN
      PERFORM public.voice_vocab_make_active(v, 'gate_activate', format('gate passed: %s -> %s word error rate on %s items', _eval->>'wer_before', _eval->>'wer_after', _eval->>'items'));
      RETURN 'activated';
    ELSIF passed = 'false' THEN
      UPDATE public.voice_vocab_versions SET status = 'blocked' WHERE version = v;
      -- back to the review queue; never auto-promoted again (an administrator decides)
      UPDATE public.voice_vocab_suggestions SET status = 'pending', version_added = NULL, gate_blocked_at = now() WHERE version_added = v AND status IN ('auto_promoted', 'approved');
      PERFORM public.voice_learning_log('gate_block', 'vocabulary', NULL, jsonb_build_object('version', v, 'eval', _eval), 'accuracy would drop');
      RETURN 'blocked';
    END IF;
    RETURN 'waiting';
  ELSIF _kind = 'route' THEN
    SELECT * INTO r FROM public.voice_routes WHERE id = _id::uuid AND status = 'proposed' FOR UPDATE;
    IF r.id IS NULL THEN RETURN 'stale'; END IF;
    IF passed = 'true' THEN
      UPDATE public.voice_routes SET status = 'retired', decided_at = now() WHERE status = 'active' AND language = r.language AND device = r.device AND accent = r.accent;
      UPDATE public.voice_routes SET status = 'active', eval = _eval, decided_at = now() WHERE id = r.id;
      PERFORM public.voice_learning_log('route_activate', r.language || '/' || r.device || '/' || r.accent, jsonb_build_object('model', r.previous_model), jsonb_build_object('model', r.model, 'eval', _eval), 'gate passed');
      RETURN 'activated';
    END IF;
    -- worse, or no frozen benchmark yet: a model change is never made blind
    UPDATE public.voice_routes SET status = 'blocked', eval = _eval, decided_at = now() WHERE id = r.id;
    PERFORM public.voice_learning_log('route_block', r.language || '/' || r.device || '/' || r.accent, NULL, jsonb_build_object('model', r.model, 'eval', _eval),
      CASE WHEN passed = 'false' THEN 'accuracy would drop' ELSE 'no benchmark to compare' END);
    RETURN 'blocked';
  END IF;
  RETURN 'unknown';
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_learning_audio_deleted(_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.voice_training_audio SET deleted_at = now() WHERE id = ANY (_ids) AND delete_requested_at IS NOT NULL AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Administrators (AI Interviewer Training › Learning)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_voice_learning_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.voice_learning_settings(),
    'default_model', public.voice_default_model(),
    'week', jsonb_build_object(
      'new_suggestions', (SELECT count(*) FROM public.voice_vocab_suggestions WHERE created_at > now() - interval '7 days'),
      'auto_promoted', (SELECT count(*) FROM public.voice_vocab_suggestions WHERE status = 'auto_promoted' AND decided_at > now() - interval '7 days'),
      'pairs', (SELECT count(*) FROM public.voice_correction_pairs WHERE source = 'consultant' AND created_at > now() - interval '7 days')),
    'queue', (SELECT count(*) FROM public.voice_vocab_suggestions WHERE status = 'pending' AND problem IS NULL),
    'rejected', (SELECT count(*) FROM public.voice_vocab_blocklist),
    'versions', coalesce((SELECT jsonb_agg(jsonb_build_object('version', version, 'status', status, 'kind', kind, 'terms', jsonb_array_length(terms),
                   'reason', reason, 'created_at', created_at, 'activated_at', activated_at, 'eval', eval) ORDER BY version DESC)
                 FROM (SELECT * FROM public.voice_vocab_versions ORDER BY version DESC LIMIT 25) v), '[]'::jsonb),
    'active_terms', coalesce((SELECT terms FROM public.voice_vocab_versions WHERE status = 'active'), '[]'::jsonb),
    'trend', coalesce((SELECT jsonb_agg(jsonb_build_object('week', w, 'model', model, 'vocab_version', vv, 'answers', a, 'words', wd, 'errors', e) ORDER BY w, model)
                 FROM (SELECT date_trunc('week', day)::date AS w, model, max(vocab_version) AS vv, sum(answers)::int AS a, sum(words)::int AS wd, sum(errors)::int AS e
                       FROM public.voice_wer_daily WHERE day > now() - interval '120 days' GROUP BY 1, 2) t), '[]'::jsonb),
    'routing', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.language, r.device, r.accent) FROM public.voice_route_recommendations r), '[]'::jsonb),
    'routes', coalesce((SELECT jsonb_agg(jsonb_build_object('language', language, 'device', device, 'accent', accent, 'model', model, 'previous_model', previous_model,
                   'status', status, 'eval', eval, 'decided_at', decided_at) ORDER BY created_at DESC)
                 FROM (SELECT * FROM public.voice_routes ORDER BY created_at DESC LIMIT 30) r), '[]'::jsonb),
    'audio', jsonb_build_object(
      'recordings', (SELECT count(*) FROM public.voice_training_audio WHERE deleted_at IS NULL AND delete_requested_at IS NULL),
      'bytes', (SELECT coalesce(sum(bytes), 0) FROM public.voice_training_audio WHERE deleted_at IS NULL),
      'consents', (SELECT count(DISTINCT user_id) FROM public.voice_audio_consents WHERE withdrawn_at IS NULL),
      'pending_delete', (SELECT count(*) FROM public.voice_training_audio WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL)),
    'benchmark_items', (SELECT count(*) FROM public.voice_eval_items WHERE source = 'benchmark'),
    'live_items', (SELECT count(*) FROM public.voice_eval_items WHERE source = 'live'),
    'last_run', (SELECT jsonb_build_object('started_at', started_at, 'finished_at', finished_at, 'result', result) FROM public.voice_learning_runs WHERE kind = 'nightly' ORDER BY started_at DESC LIMIT 1),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'target', e.target, 'reason', e.reason,
                   'actor', (SELECT p.display_name FROM public.profiles p WHERE p.user_id = e.actor)) ORDER BY e.at DESC)
                 FROM (SELECT * FROM public.voice_learning_events ORDER BY at DESC LIMIT 40) e), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_voice_learning_suggestions(_status text DEFAULT 'pending', _limit integer DEFAULT 200)
RETURNS TABLE (id uuid, heard_key text, final_term text, module text, total_count integer, consultants integer, sap_ok boolean,
               status text, first_seen timestamptz, last_seen timestamptz, version_added integer, decided_at timestamptz, decision_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT v.id, v.heard_key, v.final_term, v.module, v.total_count, v.consultants, v.sap_ok, v.status, v.first_seen, v.last_seen, v.version_added, v.decided_at, v.decision_reason
  FROM public.voice_vocab_suggestions v
  WHERE v.problem IS NULL AND (_status IS NULL OR v.status = _status)
  ORDER BY v.consultants DESC, v.total_count DESC, v.last_seen DESC
  LIMIT least(greatest(coalesce(_limit, 200), 1), 500);
END;
$$;

-- approve / edit (the edited spelling is learned instead) / reject (block list: never suggested again)
CREATE OR REPLACE FUNCTION public.admin_voice_learning_decide(_id uuid, _action text, _term text, _module text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v public.voice_vocab_suggestions; new_term text; cand integer;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('approve', 'edit', 'reject') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.voice_vocab_suggestions WHERE id = _id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Suggestion not found' USING ERRCODE = 'P0002'; END IF;
  IF _action = 'reject' THEN
    UPDATE public.voice_vocab_suggestions SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = left(_reason, 500), updated_at = now() WHERE id = _id;
    INSERT INTO public.voice_vocab_blocklist (final_key, term, reason, rejected_by)
    SELECT DISTINCT k, v.final_term, left(_reason, 500), auth.uid() FROM unnest(ARRAY[v.final_key, lower(v.final_term)]) k
    ON CONFLICT (final_key) DO NOTHING;
    DELETE FROM public.voice_personal_terms WHERE term_key IN (v.final_key, lower(v.final_term));
    PERFORM public.voice_learning_log('reject', v.heard_key || ' -> ' || v.final_term, to_jsonb(v), NULL, _reason);
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;
  new_term := public.voice_clean_term(CASE WHEN _action = 'edit' THEN _term ELSE v.final_term END);
  IF public.voice_term_problem(new_term) IS NOT NULL THEN RAISE EXCEPTION 'This word cannot be learned (%)', public.voice_term_problem(new_term) USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.voice_vocab_blocklist WHERE final_key = lower(new_term)) THEN RAISE EXCEPTION 'This word was rejected before' USING ERRCODE = '22023'; END IF;
  cand := public.voice_vocab_add_to_candidate(jsonb_build_array(jsonb_build_object('heard', v.heard_key, 'term', new_term, 'module', coalesce(nullif(btrim(_module), ''), v.module), 'source', 'admin')),
                                              'admin', format('%s by administrator: %s -> %s', _action, v.heard_key, new_term));
  UPDATE public.voice_vocab_suggestions SET status = 'approved', final_term = new_term, module = coalesce(nullif(btrim(_module), ''), module), version_added = cand,
    decided_by = auth.uid(), decided_at = now(), decision_reason = left(_reason, 500), updated_at = now() WHERE id = _id;
  PERFORM public.voice_learning_log(_action, v.heard_key || ' -> ' || new_term, to_jsonb(v), jsonb_build_object('candidate', cand), _reason);
  PERFORM public.voice_learning_wake();
  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'candidate', cand);
END;
$$;

-- One-click rollback to any version that was active before.
CREATE OR REPLACE FUNCTION public.admin_voice_vocab_rollback(_version integer, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.voice_vocab_versions;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public.voice_vocab_versions WHERE version = _version;
  IF t.version IS NULL THEN RAISE EXCEPTION 'Version not found' USING ERRCODE = 'P0002'; END IF;
  IF t.status = 'active' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF t.activated_at IS NULL THEN RAISE EXCEPTION 'Only a version that was active before can be restored' USING ERRCODE = '22023'; END IF;
  PERFORM public.voice_vocab_make_active(_version, 'rollback', _reason);
  RETURN jsonb_build_object('ok', true, 'active', _version);
END;
$$;

-- A waiting candidate (not enough test items yet) may be activated by an administrator; a blocked one (proven worse) never.
CREATE OR REPLACE FUNCTION public.admin_voice_vocab_activate(_version integer, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t public.voice_vocab_versions;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public.voice_vocab_versions WHERE version = _version;
  IF t.version IS NULL OR t.status <> 'candidate' THEN RAISE EXCEPTION 'Only a waiting candidate can be activated' USING ERRCODE = '22023'; END IF;
  IF t.eval->>'passed' = 'false' THEN RAISE EXCEPTION 'The test showed lower accuracy' USING ERRCODE = '22023'; END IF;
  PERFORM public.voice_vocab_make_active(_version, 'admin_activate', _reason);
  RETURN jsonb_build_object('ok', true, 'active', _version);
END;
$$;

-- Removes one learned term at once (new active version without it) and blocks it, e.g. after a wrong promotion.
CREATE OR REPLACE FUNCTION public.admin_voice_vocab_remove_term(_heard text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a public.voice_vocab_versions; kept jsonb; removed jsonb; nv integer;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.voice_vocab_versions WHERE status = 'active' FOR UPDATE;
  SELECT coalesce(jsonb_agg(t) FILTER (WHERE public.voice_term_key(t->>'heard') <> public.voice_term_key(_heard)), '[]'::jsonb),
         coalesce(jsonb_agg(t) FILTER (WHERE public.voice_term_key(t->>'heard') = public.voice_term_key(_heard)), '[]'::jsonb)
  INTO kept, removed FROM jsonb_array_elements(a.terms) t;
  IF jsonb_array_length(removed) = 0 THEN RAISE EXCEPTION 'Term not in the active vocabulary' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.voice_vocab_versions (status, kind, terms, reason, parent_version, created_by) VALUES ('retired', 'admin', kept, left('removed: ' || _heard || ' (' || _reason || ')', 500), a.version, auth.uid())
  RETURNING version INTO nv;
  PERFORM public.voice_vocab_make_active(nv, 'remove_term', _reason);
  INSERT INTO public.voice_vocab_blocklist (final_key, term, reason, rejected_by)
  SELECT public.voice_term_key(t->>'term'), t->>'term', left(_reason, 500), auth.uid() FROM jsonb_array_elements(removed) t ON CONFLICT DO NOTHING;
  UPDATE public.voice_vocab_suggestions SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = left(_reason, 500)
  WHERE heard_key = public.voice_term_key(_heard);
  -- the open candidate was built on the old version: rebuild it without the term
  UPDATE public.voice_vocab_versions SET terms = coalesce((SELECT jsonb_agg(t) FROM jsonb_array_elements(terms) t WHERE public.voice_term_key(t->>'heard') <> public.voice_term_key(_heard)), '[]'::jsonb), eval = NULL
  WHERE status = 'candidate';
  RETURN jsonb_build_object('ok', true, 'active', nv);
END;
$$;

-- Kill switches and numbers. Training audio and the pinned model: super administrators only. Audited with before/after.
CREATE OR REPLACE FUNCTION public.admin_voice_learning_set_settings(_patch jsonb, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE before jsonb := public.voice_learning_settings(); merged jsonb; k text;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE = '22023'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF NOT (before ? k) THEN RAISE EXCEPTION 'Unknown setting %', k USING ERRCODE = '22023'; END IF;
    IF k IN ('training_audio', 'pinned_model') AND (_patch->k) IS DISTINCT FROM (before->k) AND NOT public.has_role(auth.uid(), 'super_admin') THEN
      RAISE EXCEPTION 'Only a super administrator can change %', k USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF _patch ? 'pinned_model' AND jsonb_typeof(_patch->'pinned_model') = 'string' AND NOT public.voice_allowed_model(_patch->>'pinned_model') THEN
    RAISE EXCEPTION 'Unknown model' USING ERRCODE = '22023';
  END IF;
  merged := coalesce((SELECT value FROM public.platform_settings WHERE key = 'interview_voice_learning'), '{}'::jsonb) || _patch;
  INSERT INTO public.platform_settings (key, value) VALUES ('interview_voice_learning', merged)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  PERFORM public.voice_learning_log('settings', 'interview_voice_learning', before, public.voice_learning_settings(), _reason);
  IF before->>'training_audio' = 'true' AND _patch->>'training_audio' = 'false' THEN
    UPDATE public.voice_training_audio SET delete_requested_at = now(), delete_reason = 'setting_off' WHERE deleted_at IS NULL AND delete_requested_at IS NULL;
    PERFORM public.voice_learning_wake();
  END IF;
  RETURN public.voice_learning_settings();
END;
$$;

-- Rollback of a route: the context goes back to the less specific route or the default model.
CREATE OR REPLACE FUNCTION public.admin_voice_route_retire(_language text, _device text, _accent text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.voice_routes;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  UPDATE public.voice_routes SET status = 'retired', decided_at = now(), decided_by = auth.uid()
  WHERE status = 'active' AND language = _language AND device = _device AND accent = _accent RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'No active route for this context' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.voice_learning_log('route_rollback', _language || '/' || _device || '/' || _accent, jsonb_build_object('model', r.model), NULL, _reason);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Frozen benchmark: the owner's recorded sentences, imported from scripts/voice-benchmark results (text only).
-- _items: [{ "id": "01", "category": "...", "lang": "en", "reference": "...", "raws": { "<model id>": "<raw text>" } }]
CREATE OR REPLACE FUNCTION public.admin_voice_benchmark_import(_items jsonb, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer; i jsonb; raws jsonb; k text;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 OR jsonb_array_length(_items) > 500 THEN RAISE EXCEPTION 'Between 1 and 500 items' USING ERRCODE = '22023'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.voice_eval_items WHERE source = 'benchmark';
  FOR i IN SELECT value FROM jsonb_array_elements(_items) LOOP
    CONTINUE WHEN coalesce(btrim(i->>'reference'), '') = '' OR jsonb_typeof(i->'raws') <> 'object';
    raws := '{}'::jsonb;
    FOR k IN SELECT jsonb_object_keys(i->'raws') LOOP
      IF public.voice_allowed_model(k) AND jsonb_typeof(i->'raws'->k) = 'string' THEN raws := raws || jsonb_build_object(k, left(i->'raws'->>k, 4000)); END IF;
    END LOOP;
    INSERT INTO public.voice_eval_items (source, external_id, category, language, reference, raws)
    VALUES ('benchmark', left(i->>'id', 20), left(i->>'category', 40), left(i->>'lang', 10), left(i->>'reference', 4000), raws);
  END LOOP;
  SELECT count(*) INTO n FROM public.voice_eval_items WHERE source = 'benchmark';
  PERFORM public.voice_learning_log('benchmark_import', 'frozen set', NULL, jsonb_build_object('items', n), _reason);
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_interview_question_stats(_filter text DEFAULT 'flagged', _limit integer DEFAULT 200)
RETURNS SETOF public.interview_question_stats LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.interview_question_stats q
  WHERE CASE coalesce(_filter, 'flagged') WHEN 'flagged' THEN cardinality(q.flags) > 0 AND q.status = 'active'
             WHEN 'candidates' THEN q.library_candidate AND q.status = 'active' WHEN 'retired' THEN q.status = 'retired' ELSE true END
  ORDER BY cardinality(q.flags) DESC, q.answers DESC
  LIMIT least(greatest(coalesce(_limit, 200), 1), 500);
END;
$$;

-- retire / restore / edit (library questions) / add_to_library (good generated questions; administrator approval)
CREATE OR REPLACE FUNCTION public.admin_interview_question_action(_key text, _action text, _text text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE q public.interview_question_stats; lib uuid;
BEGIN
  IF NOT public.voice_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('retire', 'restore', 'edit', 'add_to_library') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023'; END IF;
  IF coalesce(length(btrim(_reason)), 0) < 3 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO q FROM public.interview_question_stats WHERE question_key = _key FOR UPDATE;
  IF q.question_key IS NULL THEN RAISE EXCEPTION 'Question not found' USING ERRCODE = 'P0002'; END IF;
  IF _action IN ('edit', 'add_to_library') AND (coalesce(length(btrim(_text)), 0) < 10 OR length(_text) > 2000) THEN
    RAISE EXCEPTION 'Question text must be 10 to 2000 characters' USING ERRCODE = '22023';
  END IF;
  IF _action = 'retire' THEN
    UPDATE public.interview_question_stats SET status = 'retired', admin_note = left(_reason, 500), updated_by = auth.uid(), updated_at = now() WHERE question_key = _key;
    IF q.library_id IS NOT NULL THEN UPDATE public.interview_question_library SET is_active = false, updated_at = now() WHERE id = q.library_id; END IF;
  ELSIF _action = 'restore' THEN
    UPDATE public.interview_question_stats SET status = 'active', admin_note = left(_reason, 500), updated_by = auth.uid(), updated_at = now() WHERE question_key = _key;
    IF q.library_id IS NOT NULL THEN UPDATE public.interview_question_library SET is_active = true, updated_at = now() WHERE id = q.library_id; END IF;
  ELSIF _action = 'edit' THEN
    IF q.library_id IS NULL THEN RAISE EXCEPTION 'Only library questions can be edited; add this one to the library with the new wording' USING ERRCODE = '22023'; END IF;
    UPDATE public.interview_question_library SET question = btrim(_text), updated_at = now() WHERE id = q.library_id;
    UPDATE public.interview_question_stats SET question = btrim(_text), admin_note = left(_reason, 500), updated_by = auth.uid(), updated_at = now() WHERE question_key = _key;
  ELSE
    IF q.library_id IS NOT NULL THEN RAISE EXCEPTION 'Already in the library' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.interview_question_library (sap_module, difficulty, category, question, source, is_active, created_by)
    VALUES (coalesce(nullif(q.sap_module, ''), 'general'), 'medium', 'technical', btrim(_text), 'learning', true, auth.uid())
    RETURNING id INTO lib;
    UPDATE public.interview_question_stats SET library_id = lib, library_candidate = false, admin_note = left(_reason, 500), updated_by = auth.uid(), updated_at = now() WHERE question_key = _key;
  END IF;
  PERFORM public.voice_learning_log('question_' || _action, _key, jsonb_build_object('question', q.question, 'status', q.status),
    jsonb_build_object('text', CASE WHEN _action IN ('edit', 'add_to_library') THEN btrim(_text) END, 'library_id', coalesce(lib, q.library_id)), _reason);
  RETURN jsonb_build_object('ok', true, 'library_id', coalesce(lib, q.library_id));
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges: default deny, then exactly who may call what
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND (p.proname LIKE 'voice\_%' OR p.proname IN ('admin_voice_learning_overview', 'admin_voice_learning_suggestions',
             'admin_voice_learning_decide', 'admin_voice_vocab_rollback', 'admin_voice_vocab_activate', 'admin_voice_vocab_remove_term',
             'admin_voice_learning_set_settings', 'admin_voice_route_retire', 'admin_voice_benchmark_import', 'admin_interview_question_stats',
             'admin_interview_question_action'))
             AND p.proname NOT IN ('voice_settings', 'voice_claim_segment', 'voice_finish_segment', 'voice_log_answer') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.voice_learn_from_answer(uuid, integer, integer, boolean, text, text, integer, jsonb, jsonb, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_my_learning() TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_delete_my_terms(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_set_my_accent(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_set_audio_consent(boolean, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_learning_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_learning_suggestions(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_learning_decide(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_vocab_rollback(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_vocab_activate(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_vocab_remove_term(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_learning_set_settings(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_route_retire(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_voice_benchmark_import(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_interview_question_stats(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_interview_question_action(text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Schedule (once a day; the run function is only woken while it has work)
-- ---------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'voice-learning-nightly';
  PERFORM cron.schedule('voice-learning-nightly', '17 3 * * *', 'SELECT public.voice_learning_nightly()');
END $$;
