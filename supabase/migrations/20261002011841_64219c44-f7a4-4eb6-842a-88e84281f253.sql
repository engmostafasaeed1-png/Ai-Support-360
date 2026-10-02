-- Client-cycle hardening M12 (new finding F32 and finding F17):
-- F32: any signed-in user could create a company and add ANY other user to it without that user's consent. Company membership decides who can
--      read the members' names and pictures, which company a new ticket is filed under and (with F17 below) who can read the company's tickets.
--      A membership now counts only after the invited user has accepted it (new column accepted_at; every existing member counts as accepted).
--      A pending invitation is invisible to ordinary queries; the invited user lists and answers invitations through two functions.
-- F17: accepted members of a company can read (not edit) the company's tickets and their documents, assignments, tags, hours, timesheets,
--      bids and match requests.

-- ===== F32: membership needs the member's consent =====
ALTER TABLE public.tenant_members ADD COLUMN accepted_at timestamptz DEFAULT now();

CREATE FUNCTION public.guard_tenant_member_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id = auth.uid() THEN
      NEW.accepted_at := now();
    ELSE
      NEW.accepted_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'A company invitation can only be accepted by the invited user' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_tenant_member_consent() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_tenant_member_consent BEFORE INSERT OR UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_member_consent();

CREATE FUNCTION public.my_company_invitations()
RETURNS TABLE (tenant_id uuid, company_name text, org_role org_role, invited_by uuid, invited_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.tenant_id, t.name, m.org_role, m.invited_by, m.created_at
  FROM public.tenant_members m JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = auth.uid() AND m.accepted_at IS NULL
  ORDER BY m.created_at DESC
$function$;
REVOKE ALL ON FUNCTION public.my_company_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_invitations() TO authenticated;

CREATE FUNCTION public.respond_to_company_invitation(_tenant_id uuid, _accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _accept THEN
    UPDATE public.tenant_members SET accepted_at = now()
    WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND accepted_at IS NULL;
  ELSE
    DELETE FROM public.tenant_members
    WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND accepted_at IS NULL;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation found' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_to_company_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_company_invitation(uuid, boolean) TO authenticated;

-- the four helpers every company policy goes through now ignore pending invitations
CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND accepted_at IS NOT NULL
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _tenant_id uuid, _role org_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND org_role = _role AND accepted_at IS NOT NULL
  )
$function$;

CREATE OR REPLACE FUNCTION public.share_a_company(_user_a uuid, _user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members a JOIN public.tenant_members b ON b.tenant_id = a.tenant_id
                 WHERE a.user_id = _user_a AND b.user_id = _user_b
                   AND a.accepted_at IS NOT NULL AND b.accepted_at IS NOT NULL)
$function$;

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND accepted_at IS NOT NULL ORDER BY created_at LIMIT 1
$function$;

-- ===== F17: colleagues can read the company's tickets =====
CREATE FUNCTION public.ticket_in_my_company(_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = _ticket_id AND t.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), t.tenant_id)
  )
$function$;
REVOKE ALL ON FUNCTION public.ticket_in_my_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_in_my_company(uuid) TO authenticated;

CREATE POLICY "Company members can view the company's tickets" ON public.tickets
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Company members can view the company's ticket documents" ON public.ticket_documents
  FOR SELECT TO authenticated USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Company members can view the company's ticket assignments" ON public.ticket_assignments
  FOR SELECT TO authenticated USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Company members can view the company's ticket tags" ON public.ticket_tags
  FOR SELECT TO authenticated USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Company members can view the company's work logs" ON public.ticket_work_logs
  FOR SELECT TO authenticated USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Company members can view the company's timesheets" ON public.ticket_timesheet_submissions
  FOR SELECT TO authenticated USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Company members can view the company's bids" ON public.proposals
  FOR SELECT TO authenticated USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Company members can view the company's match requests" ON public.ticket_match_requests
  FOR SELECT TO authenticated USING (public.ticket_in_my_company(ticket_id));