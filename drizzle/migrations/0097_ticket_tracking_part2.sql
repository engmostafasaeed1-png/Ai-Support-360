-- ------------------------------------------------------------------ read RPCs (browser)

-- Tracking of one ticket for the signed-in person: role, settings, facts, working status history, allowed statuses.
CREATE OR REPLACE FUNCTION public.tt_ticket_tracking(_ticket uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _role text; s jsonb := public.tt_settings(); _allowed jsonb;
BEGIN
  _role := public.tt_viewer_role(_ticket, _uid);
  IF _role IS NULL THEN RETURN jsonb_build_object('enabled', COALESCE((s ->> 'enabled')::boolean, false), 'role', NULL); END IF;
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) AND _role <> 'admin' THEN
    RETURN jsonb_build_object('enabled', false, 'role', _role);
  END IF;
  SELECT COALESCE(jsonb_agg(x ->> 'key' ORDER BY (x ->> 'order')::int), '[]'::jsonb) INTO _allowed
    FROM jsonb_array_elements(s -> 'statuses') x
   WHERE COALESCE((x ->> 'enabled')::boolean, true)
     AND (_role = 'admin' OR (_role IN ('client', 'consultant') AND COALESCE((s -> 'matrix' -> (x ->> 'key') ->> _role)::boolean, false)));
  RETURN jsonb_build_object(
    'enabled', COALESCE((s ->> 'enabled')::boolean, false),
    'role', _role,
    'settings', s,
    'facts', public.tt_facts(_ticket),
    'allowed', _allowed,
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', e.created_at, 'from', e.from_key, 'to', e.to_key, 'by', e.actor_role,
                         'note', e.note, 'expected_date', e.expected_date, 'responsible', e.responsible, 'backfill', e.backfill) ORDER BY e.created_at)
                         FROM (SELECT * FROM public.ticket_working_status_events e2 WHERE e2.ticket_id = _ticket ORDER BY e2.created_at DESC LIMIT 300) e), '[]'::jsonb));
END
$$;
REVOKE ALL ON FUNCTION public.tt_ticket_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_ticket_tracking(uuid) TO authenticated;

-- Facts for the tickets of a list (at most 200), only those the caller may read; nothing while the feature is off
-- (except for admins).
CREATE OR REPLACE FUNCTION public.tt_list_facts(_tickets uuid[])
 RETURNS TABLE(ticket_id uuid, role text, facts jsonb) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE _uid uuid := auth.uid(); _on boolean := COALESCE((public.tt_settings() ->> 'enabled')::boolean, false); _id uuid; _r text;
BEGIN
  IF _uid IS NULL OR _tickets IS NULL THEN RETURN; END IF;
  IF NOT _on AND NOT public.tt_is_admin(_uid) THEN RETURN; END IF;
  FOREACH _id IN ARRAY _tickets[1:200] LOOP
    _r := public.tt_viewer_role(_id, _uid);
    IF _r IS NOT NULL THEN
      ticket_id := _id; role := _r; facts := public.tt_facts(_id);
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.tt_list_facts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_list_facts(uuid[]) TO authenticated;

-- The unified timeline (newest first, max 500): system events from existing tables, manual working status changes,
-- and comment milestones (message counts per day and side - never message text). Consultants see only their own
-- bids, rates, match requests, team steps, confirmations and timesheets, so a team member never sees a competitor.
CREATE OR REPLACE FUNCTION public.tt_timeline(_ticket uuid)
 RETURNS TABLE(event_at timestamptz, source text, kind text, actor_role text, params jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _uid uuid := auth.uid(); _role text; t public.tickets; _me uuid; _gated boolean; _full boolean;
BEGIN
  _role := public.tt_viewer_role(_ticket, _uid);
  IF _role IS NULL THEN RETURN; END IF;
  IF NOT COALESCE((public.tt_settings() ->> 'enabled')::boolean, false) AND _role <> 'admin' THEN RETURN; END IF;
  SELECT * INTO t FROM public.tickets WHERE id = _ticket;
  SELECT c.id INTO _me FROM public.consultants c WHERE c.user_id = _uid LIMIT 1;
  _gated := COALESCE(public.team_ticket_gated(_ticket), false);
  _full := _role IN ('client', 'admin');
  RETURN QUERY
  SELECT x.event_at, x.source, x.kind, x.actor_role, x.params FROM (
    SELECT t.created_at AS event_at, 'system'::text AS source, 'created'::text AS kind, 'client'::text AS actor_role, '{}'::jsonb AS params
    UNION ALL
    SELECT a.created_at, 'system', 'status', public.tt_actor_role(_ticket, a.user_id),
           jsonb_build_object('from', a.metadata #>> '{old,status}', 'to', a.metadata #>> '{new,status}')
      FROM public.audit_logs a
     WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
       AND a.metadata #>> '{new,status}' IS NOT NULL AND a.metadata #>> '{new,status}' IS DISTINCT FROM a.metadata #>> '{old,status}'
    UNION ALL
    SELECT a.created_at, 'system', CASE WHEN a.metadata #>> '{new,consultant_id}' IS NULL THEN 'consultant_removed' ELSE 'consultant_assigned' END,
           public.tt_actor_role(_ticket, a.user_id), '{}'::jsonb
      FROM public.audit_logs a
     WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
       AND (a.metadata -> 'new') ? 'consultant_id' AND a.metadata #>> '{new,consultant_id}' IS DISTINCT FROM a.metadata #>> '{old,consultant_id}'
    UNION ALL
    SELECT a.created_at, 'system', 'sla_breached', 'system', '{}'::jsonb
      FROM public.audit_logs a
     WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
       AND a.metadata #>> '{new,sla_breached}' = 'true' AND a.metadata #>> '{old,sla_breached}' IS DISTINCT FROM 'true'
    UNION ALL SELECT t.plan_submitted_at, 'system', 'plan_submitted', 'consultant', '{}'::jsonb
    UNION ALL SELECT t.plan_approved_at, 'system', 'plan_approved', 'client', '{}'::jsonb
    UNION ALL SELECT t.plan_rejected_at, 'system', 'plan_rejected', 'client', '{}'::jsonb
    UNION ALL SELECT t.critical_first_reply_at, 'system', 'critical_reply', 'consultant', '{}'::jsonb
    UNION ALL SELECT t.close_outcome_at, 'system', 'outcome', public.tt_actor_role(_ticket, t.close_outcome_by), jsonb_build_object('outcome', t.close_outcome)
    UNION ALL
    SELECT m.created_at, 'system', 'match_sent', 'client', '{}'::jsonb FROM public.ticket_match_requests m
     WHERE m.ticket_id = _ticket AND (_full OR m.consultant_id = _me)
    UNION ALL
    SELECT m.responded_at, 'system', 'match_answered', 'consultant', jsonb_build_object('status', m.status::text) FROM public.ticket_match_requests m
     WHERE m.ticket_id = _ticket AND (_full OR m.consultant_id = _me)
    UNION ALL
    SELECT p.created_at, 'system', 'bid_received', 'consultant', '{}'::jsonb FROM public.proposals p
     WHERE p.ticket_id = _ticket AND (_full OR p.consultant_id = _me)
    UNION ALL
    SELECT e.created_at, 'system', 'team_step', e.actor_role, jsonb_build_object('from', e.from_status, 'to', e.to_status)
      FROM public.ticket_team_member_events e WHERE e.ticket_id = _ticket AND (_full OR e.consultant_id = _me)
    UNION ALL
    SELECT r.created_at, 'system', 'rate_proposed', 'consultant', '{}'::jsonb FROM public.ticket_rates r
     WHERE r.ticket_id = _ticket AND (_full OR r.consultant_id = _me)
    UNION ALL
    SELECT r.decided_at, 'system', 'rate_decided', public.tt_actor_role(_ticket, r.decided_by), jsonb_build_object('status', r.status)
      FROM public.ticket_rates r WHERE r.ticket_id = _ticket AND r.status <> 'proposed' AND (_full OR r.consultant_id = _me)
    UNION ALL
    SELECT n.signed_at, 'system', 'nda_consultant_signed', 'consultant', '{}'::jsonb FROM public.nda_agreements n
     WHERE NOT _gated AND n.consultant_id = t.consultant_id AND n.client_id = t.client_id
    UNION ALL
    SELECT n.client_signed_at, 'system', 'nda_client_signed', 'client', '{}'::jsonb FROM public.nda_agreements n
     WHERE NOT _gated AND n.consultant_id = t.consultant_id AND n.client_id = t.client_id
    UNION ALL
    SELECT c.consultant_confirmed_at, 'system', 'engagement_confirmed', 'consultant', '{}'::jsonb FROM public.engagement_confirmations c
     WHERE c.ticket_id = _ticket AND (_full OR c.consultant_id = _me)
    UNION ALL
    SELECT c.client_confirmed_at, 'system', 'engagement_confirmed', 'client', '{}'::jsonb FROM public.engagement_confirmations c
     WHERE c.ticket_id = _ticket AND (_full OR c.consultant_id = _me)
    UNION ALL
    SELECT d.created_at, 'system', CASE WHEN d.file_name ILIKE 'BRD\_%' THEN 'brd_attached' ELSE 'document_added' END,
           public.tt_actor_role(_ticket, d.uploaded_by),
           jsonb_build_object('version', substring(d.file_name FROM '_v([0-9]+)_'), 'name', left(d.file_name, 120))
      FROM public.ticket_documents d WHERE d.ticket_id = _ticket
    UNION ALL
    SELECT s.submitted_at, 'system', 'timesheet_submitted', 'consultant', jsonb_build_object('hours', s.total_hours)
      FROM public.ticket_timesheet_submissions s WHERE s.ticket_id = _ticket AND (_full OR s.submitted_by = _uid)
    UNION ALL
    SELECT s.signed_at, 'system', 'timesheet_approved', 'client', jsonb_build_object('hours', s.total_hours)
      FROM public.ticket_timesheet_submissions s WHERE s.ticket_id = _ticket AND (_full OR s.submitted_by = _uid)
    UNION ALL
    SELECT i.created_at, 'system', 'invoice_sent', 'consultant', '{}'::jsonb FROM public.ticket_invoices i
     WHERE i.ticket_id = _ticket AND (_full OR i.consultant_id = _me)
    UNION ALL
    SELECT i.decided_at, 'system', 'invoice_decided', 'client', jsonb_build_object('status', i.status) FROM public.ticket_invoices i
     WHERE i.ticket_id = _ticket AND (_full OR i.consultant_id = _me)
    UNION ALL
    SELECT s.created_at, 'system', 'meeting_scheduled', 'system', jsonb_build_object('at', s.scheduled_at) FROM public.sessions s WHERE s.ticket_id = _ticket
    UNION ALL
    SELECT s.ended_at, 'system', 'meeting_completed', 'both', '{}'::jsonb FROM public.sessions s
     WHERE s.ticket_id = _ticket AND s.status::text = 'completed'
    UNION ALL
    SELECT e.created_at, 'manual', 'working_status', e.actor_role,
           jsonb_build_object('from', e.from_key, 'to', e.to_key, 'note', e.note, 'expected_date', e.expected_date,
                              'responsible', e.responsible, 'backfill', e.backfill)
      FROM public.ticket_working_status_events e WHERE e.ticket_id = _ticket
    UNION ALL
    SELECT max(m.created_at), 'comment', 'messages', CASE WHEN max(m.sender_role) = 'client' THEN 'client' ELSE 'consultant' END,
           jsonb_build_object('count', count(*), 'day', to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD'))
      FROM public.ticket_team_messages m WHERE m.ticket_id = _ticket
     GROUP BY (m.sender_role = 'client'), date_trunc('day', m.created_at)
    UNION ALL
    SELECT max(m.created_at), 'comment', 'messages', CASE WHEN bool_and(m.sender_id = t.client_id) THEN 'client' ELSE 'consultant' END,
           jsonb_build_object('count', count(*), 'day', to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD'))
      FROM public.messages m JOIN public.sessions s ON s.id = m.session_id WHERE s.ticket_id = _ticket
     GROUP BY (m.sender_id = t.client_id), date_trunc('day', m.created_at)
    UNION ALL
    SELECT c.created_at, 'comment', 'timesheet_comment', CASE WHEN c.author_role = 'client' THEN 'client' WHEN c.author_role = 'admin' THEN 'admin' ELSE 'consultant' END, '{}'::jsonb
      FROM public.ticket_timesheet_comments c JOIN public.ticket_timesheet_submissions s ON s.id = c.submission_id
     WHERE s.ticket_id = _ticket AND (_full OR s.submitted_by = _uid)
  ) x
  WHERE x.event_at IS NOT NULL
  ORDER BY x.event_at DESC
  LIMIT 500;
END
$$;
REVOKE ALL ON FUNCTION public.tt_timeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_timeline(uuid) TO authenticated;

-- ------------------------------------------------------------------ notifications

CREATE OR REPLACE FUNCTION public.tt_wake()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_tracking_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/ticket-tracking-run';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ticket tracking e-mail wake-up skipped: %', SQLERRM;
END
$$;
REVOKE ALL ON FUNCTION public.tt_wake() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tt_queue_wake_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.tt_wake(); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.tt_queue_wake_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tt_queue_wake ON public.ticket_tracking_email_queue;
CREATE TRIGGER trg_tt_queue_wake AFTER INSERT ON public.ticket_tracking_email_queue
  FOR EACH STATEMENT EXECUTE FUNCTION public.tt_queue_wake_trigger();

CREATE OR REPLACE FUNCTION public.tt_status_label(_key text, _lang text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT CASE WHEN _lang = 'ar' THEN x ->> 'label_ar' ELSE x ->> 'label_en' END
                     FROM jsonb_array_elements(public.tt_settings() -> 'statuses') x WHERE x ->> 'key' = _key LIMIT 1), _key)
$$;
REVOKE ALL ON FUNCTION public.tt_status_label(text, text) FROM PUBLIC, anon, authenticated;

-- In-app notice with throttling: an unread tracking notice for the same ticket within the window is updated.
CREATE OR REPLACE FUNCTION public.tt_push_notice(_user uuid, _ticket uuid, _role text, _title text, _body text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _link text := CASE WHEN _role = 'client' THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket::text;
  _win int := COALESCE((public.tt_settings() ->> 'throttle_minutes')::int, 15);
  _nid uuid;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  SELECT n.id INTO _nid FROM public.notifications n
   WHERE n.user_id = _user AND n.type = 'ticket_tracking' AND n.link = _link AND NOT COALESCE(n.is_read, false)
     AND n.created_at > now() - make_interval(mins => _win)
   ORDER BY n.created_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _nid IS NOT NULL THEN
    UPDATE public.notifications SET title = left(_title, 200), body = left(_body, 1000), created_at = now() WHERE id = _nid;
  ELSE
    PERFORM public.safe_insert_notification(_user, left(_title, 200), left(_body, 1000), 'ticket_tracking', _link);
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.tt_push_notice(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- E-mail queue with a leading-edge throttle for status e-mails (one per person and ticket per window).
CREATE OR REPLACE FUNCTION public.tt_queue_email(_user uuid, _ticket uuid, _role text, _kind text, _payload jsonb, _dedupe text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s jsonb := public.tt_settings(); _win int := COALESCE((s ->> 'throttle_minutes')::int, 15);
BEGIN
  IF _user IS NULL OR NOT COALESCE((s ->> 'email_enabled')::boolean, true) THEN RETURN; END IF;
  IF _kind IN ('status', 'completed') AND EXISTS (
       SELECT 1 FROM public.ticket_tracking_email_queue q
        WHERE q.user_id = _user AND q.ticket_id = _ticket AND q.kind IN ('status', 'completed')
          AND q.created_at > now() - make_interval(mins => _win)) THEN
    RETURN;
  END IF;
  INSERT INTO public.ticket_tracking_email_queue (user_id, ticket_id, kind, payload, dedupe_key)
  VALUES (_user, _ticket, _kind, _payload || jsonb_build_object('path',
            CASE WHEN _role = 'client' THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket::text), left(_dedupe, 300))
  ON CONFLICT (dedupe_key) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION public.tt_queue_email(uuid, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tt_lang(_user uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT CASE WHEN (SELECT p.preferred_language FROM public.profiles p WHERE p.user_id = _user LIMIT 1) = 'ar' THEN 'ar' ELSE 'en' END $$;
REVOKE ALL ON FUNCTION public.tt_lang(uuid) FROM PUBLIC, anon, authenticated;

-- Tells everybody on the ticket except the actor (names never appear: "the client", "the consultant").
CREATE OR REPLACE FUNCTION public.tt_notify_change(_ticket uuid, _actor uuid, _actor_role text, _to text, _note text, _version int)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r record; _lang text; _title text; _body text; _who text; _label text; _kind text;
  _tt text := (SELECT left(t.title, 120) FROM public.tickets t WHERE t.id = _ticket);
  _n text := NULLIF(left(btrim(COALESCE(_note, '')), 200), '');
BEGIN
  FOR r IN SELECT * FROM public.tt_recipients(_ticket) LOOP
    CONTINUE WHEN r.user_id = _actor;
    _lang := public.tt_lang(r.user_id);
    _label := public.tt_status_label(_to, _lang);
    _who := CASE _actor_role WHEN 'client' THEN CASE WHEN _lang = 'ar' THEN 'العميل' ELSE 'the client' END
                             WHEN 'admin' THEN CASE WHEN _lang = 'ar' THEN 'فريق الدعم' ELSE 'the support team' END
                             ELSE CASE WHEN _lang = 'ar' THEN 'الاستشاري' ELSE 'the consultant' END END;
    _kind := CASE WHEN _to = 'completed' AND _actor_role = 'consultant' AND r.role = 'client' THEN 'completed' ELSE 'status' END;
    IF _kind = 'completed' THEN
      _title := CASE WHEN _lang = 'ar' THEN 'يرجى تأكيد الحل' ELSE 'Please confirm the resolution' END;
      _body := CASE WHEN _lang = 'ar'
        THEN '«' || _tt || '»: أشار الاستشاري إلى أن عمله مكتمل. يرجى مراجعة العمل وتأكيد الحل، أو اختيار «يحتاج إلى إعادة عمل». لم يتم إغلاق التذكرة.'
        ELSE '"' || _tt || '": the consultant marked their part as complete. Please check the work and confirm the resolution, or choose "Needs rework". The ticket has not been closed.' END;
    ELSE
      _title := CASE WHEN _lang = 'ar' THEN 'تم تحديث حالة العمل' ELSE 'Working status updated' END;
      _body := CASE WHEN _lang = 'ar' THEN '«' || _tt || '»: ' || _label || ' - بواسطة ' || _who || '.'
                    ELSE '"' || _tt || '": ' || _label || ' - set by ' || _who || '.' END
               || CASE WHEN _n IS NULL THEN '' ELSE CASE WHEN _lang = 'ar' THEN ' ملاحظة: ' ELSE ' Note: ' END || _n END;
    END IF;
    PERFORM public.tt_push_notice(r.user_id, _ticket, r.role, _title, _body);
    PERFORM public.tt_queue_email(r.user_id, _ticket, r.role, _kind,
      jsonb_build_object('lang', _lang, 'ticket_title', _tt, 'status_label', _label, 'actor', _actor_role, 'note', _n),
      'tt:' || _kind || ':' || _ticket::text || ':' || r.user_id::text || ':v' || _version::text);
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.tt_notify_change(uuid, uuid, text, text, text, int) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ the only write path

CREATE OR REPLACE FUNCTION public.tt_set_working_status(_ticket uuid, _status text, _note text DEFAULT NULL,
  _expected_date date DEFAULT NULL, _responsible text DEFAULT NULL, _expected_version integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid(); s jsonb := public.tt_settings(); _role text; t public.tickets; w public.ticket_working_status;
  _def jsonb; _n text := NULLIF(btrim(COALESCE(_note, '')), ''); _max int; _v int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  _role := public.tt_viewer_role(_ticket, _uid);
  IF _role IS NULL OR _role = 'observer' THEN RAISE EXCEPTION 'You can not change the working status of this ticket' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) AND _role <> 'admin' THEN
    RAISE EXCEPTION 'Working status is switched off' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public.tickets WHERE id = _ticket;
  IF t.status::text = 'closed' AND _role <> 'admin' THEN
    RAISE EXCEPTION 'This ticket is closed' USING ERRCODE = '55000';
  END IF;
  SELECT x INTO _def FROM jsonb_array_elements(s -> 'statuses') x
   WHERE x ->> 'key' = _status AND COALESCE((x ->> 'enabled')::boolean, true) LIMIT 1;
  IF _def IS NULL THEN RAISE EXCEPTION 'Unknown working status' USING ERRCODE = '22023'; END IF;
  IF _role <> 'admin' AND NOT COALESCE((s -> 'matrix' -> _status ->> _role)::boolean, false) THEN
    RAISE EXCEPTION 'This working status can not be set by the %', _role USING ERRCODE = '42501';
  END IF;
  _max := COALESCE((s ->> 'note_max')::int, 1000);
  IF _n IS NOT NULL AND char_length(_n) > _max THEN
    RAISE EXCEPTION 'The note is too long (% characters at most)', _max USING ERRCODE = '22023';
  END IF;
  IF _n IS NULL AND COALESCE((s -> 'matrix' -> _status ->> 'note')::boolean, false) THEN
    RAISE EXCEPTION 'Please add a short note for this working status' USING ERRCODE = '22023';
  END IF;
  IF _n IS NOT NULL AND public.contact_details_in_text(_n) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal.'
      USING ERRCODE = '22023';
  END IF;
  IF _responsible IS NOT NULL AND _responsible NOT IN ('client', 'consultant', 'both', 'third_party') THEN
    RAISE EXCEPTION 'Unknown responsible side' USING ERRCODE = '22023';
  END IF;
  IF _expected_date IS NOT NULL AND (_expected_date < current_date OR _expected_date > current_date + 365) THEN
    RAISE EXCEPTION 'The expected date must be between today and one year from now' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ticket_working_status (ticket_id, status_key, set_by_role, set_at, version)
  VALUES (_ticket, 'not_started', 'system', t.created_at, 1) ON CONFLICT (ticket_id) DO NOTHING;
  SELECT * INTO w FROM public.ticket_working_status WHERE ticket_id = _ticket FOR UPDATE;

  IF _expected_version IS NOT NULL AND _expected_version <> w.version THEN
    RAISE EXCEPTION 'The working status was changed by someone else a moment ago; please reload' USING ERRCODE = '40001',
      HINT = 'current_version=' || w.version::text;
  END IF;
  -- Idempotent: the same status with the same details is not a change (no event, no notification, no rate limit hit).
  IF w.status_key = _status AND w.note IS NOT DISTINCT FROM _n AND w.expected_date IS NOT DISTINCT FROM _expected_date
     AND w.responsible IS NOT DISTINCT FROM _responsible THEN
    RETURN jsonb_build_object('version', w.version, 'changed', false);
  END IF;
  IF NOT public.check_rate_limit('tt-status:' || _uid::text, COALESCE((s ->> 'rate_limit_per_hour')::int, 30), 3600) THEN
    RAISE EXCEPTION 'Too many working status changes in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;

  _v := w.version + 1;
  UPDATE public.ticket_working_status SET
    status_key = _status, note = _n, expected_date = _expected_date, responsible = _responsible,
    set_by = _uid, set_by_role = _role, set_at = now(), version = _v,
    last_reminder_on = NULL, overdue_reminders = 0, review_reminded_on = NULL, review_reminders = 0
   WHERE ticket_id = _ticket;
  INSERT INTO public.ticket_working_status_events (ticket_id, from_key, to_key, note, expected_date, responsible, actor_id, actor_role)
  VALUES (_ticket, w.status_key, _status, _n, _expected_date, _responsible, _uid, _role);
  IF _role = 'admin' THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (_uid, 'ticket_working_status.admin_set', 'ticket', _ticket,
            jsonb_build_object('from', w.status_key, 'to', _status, 'note', _n, 'expected_date', _expected_date, 'responsible', _responsible));
  END IF;
  BEGIN
    PERFORM public.tt_notify_change(_ticket, _uid, _role, _status, _n, _v);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ticket tracking notification skipped: %', SQLERRM;
  END;
  RETURN jsonb_build_object('version', _v, 'changed', true);
END
$$;
REVOKE ALL ON FUNCTION public.tt_set_working_status(uuid, text, text, date, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_set_working_status(uuid, text, text, date, text, integer) TO authenticated;