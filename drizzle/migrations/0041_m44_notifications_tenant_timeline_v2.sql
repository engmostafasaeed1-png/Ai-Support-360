-- M44: notices carry the company of their ticket; the ticket timeline says who did what

-- 1) A notice about a ticket carries the company of the ticket (before, an administrator notice and
--    the "resolved" / "consultant assigned" / "match" notices belonged to no company and showed in every company).
CREATE OR REPLACE FUNCTION public.notify_admins_new_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _admin RECORD;
BEGIN
  FOR _admin IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      _admin.user_id,
      'New Ticket Submitted',
      'A new ticket "' || NEW.title || '" (' || NEW.sap_module || ') has been submitted.',
      'ticket',
      '/admin/tickets',
      NEW.tenant_id
    );
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_ticket_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'resolved' AND (OLD.status IS DISTINCT FROM 'resolved') THEN
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      NEW.client_id,
      'Ticket Resolved',
      'Your ticket "' || NEW.title || '" has been resolved.',
      'ticket',
      '/client/tickets',
      NEW.tenant_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_ticket_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
BEGIN
  IF NEW.consultant_id IS NOT NULL AND (OLD.consultant_id IS DISTINCT FROM NEW.consultant_id) THEN
    -- Notify the client
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      NEW.client_id,
      'Consultant Assigned',
      'A consultant has been matched to your ticket "' || NEW.title || '".',
      'ticket',
      '/client/tickets',
      NEW.tenant_id
    );
    -- Look up consultant user_id
    SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
    IF _consultant_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (
        _consultant_user_id,
        'New Ticket Assignment',
        'You have been assigned to ticket "' || NEW.title || '" (' || NEW.sap_module || ').',
        'ticket',
        '/consultant/cases',
        NEW.tenant_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_match_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_id uuid;
  _ticket_title text;
  _tenant uuid;
  _consultant_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT t.client_id, t.title, t.tenant_id INTO _client_id, _ticket_title, _tenant FROM public.tickets t WHERE t.id = NEW.ticket_id;
    SELECT p.display_name INTO _consultant_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = NEW.consultant_id;
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      _client_id,
      'Consultant Accepted Match',
      'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" accepted the match for "' || COALESCE(_ticket_title, 'your ticket') || '". You can now choose them.',
      'match_request',
      '/client/tickets',
      _tenant
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_match_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
  _ticket_title text;
  _tenant uuid;
BEGIN
  SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
  SELECT title, tenant_id INTO _ticket_title, _tenant FROM public.tickets WHERE id = NEW.ticket_id;
  IF _consultant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      _consultant_user_id,
      'New Ticket Match Request',
      'You have been matched to ticket "' || COALESCE(_ticket_title, 'Untitled') || '". Review and respond.',
      'match_request',
      '/consultant/requests',
      _tenant
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_payment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      NEW.client_id,
      'Payment Confirmed',
      'Your payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || ' (invoice ' || COALESCE(NEW.invoice_number, NEW.reference, '') || ') was confirmed.',
      'payment',
      '/client/payments',
      NEW.tenant_id
    );
    SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
    IF _consultant_user_id IS NOT NULL AND NEW.kind = 'invoice' THEN
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (
        _consultant_user_id,
        'Client payment received',
        CASE WHEN NEW.pricing_model = 'v2'
          THEN 'The platform received the client''s payment for invoice ' || COALESCE(NEW.invoice_number, NEW.reference, '') || '. Your fee of ' || NEW.base_amount || ' ' || COALESCE(NEW.currency, 'USD') || ' is prepared for payout by the administrator.'
          ELSE 'The platform received the client''s payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || '. Your payout, after the platform commission, is prepared by the administrator.'
        END,
        'payment',
        '/consultant/earnings',
        NEW.tenant_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Existing notices about a ticket get the company of that ticket (only when the title belongs to one company)
UPDATE public.notifications n
   SET tenant_id = x.tenant_id
  FROM (
    SELECT t.title, (array_agg(DISTINCT t.tenant_id))[1] AS tenant_id
      FROM public.tickets t
     WHERE t.tenant_id IS NOT NULL
     GROUP BY t.title
    HAVING count(DISTINCT t.tenant_id) = 1
  ) x
 WHERE n.tenant_id IS NULL
   AND n.type IN ('ticket', 'match_request')
   AND position('"' || x.title || '"' IN COALESCE(n.body, '')) > 0;

-- 2b) Older client notices that belong to no company (they are written before the person had a second company)
--     belong to the first company of that person.
UPDATE public.notifications n
   SET tenant_id = f.first_tenant
  FROM (
    SELECT m.user_id,
           (array_agg(m.tenant_id ORDER BY m.created_at))[1] AS first_tenant,
           (array_agg(m.created_at ORDER BY m.created_at))[2] AS second_at
      FROM public.tenant_members m
     GROUP BY m.user_id
    HAVING count(*) > 1
  ) f
 WHERE n.tenant_id IS NULL
   AND n.user_id = f.user_id
   AND COALESCE(n.link, '') LIKE '/client/%'
   AND n.created_at < f.second_at;

-- 3) The ticket timeline names who did each thing and covers documents, hourly rates and timesheets.
--    (ticket_timeline stays as it is; the screens use this version.)
CREATE OR REPLACE FUNCTION public.ticket_timeline_v2(_ticket_id uuid)
 RETURNS TABLE(event_at timestamptz, kind text, title text, detail text, actor_name text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t public.tickets;
  _money boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO _t FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT (_t.client_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'super_admin'::app_role)
          OR public.ticket_consultant_for_me(_ticket_id) IS NOT NULL
          OR public.is_ticket_participant(_ticket_id)) THEN
    RETURN;
  END IF;
  -- rates and timesheets are only for the client, the consultant of the ticket and administrators
  _money := _t.client_id = auth.uid()
            OR public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'super_admin'::app_role)
            OR public.ticket_consultant_for_me(_ticket_id) IS NOT NULL;
  RETURN QUERY
  SELECT x.event_at, x.kind, x.title, x.detail,
         COALESCE((SELECT p.display_name FROM public.profiles p WHERE p.user_id = x.actor_id LIMIT 1), x.actor_text) AS actor_name
    FROM (
      SELECT _t.created_at AS event_at, 'created'::text AS kind, 'Ticket created'::text AS title, NULL::text AS detail,
             _t.client_id AS actor_id, NULL::text AS actor_text
      UNION ALL
      SELECT a.created_at, 'status', 'Status changed to ' || replace(a.metadata #>> '{new,status}', '_', ' '),
             CASE WHEN a.metadata #>> '{old,status}' IS NOT NULL THEN 'Before: ' || replace(a.metadata #>> '{old,status}', '_', ' ') END,
             a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,status}' IS NOT NULL
         AND a.metadata #>> '{new,status}' IS DISTINCT FROM a.metadata #>> '{old,status}'
      UNION ALL
      SELECT a.created_at, 'assignment',
             CASE WHEN a.metadata #>> '{new,consultant_id}' IS NULL THEN 'Consultant removed from the ticket' ELSE 'Consultant assigned' END,
             (SELECT pp.display_name FROM public.consultants cc JOIN public.profiles pp ON pp.user_id = cc.user_id WHERE cc.id::text = a.metadata #>> '{new,consultant_id}'),
             a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND (a.metadata -> 'new') ? 'consultant_id'
         AND a.metadata #>> '{new,consultant_id}' IS DISTINCT FROM a.metadata #>> '{old,consultant_id}'
      UNION ALL
      SELECT a.created_at, 'urgency', 'Urgency changed to ' || (a.metadata #>> '{new,urgency}'),
             CASE WHEN a.metadata #>> '{old,urgency}' IS NOT NULL THEN 'Before: ' || (a.metadata #>> '{old,urgency}') END,
             a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,urgency}' IS NOT NULL
         AND a.metadata #>> '{new,urgency}' IS DISTINCT FROM a.metadata #>> '{old,urgency}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan submitted for approval', NULL, a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_submitted_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_submitted_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_submitted_at}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan approved', NULL, a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_approved_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_approved_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_approved_at}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan rejected', a.metadata #>> '{new,plan_rejection_reason}', a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_rejected_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_rejected_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_rejected_at}'
      UNION ALL
      SELECT m.created_at, 'match', 'A consultant was asked to take this ticket',
             (SELECT pp.display_name FROM public.consultants cc JOIN public.profiles pp ON pp.user_id = cc.user_id WHERE cc.id = m.consultant_id),
             m.sent_by, NULL
        FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket_id
      UNION ALL
      SELECT m.responded_at, 'match',
             CASE WHEN m.status::text = 'accepted' THEN 'A consultant accepted the match request' ELSE 'A consultant answered the match request (' || replace(m.status::text, '_', ' ') || ')' END,
             NULL,
             (SELECT cc.user_id FROM public.consultants cc WHERE cc.id = m.consultant_id), NULL
        FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket_id AND m.responded_at IS NOT NULL
      UNION ALL
      SELECT d.created_at, 'document', 'Document uploaded: ' || d.file_name, 'Version ' || COALESCE(d.version, 1)::text, d.uploaded_by, NULL
        FROM public.ticket_documents d WHERE d.ticket_id = _ticket_id
      UNION ALL
      SELECT r.created_at, 'rate', 'Hourly rate proposed: ' || to_char(r.hourly_rate, 'FM999999990.00') || ' ' || COALESCE(r.currency, 'USD'), NULL, r.proposed_by, NULL
        FROM public.ticket_rates r WHERE _money AND r.ticket_id = _ticket_id
      UNION ALL
      SELECT r.decided_at, 'rate',
             CASE WHEN r.status = 'approved' THEN 'Hourly rate approved: ' ELSE 'Hourly rate declined: ' END || to_char(r.hourly_rate, 'FM999999990.00') || ' ' || COALESCE(r.currency, 'USD'),
             r.decision_note, r.decided_by, NULL
        FROM public.ticket_rates r WHERE _money AND r.ticket_id = _ticket_id AND r.decided_at IS NOT NULL AND r.status IN ('approved', 'rejected')
      UNION ALL
      SELECT s.created_at, 'timesheet', 'Timesheet submitted',
             to_char(COALESCE(s.total_hours, 0), 'FM990.00') || ' h logged, ' || to_char(COALESCE(s.billable_hours, 0), 'FM990.00') || ' h billable',
             s.submitted_by, NULL
        FROM public.ticket_timesheet_submissions s WHERE _money AND s.ticket_id = _ticket_id
      UNION ALL
      SELECT c.created_at, 'timesheet',
             CASE c.kind WHEN 'change_request' THEN 'Changes requested on the timesheet' WHEN 'resubmitted' THEN 'Timesheet sent again' ELSE 'Comment on the timesheet' END,
             left(c.body, 200), c.author_id, NULL
        FROM public.ticket_timesheet_comments c
        JOIN public.ticket_timesheet_submissions s ON s.id = c.submission_id
       WHERE _money AND s.ticket_id = _ticket_id
      UNION ALL
      SELECT s.signed_at, 'timesheet', 'Timesheet approved', NULL, NULL, s.signed_by_name
        FROM public.ticket_timesheet_submissions s WHERE _money AND s.ticket_id = _ticket_id AND s.signed_at IS NOT NULL
    ) x
   WHERE x.event_at IS NOT NULL
   ORDER BY x.event_at DESC, (x.title <> 'Timesheet submitted') DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.ticket_timeline_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_timeline_v2(uuid) TO authenticated, service_role;