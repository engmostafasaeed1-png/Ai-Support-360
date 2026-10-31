-- =====================================================================================================================
-- Demo booked: schedule needed (owner request 2026-10-31). PREPARED, NOT APPLIED: the owner reviews first.
--
-- Reuses the existing demo flow (no second system):
--   demo_requests + submit_demo_request (form) · notify_admins_demo_request (bell, new text) · demo-request-notify
--   (e-mails: confirmation + ONE admin alert, plus the reminder sweep) · admin-confirm-demo-reschedule (admin actions,
--   requester e-mails) · sla_add_business_minutes (the one business-minute clock, probed so file order does not matter).
--
-- Adds:
--   * optional form details (role, phone/WhatsApp, SAP area, site language) written once, right after the booking;
--   * respond-by deadline = created + N business hours (setting, default 1, the promise on the website);
--   * one alert per request (dsa_alert_claim) with duplicate / flood guard;
--   * reminders while still unscheduled after the deadline: once, then daily, at most 2 more (dsa_reminder_claim),
--     stopping by themselves when a time is confirmed (status leaves received / rescheduling);
--   * admin schedule / reschedule / cancel (admin_demo_schedule, admin_demo_cancel) with audit + rate limit;
--   * the requester's page reads the meeting with get_demo_meeting_by_token;
--   * settings: platform_settings 'demo_schedule_alerts' (admin_demo_alert_settings / admin_demo_alert_set_settings);
--   * cron 'demo-schedule-run' every 15 minutes calling demo-request-notify { sweep: true } with job_invoke_headers().
-- Personal data: only what the form collects. No country is asked (the time zone is shown instead).
-- =====================================================================================================================

-- 1. Columns (additive, nullable or defaulted) ---------------------------------------------------------------------
ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS requester_role text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS sap_area text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS respond_by timestamptz,
  ADD COLUMN IF NOT EXISTS alert_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_skip_reason text,
  ADD COLUMN IF NOT EXISTS reminders_sent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_duration_min integer,
  ADD COLUMN IF NOT EXISTS meeting_link text,
  ADD COLUMN IF NOT EXISTS meeting_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demo_requests_details_chk') THEN
    ALTER TABLE public.demo_requests ADD CONSTRAINT demo_requests_details_chk CHECK (
      (requester_role IS NULL OR length(requester_role) <= 80)
      AND (phone IS NULL OR phone ~ '^\+?[0-9][0-9 ()./-]{5,28}$')
      AND (sap_area IS NULL OR length(sap_area) <= 120)
      AND (language IS NULL OR language IN ('en', 'ar'))
      AND (meeting_duration_min IS NULL OR meeting_duration_min BETWEEN 15 AND 240)
      AND (meeting_link IS NULL OR (length(meeting_link) <= 500 AND meeting_link ~ '^https://[^\s/@:]+\.[^\s/@:]+(/\S*)?$'))
      AND (cancel_reason IS NULL OR length(cancel_reason) <= 500)
      AND reminders_sent BETWEEN 0 AND 10);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS demo_requests_reminder_idx ON public.demo_requests (respond_by)
  WHERE status IN ('received', 'rescheduling') AND meeting_at IS NULL;
CREATE INDEX IF NOT EXISTS demo_requests_email_recent_idx ON public.demo_requests (lower(email), created_at);

COMMENT ON COLUMN public.demo_requests.respond_by IS 'Confirm a slot before this (created + respond_business_hours on the demo calendar).';
COMMENT ON COLUMN public.demo_requests.meeting_at IS 'Confirmed demo start (admin_demo_schedule). scheduled_date/slot keep what the requester entered.';

-- 2. Settings -------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
SELECT 'demo_schedule_alerts', jsonb_build_object(
  'enabled', true, 'respond_business_hours', 1, 'admin_timezone', 'Asia/Riyadh', 'admin_language', 'en',
  'daily_reminders_max', 2, 'default_duration_min', 30,
  'calendar', jsonb_build_object('mode', 'business', 'tz', 'Asia/Riyadh', 'days', jsonb_build_array(0, 1, 2, 3, 4),
                                 'start', '08:00', 'end', '18:00', 'holidays', '[]'::jsonb))
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'demo_schedule_alerts');

CREATE OR REPLACE FUNCTION public.dsa_valid_tz(_tz text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT _tz IS NOT NULL AND length(_tz) <= 64 AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _tz)
$$;

-- Stored settings merged over the defaults and clamped (mirror: _shared/demoSchedule.ts readDemoSettings).
CREATE OR REPLACE FUNCTION public.dsa_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb := COALESCE((SELECT value FROM public.platform_settings WHERE key = 'demo_schedule_alerts'), '{}'::jsonb);
  c jsonb := COALESCE(v -> 'calendar', '{}'::jsonb);
  h numeric; r int; d int;
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN v := '{}'::jsonb; END IF;
  IF jsonb_typeof(c) <> 'object' THEN c := '{}'::jsonb; END IF;
  h := CASE WHEN jsonb_typeof(v -> 'respond_business_hours') = 'number' THEN LEAST(72, GREATEST(0.25, (v ->> 'respond_business_hours')::numeric)) ELSE 1 END;
  r := CASE WHEN jsonb_typeof(v -> 'daily_reminders_max') = 'number' THEN LEAST(2, GREATEST(0, round((v ->> 'daily_reminders_max')::numeric)))::int ELSE 2 END;
  d := CASE WHEN jsonb_typeof(v -> 'default_duration_min') = 'number' THEN LEAST(240, GREATEST(15, round((v ->> 'default_duration_min')::numeric)))::int ELSE 30 END;
  RETURN jsonb_build_object(
    'enabled', COALESCE((v ->> 'enabled')::boolean, true),
    'respond_business_hours', h,
    'admin_timezone', CASE WHEN public.dsa_valid_tz(v ->> 'admin_timezone') THEN v ->> 'admin_timezone' ELSE 'Asia/Riyadh' END,
    'admin_language', CASE WHEN v ->> 'admin_language' = 'ar' THEN 'ar' ELSE 'en' END,
    'daily_reminders_max', r,
    'default_duration_min', d,
    'calendar', jsonb_build_object(
      'mode', CASE WHEN c ->> 'mode' = '24x7' THEN '24x7' ELSE 'business' END,
      'tz', CASE WHEN public.dsa_valid_tz(c ->> 'tz') THEN c ->> 'tz' ELSE 'Asia/Riyadh' END,
      'days', CASE WHEN jsonb_typeof(c -> 'days') = 'array' AND jsonb_array_length(c -> 'days') > 0 THEN c -> 'days' ELSE '[0,1,2,3,4]'::jsonb END,
      'start', CASE WHEN c ->> 'start' ~ '^([01]?\d|2[0-3]):[0-5]\d$' THEN c ->> 'start' ELSE '08:00' END,
      'end', CASE WHEN c ->> 'end' ~ '^([01]?\d|2[0-3]):[0-5]\d$' THEN c ->> 'end' ELSE '18:00' END,
      'holidays', CASE WHEN jsonb_typeof(c -> 'holidays') = 'array' THEN c -> 'holidays' ELSE '[]'::jsonb END));
END $$;
REVOKE ALL ON FUNCTION public.dsa_settings() FROM PUBLIC, anon, authenticated;

-- Deadline: N business hours on the demo calendar (the SLA clock when present, else plain hours).
CREATE OR REPLACE FUNCTION public.dsa_respond_by(_from timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.dsa_settings(); m numeric; r timestamptz;
BEGIN
  m := round((s ->> 'respond_business_hours')::numeric * 60);
  IF to_regprocedure('public.sla_add_business_minutes(timestamptz,numeric,jsonb)') IS NOT NULL THEN
    EXECUTE 'SELECT public.sla_add_business_minutes($1, $2, $3)' INTO r USING _from, m, s -> 'calendar';
  END IF;
  RETURN COALESCE(r, _from + make_interval(mins => m::int));
END $$;
REVOKE ALL ON FUNCTION public.dsa_respond_by(timestamptz) FROM PUBLIC, anon, authenticated;

-- 3. Deadline on every new demo (not on website messages) -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dsa_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.source, '') <> 'contact-form' THEN
    NEW.respond_by := public.dsa_respond_by(COALESCE(NEW.created_at, now()));
  END IF;
  NEW.reminders_sent := 0; NEW.alert_sent_at := NULL; NEW.meeting_at := NULL; NEW.meeting_version := 0;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dsa_before_insert ON public.demo_requests;
CREATE TRIGGER trg_dsa_before_insert BEFORE INSERT ON public.demo_requests FOR EACH ROW EXECUTE FUNCTION public.dsa_before_insert();

-- 4. Bell text (the e-mail summary reads the same function, so bell and e-mail say the same) --------------------------
CREATE OR REPLACE FUNCTION public.dsa_bell_text(_r public.demo_requests)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.dsa_settings(); tz text := s ->> 'admin_timezone'; h numeric := (s ->> 'respond_business_hours')::numeric;
  t text;
BEGIN
  t := CASE _r.demo_type WHEN 'live' THEN 'Live platform walkthrough' WHEN 'ai-triage' THEN 'AI triage demo'
         WHEN 'pricing-roi' THEN 'Pricing & ROI call' WHEN 'module-deep-dive' THEN 'Custom module deep-dive' ELSE _r.demo_type END;
  RETURN left(_r.full_name, 80) || COALESCE(' (' || left(_r.company, 80) || ')', '') || ' booked a "' || t || '" demo. '
    || CASE WHEN _r.scheduled_date IS NOT NULL AND _r.scheduled_slot IS NOT NULL
         THEN 'Preferred: ' || to_char(_r.scheduled_date, 'YYYY-MM-DD') || ' ' || _r.scheduled_slot || COALESCE(' (' || _r.timezone || ')', '') || '. '
         ELSE 'No preferred time (' || COALESCE(_r.scheduling_preference, 'flexible') || '). ' END
    || CASE WHEN _r.respond_by IS NOT NULL
         THEN 'Confirm a time by ' || to_char(_r.respond_by AT TIME ZONE tz, 'Dy DD Mon HH24:MI') || ' (' || tz || '), within '
              || trim(to_char(h, 'FM999990.##')) || ' business hour' || CASE WHEN h = 1 THEN '' ELSE 's' END || '.'
         ELSE '' END;
END $$;
REVOKE ALL ON FUNCTION public.dsa_bell_text(public.demo_requests) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_admins_demo_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin uuid; _contact boolean := COALESCE(NEW.source, '') = 'contact-form'; _body text;
BEGIN
  _body := CASE WHEN _contact THEN left(NEW.full_name, 80) || COALESCE(' (' || left(NEW.company, 80) || ')', '') || ' sent a message from the website.'
                ELSE public.dsa_bell_text(NEW) END;
  FOR _admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
    PERFORM public.safe_insert_notification(_admin,
      CASE WHEN _contact THEN 'New website message' ELSE 'Demo booked: schedule needed' END,
      _body, 'demo_request', '/admin/demo-requests?request=' || NEW.id::text);
  END LOOP;
  RETURN NEW;
END $$;

-- 5. Optional details from the form, once, right after the booking --------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_demo_request_details(_token text, _role text, _phone text, _sap_area text, _language text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r text := NULLIF(btrim(COALESCE(_role, '')), ''); p text := NULLIF(btrim(COALESCE(_phone, '')), '');
  a text := NULLIF(btrim(COALESCE(_sap_area, '')), ''); l text := CASE WHEN _language IN ('en', 'ar') THEN _language END; n int;
BEGIN
  IF _token IS NULL OR _token !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE = '22023'; END IF;
  IF length(COALESCE(r, '')) > 80 OR length(COALESCE(a, '')) > 120 THEN RAISE EXCEPTION 'Please shorten your answer' USING ERRCODE = '22023'; END IF;
  IF p IS NOT NULL AND p !~ '^\+?[0-9][0-9 ()./-]{5,28}$' THEN RAISE EXCEPTION 'Please enter a valid phone number' USING ERRCODE = '22023'; END IF;
  IF NOT public.check_rate_limit('demo_details:' || _token, 3, 3600) THEN RAISE EXCEPTION 'Too many requests. Please try again later.' USING ERRCODE = '54000'; END IF;
  UPDATE public.demo_requests
     SET requester_role = r, phone = p, sap_area = a, language = l, updated_at = now()
   WHERE request_token = _token AND status = 'received' AND created_at > now() - interval '15 minutes'
     AND alert_sent_at IS NULL AND requester_role IS NULL AND phone IS NULL AND sap_area IS NULL AND language IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.submit_demo_request_details(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_demo_request_details(text, text, text, text, text) TO anon, authenticated;

-- 6. One alert per request (service only) ---------------------------------------------------------------------------
-- send=false: already sent, switched off, or 3+ open bookings from the same e-mail in 24 hours (flood).
-- duplicate_of: another open booking from the same e-mail in 24 hours (the alert says "possible duplicate").
CREATE OR REPLACE FUNCTION public.dsa_alert_claim(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.demo_requests; s jsonb := public.dsa_settings(); dup uuid; n int;
BEGIN
  SELECT * INTO r FROM public.demo_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('send', false, 'reason', 'not_found'); END IF;
  IF r.alert_sent_at IS NOT NULL THEN RETURN jsonb_build_object('send', false, 'reason', 'already_sent'); END IF;
  IF NOT (s ->> 'enabled')::boolean THEN
    UPDATE public.demo_requests SET alert_sent_at = now(), alert_skip_reason = 'disabled' WHERE id = _id;
    RETURN jsonb_build_object('send', false, 'reason', 'disabled');
  END IF;
  SELECT count(*), (array_agg(id ORDER BY created_at))[1] INTO n, dup FROM public.demo_requests
   WHERE lower(email) = lower(r.email) AND id <> r.id AND created_at > r.created_at - interval '24 hours' AND created_at <= r.created_at
     AND status IN ('received', 'contacted', 'scheduled', 'rescheduling');
  IF n >= 2 THEN
    UPDATE public.demo_requests SET alert_sent_at = now(), alert_skip_reason = 'flood' WHERE id = _id;
    RETURN jsonb_build_object('send', false, 'reason', 'flood');
  END IF;
  UPDATE public.demo_requests SET alert_sent_at = now(), alert_skip_reason = CASE WHEN dup IS NOT NULL THEN 'duplicate_flagged' END WHERE id = _id;
  RETURN jsonb_build_object('send', true, 'duplicate_of', dup,
    'bell_text', CASE WHEN COALESCE(r.source, '') = 'contact-form' THEN NULL ELSE public.dsa_bell_text(r) END);
END $$;
REVOKE ALL ON FUNCTION public.dsa_alert_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dsa_alert_claim(uuid) TO service_role;

-- 7. Reminders (service only): first at the deadline, then one per day, at most daily_reminders_max more.
--    Only demos still unscheduled (status received / rescheduling, no meeting) and at most 14 days past the deadline.
--    The count is taken before sending (at most once; a lost e-mail is followed by the next day's reminder).
CREATE OR REPLACE FUNCTION public.dsa_reminder_claim(_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.dsa_settings(); mx int := 1 + (s ->> 'daily_reminders_max')::int; out jsonb := '[]'::jsonb; r record;
BEGIN
  IF NOT (s ->> 'enabled')::boolean THEN RETURN out; END IF;
  FOR r IN
    SELECT d.id, d.reminders_sent FROM public.demo_requests d
     WHERE d.status IN ('received', 'rescheduling') AND d.meeting_at IS NULL AND COALESCE(d.source, '') <> 'contact-form'
       AND d.respond_by IS NOT NULL AND d.respond_by <= now() AND d.respond_by > now() - interval '14 days'
       AND d.reminders_sent < mx
       AND (d.reminders_sent = 0 OR d.last_reminder_at <= now() - interval '1 day')
     ORDER BY d.respond_by LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.demo_requests SET reminders_sent = reminders_sent + 1, last_reminder_at = now() WHERE id = r.id;
    out := out || jsonb_build_array(jsonb_build_object('id', r.id, 'n', r.reminders_sent + 1));
  END LOOP;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.dsa_reminder_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dsa_reminder_claim(integer) TO service_role;

-- 8. Admin: confirm / move / cancel ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dsa_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
$$;
REVOKE ALL ON FUNCTION public.dsa_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dsa_is_admin() TO authenticated;

-- _date + _time are wall-clock in _tz (the admin picks the zone; default theirs). Returns {kind, version, meeting_at}.
CREATE OR REPLACE FUNCTION public.admin_demo_schedule(_id uuid, _date date, _time text, _tz text, _duration_min integer,
  _meeting_link text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.demo_requests; at timestamptz; k text; link text := NULLIF(btrim(COALESCE(_meeting_link, '')), '');
  note text := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  IF NOT public.dsa_is_admin() THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('demo_schedule:' || auth.uid()::text, 60, 3600) THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000'; END IF;
  IF _date IS NULL OR _time IS NULL OR _time !~ '^([01]?\d|2[0-3]):[0-5]\d$' THEN RAISE EXCEPTION 'Please choose a date and a time' USING ERRCODE = '22023'; END IF;
  IF NOT public.dsa_valid_tz(_tz) THEN RAISE EXCEPTION 'Please choose a valid time zone' USING ERRCODE = '22023'; END IF;
  IF _duration_min IS NULL OR _duration_min NOT BETWEEN 15 AND 240 THEN RAISE EXCEPTION 'Duration must be 15 to 240 minutes' USING ERRCODE = '22023'; END IF;
  IF link IS NOT NULL AND (length(link) > 500 OR link !~ '^https://[^\s/@:]+\.[^\s/@:]+(/\S*)?$') THEN
    RAISE EXCEPTION 'The meeting link must be a full https:// address' USING ERRCODE = '22023'; END IF;
  IF length(COALESCE(note, '')) > 500 THEN RAISE EXCEPTION 'The note is too long' USING ERRCODE = '22023'; END IF;
  at := (_date + _time::time) AT TIME ZONE _tz;
  IF at < now() + interval '5 minutes' THEN RAISE EXCEPTION 'Please choose a time that is still ahead' USING ERRCODE = '22023'; END IF;
  IF at > now() + interval '365 days' THEN RAISE EXCEPTION 'Please choose a date within the next year' USING ERRCODE = '22023'; END IF;

  SELECT * INTO r FROM public.demo_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Demo request not found' USING ERRCODE = 'P0002'; END IF;
  IF r.status NOT IN ('received', 'contacted', 'scheduled', 'rescheduling') THEN
    RAISE EXCEPTION 'This demo is % and cannot be scheduled', r.status USING ERRCODE = '22023'; END IF;
  k := CASE WHEN r.meeting_at IS NOT NULL OR r.status = 'scheduled' THEN 'rescheduled' ELSE 'confirmed' END;
  IF r.meeting_at = at AND r.status = 'scheduled' AND COALESCE(r.meeting_link, '') = COALESCE(link, '') AND r.meeting_duration_min = _duration_min THEN
    RAISE EXCEPTION 'nothing_changed' USING ERRCODE = '22023'; END IF;

  UPDATE public.demo_requests
     SET status = 'scheduled', meeting_at = at, meeting_duration_min = _duration_min, meeting_link = link,
         meeting_version = meeting_version + 1, scheduled_by = auth.uid(), cancel_reason = NULL,
         status_note = COALESCE(note, status_note), updated_at = now()
   WHERE id = _id RETURNING * INTO r;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'demo_' || k, 'demo_request', _id,
          jsonb_build_object('meeting_at', at, 'duration_min', _duration_min, 'tz', _tz, 'has_link', link IS NOT NULL, 'version', r.meeting_version));
  RETURN jsonb_build_object('kind', k, 'version', r.meeting_version, 'meeting_at', at);
END $$;
REVOKE ALL ON FUNCTION public.admin_demo_schedule(uuid, date, text, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_demo_schedule(uuid, date, text, text, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_demo_cancel(_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.demo_requests; why text := NULLIF(btrim(COALESCE(_reason, '')), ''); had boolean;
BEGIN
  IF NOT public.dsa_is_admin() THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('demo_schedule:' || auth.uid()::text, 60, 3600) THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000'; END IF;
  IF length(COALESCE(why, '')) > 500 THEN RAISE EXCEPTION 'The reason is too long' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.demo_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Demo request not found' USING ERRCODE = 'P0002'; END IF;
  IF r.status NOT IN ('received', 'contacted', 'scheduled', 'rescheduling') THEN
    RAISE EXCEPTION 'This demo is already %', r.status USING ERRCODE = '22023'; END IF;
  had := r.meeting_at IS NOT NULL;
  UPDATE public.demo_requests SET status = 'cancelled', cancel_reason = why, meeting_version = meeting_version + 1,
         status_note = COALESCE(why, status_note), updated_at = now()
   WHERE id = _id RETURNING * INTO r;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'demo_cancelled', 'demo_request', _id, jsonb_build_object('had_meeting', had, 'has_reason', why IS NOT NULL, 'version', r.meeting_version));
  RETURN jsonb_build_object('kind', 'cancelled', 'version', r.meeting_version, 'had_meeting', had);
END $$;
REVOKE ALL ON FUNCTION public.admin_demo_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_demo_cancel(uuid, text) TO authenticated;

-- 9. The requester's page (token = the secret link they got) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_demo_meeting_by_token(_token text)
RETURNS TABLE (status text, meeting_at timestamptz, meeting_duration_min integer, meeting_link text, meeting_version integer, timezone text, cancel_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.status, d.meeting_at, d.meeting_duration_min,
         CASE WHEN d.status = 'scheduled' THEN d.meeting_link END, d.meeting_version, d.timezone,
         CASE WHEN d.status = 'cancelled' THEN d.cancel_reason END
    FROM public.demo_requests d
   WHERE _token ~ '^[a-f0-9]{32}$' AND d.request_token = _token
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_demo_meeting_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_demo_meeting_by_token(text) TO anon, authenticated;

-- 10. Admin settings ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_demo_alert_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.dsa_is_admin() THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
  RETURN public.dsa_settings();
END $$;
REVOKE ALL ON FUNCTION public.admin_demo_alert_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_demo_alert_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_demo_alert_set_settings(_enabled boolean, _respond_business_hours numeric,
  _admin_timezone text, _daily_reminders_max integer, _default_duration_min integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before jsonb; v jsonb;
BEGIN
  IF NOT public.dsa_is_admin() THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
  IF _respond_business_hours IS NULL OR _respond_business_hours < 0.25 OR _respond_business_hours > 72 THEN
    RAISE EXCEPTION 'Response time must be 0.25 to 72 business hours' USING ERRCODE = '22023'; END IF;
  IF NOT public.dsa_valid_tz(_admin_timezone) THEN RAISE EXCEPTION 'Please choose a valid time zone' USING ERRCODE = '22023'; END IF;
  IF _daily_reminders_max IS NULL OR _daily_reminders_max NOT BETWEEN 0 AND 2 THEN RAISE EXCEPTION 'Daily reminders must be 0 to 2' USING ERRCODE = '22023'; END IF;
  IF _default_duration_min IS NULL OR _default_duration_min NOT BETWEEN 15 AND 240 THEN RAISE EXCEPTION 'Duration must be 15 to 240 minutes' USING ERRCODE = '22023'; END IF;
  before := public.dsa_settings();
  v := COALESCE((SELECT value FROM public.platform_settings WHERE key = 'demo_schedule_alerts'), '{}'::jsonb)
       || jsonb_build_object('enabled', COALESCE(_enabled, true), 'respond_business_hours', _respond_business_hours,
                             'admin_timezone', _admin_timezone, 'daily_reminders_max', _daily_reminders_max, 'default_duration_min', _default_duration_min);
  INSERT INTO public.platform_settings (key, value) VALUES ('demo_schedule_alerts', v)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'demo_alert_settings', 'platform_setting', NULL, jsonb_build_object('before', before, 'after', public.dsa_settings()));
  RETURN public.dsa_settings();
END $$;
REVOKE ALL ON FUNCTION public.admin_demo_alert_set_settings(boolean, numeric, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_demo_alert_set_settings(boolean, numeric, text, integer, integer) TO authenticated;

-- 11. Reminder sweep every 15 minutes, calling the function only while a reminder is due (job token checked by the
--     function; responses are counts only).
CREATE OR REPLACE FUNCTION public.dsa_reminders_due()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.demo_requests d
    WHERE d.status IN ('received', 'rescheduling') AND d.meeting_at IS NULL AND COALESCE(d.source, '') <> 'contact-form'
      AND d.respond_by IS NOT NULL AND d.respond_by <= now() AND d.respond_by > now() - interval '14 days'
      AND d.reminders_sent < 1 + (public.dsa_settings() ->> 'daily_reminders_max')::int
      AND (d.reminders_sent = 0 OR d.last_reminder_at <= now() - interval '1 day'))
$$;
REVOKE ALL ON FUNCTION public.dsa_reminders_due() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND to_regnamespace('net') IS NOT NULL AND to_regprocedure('public.job_invoke_headers()') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo-schedule-run';
    PERFORM cron.schedule('demo-schedule-run', '*/15 * * * *', $job$
      SELECT net.http_post(
        url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/demo-request-notify',
        headers := public.job_invoke_headers(),
        body := '{"sweep":true}'::jsonb,
        timeout_milliseconds := 10000)
      WHERE public.dsa_reminders_due();
    $job$);
  END IF;
END $$;
