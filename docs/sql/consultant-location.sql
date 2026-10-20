-- Fix K: consultant location is mandatory (country + city), independent of the global enforcement switch.
-- NOT APPLIED by the agent: review and apply it yourself (after docs/sql/interview-completion.sql).
-- Additive and idempotent. No consultant row is changed or deleted; no existing column is dropped or retyped.
--
-- What it does
--   1. profile_field_rules.hard_required (country, city = true): admins can no longer make them optional/hidden.
--   2. Setting "location_rules" = { grace_days: 7, grace_started_at: <the moment you apply this file> }.
--      Deadline per consultant = later of (grace start, sign-up) + grace_days.
--   3. After the deadline a consultant without country AND city:
--        - is hidden from the directory, the map and matching (hidden_consultant_ids, which all of them already use),
--        - cannot place a NEW bid (existing bid guard),
--        - cannot accept an invitation (new guard on ticket_match_requests).
--      Declining, editing the profile and existing work are never blocked.
--   4. my_location_status()                  - the consultant's own deadline (used by the banner and prompt).
--   5. admin_missing_location()             - admin list "Who is missing location" (with e-mail for the CSV).
--      admin_set_location_grace(days)       - admin-editable grace days (0-90).
--      admin_send_location_reminder(ids)    - in-app reminder now; at most once per consultant per 24 h,
--                                             50 consultants per click, 10 clicks per hour per admin.
--   The daily reminder e-mail already lists missing items from consultant_completion(), which now includes
--   "Location (country and city)" (see interview-completion.sql).
--
-- Performance: every check is a primary-key lookup on consultants plus one platform_settings row.

-- 1. Hard-required rule ---------------------------------------------------------------------------------------
ALTER TABLE public.profile_field_rules ADD COLUMN IF NOT EXISTS hard_required BOOLEAN NOT NULL DEFAULT false;
UPDATE public.profile_field_rules SET hard_required = true, mode = 'required'
 WHERE field_key IN ('country', 'city') AND (hard_required IS DISTINCT FROM true OR mode <> 'required');

-- Admin rules editor: refuse to make a hard-required field optional or hidden.
CREATE OR REPLACE FUNCTION public.admin_set_profile_field_rules(_rules jsonb, _enforce boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _item jsonb;
  _old text;
  _hard boolean;
  _mode text;
  _key text;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF _rules IS NULL OR jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) > 100 THEN
    RAISE EXCEPTION 'The rules are not valid' USING ERRCODE = '22023';
  END IF;
  FOR _item IN SELECT * FROM jsonb_array_elements(_rules) LOOP
    _key := _item ->> 'field_key';
    _mode := _item ->> 'mode';
    IF _mode NOT IN ('required', 'optional', 'hidden') THEN
      RAISE EXCEPTION 'The mode must be required, optional or hidden' USING ERRCODE = '22023';
    END IF;
    SELECT mode, hard_required INTO _old, _hard FROM public.profile_field_rules WHERE field_key = _key FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown profile field %', _key USING ERRCODE = '22023';
    END IF;
    IF _hard AND _mode <> 'required' THEN
      RAISE EXCEPTION 'The field % is always required', _key USING ERRCODE = '22023';
    END IF;
    IF _old IS DISTINCT FROM _mode THEN
      UPDATE public.profile_field_rules SET mode = _mode, updated_by = auth.uid(), updated_at = now() WHERE field_key = _key;
      INSERT INTO public.profile_field_rules_log (field_key, old_mode, new_mode, changed_by) VALUES (_key, _old, _mode, auth.uid());
    END IF;
  END LOOP;
  IF _enforce IS NOT NULL THEN
    UPDATE public.profile_rules_config SET enforce = _enforce, updated_by = auth.uid(), updated_at = now() WHERE id AND enforce IS DISTINCT FROM _enforce;
  END IF;
END
$function$;

-- 2. Grace setting (inserted once; "counted from today" = the moment this file is applied) -------------------
INSERT INTO public.platform_settings (key, value)
VALUES ('location_rules', jsonb_build_object('grace_days', 7, 'grace_started_at', to_jsonb(now())))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.location_grace_deadline(_cid uuid)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT greatest((s.value ->> 'grace_started_at')::timestamptz, c.created_at)
         + make_interval(days => least(90, greatest(0, COALESCE((s.value ->> 'grace_days')::int, 7))))
    FROM public.consultants c
    JOIN public.platform_settings s ON s.key = 'location_rules'
   WHERE c.id = _cid
$$;
REVOKE ALL ON FUNCTION public.location_grace_deadline(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.consultant_location_blocked(_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultants c
     WHERE c.id = _cid
       AND (NULLIF(btrim(COALESCE(c.country, '')), '') IS NULL OR NULLIF(btrim(COALESCE(c.city, '')), '') IS NULL)
       AND now() >= COALESCE(public.location_grace_deadline(c.id), 'infinity'::timestamptz)
  )
$$;
REVOKE ALL ON FUNCTION public.consultant_location_blocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_location_blocked(uuid) TO authenticated, service_role;

-- 3a. Hidden from directory, map and matching (existing rule kept; location rule added, independent of "enforce").
CREATE OR REPLACE FUNCTION public.hidden_consultant_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[])
    FROM public.consultants c
   WHERE auth.uid() IS NOT NULL
     AND (
       (COALESCE((SELECT enforce FROM public.profile_rules_config WHERE id), false)
        AND cardinality(public.consultant_missing_fields(c.id)) > 0)
       OR public.consultant_location_blocked(c.id)
     )
$function$;

-- 3b. New bids: the existing guard, with a clear location message first.
CREATE OR REPLACE FUNCTION public.guard_bid_profile_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN RETURN NEW; END IF;
  IF public.consultant_location_blocked(NEW.consultant_id)
     AND NOT EXISTS (SELECT 1 FROM public.proposals p WHERE p.ticket_id = NEW.ticket_id AND p.consultant_id = NEW.consultant_id) THEN
    RAISE EXCEPTION 'Add your country and city to your profile before placing a new bid' USING ERRCODE = '22023';
  END IF;
  IF public.new_bid_blocked_by_profile(NEW.consultant_id, NEW.ticket_id) THEN
    RAISE EXCEPTION 'Please complete your profile before placing a new bid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;

-- 3c. Accepting an invitation (declining stays allowed).
CREATE OR REPLACE FUNCTION public.guard_match_accept_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted'
     AND public.is_untrusted_writer()
     AND public.consultant_location_blocked(NEW.consultant_id) THEN
    RAISE EXCEPTION 'Add your country and city to your profile before accepting an invitation' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_guard_match_accept_location ON public.ticket_match_requests;
CREATE TRIGGER trg_guard_match_accept_location
  BEFORE UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_match_accept_location();

-- 4. The signed-in consultant's own status ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_location_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'grace_started_at', s.value ->> 'grace_started_at',
           'grace_days', COALESCE((s.value ->> 'grace_days')::int, 7),
           'deadline', public.location_grace_deadline(c.id),
           'blocked', public.consultant_location_blocked(c.id))
    FROM public.consultants c
    JOIN public.platform_settings s ON s.key = 'location_rules'
   WHERE c.user_id = auth.uid()
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.my_location_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_location_status() TO authenticated;

-- 5. Admin tools ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.location_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.location_reminder_log TO authenticated;
GRANT ALL ON public.location_reminder_log TO service_role;
ALTER TABLE public.location_reminder_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read location reminders" ON public.location_reminder_log;
CREATE POLICY "Admins read location reminders" ON public.location_reminder_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS location_reminder_log_consultant_idx ON public.location_reminder_log (consultant_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.admin_missing_location()
 RETURNS TABLE (consultant_id uuid, display_name text, email text, verification_status text, signed_up_at timestamptz,
                country text, city text, deadline timestamptz, blocked boolean, last_reminded_at timestamptz)
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
         c.country, c.city, public.location_grace_deadline(c.id), public.consultant_location_blocked(c.id),
         (SELECT max(l.sent_at) FROM public.location_reminder_log l WHERE l.consultant_id = c.id)
    FROM public.consultants c
    LEFT JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN auth.users u ON u.id = c.user_id
   WHERE NULLIF(btrim(COALESCE(c.country, '')), '') IS NULL OR NULLIF(btrim(COALESCE(c.city, '')), '') IS NULL
   ORDER BY c.created_at;
END
$$;
REVOKE ALL ON FUNCTION public.admin_missing_location() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_missing_location() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_location_grace(_days int)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF _days IS NULL OR _days < 0 OR _days > 90 THEN
    RAISE EXCEPTION 'The grace period must be between 0 and 90 days' USING ERRCODE = '22023';
  END IF;
  UPDATE public.platform_settings
     SET value = jsonb_set(value, '{grace_days}', to_jsonb(_days)), updated_at = now()
   WHERE key = 'location_rules';
END
$$;
REVOKE ALL ON FUNCTION public.admin_set_location_grace(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_location_grace(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_send_location_reminder(_ids uuid[])
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _sent int := 0;
  _row record;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF _ids IS NULL OR cardinality(_ids) = 0 OR cardinality(_ids) > 50 THEN
    RAISE EXCEPTION 'Choose between 1 and 50 consultants' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('location-reminder:' || auth.uid()::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many reminders. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  FOR _row IN
    SELECT c.id, c.user_id FROM public.consultants c
     WHERE c.id = ANY(_ids)
       AND (NULLIF(btrim(COALESCE(c.country, '')), '') IS NULL OR NULLIF(btrim(COALESCE(c.city, '')), '') IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.location_reminder_log l WHERE l.consultant_id = c.id AND l.sent_at > now() - interval '24 hours')
  LOOP
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (_row.user_id, 'Add your location',
            'Add your country and city - needed to appear in search and on the map.',
            'profile_reminder', '/consultant/profile#profile-details');
    INSERT INTO public.location_reminder_log (consultant_id, sent_by) VALUES (_row.id, auth.uid());
    _sent := _sent + 1;
  END LOOP;
  RETURN _sent;
END
$$;
REVOKE ALL ON FUNCTION public.admin_send_location_reminder(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_location_reminder(uuid[]) TO authenticated;
