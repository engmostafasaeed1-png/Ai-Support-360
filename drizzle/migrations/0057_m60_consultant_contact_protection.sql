-- M60: contact details of a consultant stay inside the portal until the consultant is assigned to a ticket of the client.
--  1. helper functions: who is "assigned", who is "engaged" (bid or accepted a match request)
--  2. a client can no longer put an arbitrary consultant on a ticket or on its team
--  3. a session (booking) needs a ticket with that consultant assigned
--  4. the contact columns of consultants (LinkedIn, GitHub, website, video, Credly) are no longer readable through the table API
--     (nor through realtime); the consultant, the admins and the clients of an assigned consultant read them through a view
--  5. the emergency contact never gives the phone of a consultant who is not assigned to the ticket
--  6. e-mail addresses, phone numbers and web links are rejected in bio, cover letters and work history

-- 1 ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultant_assigned_to_ticket(_ticket_id uuid, _consultant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT _ticket_id IS NOT NULL AND _consultant_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.consultant_id = _consultant_id)
    OR EXISTS (SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = _ticket_id AND a.consultant_id = _consultant_id AND a.status = 'active')
  )
$function$;

CREATE OR REPLACE FUNCTION public.consultant_assigned_to_client(_consultant_id uuid, _client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT _consultant_id IS NOT NULL AND _client_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.client_id = _client_id AND t.consultant_id = _consultant_id)
    OR EXISTS (SELECT 1 FROM public.ticket_assignments a JOIN public.tickets t ON t.id = a.ticket_id
               WHERE t.client_id = _client_id AND a.consultant_id = _consultant_id AND a.status = 'active')
  )
$function$;

CREATE OR REPLACE FUNCTION public.consultant_engaged_on_ticket(_ticket_id uuid, _consultant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (SELECT 1 FROM public.proposals p WHERE p.ticket_id = _ticket_id AND p.consultant_id = _consultant_id)
      OR EXISTS (SELECT 1 FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket_id AND m.consultant_id = _consultant_id AND m.status::text = 'accepted')
$function$;

REVOKE ALL ON FUNCTION public.consultant_assigned_to_ticket(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultant_assigned_to_client(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultant_engaged_on_ticket(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_assigned_to_ticket(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_assigned_to_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_engaged_on_ticket(uuid, uuid) TO authenticated;

-- 2 ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_ticket_consultant_engaged()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() OR NEW.consultant_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.consultant_id IS NOT DISTINCT FROM OLD.consultant_id THEN
    RETURN NEW;
  END IF;
  IF NOT public.consultant_engaged_on_ticket(NEW.id, NEW.consultant_id) THEN
    RAISE EXCEPTION 'A consultant can be assigned only after the consultant replied to the request' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_ticket_consultant_engaged ON public.tickets;
CREATE TRIGGER trg_guard_ticket_consultant_engaged
  BEFORE INSERT OR UPDATE OF consultant_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_consultant_engaged();

CREATE OR REPLACE FUNCTION public.guard_assignment_consultant_engaged()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() OR NEW.status::text <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.consultant_id IS NOT DISTINCT FROM OLD.consultant_id AND OLD.status::text = 'active' THEN
    RETURN NEW;
  END IF;
  IF NOT public.consultant_engaged_on_ticket(NEW.ticket_id, NEW.consultant_id) THEN
    RAISE EXCEPTION 'A consultant can be added to the team only after the consultant replied to the request' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_assignment_consultant_engaged ON public.ticket_assignments;
CREATE TRIGGER trg_guard_assignment_consultant_engaged
  BEFORE INSERT OR UPDATE ON public.ticket_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_consultant_engaged();

-- 3 ---------------------------------------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can create sessions with a real engagement" ON public.sessions;
CREATE POLICY "Sessions only on a ticket with the assigned consultant" ON public.sessions
  FOR INSERT
  WITH CHECK (
    ticket_id IS NOT NULL
    AND public.consultant_assigned_to_ticket(ticket_id, consultant_id)
    AND (
      (auth.uid() = client_id AND public.ticket_owned_by(ticket_id, auth.uid())
        AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id)))
      OR
      (EXISTS (SELECT 1 FROM public.consultants c
                WHERE c.id = sessions.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified'::verification_status)
        AND public.ticket_owned_by(ticket_id, client_id))
    )
  );

-- 4 ---------------------------------------------------------------------------------------------------------------------------------------------
REVOKE SELECT ON public.consultants FROM anon, authenticated;
GRANT SELECT (id, user_id, bio, hourly_rate, currency, timezone, languages, industries, verification_status, rating, total_reviews,
              response_time_minutes, availability_status, ai_skills_score, created_at, updated_at, location, city, country,
              credibility_credits, ai_interview_completed_at, ai_interview_badge, latitude, longitude, linkedin_checked_at,
              credly_checked_at, sap_role, seniority_level, total_sap_years, sap_technologies, localization_countries,
              project_types, sap_roles, profile_visible, show_availability, new_case_alerts)
  ON public.consultants TO anon, authenticated;

-- realtime sends whole rows to every subscriber who may see the row: publish the same columns only
ALTER PUBLICATION supabase_realtime DROP TABLE public.consultants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.consultants
  (id, user_id, bio, hourly_rate, currency, timezone, languages, industries, verification_status, rating, total_reviews,
   response_time_minutes, availability_status, ai_skills_score, created_at, updated_at, location, city, country,
   credibility_credits, ai_interview_completed_at, ai_interview_badge, latitude, longitude, linkedin_checked_at,
   credly_checked_at, sap_role, seniority_level, total_sap_years, sap_technologies, localization_countries,
   project_types, sap_roles, profile_visible, show_availability, new_case_alerts);

CREATE OR REPLACE VIEW public.consultant_contact_links AS
  SELECT c.id AS consultant_id, c.user_id, c.linkedin_url, c.github_url, c.personal_website, c.profile_video_url, c.credly_username
    FROM public.consultants c
   WHERE c.user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR (c.verification_status = 'verified'::verification_status AND public.consultant_assigned_to_client(c.id, auth.uid()));
REVOKE ALL ON public.consultant_contact_links FROM PUBLIC, anon;
GRANT SELECT ON public.consultant_contact_links TO authenticated;

-- 5 ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_emergency_contact(_ticket_id uuid)
RETURNS TABLE(display_name text, phone text, hourly_rate numeric, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _t public.tickets;
BEGIN
  SELECT * INTO _t FROM public.tickets t
   WHERE t.id = _ticket_id AND t.client_id = auth.uid() AND t.urgency::text IN ('high', 'critical');
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- only the consultant assigned to this ticket; before that, the administrator of the platform
  IF _t.consultant_id IS NOT NULL THEN
    RETURN QUERY
      SELECT p.display_name, p.phone, c.hourly_rate, 'assigned_consultant'::text
        FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id
       WHERE c.id = _t.consultant_id;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.display_name, p.phone, NULL::numeric, 'administrator'::text
      FROM public.user_roles ur JOIN public.profiles p ON p.user_id = ur.user_id
     WHERE ur.role = 'admin'::app_role
     ORDER BY (p.phone IS NOT NULL AND btrim(p.phone) <> '') DESC, ur.created_at
     LIMIT 1;
END;
$function$;

-- 6 ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_details_in_text(_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $function$
  SELECT _text IS NOT NULL AND (
       _text ~* '[a-z0-9._%+-]+\s?(@|\[at\]|\(at\))\s?[a-z0-9-]+(\.|\s?\[dot\]\s?)[a-z]{2,}'
    OR _text ~* '(https?://|www\.)[^\s]+'
    OR _text ~* '\m[a-z0-9-]+\.(com|net|org|io|me|co|app|dev|ai|info|biz|sa|ae|eg)(/|\M)'
    OR _text ~* '\m(whats\s?app|telegram|skype|viber|wechat|signal app|t\.me)\M'
    OR _text ~ '(\+|\m00)\d[\d\s().-]{7,}\d'
    OR _text ~ '\m\d{9,}\M'
    OR _text ~ '\m\d{3}[\s.-]\d{3,4}[\s.-]\d{4}\M'
    OR _text ~ '\m\d{2,4}[\s.-]\d{7,8}\M'
  )
$function$;

CREATE OR REPLACE FUNCTION public.guard_no_contact_details()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE
  _new text := to_jsonb(NEW) ->> TG_ARGV[0];
  _old text;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    _old := to_jsonb(OLD) ->> TG_ARGV[0];
    IF _old IS NOT DISTINCT FROM _new THEN
      RETURN NEW;
    END IF;
  END IF;
  IF public.contact_details_in_text(_new) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_no_contact_bio ON public.consultants;
CREATE TRIGGER trg_guard_no_contact_bio BEFORE INSERT OR UPDATE OF bio ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_contact_details('bio');
DROP TRIGGER IF EXISTS trg_guard_no_contact_cover ON public.proposals;
CREATE TRIGGER trg_guard_no_contact_cover BEFORE INSERT OR UPDATE OF cover_letter ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_contact_details('cover_letter');
DROP TRIGGER IF EXISTS trg_guard_no_contact_work ON public.consultant_work_history;
CREATE TRIGGER trg_guard_no_contact_work BEFORE INSERT OR UPDATE OF description ON public.consultant_work_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_contact_details('description');
DROP TRIGGER IF EXISTS trg_guard_no_contact_projects ON public.consultant_projects;
CREATE TRIGGER trg_guard_no_contact_projects BEFORE INSERT OR UPDATE OF description ON public.consultant_projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_contact_details('description');

REVOKE ALL ON FUNCTION public.contact_details_in_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_details_in_text(text) TO authenticated;