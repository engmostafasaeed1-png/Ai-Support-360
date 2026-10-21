-- Feature Y: weekly availability required + urgent reminders + "On hold" status with start/end dates.
-- NOT APPLIED by the agent: review and apply it yourself. Additive and idempotent; no consultant row is deleted,
-- no column is dropped or retyped. Deploy order: the edge functions availability-run and consultant-profile-reminder
-- are already deployed, so the e-mails work the moment this file is applied.
--
-- Note on step 0: PostgreSQL accepts "ALTER TYPE ... ADD VALUE" inside a transaction, but the new value can only be
-- used after commit. Everything below compares/sets it as text inside PL/pgSQL (evaluated at run time), so applying the
-- whole file at once works. If your SQL tool still complains, run step 0 alone first, then the rest.
--
-- What it does
--   1. "Weekly availability" = at least one recurring weekly slot (availability_slots with a weekday, no date).
--      Profile rule field_key 'availability' becomes hard-required (ON by default; admins can switch it off in the
--      Availability admin section). It is part of consultant_missing_fields / the submission gate / completion %.
--   2. Grace: setting availability_grace_days (7) counted from availability_grace_started_at (= when you apply this) or
--      the sign-up, whichever is later. After it, consultants without weekly availability are left out of NEW matching,
--      critical alerts and the directory (hidden_consultant_ids / critical_alert_targets). Signing in, existing work and
--      accepting what they already have are never blocked.
--   3. Reminders: one urgent, essential notice now (in-app + e-mail) to everyone missing it, then the highlighted
--      "Urgent" block inside the daily profile reminder mail every 2 days (8 times), then weekly - never a second mail
--      the same day. Stop at once when filled, when not required, or while on hold. Reminder mails follow the pause rules.
--   4. Holds (consultant_holds): start (default now, up to 180 days ahead) and required end (max hold_max_days = 90),
--      private reason (contact details refused); overlapping holds merge; during a hold: no new requests / invitations /
--      critical alerts, directory shows "On hold until ..." (hold_directory_mode 'label', or 'hide'), the period is in
--      consultant_unavailable_periods (Feature M ignores those requests), clients of active tickets get a short notice,
--      profile/availability reminders pause. Automatic resume by the 15-minute sweep (in-app + e-mail), early resume,
--      extend/shorten, cancel a future hold, administrator set/clear on behalf (reason, audited).
--   5. Admin: missing list, counts, reminders now (50 per click, 10 clicks/hour, once per consultant per 24 h, audited),
--      settings, holds list; a weekly digest line for administrators (Monday morning, from the same sweep).

-- 0. New status value ------------------------------------------------------------------------------------------------
ALTER TYPE public.availability_status ADD VALUE IF NOT EXISTS 'on_hold';

-- 1. Settings ------------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value) VALUES
  ('availability_grace_days', '7'::jsonb),
  ('availability_grace_started_at', to_jsonb(now())),
  ('hold_max_days', '90'::jsonb),
  ('hold_directory_mode', '"label"'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.avail_setting_int(_key text, _def int, _lo int, _hi int)
 RETURNS int
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT least(_hi, greatest(_lo, COALESCE((
    SELECT CASE WHEN jsonb_typeof(s.value) = 'number' THEN (s.value #>> '{}')::numeric::int
                WHEN jsonb_typeof(s.value) = 'string' AND (s.value #>> '{}') ~ '^\d{1,4}$' THEN (s.value #>> '{}')::int END
      FROM public.platform_settings s WHERE s.key = _key), _def)))
$$;
REVOKE ALL ON FUNCTION public.avail_setting_int(text, int, int, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hold_directory_mode()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN (SELECT s.value #>> '{}' FROM public.platform_settings s WHERE s.key = 'hold_directory_mode') = 'hide' THEN 'hide' ELSE 'label' END
$$;
REVOKE ALL ON FUNCTION public.hold_directory_mode() FROM PUBLIC, anon;

-- 2. "Weekly availability" filled + required rule ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultant_has_weekly_availability(_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.availability_slots x
                  WHERE x.consultant_id = _cid AND x.specific_date IS NULL
                    AND x.day_of_week BETWEEN 0 AND 6 AND x.end_time > x.start_time)
$$;
REVOKE ALL ON FUNCTION public.consultant_has_weekly_availability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_has_weekly_availability(uuid) TO authenticated, service_role;

-- Same body as live, only 'availability' changed: one-date slots no longer count as weekly availability.
CREATE OR REPLACE FUNCTION public.profile_field_filled(_cid uuid, _key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.consultants;
  p public.profiles;
BEGIN
  SELECT * INTO c FROM public.consultants WHERE id = _cid;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO p FROM public.profiles WHERE user_id = c.user_id;
  RETURN CASE _key
    WHEN 'display_name' THEN char_length(btrim(COALESCE(p.display_name, ''))) >= 2
    WHEN 'avatar' THEN COALESCE(p.avatar_url, '') <> ''
    WHEN 'phone' THEN COALESCE(p.phone, '') <> ''
    WHEN 'bio' THEN char_length(btrim(COALESCE(c.bio, ''))) >= 20
    WHEN 'hourly_rate' THEN COALESCE(c.hourly_rate, 0) > 0
    WHEN 'timezone' THEN COALESCE(c.timezone, '') <> ''
    WHEN 'languages' THEN COALESCE(cardinality(c.languages), 0) > 0
    WHEN 'language_levels' THEN c.language_levels IS NOT NULL AND c.language_levels::text NOT IN ('{}', '[]', 'null')
    WHEN 'nationality' THEN COALESCE(c.nationality, '') <> '' OR EXISTS (SELECT 1 FROM public.consultant_private x WHERE x.consultant_id = _cid AND COALESCE(x.nationality, '') <> '')
    WHEN 'country' THEN COALESCE(btrim(c.country), '') <> ''
    WHEN 'city' THEN COALESCE(btrim(c.city), '') <> ''
    WHEN 'work_modes' THEN COALESCE(cardinality(c.work_modes), 0) > 0
    WHEN 'working_week' THEN COALESCE(c.working_week, '') <> ''
    WHEN 'linkedin_url' THEN COALESCE(c.linkedin_url, '') <> ''
    WHEN 'credly_username' THEN COALESCE(c.credly_username, '') <> ''
    WHEN 'github_url' THEN COALESCE(c.github_url, '') <> ''
    WHEN 'personal_website' THEN COALESCE(c.personal_website, '') <> ''
    WHEN 'profile_video_url' THEN COALESCE(c.profile_video_url, '') <> ''
    WHEN 'sap_role' THEN COALESCE(c.sap_role, '') <> ''
    WHEN 'seniority_level' THEN COALESCE(c.seniority_level, '') <> ''
    WHEN 'total_sap_years' THEN COALESCE(c.total_sap_years, 0) > 0
    WHEN 'sap_roles' THEN COALESCE(cardinality(c.sap_roles), 0) > 0
    WHEN 'sap_technologies' THEN COALESCE(cardinality(c.sap_technologies), 0) > 0
    WHEN 'industries' THEN COALESCE(cardinality(c.industries), 0) > 0
    WHEN 'customer_segments' THEN COALESCE(cardinality(c.customer_segments), 0) > 0
    WHEN 'vertical_solutions' THEN COALESCE(cardinality(c.vertical_solutions), 0) > 0
    WHEN 'localization_countries' THEN COALESCE(cardinality(c.localization_countries), 0) > 0
    WHEN 'localization_solutions' THEN COALESCE(cardinality(c.localization_solutions), 0) > 0
    WHEN 'deployment_experience' THEN COALESCE(cardinality(c.deployment_experience), 0) > 0
    WHEN 'project_types' THEN COALESCE(cardinality(c.project_types), 0) > 0
    WHEN 'project_scale' THEN COALESCE(c.project_scale, '') <> ''
    WHEN 'skills' THEN EXISTS (SELECT 1 FROM public.consultant_skills x WHERE x.consultant_id = _cid)
    WHEN 'certifications' THEN EXISTS (SELECT 1 FROM public.certifications x WHERE x.consultant_id = _cid)
    WHEN 'work_history' THEN EXISTS (SELECT 1 FROM public.consultant_work_history x WHERE x.consultant_id = _cid)
    WHEN 'education' THEN EXISTS (SELECT 1 FROM public.consultant_education x WHERE x.consultant_id = _cid)
    WHEN 'projects' THEN EXISTS (SELECT 1 FROM public.consultant_projects x WHERE x.consultant_id = _cid)
    WHEN 'availability' THEN public.consultant_has_weekly_availability(_cid)
    WHEN 'cv' THEN COALESCE(c.cv_url, '') <> '' OR EXISTS (SELECT 1 FROM public.consultant_private x WHERE x.consultant_id = _cid AND COALESCE(x.cv_url, '') <> '')
    WHEN 'ai_interview' THEN c.ai_interview_completed_at IS NOT NULL
    WHEN 'bank_details' THEN EXISTS (SELECT 1 FROM public.consultant_payout_details x WHERE x.consultant_id = _cid AND x.acknowledged_at IS NOT NULL)
    ELSE true
  END;
END
$function$;

UPDATE public.profile_field_rules
   SET hard_required = true, mode = 'required', label = 'Weekly availability', updated_at = now()
 WHERE field_key = 'availability' AND (hard_required IS DISTINCT FROM true OR mode <> 'required');

CREATE OR REPLACE FUNCTION public.availability_required()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT r.mode = 'required' OR r.hard_required FROM public.profile_field_rules r WHERE r.field_key = 'availability'), false)
$$;
REVOKE ALL ON FUNCTION public.availability_required() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.availability_required() TO authenticated, service_role;

-- 3. Holds ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  prev_status text,
  unavailable_period_id uuid,
  set_by uuid,
  set_by_admin boolean NOT NULL DEFAULT false,
  admin_reason text,
  merged_into uuid,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  client_notice_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultant_holds_range CHECK (ends_at > starts_at),
  CONSTRAINT consultant_holds_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500)
);
GRANT SELECT ON public.consultant_holds TO authenticated;
GRANT ALL ON public.consultant_holds TO service_role;
ALTER TABLE public.consultant_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Consultants read own holds" ON public.consultant_holds;
CREATE POLICY "Consultants read own holds" ON public.consultant_holds
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_holds.consultant_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins read holds" ON public.consultant_holds;
CREATE POLICY "Admins read holds" ON public.consultant_holds
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
-- No insert/update/delete policies: holds change only through the functions below.
CREATE INDEX IF NOT EXISTS consultant_holds_open_idx ON public.consultant_holds (consultant_id, starts_at) WHERE status IN ('scheduled', 'active');
CREATE INDEX IF NOT EXISTS consultant_holds_due_idx ON public.consultant_holds (status, starts_at, ends_at);

CREATE OR REPLACE FUNCTION public.consultant_on_hold(_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.consultant_holds h
                  WHERE h.consultant_id = _cid AND h.status IN ('scheduled', 'active')
                    AND h.starts_at <= now() AND h.ends_at > now())
$$;
REVOKE ALL ON FUNCTION public.consultant_on_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_on_hold(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultant_on_hold_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT h.consultant_id), ARRAY[]::uuid[]) FROM public.consultant_holds h
   WHERE h.status IN ('scheduled', 'active') AND h.starts_at <= now() AND h.ends_at > now()
$$;
REVOKE ALL ON FUNCTION public.consultant_on_hold_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_on_hold_ids() TO service_role;

-- Only with hold_directory_mode = 'hide'; otherwise the directory shows "On hold until ..." and the consultant cannot be chosen.
CREATE OR REPLACE FUNCTION public.consultant_hold_hidden_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN public.hold_directory_mode() = 'hide' THEN public.consultant_on_hold_ids() ELSE ARRAY[]::uuid[] END
$$;
REVOKE ALL ON FUNCTION public.consultant_hold_hidden_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_hold_hidden_ids() TO service_role;

-- Public part of a hold for cards and the map: only "on hold until" (never the reason or who set it).
CREATE OR REPLACE FUNCTION public.consultant_hold_public(_ids uuid[])
 RETURNS TABLE (consultant_id uuid, ends_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT h.consultant_id, max(h.ends_at)
    FROM public.consultant_holds h
   WHERE auth.uid() IS NOT NULL
     AND h.consultant_id = ANY((_ids)[1:500])
     AND h.status IN ('scheduled', 'active') AND h.starts_at <= now() AND h.ends_at > now()
   GROUP BY h.consultant_id
$$;
REVOKE ALL ON FUNCTION public.consultant_hold_public(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_hold_public(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.availability_public_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('hold_directory', public.hold_directory_mode(),
                            'hold_max_days', public.avail_setting_int('hold_max_days', 90, 1, 365),
                            'required', public.availability_required())
$$;
REVOKE ALL ON FUNCTION public.availability_public_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.availability_public_config() TO authenticated;

-- Client notice text (mirrored by clientHoldNotice in _shared/availabilityRules.ts).
CREATE OR REPLACE FUNCTION public.hold_client_notice_text(_starts timestamptz, _ends timestamptz, _lang text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN _lang LIKE 'ar%'
    THEN 'مستشارك متوقف مؤقتًا من ' || to_char(_starts AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || ' إلى '
         || to_char(_ends AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || '، ويستمر العمل الحالي كما هو متفق عليه.'
    ELSE 'Your consultant is on hold from ' || to_char(_starts AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY') || ' to '
         || to_char(_ends AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY') || ', current work continues as agreed.' END
$$;
REVOKE ALL ON FUNCTION public.hold_client_notice_text(timestamptz, timestamptz, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.hold_user_lang(_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN (SELECT p.preferred_language FROM public.profiles p WHERE p.user_id = _uid) LIKE 'ar%' THEN 'ar' ELSE 'en' END
$$;
REVOKE ALL ON FUNCTION public.hold_user_lang(uuid) FROM PUBLIC, anon, authenticated;

-- The period Feature M uses: requests that arrive inside it are not counted against the consultant.
CREATE OR REPLACE FUNCTION public.hold_sync_period(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  h public.consultant_holds;
  _pid uuid;
BEGIN
  SELECT * INTO h FROM public.consultant_holds WHERE id = _id;
  IF NOT FOUND THEN RETURN; END IF;
  IF h.status = 'cancelled' THEN
    IF h.unavailable_period_id IS NOT NULL THEN DELETE FROM public.consultant_unavailable_periods WHERE id = h.unavailable_period_id; END IF;
    UPDATE public.consultant_holds SET unavailable_period_id = NULL WHERE id = _id;
    RETURN;
  END IF;
  UPDATE public.consultant_unavailable_periods
     SET starts_at = h.starts_at, ends_at = h.ends_at, updated_at = now()
   WHERE id = h.unavailable_period_id
  RETURNING id INTO _pid;
  IF _pid IS NULL THEN
    INSERT INTO public.consultant_unavailable_periods (consultant_id, starts_at, ends_at, reason)
    VALUES (h.consultant_id, h.starts_at, h.ends_at, 'On hold')
    RETURNING id INTO _pid;
    UPDATE public.consultant_holds SET unavailable_period_id = _pid WHERE id = _id;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.hold_sync_period(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hold_validate(_starts timestamptz, _ends timestamptz, _reason text, _new boolean)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _max int := public.avail_setting_int('hold_max_days', 90, 1, 365);
BEGIN
  IF _ends IS NULL THEN RAISE EXCEPTION 'Choose when the hold ends' USING ERRCODE = '22023'; END IF;
  IF _starts IS NULL THEN RAISE EXCEPTION 'Choose when the hold starts' USING ERRCODE = '22023'; END IF;
  IF _new AND _starts < now() - interval '5 minutes' THEN RAISE EXCEPTION 'The start cannot be in the past' USING ERRCODE = '22023'; END IF;
  IF _new AND _starts > now() + interval '180 days' THEN RAISE EXCEPTION 'A hold can start at most 180 days ahead' USING ERRCODE = '22023'; END IF;
  IF _ends <= _starts THEN RAISE EXCEPTION 'The end must be after the start' USING ERRCODE = '22023'; END IF;
  IF _ends <= now() THEN RAISE EXCEPTION 'The end must be in the future' USING ERRCODE = '22023'; END IF;
  IF _ends - _starts > make_interval(days => _max) THEN RAISE EXCEPTION 'A hold can last at most % days', _max USING ERRCODE = '22023'; END IF;
  IF _reason IS NOT NULL AND char_length(btrim(_reason)) > 500 THEN RAISE EXCEPTION 'Keep the reason under 500 characters' USING ERRCODE = '22023'; END IF;
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NOT NULL AND public.contact_details_in_text(_reason) THEN
    RAISE EXCEPTION 'Please remove contact details (e-mail, phone, links) from the reason' USING ERRCODE = '22023';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.hold_validate(timestamptz, timestamptz, text, boolean) FROM PUBLIC, anon, authenticated;

-- Absorbs every scheduled/active hold of the same consultant that overlaps or touches _id (repeated until stable).
-- The kept row is the active one, otherwise the earliest. Returns the kept id.
CREATE OR REPLACE FUNCTION public.hold_merge(_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  h public.consultant_holds;
  _ids uuid[];
  _keep uuid;
  _s timestamptz;
  _e timestamptz;
  _max int := public.avail_setting_int('hold_max_days', 90, 1, 365);
  _loops int := 0;
BEGIN
  SELECT * INTO h FROM public.consultant_holds WHERE id = _id;
  _s := h.starts_at; _e := h.ends_at; _ids := ARRAY[_id];
  LOOP
    _loops := _loops + 1;
    SELECT array_agg(x.id), least(_s, min(x.starts_at)), greatest(_e, max(x.ends_at)) INTO _ids, _s, _e
      FROM public.consultant_holds x
     WHERE x.consultant_id = h.consultant_id AND x.status IN ('scheduled', 'active')
       AND (x.id = ANY(_ids) OR (x.starts_at <= _e AND x.ends_at >= _s));
    EXIT WHEN _loops > 20 OR NOT EXISTS (
      SELECT 1 FROM public.consultant_holds x
       WHERE x.consultant_id = h.consultant_id AND x.status IN ('scheduled', 'active') AND NOT (x.id = ANY(_ids))
         AND x.starts_at <= _e AND x.ends_at >= _s);
  END LOOP;
  IF cardinality(_ids) <= 1 THEN RETURN _id; END IF;
  IF _e - _s > make_interval(days => _max) THEN
    RAISE EXCEPTION 'Together with your other hold this would last more than % days', _max USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO _keep FROM public.consultant_holds x WHERE x.id = ANY(_ids)
   ORDER BY (x.status = 'active') DESC, x.starts_at, x.created_at LIMIT 1;
  UPDATE public.consultant_holds k
     SET starts_at = _s, ends_at = _e, updated_at = now(),
         reason = COALESCE(k.reason, (SELECT o.reason FROM public.consultant_holds o WHERE o.id = ANY(_ids) AND o.reason IS NOT NULL ORDER BY o.created_at DESC LIMIT 1)),
         set_by_admin = k.set_by_admin OR EXISTS (SELECT 1 FROM public.consultant_holds o WHERE o.id = ANY(_ids) AND o.set_by_admin),
         admin_reason = COALESCE((SELECT o.admin_reason FROM public.consultant_holds o WHERE o.id = ANY(_ids) AND o.admin_reason IS NOT NULL ORDER BY o.created_at DESC LIMIT 1), k.admin_reason)
   WHERE k.id = _keep;
  UPDATE public.consultant_holds SET status = 'cancelled', merged_into = _keep, updated_at = now()
   WHERE id = ANY(_ids) AND id <> _keep;
  PERFORM public.hold_sync_period(x) FROM unnest(_ids) AS x;
  RETURN _keep;
END
$$;
REVOKE ALL ON FUNCTION public.hold_merge(uuid) FROM PUBLIC, anon, authenticated;

-- Clients of the consultant's active tickets: one short notice per ticket.
CREATE OR REPLACE FUNCTION public.hold_notify_clients(_id uuid)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  h public.consultant_holds;
  r record;
  _n int := 0;
  _lang text;
BEGIN
  SELECT * INTO h FROM public.consultant_holds WHERE id = _id;
  FOR r IN
    SELECT DISTINCT t.id AS tid, t.client_id
      FROM public.tickets t
     WHERE t.status::text NOT IN ('resolved', 'closed')
       AND (t.consultant_id = h.consultant_id
            OR EXISTS (SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = t.id AND a.consultant_id = h.consultant_id AND a.status::text = 'active')
            OR EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = t.id AND m.consultant_id = h.consultant_id AND m.status IN ('ready', 'active')))
  LOOP
    _lang := public.hold_user_lang(r.client_id);
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (r.client_id,
            CASE WHEN _lang = 'ar' THEN 'المستشار متوقف مؤقتًا' ELSE 'Your consultant is on hold' END,
            public.hold_client_notice_text(h.starts_at, h.ends_at, _lang),
            'consultant_hold', '/client/tickets/' || r.tid::text);
    _n := _n + 1;
  END LOOP;
  UPDATE public.consultant_holds SET client_notice_at = now() WHERE id = _id;
  RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.hold_notify_clients(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hold_activate(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  h public.consultant_holds;
  _prev text;
  _uid uuid;
  _lang text;
BEGIN
  SELECT * INTO h FROM public.consultant_holds WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR h.status <> 'scheduled' OR h.starts_at > now() OR h.ends_at <= now() THEN RETURN; END IF;
  SELECT c.availability_status::text, c.user_id INTO _prev, _uid FROM public.consultants c WHERE c.id = h.consultant_id FOR UPDATE;
  UPDATE public.consultant_holds
     SET status = 'active', started_at = now(), updated_at = now(),
         prev_status = CASE WHEN _prev = 'on_hold' OR _prev IS NULL THEN COALESCE(prev_status, 'offline') ELSE _prev END
   WHERE id = _id;
  EXECUTE 'UPDATE public.consultants SET availability_status = $1::availability_status WHERE id = $2' USING 'on_hold', h.consultant_id;
  _lang := public.hold_user_lang(_uid);
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_uid,
          CASE WHEN _lang = 'ar' THEN 'بدأ التوقف المؤقت' ELSE 'Your hold has started' END,
          CASE WHEN _lang = 'ar' THEN 'لن تصلك طلبات أو دعوات أو تنبيهات عاجلة جديدة حتى ' || to_char(h.ends_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' (بتوقيت الرياض). يستمر عملك الحالي كما هو.'
               ELSE 'No new requests, invitations or critical alerts until ' || to_char(h.ends_at AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY HH24:MI') || ' (Riyadh time). Your current work continues as agreed.' END,
          'hold_started', '/consultant/profile#availability');
  IF h.client_notice_at IS NULL THEN PERFORM public.hold_notify_clients(_id); END IF;
END
$$;
REVOKE ALL ON FUNCTION public.hold_activate(uuid) FROM PUBLIC, anon, authenticated;

-- Ends an active hold now (or cancels a scheduled one); restores the previous status and sends the "back" notice.
CREATE OR REPLACE FUNCTION public.hold_finish(_id uuid, _why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  h public.consultant_holds;
  _uid uuid;
  _lang text;
BEGIN
  SELECT * INTO h FROM public.consultant_holds WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR h.status NOT IN ('scheduled', 'active') THEN RETURN; END IF;
  IF h.status = 'scheduled' AND h.starts_at > now() THEN
    UPDATE public.consultant_holds SET status = 'cancelled', end_reason = _why, updated_at = now() WHERE id = _id;
    PERFORM public.hold_sync_period(_id);
    RETURN;
  END IF;
  UPDATE public.consultant_holds
     SET status = 'ended', ended_at = now(), ends_at = greatest(starts_at + interval '1 second', least(ends_at, now())),
         end_reason = _why, updated_at = now()
   WHERE id = _id;
  UPDATE public.consultant_unavailable_periods p
     SET ends_at = greatest(p.starts_at + interval '1 second', least(p.ends_at, now())), updated_at = now()
   WHERE p.id = h.unavailable_period_id;
  IF NOT public.consultant_on_hold(h.consultant_id) THEN
    EXECUTE 'UPDATE public.consultants SET availability_status = $1::availability_status WHERE id = $2 AND availability_status::text = ''on_hold'''
      USING COALESCE(NULLIF(h.prev_status, 'on_hold'), 'offline'), h.consultant_id;
  END IF;
  SELECT c.user_id INTO _uid FROM public.consultants c WHERE c.id = h.consultant_id;
  _lang := public.hold_user_lang(_uid);
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_uid,
          CASE WHEN _lang = 'ar' THEN 'مرحبًا بعودتك' ELSE 'Welcome back' END,
          CASE WHEN _lang = 'ar' THEN 'انتهى التوقف المؤقت. يمكنك استقبال الطلبات الجديدة مرة أخرى.' ELSE 'Your hold has ended. You can receive new requests again.' END,
          'hold_ended', '/consultant/profile#availability');
  IF to_regclass('public.availability_email_queue') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.availability_email_queue (consultant_id, user_id, kind) VALUES ($1, $2, ''resumed'')' USING h.consultant_id, _uid;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.hold_finish(uuid, text) FROM PUBLIC, anon, authenticated;

-- Create (or merge into) a hold; activates at once when it starts now.
CREATE OR REPLACE FUNCTION public.hold_create(_cid uuid, _starts timestamptz, _ends timestamptz, _reason text, _actor uuid, _admin boolean, _admin_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  -- A start a few minutes in the past (the dialog was open for a while) counts as now.
  _s timestamptz := greatest(COALESCE(_starts, now()), now());
  _id uuid;
BEGIN
  PERFORM public.hold_validate(COALESCE(_starts, now()), _ends, _reason, true);
  PERFORM 1 FROM public.consultants WHERE id = _cid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultant not found' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.consultant_holds (consultant_id, starts_at, ends_at, reason, set_by, set_by_admin, admin_reason)
  VALUES (_cid, _s, _ends, NULLIF(btrim(COALESCE(_reason, '')), ''), _actor, _admin, _admin_reason)
  RETURNING id INTO _id;
  _id := public.hold_merge(_id);
  PERFORM public.hold_sync_period(_id);
  IF (SELECT starts_at <= now() FROM public.consultant_holds WHERE id = _id) THEN PERFORM public.hold_activate(_id); END IF;
  RETURN _id;
END
$$;
REVOKE ALL ON FUNCTION public.hold_create(uuid, timestamptz, timestamptz, text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_consultant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$ SELECT c.id FROM public.consultants c WHERE c.user_id = auth.uid() LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.my_consultant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_consultant_id() TO authenticated;

-- 3a. Consultant RPCs
CREATE OR REPLACE FUNCTION public.set_my_hold(_starts_at timestamptz, _ends_at timestamptz, _reason text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid := public.my_consultant_id();
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'Consultants only' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('hold:' || auth.uid()::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many changes. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  RETURN public.hold_create(_cid, _starts_at, _ends_at, _reason, auth.uid(), false, NULL);
END
$$;
REVOKE ALL ON FUNCTION public.set_my_hold(timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_hold(timestamptz, timestamptz, text) TO authenticated;

-- Extend or shorten (a new end in the past = resume now).
CREATE OR REPLACE FUNCTION public.change_my_hold(_hold_id uuid, _ends_at timestamptz)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid := public.my_consultant_id();
  h public.consultant_holds;
  _id uuid;
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'Consultants only' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('hold:' || auth.uid()::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many changes. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  SELECT * INTO h FROM public.consultant_holds WHERE id = _hold_id AND consultant_id = _cid AND status IN ('scheduled', 'active') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This hold can no longer be changed' USING ERRCODE = '22023'; END IF;
  IF _ends_at IS NOT NULL AND _ends_at <= now() AND h.status = 'active' THEN
    PERFORM public.hold_finish(h.id, 'resumed');
    RETURN h.id;
  END IF;
  PERFORM public.hold_validate(h.starts_at, _ends_at, NULL, false);
  UPDATE public.consultant_holds SET ends_at = _ends_at, updated_at = now() WHERE id = h.id;
  _id := public.hold_merge(h.id);
  PERFORM public.hold_sync_period(_id);
  RETURN _id;
END
$$;
REVOKE ALL ON FUNCTION public.change_my_hold(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_my_hold(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.resume_my_hold()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid := public.my_consultant_id();
  _id uuid;
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'Consultants only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO _id FROM public.consultant_holds
   WHERE consultant_id = _cid AND status IN ('scheduled', 'active') AND starts_at <= now() AND ends_at > now()
   ORDER BY starts_at LIMIT 1;
  IF _id IS NULL THEN RETURN false; END IF;
  -- A due-but-not-yet-started row is started first, so the restore uses the right previous status.
  PERFORM public.hold_activate(_id);
  PERFORM public.hold_finish(_id, 'resumed');
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.resume_my_hold() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_my_hold() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_hold(_hold_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid := public.my_consultant_id();
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'Consultants only' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultant_holds WHERE id = _hold_id AND consultant_id = _cid AND status = 'scheduled' AND starts_at > now()) THEN
    RAISE EXCEPTION 'Only a hold that has not started yet can be cancelled' USING ERRCODE = '22023';
  END IF;
  PERFORM public.hold_finish(_hold_id, 'cancelled');
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.cancel_my_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_hold(uuid) TO authenticated;

-- 3b. Guards: the status follows the hold; no new work for a consultant on hold.
CREATE OR REPLACE FUNCTION public.guard_hold_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.availability_status IS NOT DISTINCT FROM OLD.availability_status OR NOT public.is_untrusted_writer() THEN RETURN NEW; END IF;
  IF NEW.availability_status::text = 'on_hold' THEN
    RAISE EXCEPTION 'Use "Set on hold" with a start and an end date' USING ERRCODE = '22023';
  END IF;
  IF OLD.availability_status::text = 'on_hold' AND public.consultant_on_hold(NEW.id) THEN
    RAISE EXCEPTION 'You are on hold. Press "Resume now" first.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_guard_hold_status ON public.consultants;
CREATE TRIGGER trg_guard_hold_status
  BEFORE UPDATE OF availability_status ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_hold_status();

CREATE OR REPLACE FUNCTION public.guard_new_work_on_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _until timestamptz;
BEGIN
  SELECT max(h.ends_at) INTO _until FROM public.consultant_holds h
   WHERE h.consultant_id = NEW.consultant_id AND h.status IN ('scheduled', 'active') AND h.starts_at <= now() AND h.ends_at > now();
  IF _until IS NOT NULL THEN
    RAISE EXCEPTION 'This consultant is on hold until % and cannot get new requests', to_char(_until AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY')
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_guard_match_request_hold ON public.ticket_match_requests;
CREATE TRIGGER trg_guard_match_request_hold
  BEFORE INSERT ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_new_work_on_hold();
DROP TRIGGER IF EXISTS trg_guard_team_member_hold ON public.ticket_team_members;
CREATE TRIGGER trg_guard_team_member_hold
  BEFORE INSERT ON public.ticket_team_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_new_work_on_hold();

-- 4. Grace -----------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.availability_grace_deadline_at(_signed_up timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT greatest(COALESCE((SELECT (s.value #>> '{}')::timestamptz FROM public.platform_settings s WHERE s.key = 'availability_grace_started_at'), now()),
                  COALESCE(_signed_up, '-infinity'::timestamptz))
         + make_interval(days => public.avail_setting_int('availability_grace_days', 7, 0, 90))
$$;
REVOKE ALL ON FUNCTION public.availability_grace_deadline_at(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultant_availability_blocked(_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT public.availability_required() AND EXISTS (
    SELECT 1 FROM public.consultants c
     WHERE c.id = _cid AND NOT public.consultant_has_weekly_availability(c.id)
       AND now() >= public.availability_grace_deadline_at(c.created_at))
$$;
REVOKE ALL ON FUNCTION public.consultant_availability_blocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_availability_blocked(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultant_availability_blocked_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN public.availability_required() THEN COALESCE((
    SELECT array_agg(c.id) FROM public.consultants c
     WHERE NOT public.consultant_has_weekly_availability(c.id)
       AND now() >= public.availability_grace_deadline_at(c.created_at)), ARRAY[]::uuid[]) ELSE ARRAY[]::uuid[] END
$$;
REVOKE ALL ON FUNCTION public.consultant_availability_blocked_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_availability_blocked_ids() TO service_role;

-- 4a. Directory, map and matching. Combined rule, kept identical in consultant-location.sql, consultant-policy.sql,
-- user-management.sql and availability-hold.sql (any may be applied last).
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
  -- Missing weekly availability has its own grace rule (consultant_availability_blocked_ids), so it never hides on its own here.
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO _ids
    FROM public.consultants c
   WHERE COALESCE((SELECT enforce FROM public.profile_rules_config WHERE id), false)
     AND cardinality(array_remove(public.consultant_missing_fields(c.id), 'availability')) > 0;
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
  IF to_regprocedure('public.consultant_availability_blocked_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_availability_blocked_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_hold_hidden_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_hold_hidden_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  RETURN ARRAY(SELECT DISTINCT x FROM unnest(_ids) AS x);
END
$function$;

-- 4b. Critical alerts. Combined rule, kept identical in responsiveness.sql, consultant-policy.sql and availability-hold.sql.
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
  IF to_regprocedure('public.consultant_availability_blocked_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_availability_blocked_ids()' INTO _more;
    _skip := _skip || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_on_hold_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_on_hold_ids()' INTO _more;
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

-- 5. Reminders ---------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('first', 'reminder', 'admin')),
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.availability_reminder_log TO authenticated;
GRANT ALL ON public.availability_reminder_log TO service_role;
ALTER TABLE public.availability_reminder_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read availability reminders" ON public.availability_reminder_log;
CREATE POLICY "Admins read availability reminders" ON public.availability_reminder_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS availability_reminder_log_idx ON public.availability_reminder_log (consultant_id, sent_at DESC);

-- E-mails go out through the availability-run function (managed sender, one recipient per mail).
CREATE TABLE IF NOT EXISTS public.availability_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('first', 'admin', 'resumed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text
);
GRANT ALL ON public.availability_email_queue TO service_role;
ALTER TABLE public.availability_email_queue ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS availability_email_queue_pending_idx ON public.availability_email_queue (created_at) WHERE sent_at IS NULL AND failed_at IS NULL;

-- Wakes the sender only while e-mails are waiting (no permanent polling of the function).
CREATE OR REPLACE FUNCTION public.availability_wake()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF to_regnamespace('net') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.availability_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := jsonb_build_object('Content-Type', 'application/json'), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/availability-run';
END
$$;
REVOKE ALL ON FUNCTION public.availability_wake() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.availability_queue_wake_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$ BEGIN PERFORM public.availability_wake(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_availability_queue_wake ON public.availability_email_queue;
CREATE TRIGGER trg_availability_queue_wake
  AFTER INSERT ON public.availability_email_queue
  FOR EACH STATEMENT EXECUTE FUNCTION public.availability_queue_wake_trigger();

CREATE OR REPLACE FUNCTION public.availability_email_claim(_limit int DEFAULT 100)
 RETURNS TABLE (id uuid, consultant_id uuid, user_id uuid, kind text, lang text, display_name text, deadline timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM public.availability_email_queue q
     WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5
       AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '10 minutes')
     ORDER BY q.created_at
     LIMIT greatest(1, least(COALESCE(_limit, 100), 200))
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.availability_email_queue q SET claimed_at = now(), attempts = q.attempts + 1
      FROM picked WHERE q.id = picked.id
    RETURNING q.id, q.consultant_id, q.user_id, q.kind
  )
  SELECT u.id, u.consultant_id, u.user_id, u.kind, public.hold_user_lang(u.user_id),
         (SELECT p.display_name FROM public.profiles p WHERE p.user_id = u.user_id),
         (SELECT public.availability_grace_deadline_at(c.created_at) FROM public.consultants c WHERE c.id = u.consultant_id)
    FROM upd u;
END
$$;
REVOKE ALL ON FUNCTION public.availability_email_claim(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.availability_email_claim(int) TO service_role;

CREATE OR REPLACE FUNCTION public.availability_email_done(_id uuid, _ok boolean, _error text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.availability_email_queue
     SET sent_at = CASE WHEN _ok THEN now() END,
         failed_at = CASE WHEN NOT _ok AND attempts >= 5 THEN now() END,
         claimed_at = CASE WHEN _ok THEN claimed_at END,
         last_error = CASE WHEN _ok THEN NULL ELSE left(_error, 200) END
   WHERE id = _id;
END
$$;
REVOKE ALL ON FUNCTION public.availability_email_done(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.availability_email_done(uuid, boolean, text) TO service_role;

-- Cadence (mirrored by availabilityReminderDue): 'stop' | 'first' | 'wait' | 'due'.
CREATE OR REPLACE FUNCTION public.availability_reminder_due(_cid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _first timestamptz;
  _last timestamptz;
  _n int;
BEGIN
  IF NOT public.availability_required() OR public.consultant_has_weekly_availability(_cid) OR public.consultant_on_hold(_cid) THEN RETURN 'stop'; END IF;
  SELECT min(sent_at) FILTER (WHERE kind = 'first'), max(sent_at), count(*) FILTER (WHERE kind = 'reminder')
    INTO _first, _last, _n
    FROM public.availability_reminder_log WHERE consultant_id = _cid;
  IF _first IS NULL THEN RETURN 'first'; END IF;
  IF now() - _last >= (CASE WHEN _n < 8 THEN interval '44 hours' ELSE interval '164 hours' END) THEN RETURN 'due'; END IF;
  RETURN 'wait';
END
$$;
REVOKE ALL ON FUNCTION public.availability_reminder_due(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.availability_reminder_due(uuid) TO service_role;

-- The one-time urgent notice (essential: never held by a pause). _all = everyone now (used once below);
-- later sign-ups get it 24 h after signing up, from the sweep.
CREATE OR REPLACE FUNCTION public.availability_send_first(_all boolean)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  r record;
  _n int := 0;
  _lang text;
  _deadline timestamptz;
BEGIN
  IF NOT public.availability_required() THEN RETURN 0; END IF;
  FOR r IN
    SELECT c.id, c.user_id, c.created_at FROM public.consultants c
     WHERE NOT public.consultant_has_weekly_availability(c.id)
       AND NOT public.consultant_on_hold(c.id)
       AND (_all OR c.created_at < now() - interval '24 hours')
       AND NOT EXISTS (SELECT 1 FROM public.availability_reminder_log l WHERE l.consultant_id = c.id AND l.kind = 'first')
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until < now()))
     ORDER BY c.created_at
     LIMIT 500
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    _lang := public.hold_user_lang(r.user_id);
    _deadline := public.availability_grace_deadline_at(r.created_at);
    INSERT INTO public.availability_reminder_log (consultant_id, kind) VALUES (r.id, 'first');
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (r.user_id,
            CASE WHEN _lang = 'ar' THEN 'يرجى إضافة توفرك الأسبوعي - مطلوب لاستقبال الطلبات' ELSE 'Please add your weekly availability - needed for requests' END,
            CASE WHEN _lang = 'ar'
              THEN 'يعتمد العملاء والمطابقة على توفرك الأسبوعي. الطلبات التي تصل خارج أوقاتك لا تُحتسب ضدك. أضفه قبل ' || to_char(_deadline AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || ' لتستمر في تلقي الطلبات الجديدة والتنبيهات العاجلة.'
              ELSE 'Clients and matching rely on your weekly availability. Requests outside your hours are not counted against you. Add it by ' || to_char(_deadline AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY') || ' to keep receiving new requests and critical alerts.' END,
            'availability_urgent', '/consultant/profile#availability');
    INSERT INTO public.availability_email_queue (consultant_id, user_id, kind) VALUES (r.id, r.user_id, 'first');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.availability_send_first(boolean) FROM PUBLIC, anon, authenticated;

-- The daily profile reminder carries the "Urgent: weekly availability" block (one mail per day, never two).
-- Same as the live function plus: skipped while on hold; also due when only the availability reminder is due;
-- returns availability_urgent. The return type changes, so the old function is dropped first.
DROP FUNCTION IF EXISTS public.claim_profile_reminders(integer);
CREATE FUNCTION public.claim_profile_reminders(_limit integer DEFAULT 200)
 RETURNS TABLE(consultant_id uuid, user_id uuid, kind text, percent integer, missing text[], interview_done boolean, earned_badge text, payout_ready boolean, lang text, availability_urgent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flag TEXT;
  v_daily_days INT;
BEGIN
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT value #>> '{}' INTO v_flag FROM public.platform_settings WHERE key = 'profile_reminder_emails';
  IF v_flag = 'false' THEN RETURN; END IF;
  SELECT COALESCE(NULLIF(value #>> '{}', '')::INT, 30) INTO v_daily_days FROM public.platform_settings WHERE key = 'profile_reminder_daily_days';
  v_daily_days := COALESCE(LEAST(GREATEST(v_daily_days, 1), 365), 30);
  RETURN QUERY
  WITH locked AS (
    SELECT c.id AS cid, c.user_id AS uid, c.created_at AS signed_up_at,
           (SELECT max(l.sent_at) FROM public.profile_reminder_log l WHERE l.consultant_id = c.id) AS last_sent
    FROM public.consultants c
    WHERE EXTRACT(HOUR FROM now() AT TIME ZONE COALESCE(NULLIF(c.timezone, ''), 'Asia/Riyadh')) = 9
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until < now()))
      AND NOT public.consultant_on_hold(c.id)
    ORDER BY c.created_at
    FOR UPDATE OF c SKIP LOCKED
  ),
  scored AS (SELECT lk.*, public.consultant_completion(lk.cid) AS comp, public.availability_reminder_due(lk.cid) AS avail FROM locked lk),
  due AS (
    SELECT s.*,
      CASE WHEN s.last_sent IS NOT NULL AND now() - s.signed_up_at >= make_interval(days => v_daily_days) THEN 'weekly' ELSE 'daily' END AS due_kind
    FROM scored s
    WHERE (s.last_sent IS NULL OR now() - s.last_sent >= interval '20 hours')
      AND (
        s.avail = 'due'
        OR (NOT ((s.comp ->> 'fields_complete')::BOOLEAN AND (s.comp ->> 'interview_done')::BOOLEAN)
            AND ((s.last_sent IS NULL AND now() - s.signed_up_at >= interval '24 hours')
                 OR (s.last_sent IS NOT NULL
                     AND (now() - s.signed_up_at < make_interval(days => v_daily_days) OR now() - s.last_sent >= interval '7 days'))))
      )
    ORDER BY s.signed_up_at
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 200), 200))
  ),
  claimed AS (
    INSERT INTO public.profile_reminder_log (consultant_id, kind)
    SELECT d.cid, d.due_kind FROM due d
    RETURNING profile_reminder_log.consultant_id AS cid, profile_reminder_log.kind AS ckind
  ),
  avail_logged AS (
    INSERT INTO public.availability_reminder_log (consultant_id, kind)
    SELECT d.cid, 'reminder' FROM due d WHERE d.avail = 'due'
    RETURNING availability_reminder_log.consultant_id
  )
  SELECT d.cid, d.uid, cl.ckind,
         (d.comp ->> 'percent')::INT,
         (SELECT array_agg(x) FROM (SELECT jsonb_array_elements_text(d.comp -> 'missing_items') AS x LIMIT 5) m),
         (d.comp ->> 'interview_done')::BOOLEAN,
         CASE WHEN (d.comp ->> 'interview_done')::BOOLEAN THEN COALESCE(
           (SELECT c2.ai_interview_badge FROM public.consultants c2 WHERE c2.id = d.cid),
           (SELECT CASE WHEN s.overall_score >= 85 THEN 'Gold' WHEN s.overall_score >= 70 THEN 'Silver' WHEN s.overall_score >= 50 THEN 'Bronze' ELSE 'Verified' END
              FROM public.interview_sessions s
             WHERE s.consultant_id = d.cid AND s.interview_type = 'ai' AND s.status IN ('completed', 'reviewed')
             ORDER BY s.completed_at DESC NULLS LAST LIMIT 1)) END,
         (d.comp ->> 'payout_ready')::BOOLEAN,
         CASE WHEN (SELECT pr.preferred_language FROM public.profiles pr WHERE pr.user_id = d.uid) LIKE 'ar%' THEN 'ar' ELSE 'en' END,
         d.avail = 'due'
  FROM due d
  JOIN claimed cl ON cl.cid = d.cid;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_profile_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_profile_reminders(integer) TO service_role;

-- 6. The signed-in consultant's own state ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_availability_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'consultant_id', c.id,
    'required', public.availability_required(),
    'has_weekly', public.consultant_has_weekly_availability(c.id),
    'grace_started_at', (SELECT s.value #>> '{}' FROM public.platform_settings s WHERE s.key = 'availability_grace_started_at'),
    'grace_days', public.avail_setting_int('availability_grace_days', 7, 0, 90),
    'deadline', public.availability_grace_deadline_at(c.created_at),
    'blocked', public.consultant_availability_blocked(c.id),
    'hold_max_days', public.avail_setting_int('hold_max_days', 90, 1, 365),
    'hold_directory', public.hold_directory_mode(),
    'on_hold', public.consultant_on_hold(c.id))
    FROM public.consultants c
   WHERE c.user_id = auth.uid()
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.my_availability_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_availability_status() TO authenticated;

-- 7. Admin tools ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.avail_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$ SELECT COALESCE(public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'), false) $$;
REVOKE ALL ON FUNCTION public.avail_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avail_is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_missing_availability()
 RETURNS TABLE (consultant_id uuid, display_name text, email text, verification_status text, signed_up_at timestamptz,
                days_since_signup int, deadline timestamptz, blocked boolean, on_hold boolean, last_reminded_at timestamptz, reminders int)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.avail_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT c.id, p.display_name, u.email::text, c.verification_status::text, c.created_at,
         floor(extract(epoch FROM now() - c.created_at) / 86400)::int,
         public.availability_grace_deadline_at(c.created_at), public.consultant_availability_blocked(c.id), public.consultant_on_hold(c.id),
         (SELECT max(l.sent_at) FROM public.availability_reminder_log l WHERE l.consultant_id = c.id),
         (SELECT count(*)::int FROM public.availability_reminder_log l WHERE l.consultant_id = c.id)
    FROM public.consultants c
    LEFT JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN auth.users u ON u.id = c.user_id
   WHERE NOT public.consultant_has_weekly_availability(c.id)
   ORDER BY c.created_at;
END
$$;
REVOKE ALL ON FUNCTION public.admin_missing_availability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_missing_availability() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_availability_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.avail_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'consultants', (SELECT count(*) FROM public.consultants),
    'missing', (SELECT count(*) FROM public.consultants c WHERE NOT public.consultant_has_weekly_availability(c.id)),
    'blocked', cardinality(public.consultant_availability_blocked_ids()),
    'on_hold', (SELECT count(DISTINCT h.consultant_id) FROM public.consultant_holds h WHERE h.status IN ('scheduled', 'active') AND h.starts_at <= now() AND h.ends_at > now()),
    'upcoming_holds', (SELECT count(*) FROM public.consultant_holds h WHERE h.status = 'scheduled' AND h.starts_at > now()),
    'reminders_today', (SELECT count(*) FROM public.availability_reminder_log l WHERE l.sent_at >= date_trunc('day', now())),
    'required', public.availability_required(),
    'grace_days', public.avail_setting_int('availability_grace_days', 7, 0, 90),
    'grace_started_at', (SELECT s.value #>> '{}' FROM public.platform_settings s WHERE s.key = 'availability_grace_started_at'),
    'hold_max_days', public.avail_setting_int('hold_max_days', 90, 1, 365),
    'hold_directory', public.hold_directory_mode());
END
$$;
REVOKE ALL ON FUNCTION public.admin_availability_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_availability_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_availability_settings(_grace_days int, _hold_max_days int, _hold_directory text, _required boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _before jsonb;
BEGIN
  IF NOT public.avail_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _grace_days IS NULL OR _grace_days < 0 OR _grace_days > 90 THEN RAISE EXCEPTION 'The grace period must be between 0 and 90 days' USING ERRCODE = '22023'; END IF;
  IF _hold_max_days IS NULL OR _hold_max_days < 1 OR _hold_max_days > 365 THEN RAISE EXCEPTION 'The longest hold must be between 1 and 365 days' USING ERRCODE = '22023'; END IF;
  IF _hold_directory NOT IN ('label', 'hide') THEN RAISE EXCEPTION 'Choose "label" or "hide"' USING ERRCODE = '22023'; END IF;
  IF NOT public.check_rate_limit('availability-settings:' || auth.uid()::text, 30, 3600) THEN
    RAISE EXCEPTION 'Too many changes. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  _before := jsonb_build_object('grace_days', public.avail_setting_int('availability_grace_days', 7, 0, 90),
    'hold_max_days', public.avail_setting_int('hold_max_days', 90, 1, 365), 'hold_directory', public.hold_directory_mode(), 'required', public.availability_required());
  INSERT INTO public.platform_settings (key, value) VALUES
    ('availability_grace_days', to_jsonb(_grace_days)), ('hold_max_days', to_jsonb(_hold_max_days)), ('hold_directory_mode', to_jsonb(_hold_directory))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  IF _required IS NOT NULL AND _required IS DISTINCT FROM public.availability_required() THEN
    INSERT INTO public.profile_field_rules_log (field_key, old_mode, new_mode, changed_by)
    SELECT 'availability', r.mode, CASE WHEN _required THEN 'required' ELSE 'optional' END, auth.uid() FROM public.profile_field_rules r WHERE r.field_key = 'availability';
    UPDATE public.profile_field_rules SET hard_required = _required, mode = CASE WHEN _required THEN 'required' ELSE 'optional' END,
           updated_by = auth.uid(), updated_at = now()
     WHERE field_key = 'availability';
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'availability_settings_changed', 'platform_settings', NULL,
          jsonb_build_object('before', _before, 'after', jsonb_build_object('grace_days', _grace_days, 'hold_max_days', _hold_max_days, 'hold_directory', _hold_directory, 'required', COALESCE(_required, (_before ->> 'required')::boolean))));
END
$$;
REVOKE ALL ON FUNCTION public.admin_set_availability_settings(int, int, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_availability_settings(int, int, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_send_availability_reminder(_ids uuid[])
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _sent int := 0;
  r record;
  _lang text;
BEGIN
  IF NOT public.avail_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _ids IS NULL OR cardinality(_ids) = 0 OR cardinality(_ids) > 50 THEN RAISE EXCEPTION 'Choose between 1 and 50 consultants' USING ERRCODE = '22023'; END IF;
  IF NOT public.check_rate_limit('availability-reminder:' || auth.uid()::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many reminders. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  FOR r IN
    SELECT c.id, c.user_id FROM public.consultants c
     WHERE c.id = ANY(_ids)
       AND NOT public.consultant_has_weekly_availability(c.id)
       AND NOT public.consultant_on_hold(c.id)
       AND NOT EXISTS (SELECT 1 FROM public.availability_reminder_log l WHERE l.consultant_id = c.id AND l.sent_at > now() - interval '24 hours')
  LOOP
    _lang := public.hold_user_lang(r.user_id);
    INSERT INTO public.availability_reminder_log (consultant_id, kind, sent_by) VALUES (r.id, 'admin', auth.uid());
    INSERT INTO public.notifications (user_id, title, body, type, link, pause_category)
    VALUES (r.user_id,
            CASE WHEN _lang = 'ar' THEN 'يرجى إضافة توفرك الأسبوعي - مطلوب لاستقبال الطلبات' ELSE 'Please add your weekly availability - needed for requests' END,
            CASE WHEN _lang = 'ar' THEN 'يعتمد العملاء والمطابقة على توفرك الأسبوعي. يستغرق ذلك دقيقة واحدة.' ELSE 'Clients and matching rely on your weekly availability. It takes a minute.' END,
            'availability_urgent', '/consultant/profile#availability', 'reminders');
    INSERT INTO public.availability_email_queue (consultant_id, user_id, kind) VALUES (r.id, r.user_id, 'admin');
    _sent := _sent + 1;
  END LOOP;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'availability_reminder_sent', 'consultants', NULL, jsonb_build_object('requested', cardinality(_ids), 'sent', _sent, 'ids', to_jsonb(_ids)));
  RETURN _sent;
END
$$;
REVOKE ALL ON FUNCTION public.admin_send_availability_reminder(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_availability_reminder(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_hold(_cid uuid, _starts_at timestamptz, _ends_at timestamptz, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _uid uuid;
BEGIN
  IF NOT public.avail_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Please give a reason (at least 3 characters)' USING ERRCODE = '22023'; END IF;
  IF NOT public.check_rate_limit('admin-hold:' || auth.uid()::text, 30, 3600) THEN
    RAISE EXCEPTION 'Too many changes. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  _id := public.hold_create(_cid, _starts_at, _ends_at, NULL, auth.uid(), true, left(btrim(_reason), 500));
  SELECT user_id INTO _uid FROM public.consultants WHERE id = _cid;
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_uid,
          CASE WHEN public.hold_user_lang(_uid) = 'ar' THEN 'حدد المسؤول حالة التوقف المؤقت' ELSE 'An administrator set you on hold' END,
          CASE WHEN public.hold_user_lang(_uid) = 'ar' THEN 'من ' || to_char(COALESCE(_starts_at, now()) AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || ' إلى ' || to_char(_ends_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || '. يمكنك الاستئناف في أي وقت.'
               ELSE 'From ' || to_char(COALESCE(_starts_at, now()) AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY') || ' to ' || to_char(_ends_at AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY') || '. You can resume at any time.' END,
          'hold_admin', '/consultant/profile#availability');
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'consultant_hold_set', 'consultants', _cid,
          jsonb_build_object('hold_id', _id, 'starts_at', COALESCE(_starts_at, now()), 'ends_at', _ends_at, 'reason', left(btrim(_reason), 500)));
  RETURN _id;
END
$$;
REVOKE ALL ON FUNCTION public.admin_set_hold(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_hold(uuid, timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_hold(_cid uuid, _reason text)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _n int := 0;
  h record;
BEGIN
  IF NOT public.avail_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Please give a reason (at least 3 characters)' USING ERRCODE = '22023'; END IF;
  IF NOT public.check_rate_limit('admin-hold:' || auth.uid()::text, 30, 3600) THEN
    RAISE EXCEPTION 'Too many changes. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  FOR h IN SELECT id, status, starts_at FROM public.consultant_holds WHERE consultant_id = _cid AND status IN ('scheduled', 'active') ORDER BY starts_at LOOP
    IF h.status = 'scheduled' AND h.starts_at <= now() THEN PERFORM public.hold_activate(h.id); END IF;
    PERFORM public.hold_finish(h.id, 'cleared by administrator');
    _n := _n + 1;
  END LOOP;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'consultant_hold_cleared', 'consultants', _cid, jsonb_build_object('holds', _n, 'reason', left(btrim(_reason), 500)));
  RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.admin_clear_hold(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_hold(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_holds()
 RETURNS TABLE (hold_id uuid, consultant_id uuid, display_name text, starts_at timestamptz, ends_at timestamptz, state text,
                reason text, set_by_admin boolean, admin_reason text, client_notice_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.avail_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT h.id, h.consultant_id, p.display_name, h.starts_at, h.ends_at,
         CASE WHEN h.starts_at > now() THEN 'upcoming' ELSE 'current' END,
         h.reason, h.set_by_admin, h.admin_reason, h.client_notice_at
    FROM public.consultant_holds h
    JOIN public.consultants c ON c.id = h.consultant_id
    LEFT JOIN public.profiles p ON p.user_id = c.user_id
   WHERE h.status IN ('scheduled', 'active') AND h.ends_at > now()
   ORDER BY h.starts_at;
END
$$;
REVOKE ALL ON FUNCTION public.admin_holds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_holds() TO authenticated;

-- 8. Weekly digest line for administrators (Monday after 07:00 Riyadh, from the sweep; once per week).
CREATE OR REPLACE FUNCTION public.availability_weekly_digest()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _week timestamptz := date_trunc('week', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh';
  _last timestamptz;
  _missing int; _blocked int; _hold int; _upcoming int;
BEGIN
  IF now() < _week + interval '7 hours' THEN RETURN false; END IF;
  SELECT (value #>> '{}')::timestamptz INTO _last FROM public.platform_settings WHERE key = 'availability_digest_last';
  IF _last IS NOT NULL AND _last >= _week THEN RETURN false; END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('availability_digest_last', to_jsonb(now()))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  SELECT count(*) INTO _missing FROM public.consultants c WHERE NOT public.consultant_has_weekly_availability(c.id);
  _blocked := cardinality(public.consultant_availability_blocked_ids());
  SELECT count(DISTINCT h.consultant_id) INTO _hold FROM public.consultant_holds h WHERE h.status IN ('scheduled', 'active') AND h.starts_at <= now() AND h.ends_at > now();
  SELECT count(*) INTO _upcoming FROM public.consultant_holds h WHERE h.status = 'scheduled' AND h.starts_at > now();
  INSERT INTO public.notifications (user_id, title, body, type, link)
  SELECT DISTINCT ur.user_id, 'Weekly availability summary',
         format('%s consultant(s) without weekly availability (%s left out of new matching after the grace period), %s on hold now, %s hold(s) coming up.', _missing, _blocked, _hold, _upcoming),
         'admin_digest', '/admin/console/availability'
    FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.availability_weekly_digest() FROM PUBLIC, anon, authenticated;

-- 9. The 15-minute sweep (pure SQL, credential-free like the other sweeps) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.availability_hold_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  h record;
  _started int := 0;
  _ended int := 0;
  _first int := 0;
BEGIN
  FOR h IN SELECT id FROM public.consultant_holds WHERE status = 'scheduled' AND starts_at <= now() AND ends_at > now() ORDER BY starts_at LIMIT 500 LOOP
    PERFORM public.hold_activate(h.id); _started := _started + 1;
  END LOOP;
  -- Scheduled holds that started and ended between two runs: started and ended now, so the status and notices stay consistent.
  FOR h IN SELECT id, status FROM public.consultant_holds WHERE status IN ('scheduled', 'active') AND ends_at <= now() ORDER BY ends_at LIMIT 500 LOOP
    IF h.status = 'scheduled' THEN
      UPDATE public.consultant_holds SET status = 'active', started_at = now(), updated_at = now(),
             prev_status = COALESCE((SELECT NULLIF(c.availability_status::text, 'on_hold') FROM public.consultants c WHERE c.id = consultant_holds.consultant_id), 'offline')
       WHERE id = h.id;
    END IF;
    PERFORM public.hold_finish(h.id, 'ended'); _ended := _ended + 1;
  END LOOP;
  _first := public.availability_send_first(false);
  PERFORM public.availability_weekly_digest();
  -- Retries stay armed only while e-mails are waiting.
  PERFORM public.availability_wake();
  RETURN jsonb_build_object('started', _started, 'ended', _ended, 'first_notices', _first);
END
$$;
REVOKE ALL ON FUNCTION public.availability_hold_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.availability_hold_sweep() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'availability-hold-sweep';
SELECT cron.schedule('availability-hold-sweep', '*/15 * * * *', 'SELECT public.availability_hold_sweep()');

-- 10. The urgent notice now, to every consultant without weekly availability (in-app + e-mail; essential, not paused).
SELECT public.availability_send_first(true);
