-- =============================================================================
-- Feature I — database checks for team requests, limits, approvals, declines, audit and the team thread.
-- NOT RUN BY THE ASSISTANT. Run once AFTER applying docs/sql/team-engagement.sql.
-- Everything runs inside one transaction and is ROLLED BACK: no data is kept, no e-mail is sent.
-- Needs one open ticket with a client, three verified consultants and one administrator.
-- Prints "TEAM CHECKS PASSED" or stops at the first "FAIL: ...".
-- =============================================================================
BEGIN;

DO $$
DECLARE
  _ticket uuid; _client uuid; _admin uuid;
  _a uuid; _a_user uuid; _b uuid; _c uuid; _c_user uuid; _d uuid;
  _req uuid; _req2 uuid; _member uuid; res jsonb; _n int; _ok boolean; _st text;

  -- impersonate a signed-in user for auth.uid()
  PROCEDURE_DUMMY int;
BEGIN
  SELECT t.id, t.client_id INTO _ticket, _client FROM public.tickets t
   WHERE t.client_id IS NOT NULL AND t.status::text NOT IN ('resolved', 'closed') ORDER BY t.created_at LIMIT 1;
  SELECT ur.user_id INTO _admin FROM public.user_roles ur WHERE ur.role::text IN ('admin', 'super_admin') LIMIT 1;
  SELECT c.id, c.user_id INTO _a, _a_user FROM public.consultants c WHERE c.verification_status = 'verified' AND c.user_id <> _client ORDER BY c.created_at LIMIT 1;
  SELECT c.id INTO _b FROM public.consultants c WHERE c.verification_status = 'verified' AND c.id <> _a AND c.user_id <> _client ORDER BY c.created_at LIMIT 1;
  SELECT c.id, c.user_id INTO _c, _c_user FROM public.consultants c WHERE c.verification_status = 'verified' AND c.id NOT IN (_a, _b) AND c.user_id <> _client ORDER BY c.created_at LIMIT 1;
  SELECT c.id INTO _d FROM public.consultants c WHERE c.verification_status = 'verified' AND c.id NOT IN (_a, _b, _c) AND c.user_id <> _client ORDER BY c.created_at LIMIT 1;
  IF _ticket IS NULL OR _admin IS NULL OR _a IS NULL OR _b IS NULL OR _c IS NULL THEN
    RAISE EXCEPTION 'SKIPPED: needs an open ticket, an administrator and three verified consultants';
  END IF;

  -- fixture: consultant A works on the ticket; B, C, D are not on it
  UPDATE public.ticket_team_members SET status = 'withdrawn', ended_at = now()
   WHERE ticket_id = _ticket AND consultant_id IN (_b, _c, _d) AND public.team_live(status);
  IF NOT EXISTS (SELECT 1 FROM public.ticket_team_members WHERE ticket_id = _ticket AND consultant_id = _a AND status IN ('ready', 'active')) THEN
    UPDATE public.ticket_team_members SET status = 'withdrawn', ended_at = now() WHERE ticket_id = _ticket AND consultant_id = _a AND public.team_live(status);
    INSERT INTO public.ticket_team_members (ticket_id, consultant_id, status, ready_at) VALUES (_ticket, _a, 'active', now());
  END IF;
  DELETE FROM public.ticket_team_requests WHERE ticket_id = _ticket;
  UPDATE public.platform_settings SET value = value || '{"max_team_size":5,"team_request_max_pending":3,"team_request_cooldown_hours":24,"team_request_redecline_days":7}'::jsonb
   WHERE key = 'team_engagement';

  -- ---- as consultant A ----------------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _a_user, 'role', 'authenticated')::text, true);

  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, '  '); EXCEPTION WHEN others THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: a request without a reason was accepted'; END IF;

  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, 'Call me on +966 50 123 4567 please'); EXCEPTION WHEN others THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: contact details in the reason were accepted (M60)'; END IF;

  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, 'Need help with month-end', NULL, _a); EXCEPTION WHEN others THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: a consultant could suggest themselves'; END IF;

  _req := public.team_request_additional(_ticket, 'Need an MM expert for the goods receipt part', 'MM', _b, 12);
  SELECT status INTO _st FROM public.ticket_team_requests WHERE id = _req;
  IF _st IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'FAIL: new request is not pending'; END IF;
  IF (SELECT payer FROM public.ticket_team_requests WHERE id = _req) <> 'client' THEN RAISE EXCEPTION 'FAIL: payer is not the client'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'team_request.created' AND entity_id = _req) THEN
    RAISE EXCEPTION 'FAIL: no audit entry for the new request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = _client AND n.title = 'Team request' AND n.created_at >= now() - interval '1 minute') THEN
    RAISE EXCEPTION 'FAIL: the client was not notified';
  END IF;

  -- one request per 24 h per consultant
  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, 'Second request too soon', NULL, _c); EXCEPTION WHEN others THEN _ok := SQLERRM LIKE '%every 24 hours%'; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: the 24-hour limit did not apply'; END IF;

  -- maximum 3 open requests per consultant per ticket
  UPDATE public.ticket_team_requests SET created_at = now() - interval '25 hours' WHERE id = _req;
  INSERT INTO public.ticket_team_requests (ticket_id, requester_member_id, requester_consultant_id, reason, created_at)
  SELECT _ticket, m.id, _a, 'older open request', now() - interval '30 hours'
    FROM public.ticket_team_members m WHERE m.ticket_id = _ticket AND m.consultant_id = _a AND public.team_live(m.status)
   CROSS JOIN generate_series(1, 2);
  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, 'Fourth open request', NULL, NULL); EXCEPTION WHEN others THEN _ok := SQLERRM LIKE '%3 open team requests%'; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: the 3-open-requests limit did not apply'; END IF;
  DELETE FROM public.ticket_team_requests WHERE ticket_id = _ticket AND reason = 'older open request';

  -- maximum team size
  UPDATE public.platform_settings SET value = value || '{"max_team_size":1}'::jsonb WHERE key = 'team_engagement';
  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, 'Team is full check', NULL, NULL); EXCEPTION WHEN others THEN _ok := SQLERRM LIKE '%team is already full%'; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: the maximum team size did not apply'; END IF;
  UPDATE public.platform_settings SET value = value || '{"max_team_size":5}'::jsonb WHERE key = 'team_engagement';

  -- ---- as the client: decline ---------------------------------------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _client, 'role', 'authenticated')::text, true);
  res := public.team_decide_request(_req, 'decline', NULL, 'Not needed yet');
  IF (SELECT status FROM public.ticket_team_requests WHERE id = _req) <> 'declined' THEN RAISE EXCEPTION 'FAIL: decline did not stick'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'team_request.declined' AND entity_id = _req) THEN RAISE EXCEPTION 'FAIL: no audit entry for the decline'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = _a_user AND n.title = 'Team request declined' AND n.created_at >= now() - interval '1 minute') THEN
    RAISE EXCEPTION 'FAIL: the requester was not told about the decline';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_team_members WHERE ticket_id = _ticket AND consultant_id = _b AND public.team_live(status)) THEN
    RAISE EXCEPTION 'FAIL: a declined request added the consultant';
  END IF;
  _ok := false; BEGIN PERFORM public.team_decide_request(_req, 'approve'); EXCEPTION WHEN others THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: an answered request could be answered again'; END IF;

  -- ---- as consultant A: same person within 7 days is blocked; another person is allowed ----
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _a_user, 'role', 'authenticated')::text, true);
  UPDATE public.ticket_team_requests SET created_at = now() - interval '25 hours' WHERE id = _req;
  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, 'Please reconsider the MM expert', NULL, _b); EXCEPTION WHEN others THEN _ok := SQLERRM LIKE '%declined this consultant recently%'; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: the 7-day block after a decline did not apply'; END IF;
  _req2 := public.team_request_additional(_ticket, 'Need a second FI consultant for VAT', NULL, _c);

  -- ---- as the client: approve -> the suggested consultant enters the team as Invited ----
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _client, 'role', 'authenticated')::text, true);
  res := public.team_decide_request(_req2, 'approve');
  _member := (res ->> 'member_id')::uuid;
  SELECT status INTO _st FROM public.ticket_team_members WHERE id = _member;
  IF _member IS NULL OR _st IS NULL OR NOT public.team_pre_ready(_st) OR _st = 'ready' THEN
    RAISE EXCEPTION 'FAIL: approval did not create an invited member (status %)', _st;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_assignments WHERE ticket_id = _ticket AND consultant_id = _c AND status::text = 'active') THEN
    RAISE EXCEPTION 'FAIL: the approved consultant was assigned before the four gates';
  END IF;
  IF (SELECT created_member_id FROM public.ticket_team_requests WHERE id = _req2) IS DISTINCT FROM _member THEN RAISE EXCEPTION 'FAIL: request not linked to the new member'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'team_request.approved' AND entity_id = _req2) THEN RAISE EXCEPTION 'FAIL: no audit entry for the approval'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = _a_user AND n.title = 'Team request approved' AND n.created_at >= now() - interval '1 minute') THEN
    RAISE EXCEPTION 'FAIL: the requester was not told about the approval';
  END IF;

  -- ---- an invited (not yet ready) consultant cannot request or use the team thread ----
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _c_user, 'role', 'authenticated')::text, true);
  _ok := false; BEGIN PERFORM public.team_request_additional(_ticket, 'I want a helper'); EXCEPTION WHEN others THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: an invited consultant could send a team request'; END IF;
  _ok := false; BEGIN PERFORM public.team_post_message(_ticket, 'Hello team'); EXCEPTION WHEN others THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: an invited consultant could post in the team thread'; END IF;
  IF EXISTS (SELECT 1 FROM public.team_thread(_ticket)) THEN RAISE EXCEPTION 'FAIL: an invited consultant could read the team thread'; END IF;

  -- ---- team thread: client and ready members; contact details blocked ----
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _client, 'role', 'authenticated')::text, true);
  PERFORM public.team_post_message(_ticket, 'Welcome to the team');
  _ok := false; BEGIN PERFORM public.team_post_message(_ticket, 'mail me at someone@example.com'); EXCEPTION WHEN others THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL: contact details were accepted in the team thread (M60)'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _a_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _n FROM public.team_thread(_ticket);
  IF _n < 1 THEN RAISE EXCEPTION 'FAIL: a ready member cannot read the team thread'; END IF;

  -- ---- administrator adds and removes several consultants; audit entries ----
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  IF _d IS NOT NULL THEN
    res := public.team_invite(_ticket, jsonb_build_array(jsonb_build_object('consultant_id', _d), jsonb_build_object('consultant_id', _b)));
    IF jsonb_array_length(res -> 'invited') < 1 THEN RAISE EXCEPTION 'FAIL: the administrator could not invite several consultants: %', res; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'team_member.invited' AND entity_id = _ticket AND user_id = _admin) THEN
      RAISE EXCEPTION 'FAIL: no audit entry for the administrator invitation';
    END IF;
  END IF;
  PERFORM public.team_end_member(_member, 'Not needed any more');
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action LIKE 'team_member.%' AND entity_id = _ticket AND user_id = _admin
                  AND metadata ->> 'member_id' = _member::text) THEN
    RAISE EXCEPTION 'FAIL: no audit entry for the administrator removal';
  END IF;

  RAISE NOTICE 'TEAM CHECKS PASSED';
END $$;

ROLLBACK;
