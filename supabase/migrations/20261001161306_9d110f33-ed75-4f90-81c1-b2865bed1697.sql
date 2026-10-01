-- Client-cycle hardening M5 (findings F04, F09, F23, F28 and the emergency button):
-- a name / photo directory for the people you work with, a real public view of certifications, anonymous-safe reviews,
-- server-side emergency alert + audit logging + plan submission, interview type and proposed times kept in the database.
-- Everything here is ADDITIVE: no existing policy is removed, the screens switch over in a later front-end change.

-- ---------------------------------------------------------------------------------------------
-- F04: directory of display names and avatars (never phone / language / referral code)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.users_visible_to_each_other(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    _a = _b
    OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = _b AND c.verification_status = 'verified')
    OR public.users_share_engagement(_a, _b)
    OR public.share_a_company(_a, _b)
    OR EXISTS (SELECT 1 FROM public.ticket_match_requests m
               JOIN public.tickets t ON t.id = m.ticket_id JOIN public.consultants c ON c.id = m.consultant_id
               WHERE m.status IN ('pending', 'accepted')
                 AND ((t.client_id = _a AND c.user_id = _b) OR (t.client_id = _b AND c.user_id = _a)))
    OR EXISTS (SELECT 1 FROM public.proposals pr
               JOIN public.tickets t ON t.id = pr.ticket_id JOIN public.consultants c ON c.id = pr.consultant_id
               WHERE (t.client_id = _a AND c.user_id = _b) OR (t.client_id = _b AND c.user_id = _a))
    OR EXISTS (SELECT 1 FROM public.ticket_interviews i JOIN public.consultants c ON c.id = i.consultant_id
               WHERE (i.client_id = _a AND c.user_id = _b) OR (i.client_id = _b AND c.user_id = _a))
    OR EXISTS (SELECT 1 FROM public.shared_remote_configs r JOIN public.consultants c ON c.id = r.consultant_id
               WHERE (r.client_id = _a AND c.user_id = _b) OR (r.client_id = _b AND c.user_id = _a))
    OR EXISTS (SELECT 1 FROM public.referrals rf
               WHERE (rf.referrer_id = _a AND rf.referred_user_id = _b) OR (rf.referrer_id = _b AND rf.referred_user_id = _a))
$function$;
REVOKE ALL ON FUNCTION public.users_visible_to_each_other(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_visible_to_each_other(uuid, uuid) TO authenticated;

CREATE OR REPLACE VIEW public.profile_directory WITH (security_invoker = false) AS
SELECT p.user_id, p.display_name, p.avatar_url
FROM public.profiles p
WHERE public.has_role(auth.uid(), 'admin'::app_role)
   OR public.has_role(auth.uid(), 'super_admin'::app_role)
   OR public.users_visible_to_each_other(auth.uid(), p.user_id);
REVOKE ALL ON public.profile_directory FROM PUBLIC, anon;
GRANT SELECT ON public.profile_directory TO authenticated;

-- certifications of consultants you are allowed to see (verified ones) - the old view returned nothing to clients
CREATE OR REPLACE VIEW public.certifications_public WITH (security_invoker = false) AS
SELECT c.id, c.consultant_id, c.name, c.issuer, c.issue_date, c.expiry_date, c.verified, c.created_at
FROM public.certifications c
WHERE public.consultant_profile_visible(c.consultant_id);
ALTER VIEW public.certifications_public SET (security_invoker = false);
REVOKE ALL ON public.certifications_public FROM PUBLIC, anon;
GRANT SELECT ON public.certifications_public TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- F09: reviews of a consultant. Verified consultants' reviews are readable by signed-in users;
-- the reviewer is shown only to themselves, and to the consultant when the review is not anonymous.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.consultant_reviews WITH (security_invoker = false) AS
SELECT
  r.id, r.session_id, r.consultant_id, r.score, r.comment, r.created_at, r.is_anonymous,
  r.communication_score, r.technical_expertise_score, r.responsiveness_score,
  CASE
    WHEN r.client_id = auth.uid() THEN r.client_id
    WHEN NOT COALESCE(r.is_anonymous, false)
         AND EXISTS (SELECT 1 FROM public.consultants me WHERE me.id = r.consultant_id AND me.user_id = auth.uid()) THEN r.client_id
    WHEN public.has_role(auth.uid(), 'admin'::app_role) THEN r.client_id
    ELSE NULL
  END AS client_id
FROM public.ratings r
WHERE r.client_id = auth.uid()
   OR public.has_role(auth.uid(), 'admin'::app_role)
   OR public.consultant_profile_visible(r.consultant_id);
REVOKE ALL ON public.consultant_reviews FROM PUBLIC, anon;
GRANT SELECT ON public.consultant_reviews TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Emergency button: the alert is created on the server, for the ticket's own consultant (and the admins)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_emergency_alert(_ticket_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _cons_user uuid;
  _admin record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT t.id, t.title, t.client_id, t.consultant_id, t.urgency INTO _t
  FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501';
  END IF;
  IF _t.consultant_id IS NULL THEN
    RAISE EXCEPTION 'No consultant is assigned to this ticket yet' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('emergency-alert:' || auth.uid()::text, 5, 3600) THEN
    RAISE EXCEPTION 'Too many alerts in the last hour; please wait or call the consultant' USING ERRCODE = '54000';
  END IF;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _t.consultant_id;
  IF _cons_user IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Emergency contact',
      'The client urgently needs to reach you regarding "' || _t.title || '". Please respond immediately.',
      'ticket', '/consultant/cases/' || _t.id);
  END IF;
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin.user_id, 'Emergency alert on a ticket',
      'A client sent an emergency alert for "' || _t.title || '".', 'ticket', '/admin/tickets');
  END LOOP;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, metadata)
  VALUES ('emergency_contact.portal_notification', 'ticket', _t.id, auth.uid(),
          jsonb_build_object('consultant_id', _t.consultant_id, 'urgency', _t.urgency::text));
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.send_emergency_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_emergency_alert(uuid) TO authenticated;

-- the consultant's phone, only to the client of an urgent (high / critical) ticket the consultant works on
CREATE OR REPLACE FUNCTION public.get_emergency_contact(_ticket_id uuid)
RETURNS TABLE (display_name text, phone text, hourly_rate numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.display_name, p.phone, c.hourly_rate
  FROM public.tickets t
  JOIN public.consultants c ON c.id = t.consultant_id
  LEFT JOIN public.profiles p ON p.user_id = c.user_id
  WHERE t.id = _ticket_id AND t.client_id = auth.uid() AND t.urgency::text IN ('high', 'critical')
$function$;
REVOKE ALL ON FUNCTION public.get_emergency_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_emergency_contact(uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- F23: audit entries from the signed-in browser (the table itself stays admin-only)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_client_event(_action text, _metadata jsonb DEFAULT '{}'::jsonb, _entity_type text DEFAULT NULL, _entity_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _action IS NULL OR _action !~ '^[a-z_]+(\.[a-z_]+)?$' OR length(_action) > 60 THEN
    RAISE EXCEPTION 'Invalid audit action' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(_metadata::text, '')) > 2000 THEN
    RAISE EXCEPTION 'Audit details are too long' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('audit-event:' || auth.uid()::text, 120, 3600) THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, metadata)
  VALUES (_action, COALESCE(left(_entity_type, 60), split_part(_action, '_', 1)), _entity_id, auth.uid(), COALESCE(_metadata, '{}'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.log_client_event(text, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_client_event(text, jsonb, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- F28: the consultant submits a cost / effort plan for the client to approve (the client already has the approve / reject buttons)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_ticket_plan(_ticket_id uuid, _planned_hours numeric, _planned_cost numeric, _cost_currency text DEFAULT 'USD', _breakdown jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _planned_hours IS NULL OR _planned_hours <= 0 OR _planned_hours > 10000 OR _planned_cost IS NULL OR _planned_cost < 0 OR _planned_cost > 100000000 THEN
    RAISE EXCEPTION 'Please enter a valid number of hours and a valid cost' USING ERRCODE = '22023';
  END IF;
  SELECT t.id INTO _t
  FROM public.tickets t
  JOIN public.consultants c ON c.id = t.consultant_id
  WHERE t.id = _ticket_id AND c.user_id = auth.uid() AND c.verification_status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the consultant assigned to this ticket can submit a plan' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tickets SET
    planned_hours = _planned_hours,
    planned_cost = _planned_cost,
    cost_currency = COALESCE(NULLIF(btrim(_cost_currency), ''), 'USD'),
    cost_breakdown = _breakdown,
    plan_submitted_at = now(),
    plan_approved_at = NULL,
    plan_approved_by = NULL,
    plan_rejected_at = NULL,
    plan_rejection_reason = NULL
  WHERE id = _ticket_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_ticket_plan(uuid, numeric, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_ticket_plan(uuid, numeric, numeric, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Interview request: keep the type and the proposed times in the database and tell the admins from here
-- (the screen used to try to notify the admins from the browser, which is not allowed)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.ticket_interviews ADD COLUMN IF NOT EXISTS interview_type text NOT NULL DEFAULT 'ai';
ALTER TABLE public.ticket_interviews ADD COLUMN IF NOT EXISTS proposed_slots jsonb;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_interviews_interview_type_check') THEN
    ALTER TABLE public.ticket_interviews ADD CONSTRAINT ticket_interviews_interview_type_check CHECK (interview_type IN ('ai', 'physical', 'online'));
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.notify_admins_interview_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _admin record;
  _slots text;
  _title text;
BEGIN
  IF NEW.interview_type = 'ai' THEN
    RETURN NEW;
  END IF;
  SELECT t.title INTO _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
  SELECT string_agg(COALESCE(s ->> 'date', '?') || ' ' || COALESCE(s ->> 'start_time', '') || '-' || COALESCE(s ->> 'end_time', ''), ', ')
    INTO _slots
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.proposed_slots) = 'array' THEN NEW.proposed_slots ELSE '[]'::jsonb END) AS s;
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin.user_id,
      CASE WHEN NEW.interview_type = 'physical' THEN 'Physical Interview Request' ELSE 'Online Interview Request' END,
      'A client requested a ' || NEW.interview_type || ' interview for "' || COALESCE(_title, 'a ticket') || '".'
        || CASE WHEN _slots IS NOT NULL THEN ' Proposed times: ' || _slots ELSE '' END,
      'interview', '/admin/tickets');
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_admins_interview_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_admins_interview_request ON public.ticket_interviews;
CREATE TRIGGER trg_notify_admins_interview_request AFTER INSERT ON public.ticket_interviews
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_interview_request();