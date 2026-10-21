-- Feature N: Consultant Service Policy (versioned) and consultant acknowledgements.
-- NOT APPLIED by the agent: review and apply it yourself. Have your lawyer review the draft text in step 11 first
-- (it becomes version 1 the moment this file is applied; later versions are published from Admin > Consultant policy).
-- Additive and idempotent: new tables, functions, triggers and one schedule. No existing row is changed or deleted.
-- Order: independent of the other prepared files. consultant-location.sql and responsiveness.sql contain the same
-- combined hidden_consultant_ids() / critical_alert_targets() as this file, so any of them may be applied last.
--
-- What it does
--   1. consultant_policy_versions        version, title, summary and body (EN + AR), effective date. Public read, no edits.
--   2. consultant_policy_acknowledgements append-only (consultant, version, time, IP hash, user agent, language shown).
--      Consultants read their own rows, administrators read all, nobody can update or delete.
--   3. consultant_policy_prompts         first time a version was shown (starts the grace period).
--   4. consultant_policy_notice_log      e-mail/in-app notices: one notice, one reminder after 3 days, manual reminders.
--   5. Settings: policy_grace_days (7), policy_reminder_days (3), consultant_policy_emails (on).
--   6. After the grace period an unconfirmed consultant cannot place new bids or accept invitations and is hidden from
--      the directory, matching and Critical alerts. Sign-in, reading and confirming the policy, and existing work are
--      never blocked.
--   7. Credential-free hourly e-mail sweep (edge function consultant-policy-run), bounded by the service-only claim.

-- 1. Versions ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL UNIQUE CHECK (version > 0),
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  summary_en TEXT NOT NULL,
  summary_ar TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.consultant_policy_versions TO anon, authenticated;
GRANT ALL ON public.consultant_policy_versions TO service_role;
ALTER TABLE public.consultant_policy_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read the consultant policy" ON public.consultant_policy_versions;
CREATE POLICY "Anyone can read the consultant policy" ON public.consultant_policy_versions
  FOR SELECT TO anon, authenticated USING (true);

-- 2. Acknowledgements (append-only) ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_policy_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  version INT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash TEXT,
  user_agent TEXT,
  language TEXT NOT NULL CHECK (language IN ('en', 'ar')),
  source TEXT NOT NULL DEFAULT 'popup' CHECK (source IN ('registration', 'popup', 'banner', 'page')),
  UNIQUE (consultant_id, version)
);
CREATE INDEX IF NOT EXISTS consultant_policy_ack_user_idx ON public.consultant_policy_acknowledgements (user_id);
GRANT SELECT ON public.consultant_policy_acknowledgements TO authenticated;
GRANT SELECT, INSERT ON public.consultant_policy_acknowledgements TO service_role;
ALTER TABLE public.consultant_policy_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Consultants read own policy acknowledgements" ON public.consultant_policy_acknowledgements;
CREATE POLICY "Consultants read own policy acknowledgements" ON public.consultant_policy_acknowledgements
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read policy acknowledgements" ON public.consultant_policy_acknowledgements;
CREATE POLICY "Admins read policy acknowledgements" ON public.consultant_policy_acknowledgements
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Published versions and acknowledgements can never be changed or deleted (also not by the service role).
CREATE OR REPLACE FUNCTION public.consultant_policy_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Policy records cannot be changed or deleted' USING ERRCODE = '42501';
END
$$;
DROP TRIGGER IF EXISTS trg_consultant_policy_versions_append_only ON public.consultant_policy_versions;
CREATE TRIGGER trg_consultant_policy_versions_append_only
  BEFORE UPDATE OR DELETE ON public.consultant_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.consultant_policy_append_only();
DROP TRIGGER IF EXISTS trg_consultant_policy_ack_append_only ON public.consultant_policy_acknowledgements;
CREATE TRIGGER trg_consultant_policy_ack_append_only
  BEFORE UPDATE OR DELETE ON public.consultant_policy_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.consultant_policy_append_only();

-- 3. First display (starts the grace period) ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_policy_prompts (
  consultant_id UUID NOT NULL,
  version INT NOT NULL,
  first_shown_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_shown_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shown_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (consultant_id, version)
);
GRANT SELECT ON public.consultant_policy_prompts TO authenticated;
GRANT ALL ON public.consultant_policy_prompts TO service_role;
ALTER TABLE public.consultant_policy_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Consultants read own policy prompts" ON public.consultant_policy_prompts;
CREATE POLICY "Consultants read own policy prompts" ON public.consultant_policy_prompts
  FOR SELECT TO authenticated
  USING (consultant_id IN (SELECT c.id FROM public.consultants c WHERE c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 4. Notice log ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_policy_notice_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL,
  version INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('notice', 'reminder', 'manual')),
  requested_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS consultant_policy_notice_once_idx
  ON public.consultant_policy_notice_log (consultant_id, version, kind) WHERE kind IN ('notice', 'reminder');
CREATE INDEX IF NOT EXISTS consultant_policy_notice_pending_idx
  ON public.consultant_policy_notice_log (created_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS consultant_policy_notice_sent_idx
  ON public.consultant_policy_notice_log (sent_at DESC) WHERE sent_at IS NOT NULL;
GRANT SELECT ON public.consultant_policy_notice_log TO authenticated;
GRANT ALL ON public.consultant_policy_notice_log TO service_role;
ALTER TABLE public.consultant_policy_notice_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read policy notices" ON public.consultant_policy_notice_log;
CREATE POLICY "Admins read policy notices" ON public.consultant_policy_notice_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Secret value for hashing IP addresses (readable only by the database functions below).
CREATE TABLE IF NOT EXISTS public.consultant_policy_private (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  pepper TEXT NOT NULL DEFAULT (md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))
);
REVOKE ALL ON public.consultant_policy_private FROM anon, authenticated;
GRANT ALL ON public.consultant_policy_private TO service_role;
ALTER TABLE public.consultant_policy_private ENABLE ROW LEVEL SECURITY;
INSERT INTO public.consultant_policy_private (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 5. Settings ------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value) VALUES ('policy_grace_days', to_jsonb(7)) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_settings (key, value) VALUES ('policy_reminder_days', to_jsonb(3)) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_settings (key, value) VALUES ('consultant_policy_emails', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.consultant_policy_setting_int(_key text, _default int, _min int, _max int)
 RETURNS int
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT LEAST(_max, GREATEST(_min, COALESCE(
    (SELECT CASE WHEN jsonb_typeof(s.value) = 'number' THEN (s.value #>> '{}')::numeric::int
                 WHEN jsonb_typeof(s.value) = 'string' AND (s.value #>> '{}') ~ '^[0-9]{1,4}$' THEN (s.value #>> '{}')::int END
       FROM public.platform_settings s WHERE s.key = _key), _default)))
$$;
REVOKE ALL ON FUNCTION public.consultant_policy_setting_int(text, int, int, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultant_policy_current_version()
 RETURNS int
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT max(version) FROM public.consultant_policy_versions WHERE effective_at <= now()
$$;
GRANT EXECUTE ON FUNCTION public.consultant_policy_current_version() TO anon, authenticated, service_role;

-- 6. State of one consultant (mirrors policyState in src/lib/consultantPolicy.ts) ----------------------------------
--    none (no version yet) | accepted | pending (not shown yet) | grace (shown, inside the grace days) | blocked
CREATE OR REPLACE FUNCTION public.consultant_policy_state(_cid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _v int;
  _eff timestamptz;
  _acc_v int;
  _acc_at timestamptz;
  _first timestamptz;
  _days int := public.consultant_policy_setting_int('policy_grace_days', 7, 0, 90);
  _deadline timestamptz;
  _state text;
BEGIN
  SELECT v.version, v.effective_at INTO _v, _eff
    FROM public.consultant_policy_versions v WHERE v.effective_at <= now() ORDER BY v.version DESC LIMIT 1;
  SELECT a.version, a.accepted_at INTO _acc_v, _acc_at
    FROM public.consultant_policy_acknowledgements a WHERE a.consultant_id = _cid ORDER BY a.version DESC LIMIT 1;
  IF _v IS NOT NULL THEN
    _first := LEAST(
      (SELECT p.first_shown_at FROM public.consultant_policy_prompts p WHERE p.consultant_id = _cid AND p.version = _v),
      (SELECT min(l.sent_at) FROM public.consultant_policy_notice_log l WHERE l.consultant_id = _cid AND l.version = _v));
  END IF;
  IF _first IS NOT NULL THEN _deadline := _first + make_interval(days => _days); END IF;
  _state := CASE
    WHEN _v IS NULL THEN 'none'
    WHEN _acc_v IS NOT NULL AND _acc_v >= _v THEN 'accepted'
    WHEN _first IS NULL THEN 'pending'
    WHEN now() < _deadline THEN 'grace'
    ELSE 'blocked' END;
  RETURN jsonb_build_object(
    'state', _state, 'current_version', _v, 'effective_at', _eff,
    'accepted_version', _acc_v, 'accepted_at', _acc_at,
    'first_shown_at', _first, 'grace_days', _days,
    'deadline', CASE WHEN _state IN ('grace', 'blocked') THEN _deadline END);
END
$$;
REVOKE ALL ON FUNCTION public.consultant_policy_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_policy_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consultant_policy_blocked(_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE(public.consultant_policy_state(_cid) ->> 'state' = 'blocked', false)
$$;
REVOKE ALL ON FUNCTION public.consultant_policy_blocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_policy_blocked(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultant_policy_blocked_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[])
    FROM public.consultants c
   WHERE public.consultant_policy_current_version() IS NOT NULL
     AND public.consultant_policy_blocked(c.id)
$$;
REVOKE ALL ON FUNCTION public.consultant_policy_blocked_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_policy_blocked_ids() TO service_role;

-- 7. The signed-in consultant: status, "shown" and "accept" ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_consultant_policy_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid;
  _created timestamptz;
BEGIN
  SELECT c.id, c.created_at INTO _cid, _created FROM public.consultants c WHERE c.user_id = auth.uid() LIMIT 1;
  IF _cid IS NULL THEN RETURN NULL; END IF;
  RETURN public.consultant_policy_state(_cid) || jsonb_build_object('consultant_id', _cid, 'signed_up_at', _created);
END
$$;
REVOKE ALL ON FUNCTION public.my_consultant_policy_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_consultant_policy_status() TO authenticated;

-- Records that the current version was shown (pop-up or registration step). The first call starts the grace period.
CREATE OR REPLACE FUNCTION public.consultant_policy_mark_shown(_version int)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid;
BEGIN
  SELECT c.id INTO _cid FROM public.consultants c WHERE c.user_id = auth.uid() LIMIT 1;
  IF _cid IS NULL THEN RAISE EXCEPTION 'Consultants only' USING ERRCODE = '42501'; END IF;
  IF _version IS DISTINCT FROM public.consultant_policy_current_version() THEN
    RETURN public.my_consultant_policy_status();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultant_policy_acknowledgements a WHERE a.consultant_id = _cid AND a.version >= _version)
     AND public.check_rate_limit('policy-shown:' || auth.uid()::text, 120, 3600) THEN
    INSERT INTO public.consultant_policy_prompts AS p (consultant_id, version) VALUES (_cid, _version)
    ON CONFLICT (consultant_id, version) DO UPDATE SET last_shown_at = now(), shown_count = p.shown_count + 1;
  END IF;
  RETURN public.my_consultant_policy_status();
END
$$;
REVOKE ALL ON FUNCTION public.consultant_policy_mark_shown(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_policy_mark_shown(int) TO authenticated;

-- Accepting is idempotent: a second call for the same version returns the first acknowledgement unchanged.
CREATE OR REPLACE FUNCTION public.accept_consultant_policy(_version int, _language text, _source text, _user_agent text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid;
  _headers jsonb;
  _ip text;
  _ua text;
  _hash text;
  _pepper text;
  _lang text := CASE WHEN _language IN ('en', 'ar') THEN _language ELSE 'en' END;
  _src text := CASE WHEN _source IN ('registration', 'popup', 'banner', 'page') THEN _source ELSE 'popup' END;
  _row record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Please sign in to accept the Consultant Service Policy' USING ERRCODE = '42501'; END IF;
  SELECT c.id INTO _cid FROM public.consultants c WHERE c.user_id = _uid LIMIT 1;
  IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can accept the Consultant Service Policy' USING ERRCODE = '42501'; END IF;
  IF _version IS NULL OR _version IS DISTINCT FROM public.consultant_policy_current_version() THEN
    RAISE EXCEPTION 'A newer version of the Consultant Service Policy is available. Please reload and read it.' USING ERRCODE = '22023';
  END IF;
  SELECT a.version, a.accepted_at INTO _row FROM public.consultant_policy_acknowledgements a WHERE a.consultant_id = _cid AND a.version = _version;
  IF FOUND THEN RETURN jsonb_build_object('version', _row.version, 'accepted_at', _row.accepted_at); END IF;
  IF NOT public.check_rate_limit('policy-accept:' || _uid::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many attempts. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  BEGIN
    _headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN _headers := NULL;
  END;
  _ip := btrim(split_part(COALESCE(_headers ->> 'cf-connecting-ip', _headers ->> 'x-real-ip', _headers ->> 'x-forwarded-for', ''), ',', 1));
  _ua := left(COALESCE(NULLIF(_headers ->> 'user-agent', ''), NULLIF(_user_agent, '')), 400);
  SELECT pepper INTO _pepper FROM public.consultant_policy_private WHERE id;
  IF _ip <> '' THEN _hash := encode(sha256(convert_to(COALESCE(_pepper, '') || ':' || _ip, 'UTF8')), 'hex'); END IF;
  INSERT INTO public.consultant_policy_acknowledgements (consultant_id, user_id, version, ip_hash, user_agent, language, source)
  VALUES (_cid, _uid, _version, _hash, _ua, _lang, _src)
  ON CONFLICT (consultant_id, version) DO NOTHING;
  INSERT INTO public.consultant_policy_prompts (consultant_id, version) VALUES (_cid, _version)
  ON CONFLICT (consultant_id, version) DO NOTHING;
  SELECT a.version, a.accepted_at INTO _row FROM public.consultant_policy_acknowledgements a WHERE a.consultant_id = _cid AND a.version = _version;
  RETURN jsonb_build_object('version', _row.version, 'accepted_at', _row.accepted_at);
END
$$;
REVOKE ALL ON FUNCTION public.accept_consultant_policy(int, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_consultant_policy(int, text, text, text) TO authenticated;

-- 8. Restrictions after the grace period ------------------------------------------------------------------------------
-- 8a. New bids (revisions of an existing bid stay allowed: existing work continues).
CREATE OR REPLACE FUNCTION public.guard_bid_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN RETURN NEW; END IF;
  IF public.consultant_policy_blocked(NEW.consultant_id)
     AND NOT EXISTS (SELECT 1 FROM public.proposals p WHERE p.ticket_id = NEW.ticket_id AND p.consultant_id = NEW.consultant_id) THEN
    RAISE EXCEPTION 'Confirm the Consultant Service Policy before placing a new bid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_guard_bid_policy ON public.proposals;
CREATE TRIGGER trg_guard_bid_policy
  BEFORE INSERT ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_bid_policy();

-- 8b. Accepting an assignment request or invitation (declining stays allowed).
CREATE OR REPLACE FUNCTION public.guard_match_accept_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted'
     AND public.is_untrusted_writer()
     AND public.consultant_policy_blocked(NEW.consultant_id) THEN
    RAISE EXCEPTION 'Confirm the Consultant Service Policy before accepting a new assignment' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_guard_match_accept_policy ON public.ticket_match_requests;
CREATE TRIGGER trg_guard_match_accept_policy
  BEFORE UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_match_accept_policy();

-- 8c. Directory, map and matching (combined rule, identical in consultant-location.sql).
-- Combined rule, kept identical in consultant-location.sql, consultant-policy.sql and user-management.sql (any may be applied last):
-- profile-rule enforcement, missing location after its grace period, unconfirmed service policy after its grace period,
-- suspended or deleted accounts.
CREATE OR REPLACE FUNCTION public.hidden_consultant_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ids uuid[];
  _more uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN ARRAY[]::uuid[]; END IF;
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO _ids
    FROM public.consultants c
   WHERE COALESCE((SELECT enforce FROM public.profile_rules_config WHERE id), false)
     AND cardinality(public.consultant_missing_fields(c.id)) > 0;
  IF to_regprocedure('public.consultant_location_blocked(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) FROM public.consultants c WHERE public.consultant_location_blocked(c.id)' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_policy_blocked_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_policy_blocked_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.um_suspended_consultant_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.um_suspended_consultant_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  RETURN ARRAY(SELECT DISTINCT x FROM unnest(_ids) AS x);
END
$function$;

-- 8d. Critical alerts (combined rule, identical in responsiveness.sql).
-- Combined rule, kept identical in responsiveness.sql and consultant-policy.sql (either file may be applied last):
-- consultants whose public responsiveness level is "Needs improvement" (while responsiveness_public is on) and
-- consultants who have not confirmed the service policy after its grace period are left out of the automatic alarm
-- (they still see the request under Open requests). Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.critical_alert_targets(_ticket_id uuid)
 RETURNS TABLE(consultant_id uuid, user_id uuid, area_match boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _areas text[];
  _toks text[];
  _skip uuid[] := ARRAY[]::uuid[];
  _more uuid[];
BEGIN
  SELECT t.client_id, COALESCE(t.sap_modules, '{}'::text[]) INTO _client, _areas FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[]) INTO _toks
    FROM unnest(_areas) a, unnest(public.sap_area_tokens(a)) x;
  IF to_regclass('public.consultant_responsiveness') IS NOT NULL AND to_regprocedure('public.platform_flag(text,boolean)') IS NOT NULL THEN
    EXECUTE $q$SELECT COALESCE(array_agg(r.consultant_id), ARRAY[]::uuid[]) FROM public.consultant_responsiveness r
               WHERE public.platform_flag('responsiveness_public', false) AND r.public_level = 'needs_improvement'$q$ INTO _more;
    _skip := _skip || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_policy_blocked_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_policy_blocked_ids()' INTO _more;
    _skip := _skip || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  RETURN QUERY
  WITH elig AS (
    SELECT c.id AS cid, c.user_id AS uid, c.sap_technologies AS techs
      FROM public.consultants c
     WHERE c.verification_status = 'verified'
       AND c.user_id <> _client
       AND COALESCE(c.new_case_alerts, true)
       AND NOT (c.id = ANY(_skip))
  ), matched AS (
    SELECT e.cid, e.uid
      FROM elig e
     WHERE EXISTS (SELECT 1 FROM public.consultant_skills s
                    WHERE s.consultant_id = e.cid AND public.sap_area_tokens(s.sap_module) && _toks)
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(e.techs, '{}'::text[])) tech WHERE public.sap_area_tokens(tech) && _toks)
  )
  SELECT m.cid, m.uid, true FROM matched m
  UNION ALL
  SELECT e.cid, e.uid, false FROM elig e WHERE NOT EXISTS (SELECT 1 FROM matched);
END
$function$;

-- 9. Administrators ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_consultant_policy_overview()
 RETURNS TABLE (consultant_id uuid, display_name text, email text, verification_status text, signed_up_at timestamptz,
                state text, current_version int, accepted_version int, accepted_at timestamptz, accepted_language text,
                first_shown_at timestamptz, deadline timestamptz, last_reminder_at timestamptz, reminders int)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, p.display_name, u.email::text, c.verification_status::text, c.created_at,
         st.s ->> 'state', (st.s ->> 'current_version')::int, (st.s ->> 'accepted_version')::int,
         (st.s ->> 'accepted_at')::timestamptz,
         (SELECT a.language FROM public.consultant_policy_acknowledgements a WHERE a.consultant_id = c.id ORDER BY a.version DESC LIMIT 1),
         (st.s ->> 'first_shown_at')::timestamptz, (st.s ->> 'deadline')::timestamptz,
         (SELECT max(COALESCE(l.sent_at, l.created_at)) FROM public.consultant_policy_notice_log l WHERE l.consultant_id = c.id),
         (SELECT count(*)::int FROM public.consultant_policy_notice_log l WHERE l.consultant_id = c.id AND l.version = (st.s ->> 'current_version')::int)
    FROM public.consultants c
    CROSS JOIN LATERAL (SELECT public.consultant_policy_state(c.id) AS s) st
    LEFT JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN auth.users u ON u.id = c.user_id
   ORDER BY c.created_at;
END
$$;
REVOKE ALL ON FUNCTION public.admin_consultant_policy_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_consultant_policy_overview() TO authenticated;

-- Publishing a new version forces re-acknowledgement from its effective date (no back-dating, one scheduled at a time).
CREATE OR REPLACE FUNCTION public.admin_publish_consultant_policy(
  _title_en text, _title_ar text, _summary_en text, _summary_ar text, _body_en text, _body_ar text, _effective_at timestamptz DEFAULT NULL)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _eff timestamptz := COALESCE(_effective_at, now());
  _v int;
  _id uuid;
  _cur record;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(_title_en), '') = '' OR COALESCE(btrim(_title_ar), '') = '' OR COALESCE(btrim(_summary_en), '') = ''
     OR COALESCE(btrim(_summary_ar), '') = '' OR COALESCE(btrim(_body_en), '') = '' OR COALESCE(btrim(_body_ar), '') = '' THEN
    RAISE EXCEPTION 'Fill in the title, summary and text in English and Arabic' USING ERRCODE = '22023';
  END IF;
  IF length(_title_en) > 200 OR length(_title_ar) > 200 OR length(_summary_en) > 3000 OR length(_summary_ar) > 3000
     OR length(_body_en) > 60000 OR length(_body_ar) > 60000 THEN
    RAISE EXCEPTION 'The policy text is too long' USING ERRCODE = '22023';
  END IF;
  IF _eff < now() - interval '10 minutes' OR _eff > now() + interval '365 days' THEN
    RAISE EXCEPTION 'The effective date must be between now and one year from now' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('consultant_policy_publish'));
  IF EXISTS (SELECT 1 FROM public.consultant_policy_versions WHERE effective_at > now()) THEN
    RAISE EXCEPTION 'A version is already scheduled. Wait until it takes effect before publishing another.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _cur FROM public.consultant_policy_versions ORDER BY version DESC LIMIT 1;
  IF FOUND AND _cur.title_en = _title_en AND _cur.title_ar = _title_ar AND _cur.summary_en = _summary_en
     AND _cur.summary_ar = _summary_ar AND _cur.body_en = _body_en AND _cur.body_ar = _body_ar THEN
    RAISE EXCEPTION 'This text is the same as the current version' USING ERRCODE = '22023';
  END IF;
  _v := COALESCE((SELECT max(version) FROM public.consultant_policy_versions), 0) + 1;
  INSERT INTO public.consultant_policy_versions (version, title_en, title_ar, summary_en, summary_ar, body_en, body_ar, effective_at, published_by)
  VALUES (_v, btrim(_title_en), btrim(_title_ar), btrim(_summary_en), btrim(_summary_ar), _body_en, _body_ar, _eff, auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'consultant_policy.published', 'consultant_policy', _id, jsonb_build_object('version', _v, 'effective_at', _eff));
  RETURN _v;
END
$$;
REVOKE ALL ON FUNCTION public.admin_publish_consultant_policy(text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_consultant_policy(text, text, text, text, text, text, timestamptz) TO authenticated;

-- One-click reminder: in-app now, e-mail within the hour (sweep). At most once per consultant per 24 h.
CREATE OR REPLACE FUNCTION public.admin_send_policy_reminder(_consultant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _s jsonb;
  _uid uuid;
  _ar boolean;
  _v int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('policy-reminder:' || auth.uid()::text, 60, 3600) THEN
    RAISE EXCEPTION 'Too many reminders. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  SELECT c.user_id INTO _uid FROM public.consultants c WHERE c.id = _consultant_id;
  IF _uid IS NULL THEN RAISE EXCEPTION 'Consultant not found' USING ERRCODE = '22023'; END IF;
  _s := public.consultant_policy_state(_consultant_id);
  IF (_s ->> 'state') NOT IN ('pending', 'grace', 'blocked') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_policy_notice_log l
              WHERE l.consultant_id = _consultant_id AND l.kind = 'manual' AND l.created_at > now() - interval '24 hours') THEN
    RETURN false;
  END IF;
  _v := (_s ->> 'current_version')::int;
  _ar := COALESCE((SELECT pr.preferred_language FROM public.profiles pr WHERE pr.user_id = _uid) LIKE 'ar%', false);
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_uid,
          CASE WHEN _ar THEN 'يُرجى تأكيد سياسة خدمة المستشار' ELSE 'Please confirm the Consultant Service Policy' END,
          CASE WHEN _ar THEN 'اقرأ الملخص وأكّد الإصدار ' || _v || '. لا يتأثر عملك الحالي.'
               ELSE 'Read the summary and confirm version ' || _v || '. Your current work is not affected.' END,
          'policy_reminder', '/consultant/profile#service-policy');
  INSERT INTO public.consultant_policy_notice_log (consultant_id, version, kind, requested_by) VALUES (_consultant_id, _v, 'manual', auth.uid());
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'consultant_policy.reminder_sent', 'consultant_policy', _consultant_id, jsonb_build_object('version', _v));
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.admin_send_policy_reminder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_policy_reminder(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_policy_grace_days(_days int)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _old int := public.consultant_policy_setting_int('policy_grace_days', 7, 0, 90);
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF _days IS NULL OR _days < 0 OR _days > 90 THEN
    RAISE EXCEPTION 'The grace period must be between 0 and 90 days' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('policy_grace_days', to_jsonb(_days))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  IF _old IS DISTINCT FROM _days THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, metadata)
    VALUES (auth.uid(), 'consultant_policy.grace_days_changed', 'consultant_policy', jsonb_build_object('from', _old, 'to', _days));
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.admin_set_policy_grace_days(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_policy_grace_days(int) TO authenticated;

-- 10. E-mail sweep claim (service role only; one notice, one reminder after policy_reminder_days, manual reminders).
--     Notices go only to consultants who signed up before the version took effect (new consultants accept it at
--     registration). Rejected and suspended accounts get no automatic e-mail. At most 200 per run.
CREATE OR REPLACE FUNCTION public.claim_consultant_policy_notices(_limit int DEFAULT 200)
 RETURNS TABLE (log_id uuid, consultant_id uuid, user_id uuid, kind text, version int, lang text, deadline timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _v int;
  _eff timestamptz;
  _left int := GREATEST(1, LEAST(COALESCE(_limit, 200), 200));
  _rem int := public.consultant_policy_setting_int('policy_reminder_days', 3, 1, 30);
  _r record;
  _id uuid;
  _s jsonb;
  _ar boolean;
BEGIN
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF (SELECT s.value FROM public.platform_settings s WHERE s.key = 'consultant_policy_emails') = 'false'::jsonb THEN RETURN; END IF;
  SELECT v.version, v.effective_at INTO _v, _eff FROM public.consultant_policy_versions v WHERE v.effective_at <= now() ORDER BY v.version DESC LIMIT 1;
  IF _v IS NULL THEN RETURN; END IF;

  -- a) Manual reminders requested by an administrator (the in-app notification was sent at the click).
  FOR _r IN
    SELECT l.id AS lid, l.consultant_id AS cid, c.user_id AS uid
      FROM public.consultant_policy_notice_log l
      JOIN public.consultants c ON c.id = l.consultant_id
     WHERE l.kind = 'manual' AND l.sent_at IS NULL
     ORDER BY l.created_at
     LIMIT _left
     FOR UPDATE OF l SKIP LOCKED
  LOOP
    UPDATE public.consultant_policy_notice_log SET sent_at = now() WHERE id = _r.lid;
    _s := public.consultant_policy_state(_r.cid);
    CONTINUE WHEN (_s ->> 'state') NOT IN ('pending', 'grace', 'blocked');
    log_id := _r.lid; consultant_id := _r.cid; user_id := _r.uid; kind := 'manual'; version := _v;
    lang := CASE WHEN (SELECT pr.preferred_language FROM public.profiles pr WHERE pr.user_id = _r.uid) LIKE 'ar%' THEN 'ar' ELSE 'en' END;
    deadline := (_s ->> 'deadline')::timestamptz;
    _left := _left - 1;
    RETURN NEXT;
  END LOOP;

  -- b) First notice, c) one reminder after _rem days.
  FOR _r IN
    SELECT c.id AS cid, c.user_id AS uid,
           CASE WHEN n.id IS NULL THEN 'notice' ELSE 'reminder' END AS k
      FROM public.consultants c
      LEFT JOIN public.consultant_policy_notice_log n ON n.consultant_id = c.id AND n.version = _v AND n.kind = 'notice'
     WHERE c.created_at < _eff
       AND COALESCE(c.verification_status::text, '') NOT IN ('rejected', 'suspended')
       AND NOT EXISTS (SELECT 1 FROM public.consultant_policy_acknowledgements a WHERE a.consultant_id = c.id AND a.version >= _v)
       AND (n.id IS NULL
            OR (n.sent_at <= now() - make_interval(days => _rem)
                AND NOT EXISTS (SELECT 1 FROM public.consultant_policy_notice_log r
                                 WHERE r.consultant_id = c.id AND r.version = _v AND r.kind = 'reminder')))
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id AND u.deleted_at IS NULL
                     AND (u.banned_until IS NULL OR u.banned_until < now()))
     ORDER BY c.created_at
     LIMIT _left
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    _id := NULL;
    INSERT INTO public.consultant_policy_notice_log (consultant_id, version, kind, sent_at)
    VALUES (_r.cid, _v, _r.k, now())
    ON CONFLICT DO NOTHING
    RETURNING id INTO _id;
    CONTINUE WHEN _id IS NULL;
    _ar := COALESCE((SELECT pr.preferred_language FROM public.profiles pr WHERE pr.user_id = _r.uid) LIKE 'ar%', false);
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (_r.uid,
            CASE WHEN _ar THEN 'يُرجى تأكيد سياستنا المحدَّثة للخدمة' ELSE 'Please confirm our updated service policy' END,
            CASE WHEN _ar THEN 'اقرأ ملخص سياسة خدمة المستشار (الإصدار ' || _v || ') وأكّدها. لا يتأثر عملك الحالي.'
                 ELSE 'Read the summary of the Consultant Service Policy (version ' || _v || ') and confirm it. Your current work is not affected.' END,
            'policy_reminder', '/consultant/profile#service-policy');
    _s := public.consultant_policy_state(_r.cid);
    log_id := _id; consultant_id := _r.cid; user_id := _r.uid; kind := _r.k; version := _v;
    lang := CASE WHEN _ar THEN 'ar' ELSE 'en' END;
    deadline := (_s ->> 'deadline')::timestamptz;
    RETURN NEXT;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.claim_consultant_policy_notices(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_consultant_policy_notices(int) TO service_role;

-- 11. Version 1 (DRAFT - have your lawyer review). The text is identical to DRAFT_POLICY_V1 in src/lib/consultantPolicy.ts.
INSERT INTO public.consultant_policy_versions (version, title_en, title_ar, summary_en, summary_ar, body_en, body_ar, effective_at)
SELECT 1,
  $t_en$Consultant Service Policy$t_en$,
  $t_ar$سياسة خدمة المستشار$t_ar$,
  $s_en$This policy explains what we expect from consultants on AI Support 360 and what you can expect from us. Please accept or decline every assignment request within 24 hours (30 minutes for Critical requests); we send reminders, and if you do not reply the client is told and may choose another consultant. We measure how quickly you respond, but only for requests that arrive while you are available; any effect on your card, rating or ranking starts only after enough data and two friendly notices, can be disputed within 7 days and recovers over time. Keep all client work, contact and payment on the platform, keep your availability up to date, keep your profile accurate and take the AI interview yourself, without outside help.$s_en$,
  $s_ar$توضح هذه السياسة ما نتوقعه من المستشارين في AI Support 360 وما يمكنك أن تتوقعه منا. يُرجى قبول كل طلب إسناد أو رفضه خلال 24 ساعة (30 دقيقة للطلبات الحرجة)؛ نرسل تذكيرات، وإذا لم ترد يُبلَّغ العميل ويجوز له اختيار مستشار آخر. نقيس سرعة ردك، ولكن فقط للطلبات التي تصل وأنت متاح؛ ولا يبدأ أي أثر على بطاقتك أو تقييمك أو ترتيبك إلا بعد توفر بيانات كافية وإشعارين وديين، ويمكن الاعتراض خلال 7 أيام، ويتعافى المؤشر مع الوقت. احتفظ بكل عمل العملاء والتواصل والدفع على المنصة، وحدّث أوقات إتاحتك، وحافظ على دقة ملفك، وأجرِ مقابلة الذكاء الاصطناعي بنفسك دون مساعدة خارجية.$s_ar$,
  $b_en$Draft - have your lawyer review this text before relying on it.

## 1. Answering assignment requests
- When a client or an administrator sends you an assignment request or invitation, please accept or decline within 24 hours. For Critical requests the limit is 30 minutes.
- If you have not answered, we remind you after 2 hours, 4 hours and 1 day (Critical requests: after 10, 20 and 30 minutes) by in-app notification, pop-up and e-mail.
- If there is no reply within the limit, the request is marked "No response". The client is told and may invite another consultant, open the request for bids or wait longer. The no-response is recorded for your response rate.
- Declining within the time limit counts as a response and never counts against you.
- Before deciding you can open the ticket description (the client sees that you viewed it; this is not an answer and the clock keeps running). Files, credentials, remote access, links and contact details stay locked until the NDA, the agreed rate and the assignment.
- You can also ask the client for more information (up to 3 times per request, one question at a time). Your clock pauses until the client answers and then resumes with at least 2 hours left. Asking within the time limit counts as a response; if the client does not answer in time, the request is not counted against you. A reason for declining is optional and is never shown publicly.
- For bid invitations, the bid deadline shown on the ticket applies instead.
- Accepting a request does not replace the agreed rate, the confidentiality agreement (NDA) or the other steps required before work starts.

## 2. Responsiveness statistics
- What we measure: requests received, answered and not answered, your response rate, and your median, average and slower (90th percentile) response times, for the last 30 days, the last 90 days and all time. Critical requests and replies to client messages are measured separately.
- Fairness: a request counts only if it arrived while you were available - inside your declared working hours and time zone, outside any period you marked as unavailable or busy, and while you were below your stated capacity. Other requests are shown to you as "not counted - outside your availability".
- Nothing about your responsiveness is shown to clients before you have at least 5 counted requests, and only when the platform has switched responsiveness display on.
- Friendly notices: after your 1st and your 2nd counted no-response within 30 days you receive a polite notification ("Friendly notice 1 of 2" and "Friendly notice 2 of 2"). From the 3rd counted no-response within 30 days, or when your response rate is below 60 % after at least 5 counted requests, a Responsiveness indicator may be shown on your card.
- Clients see only your level (Excellent, Good, Fair, Needs improvement or New), your median response time and your response rate - never individual tickets, names or the requests you declined.
- Rating and ranking: once there is enough data, your overall displayed rating combines client reviews (85 %) with an automatically calculated responsiveness score (15 %), and the breakdown is always shown. Client star ratings are never changed. Responsiveness also has a modest weight in matching, and consultants at "Needs improvement" do not get automatic priority for Critical alerts.
- Disputes and recovery: you can dispute a counted no-response within 7 days, for example after a technical failure or a request sent outside your hours. An administrator reviews it and can void it. Statistics use a rolling 90-day window, so your indicator recovers automatically as new good responses replace old ones. There is no permanent penalty.
- The numbers above are the current platform settings. If they change materially, we publish a new version of this policy.

## 3. Working through the platform (no bypass)
- Clients you meet on AI Support 360 are introduced through the platform. Do not move a client, a ticket or follow-up work off the platform to avoid it, and do not ask clients to pay you directly. Clients pay the platform, and the platform pays you.
- Contact details (yours and the client's) are shared only after you are assigned to a ticket. Before that, do not share or ask for phone numbers, e-mail addresses, messaging accounts or links that get around this rule. Messages containing contact details may be hidden or flagged.
- Keep ticket messages, files, sessions, time records and invoices on the platform. The confidentiality agreement (NDA) you sign for each client continues to apply.

## 4. Keeping your availability up to date
- Keep your working hours, time zone, capacity and availability status current, and mark holidays and other unavailable periods in advance.
- Requests that arrive while you are marked unavailable are not counted against you. Clients and matching rely on this information, so out-of-date availability leads to requests you cannot take.

## 5. Accurate profile and honest AI interview
- Everything in your profile must be true and your own: experience, projects, certificates, education, skills, location and rate. Upload only documents you are entitled to share.
- Take the AI interview yourself. Do not get help from other people, AI tools, search engines or notes during the interview, unless the interview screen says that a specific aid is allowed.
- We may ask for proof, ask you to repeat the interview, remove a badge or suspend an account when information is found to be false or an interview was not taken honestly.

## 6. Changes to this policy
- When we publish a new version, you are asked to confirm it. If you have not confirmed it by the end of the grace period shown to you (currently 7 days from the first time we show it), you cannot accept new assignments or place new bids, and you are not shown in search, matching or Critical alerts until you confirm. Work on tickets you already have continues.
- You can always sign in, read this policy and confirm it.$b_en$,
  $b_ar$مسودة - اطلب من محاميك مراجعة هذا النص قبل الاعتماد عليه.

## 1. الرد على طلبات الإسناد
- عندما يرسل إليك عميل أو مسؤول طلب إسناد أو دعوة، يُرجى القبول أو الرفض خلال 24 ساعة. وفي الطلبات الحرجة تكون المهلة 30 دقيقة.
- إذا لم ترد، نذكّرك بعد ساعتين و4 ساعات ويوم واحد (الطلبات الحرجة: بعد 10 و20 و30 دقيقة) عبر إشعار داخل المنصة ونافذة منبثقة وبريد إلكتروني.
- إذا لم يصل رد خلال المهلة، يُوسم الطلب بأنه "بلا رد". ويُبلَّغ العميل، ويجوز له دعوة مستشار آخر أو فتح الطلب للعروض أو الانتظار مدة أطول. ويُسجَّل عدم الرد في معدل استجابتك.
- الرفض خلال المهلة يُعد ردًا ولا يُحتسب ضدك أبدًا.
- قبل أن تقرر يمكنك فتح وصف التذكرة (يرى العميل أنك اطلعت عليه؛ وهذا لا يُعد ردًا ويستمر العدّاد). وتبقى الملفات وبيانات الدخول والوصول عن بُعد والروابط وبيانات التواصل مقفلة حتى اتفاقية السرية والسعر المتفق عليه والإسناد.
- يمكنك أيضًا طلب معلومات إضافية من العميل (حتى 3 مرات لكل طلب، سؤال واحد في كل مرة). يتوقف العدّاد حتى يجيب العميل ثم يستأنف مع ساعتين على الأقل. ويُعد السؤال خلال المهلة ردًا، وإذا لم يُجب العميل في الوقت المحدد فلا يُحتسب الطلب ضدك. وذكر سبب الرفض اختياري ولا يُعرض علنًا أبدًا.
- في دعوات تقديم العروض، يسري الموعد النهائي للعروض الظاهر في التذكرة بدلًا من ذلك.
- قبول الطلب لا يغني عن السعر المتفق عليه ولا عن اتفاقية السرية (NDA) ولا عن الخطوات الأخرى اللازمة قبل بدء العمل.

## 2. إحصاءات سرعة الاستجابة
- ما نقيسه: الطلبات المستلمة، وما تم الرد عليه وما لم يُرد عليه، ومعدل استجابتك، والوسيط والمتوسط والزمن الأبطأ (المئين التسعين) لزمن الاستجابة، لآخر 30 يومًا وآخر 90 يومًا وكامل المدة. وتُقاس الطلبات الحرجة والردود على رسائل العملاء كلٌّ على حدة.
- العدالة: لا يُحتسب الطلب إلا إذا وصل وأنت متاح - ضمن ساعات العمل والمنطقة الزمنية التي حددتها، وخارج أي فترة وسمتها بأنك غير متاح أو مشغول، وقبل بلوغ الطاقة التي حددتها. وتظهر لك الطلبات الأخرى بعبارة "غير محتسب - خارج أوقات إتاحتك".
- لا يظهر للعملاء أي شيء عن سرعة استجابتك قبل أن يكون لديك 5 طلبات محتسبة على الأقل، ولا يظهر إلا إذا فعّلت المنصة عرض سرعة الاستجابة.
- الإشعارات الودية: بعد أول وثاني حالة عدم رد محتسبة خلال 30 يومًا يصلك إشعار مهذب ("إشعار ودي 1 من 2" و"إشعار ودي 2 من 2"). وابتداءً من الحالة الثالثة خلال 30 يومًا، أو عندما يقل معدل استجابتك عن 60 % بعد 5 طلبات محتسبة على الأقل، قد يظهر مؤشر سرعة الاستجابة على بطاقتك.
- لا يرى العملاء إلا مستواك (ممتاز أو جيد أو مقبول أو يحتاج إلى تحسين أو جديد) ووسيط زمن استجابتك ومعدل استجابتك - ولا يرون أبدًا تذاكر بعينها أو أسماء أو الطلبات التي رفضتها.
- التقييم والترتيب: عند توفر بيانات كافية، يجمع تقييمك العام المعروض بين تقييمات العملاء (85 %) ودرجة سرعة استجابة تُحسب تلقائيًا (15 %)، ويظهر التفصيل دائمًا. ولا تُغيَّر تقييمات النجوم التي يمنحها العملاء أبدًا. ولسرعة الاستجابة وزن معتدل في المطابقة، ولا يحصل المستشارون في مستوى "يحتاج إلى تحسين" على أولوية تلقائية في التنبيهات الحرجة.
- الاعتراض والتعافي: يمكنك الاعتراض على حالة عدم رد محتسبة خلال 7 أيام، مثلًا بسبب عطل تقني أو طلب أُرسل خارج ساعاتك. ويراجعه أحد المسؤولين ويمكنه إلغاؤه. وتعتمد الإحصاءات على نافذة متحركة مدتها 90 يومًا، فيتعافى مؤشرك تلقائيًا مع حلول ردود جيدة جديدة محل القديمة. ولا توجد عقوبة دائمة.
- الأرقام أعلاه هي إعدادات المنصة الحالية. وإذا تغيرت تغيرًا جوهريًا، ننشر نسخة جديدة من هذه السياسة.

## 3. العمل عبر المنصة (دون تجاوزها)
- العملاء الذين تتعرف عليهم في AI Support 360 يصلون إليك عبر المنصة. لا تنقل عميلًا أو تذكرة أو عملًا لاحقًا إلى خارج المنصة لتتجاوزها، ولا تطلب من العملاء أن يدفعوا لك مباشرة. يدفع العملاء للمنصة، والمنصة تدفع لك.
- لا تُشارك بيانات التواصل (بياناتك وبيانات العميل) إلا بعد إسنادك إلى التذكرة. وقبل ذلك لا تشارك ولا تطلب أرقام هواتف أو عناوين بريد إلكتروني أو حسابات مراسلة أو روابط تلتف على هذه القاعدة. وقد تُخفى الرسائل التي تحتوي على بيانات تواصل أو يُشار إليها.
- احتفظ برسائل التذاكر والملفات والجلسات وسجلات الوقت والفواتير على المنصة. وتظل اتفاقية السرية (NDA) التي توقعها لكل عميل سارية.

## 4. تحديث أوقات إتاحتك
- حافظ على تحديث ساعات عملك ومنطقتك الزمنية وطاقتك وحالة إتاحتك، وسجّل الإجازات وفترات عدم الإتاحة الأخرى مسبقًا.
- الطلبات التي تصل وأنت موسوم بأنك غير متاح لا تُحتسب ضدك. ويعتمد العملاء والمطابقة على هذه المعلومات، لذا فإن عدم تحديثها يؤدي إلى وصول طلبات لا تستطيع تنفيذها.

## 5. دقة الملف الشخصي ونزاهة مقابلة الذكاء الاصطناعي
- يجب أن يكون كل ما في ملفك صحيحًا ويخصك أنت: الخبرة والمشاريع والشهادات والتعليم والمهارات والموقع والسعر. ولا ترفع إلا مستندات يحق لك مشاركتها.
- أجرِ مقابلة الذكاء الاصطناعي بنفسك. ولا تستعن بأشخاص آخرين أو بأدوات ذكاء اصطناعي أو محركات بحث أو ملاحظات أثناء المقابلة، إلا إذا ذكرت شاشة المقابلة أن وسيلة معينة مسموح بها.
- يجوز لنا طلب إثبات، أو طلب إعادة المقابلة، أو سحب شارة، أو إيقاف الحساب إذا تبين أن معلومات غير صحيحة أو أن المقابلة لم تُجرَ بنزاهة.

## 6. التغييرات على هذه السياسة
- عندما ننشر نسخة جديدة، يُطلب منك تأكيدها. وإذا لم تؤكدها حتى نهاية فترة السماح المعروضة لك (حاليًا 7 أيام من أول مرة نعرضها فيها)، فلن تتمكن من قبول إسنادات جديدة أو تقديم عروض جديدة، ولن تظهر في البحث أو المطابقة أو التنبيهات الحرجة حتى تؤكدها. ويستمر العمل في التذاكر المسندة إليك حاليًا.
- يمكنك دائمًا تسجيل الدخول وقراءة هذه السياسة وتأكيدها.$b_ar$,
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.consultant_policy_versions WHERE version = 1);

-- 12. Hourly e-mail sweep at minute 23 (credential-free; the service-only claim and the function's 30-minute guard
--     bound the work; responses contain counts only).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'consultant-policy-run';
SELECT cron.schedule(
  'consultant-policy-run',
  '23 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/consultant-policy-run',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
