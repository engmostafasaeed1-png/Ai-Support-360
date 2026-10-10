-- ===== M39: a company for every ticket, the NDA that waits for the client, a closed insert door for demo requests (QA defects DEF-005 follow-up, DEF-029, DEF-055, DEF-058) =====

-- DEF-055 / DEF-058: a ticket that is created without a company (AI chat, incident form) gets the company of its client:
-- the first one the client joined or created. Without it the ticket is missing from the ticket list and the dashboard of every company.
CREATE OR REPLACE FUNCTION public.default_ticket_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT tm.tenant_id INTO NEW.tenant_id
      FROM public.tenant_members tm
     WHERE tm.user_id = NEW.client_id
     ORDER BY tm.created_at, tm.tenant_id
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_default_ticket_tenant ON public.tickets;
CREATE TRIGGER trg_default_ticket_tenant
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.default_ticket_tenant();
REVOKE EXECUTE ON FUNCTION public.default_ticket_tenant() FROM PUBLIC, anon, authenticated;

-- the tickets that exist already, then the sessions and notifications that belong to a ticket or a session
UPDATE public.tickets t
   SET tenant_id = f.tenant_id
  FROM (SELECT DISTINCT ON (tm.user_id) tm.user_id, tm.tenant_id
          FROM public.tenant_members tm
         ORDER BY tm.user_id, tm.created_at, tm.tenant_id) f
 WHERE t.tenant_id IS NULL AND t.client_id = f.user_id;

UPDATE public.sessions s
   SET tenant_id = t.tenant_id
  FROM public.tickets t
 WHERE s.tenant_id IS NULL AND s.ticket_id = t.id AND t.tenant_id IS NOT NULL;

UPDATE public.notifications n
   SET tenant_id = x.tenant_id
  FROM (
    SELECT n2.id,
           COALESCE(
             (SELECT t.tenant_id FROM public.tickets t
               WHERE t.id::text = lower(substring(n2.link from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'))),
             (SELECT s.tenant_id FROM public.sessions s
               WHERE s.id::text = lower(substring(n2.link from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')))
           ) AS tenant_id
      FROM public.notifications n2
     WHERE n2.tenant_id IS NULL AND n2.link IS NOT NULL
  ) x
 WHERE n.id = x.id AND x.tenant_id IS NOT NULL;

-- DEF-029: since both signatures are needed, a consultant who signed but whose client has not countersigned yet is still waiting:
-- the list keeps the item and says what it waits for (the old list dropped it as soon as the consultant had signed, while the access stayed closed)
DROP FUNCTION IF EXISTS public.my_nda_pending_access();
CREATE OR REPLACE FUNCTION public.my_nda_pending_access()
 RETURNS TABLE(kind text, ref_id uuid, client_id uuid, client_name text, detail text, since timestamp with time zone, waiting_for_client boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT c.id FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified'
  )
  SELECT 'share'::text, s.id, s.client_id, COALESCE(p.display_name, 'A client'), s.tool_type, s.shared_at,
         EXISTS (SELECT 1 FROM public.nda_agreements n
                  WHERE n.consultant_id = s.consultant_id AND n.client_id = s.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NULL)
  FROM public.shared_remote_configs s
  JOIN me ON me.id = s.consultant_id
  LEFT JOIN public.profiles p ON p.user_id = s.client_id
  WHERE s.status IS DISTINCT FROM 'revoked'
    AND public.share_in_validity_period(s.config)
    AND NOT EXISTS (SELECT 1 FROM public.nda_agreements n
                     WHERE n.consultant_id = s.consultant_id AND n.client_id = s.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NOT NULL)
  UNION ALL
  SELECT 'environment'::text, re.id, re.client_id, COALESCE(p.display_name, 'A client'), re.status::text, re.created_at,
         EXISTS (SELECT 1 FROM public.nda_agreements n
                  WHERE n.consultant_id = me.id AND n.client_id = re.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NULL)
  FROM public.remote_environments re
  JOIN me ON (re.consultant_id = me.id OR EXISTS (SELECT 1 FROM public.environment_consultants ec WHERE ec.environment_id = re.id AND ec.consultant_id = me.id))
  LEFT JOIN public.profiles p ON p.user_id = re.client_id
  WHERE re.status::text <> 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM public.nda_agreements n
                     WHERE n.consultant_id = me.id AND n.client_id = re.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NOT NULL)
$function$;
REVOKE EXECUTE ON FUNCTION public.my_nda_pending_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_nda_pending_access() TO authenticated;

-- DEF-012 follow-up: a demo request is only made through submit_demo_request (it checks the slot, limits the number of requests and notifies the team);
-- the table itself no longer accepts a direct insert from a visitor
DROP POLICY IF EXISTS "Anyone can submit a demo request" ON public.demo_requests;