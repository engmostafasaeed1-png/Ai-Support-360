-- Phase 0 (client-cycle findings F27, F01, F03): stop publishing client tickets, and shrink who can read open tickets / watch tickets.

-- F27a: a resolved or closed ticket may create a DRAFT playbook for an administrator to review; it is never published automatically,
-- and a playbook an administrator has already published is never overwritten with raw ticket text.
CREATE OR REPLACE FUNCTION public.auto_create_playbook_from_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _active boolean;
BEGIN
  IF (NEW.status IN ('closed', 'resolved')) AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT is_active INTO _active FROM public.playbooks WHERE source_ticket_id = NEW.id LIMIT 1;
    IF FOUND THEN
      IF NOT COALESCE(_active, false) THEN
        UPDATE public.playbooks SET
          title = 'Resolution: ' || NEW.title,
          description = COALESCE(NEW.resolution_notes, NEW.description),
          sap_module = NEW.sap_module,
          category = COALESCE(NEW.ticket_type, 'standard'),
          steps = jsonb_build_array(
            jsonb_build_object('title', 'Problem Description', 'description', COALESCE(NEW.description, 'N/A')),
            jsonb_build_object('title', 'Resolution', 'description', COALESCE(NEW.resolution_notes, 'No resolution notes provided'))
          ),
          updated_at = now()
        WHERE source_ticket_id = NEW.id AND is_active = false;
      END IF;
    ELSE
      INSERT INTO public.playbooks (title, description, category, sap_module, steps, is_active, source_ticket_id, tenant_id)
      VALUES (
        'Resolution: ' || NEW.title,
        COALESCE(NEW.resolution_notes, NEW.description),
        COALESCE(NEW.ticket_type, 'standard'),
        NEW.sap_module,
        jsonb_build_array(
          jsonb_build_object('title', 'Problem Description', 'description', COALESCE(NEW.description, 'N/A')),
          jsonb_build_object('title', 'Resolution', 'description', COALESCE(NEW.resolution_notes, 'No resolution notes provided'))
        ),
        false,
        NEW.id,
        NEW.tenant_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- F27b: a playbook that came from a ticket is only readable by people who can see that ticket (administrators keep their own policy).
DROP POLICY IF EXISTS "Active playbooks visible to authenticated" ON public.playbooks;
CREATE POLICY "Active playbooks visible to authenticated" ON public.playbooks
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (source_ticket_id IS NULL OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = playbooks.source_ticket_id))
  );

-- F01: only VERIFIED consultants can read tickets that are open for bidding.
DROP POLICY IF EXISTS "Consultants can view open tickets for bidding" ON public.tickets;
CREATE POLICY "Consultants can view open tickets for bidding" ON public.tickets
  FOR SELECT TO authenticated
  USING (
    consultant_id IS NULL
    AND status = ANY (ARRAY['new'::ticket_status, 'under_review'::ticket_status])
    AND has_role(auth.uid(), 'consultant'::app_role)
    AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified')
  );

DROP POLICY IF EXISTS "Consultants can view open-for-bids tickets" ON public.tickets;
CREATE POLICY "Consultants can view open-for-bids tickets" ON public.tickets
  FOR SELECT TO authenticated
  USING (
    open_for_bids = true
    AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified')
  );

-- F03: you can only watch a ticket you can already see (the tickets policies above decide that).
DROP POLICY IF EXISTS "Users can manage own watches" ON public.ticket_watchers;
CREATE POLICY "Users can view own watches" ON public.ticket_watchers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can stop own watches" ON public.ticket_watchers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can watch tickets they can see" ON public.ticket_watchers
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_watchers.ticket_id));