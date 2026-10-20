-- Checks for docs/sql/assignment-info-requests.sql. Run them on a throwaway database (the agent ran them on a local
-- PostgreSQL 17 with stand-ins for the live tables); every block raises an exception when a rule is broken.
-- Users: client c1, consultant k1 (consultant row kc1), admin a1.

DO $$ BEGIN
  PERFORM set_config('t.client', '11111111-1111-1111-1111-111111111111', false);
END $$;

INSERT INTO public.profiles (user_id, display_name, preferred_language) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Huda Client', 'en'),
  ('22222222-2222-2222-2222-222222222222', 'Karim Consultant', 'en');
INSERT INTO public.client_profiles (user_id, company_name, industry, country) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme Riyadh Trading', 'Retail', 'Saudi Arabia');
INSERT INTO public.consultants (id, user_id, timezone) VALUES
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Asia/Riyadh');
INSERT INTO public.tickets (id, client_id, title, description, sap_module, urgency, planned_hours, ticket_context)
VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        'FB50 error at Acme Riyadh Trading',
        'Posting fails. Call me on +966 55 123 4567 or mail huda@acme-trading.com, see https://acme.example.com/x. Acme Riyadh Trading uses S/4HANA 2022.',
        'SAP FI', 'high', 12, '{"industry":"Retail","country":"Saudi Arabia","budget_max_rate":"80"}');
INSERT INTO public.ticket_documents (ticket_id, uploaded_by, file_name, file_url, file_size, mime_type)
VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'dump.png', 'secret/path/dump.png', 2048, 'image/png');
INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status)
VALUES ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 60, 'USD', 'proposed');
INSERT INTO public.ticket_match_requests (id, ticket_id, consultant_id, sent_by)
VALUES ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');

-- 1. Preview: masked texts, attachment list only, viewed_at logged, clock untouched.
DO $$
DECLARE p JSONB; q RECORD; due_before TIMESTAMPTZ; due_after TIMESTAMPTZ;
BEGIN
  SELECT due_at INTO due_before FROM public.assignment_reminder_log WHERE request_id = '55555555-5555-5555-5555-555555555555' AND step = 'r1';
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  p := public.assignment_request_preview('55555555-5555-5555-5555-555555555555');
  IF p->>'description' ~* '(huda@|\+966|https?://)' THEN RAISE EXCEPTION 'contact details not masked: %', p->>'description'; END IF;
  IF p->>'description' ILIKE '%Acme Riyadh Trading%' OR p->>'title' ILIKE '%Acme Riyadh Trading%' THEN RAISE EXCEPTION 'company name not masked'; END IF;
  IF p->>'description' NOT LIKE '%S/4HANA 2022%' THEN RAISE EXCEPTION 'normal text lost'; END IF;
  IF p ? 'client_id' OR p::TEXT LIKE '%secret/path%' OR p::TEXT LIKE '%file_url%' THEN RAISE EXCEPTION 'locked data leaked'; END IF;
  IF jsonb_array_length(p->'attachments') <> 1 OR (p->'attachments'->0->>'name') <> 'dump.png' THEN RAISE EXCEPTION 'attachment list wrong: %', p->'attachments'; END IF;
  IF (p->>'industry') <> 'Retail' OR (p->>'country') <> 'Saudi Arabia' OR (p->>'proposed_rate')::NUMERIC <> 60 THEN RAISE EXCEPTION 'facts missing: %', p; END IF;
  SELECT * INTO q FROM public.ticket_match_requests WHERE id = '55555555-5555-5555-5555-555555555555';
  IF q.viewed_at IS NULL OR q.status::TEXT <> 'pending' THEN RAISE EXCEPTION 'view not logged or status changed'; END IF;
  SELECT due_at INTO due_after FROM public.assignment_reminder_log WHERE request_id = q.id AND step = 'r1';
  IF due_after IS DISTINCT FROM due_before THEN RAISE EXCEPTION 'opening the preview moved the clock'; END IF;
  RAISE NOTICE 'ok 1 preview hides locked data and logs the view';
END $$;

-- A stranger cannot open it.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
  BEGIN
    PERFORM public.assignment_request_preview('55555555-5555-5555-5555-555555555555');
    RAISE EXCEPTION 'stranger opened the preview';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok 1b preview is private';
END $$;

-- 2. Ask: pause, counted as response, notification, contact filter, one open at a time.
DO $$
DECLARE v UUID; q RECORD; e RECORD; n INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  BEGIN
    PERFORM public.consultant_request_assignment_info('55555555-5555-5555-5555-555555555555', ARRAY['scope'], 'mail me at k@x.com');
    RAISE EXCEPTION 'contact details passed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.consultant_request_assignment_info('55555555-5555-5555-5555-555555555555', ARRAY['scope','system','error','access'], '');
    RAISE EXCEPTION '4 topics passed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  v := public.consultant_request_assignment_info('55555555-5555-5555-5555-555555555555', ARRAY['scope', 'error'], 'Which company code and the full error text?');
  SELECT * INTO q FROM public.ticket_match_requests WHERE id = '55555555-5555-5555-5555-555555555555';
  IF q.info_paused_at IS NULL OR q.info_first_asked_at IS NULL OR q.info_requests_count <> 1 THEN RAISE EXCEPTION 'not paused'; END IF;
  SELECT * INTO e FROM public.responsiveness_events WHERE source_id = q.id;
  IF e.outcome <> 'responded' OR e.responded_at IS NULL OR abs(EXTRACT(EPOCH FROM (e.responded_at - now()))) > 5 THEN RAISE EXCEPTION 'not counted as responded: %', e; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = '11111111-1111-1111-1111-111111111111' AND link LIKE '%?info=' || v;
  IF n <> 1 THEN RAISE EXCEPTION 'client not notified'; END IF;
  BEGIN
    PERFORM public.consultant_request_assignment_info('55555555-5555-5555-5555-555555555555', ARRAY['access'], '');
    RAISE EXCEPTION 'second open question passed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'You already asked%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok 2 info request pauses, counts as response, notifies, one open';
END $$;

-- 3. While paused no reminder or No response is claimed, even when due.
DO $$
DECLARE n INT;
BEGIN
  UPDATE public.assignment_reminder_log SET due_at = now() - interval '1 minute', sent_at = CASE WHEN step = 'request' THEN now() - interval '2 hours' ELSE sent_at END
   WHERE request_id = '55555555-5555-5555-5555-555555555555';
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT count(*) INTO n FROM public.claim_assignment_reminders(100, NULL);
  IF n <> 0 THEN RAISE EXCEPTION 'reminders claimed while paused: %', n; END IF;
  IF (SELECT status::TEXT FROM public.ticket_match_requests WHERE id = '55555555-5555-5555-5555-555555555555') <> 'pending' THEN RAISE EXCEPTION 'expired while paused'; END IF;
  RAISE NOTICE 'ok 3 timer paused';
END $$;

-- 4. The client answers: resumes with at least 2 hours, reminders follow, consultant notified.
DO $$
DECLARE v_info UUID; v_due TIMESTAMPTZ; q RECORD; d TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_info FROM public.assignment_info_requests WHERE request_id = '55555555-5555-5555-5555-555555555555' AND status = 'open';
  -- The deadline had almost passed at the pause: 10 minutes left.
  PERFORM set_config('app.assignment_policy', 'on', true);
  UPDATE public.ticket_match_requests SET info_remaining_seconds = 600 WHERE id = '55555555-5555-5555-5555-555555555555';
  PERFORM set_config('app.assignment_policy', 'off', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  BEGIN
    PERFORM public.client_answer_assignment_info(v_info, 'not me');
    RAISE EXCEPTION 'consultant answered for the client';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  v_due := public.client_answer_assignment_info(v_info, 'Company code 1000, error F5 702.');
  IF v_due < now() + interval '119 minutes' THEN RAISE EXCEPTION 'less than 2 hours after resume: %', v_due; END IF;
  SELECT * INTO q FROM public.ticket_match_requests WHERE id = '55555555-5555-5555-5555-555555555555';
  IF q.info_paused_at IS NOT NULL OR q.info_resumed_at IS NULL OR q.response_due_at <> v_due THEN RAISE EXCEPTION 'not resumed'; END IF;
  SELECT due_at INTO d FROM public.assignment_reminder_log WHERE request_id = q.id AND step = 'expire';
  IF d <> v_due THEN RAISE EXCEPTION 'No response time not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '22222222-2222-2222-2222-222222222222' AND title = 'The client answered your question') THEN
    RAISE EXCEPTION 'consultant not notified';
  END IF;
  RAISE NOTICE 'ok 4 answer resumes with at least 2 hours';
END $$;

-- 5. Limit: 3 information requests per assignment request.
DO $$
DECLARE v UUID;
BEGIN
  FOR i IN 2..3 LOOP
    PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    v := public.consultant_request_assignment_info('55555555-5555-5555-5555-555555555555', ARRAY['timeline_budget'], 'Question ' || i);
    PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    PERFORM public.client_answer_assignment_info(v, 'Answer ' || i);
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  BEGIN
    PERFORM public.consultant_request_assignment_info('55555555-5555-5555-5555-555555555555', ARRAY['scope'], 'A fourth one');
    RAISE EXCEPTION 'fourth question passed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%up to 3 times%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok 5 at most 3 information requests';
END $$;

-- 6. No answer within info_wait: back to the client, e-mails claimed once, not counted against the consultant.
INSERT INTO public.ticket_match_requests (id, ticket_id, consultant_id, sent_by)
VALUES ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');
DO $$
DECLARE v UUID; kinds TEXT[]; again INT; rr RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v := public.consultant_request_assignment_info('66666666-6666-6666-6666-666666666666', ARRAY['access'], '');
  UPDATE public.assignment_info_requests SET client_due_at = now() - interval '1 minute' WHERE id = v;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT array_agg(kind ORDER BY kind) INTO kinds FROM public.claim_assignment_info_emails(100, NULL) WHERE info_id = v;
  IF (SELECT status FROM public.assignment_info_requests WHERE id = v) <> 'timed_out' THEN RAISE EXCEPTION 'not returned to the client'; END IF;
  IF kinds IS DISTINCT FROM ARRAY['timeout'] THEN RAISE EXCEPTION 'wrong e-mails: %', kinds; END IF;
  SELECT count(*) INTO again FROM public.claim_assignment_info_emails(100, NULL) WHERE info_id = v;
  IF again <> 0 THEN RAISE EXCEPTION 'e-mail claimed twice'; END IF;
  -- Even if this request later expires it is answered, not "no response".
  PERFORM set_config('app.assignment_policy', 'on', true);
  UPDATE public.ticket_match_requests SET status = 'expired', expired_at = now() WHERE id = '66666666-6666-6666-6666-666666666666';
  UPDATE public.assignment_reminder_log SET sent_at = now() WHERE request_id = '66666666-6666-6666-6666-666666666666' AND step = 'expire';
  SELECT * INTO rr FROM public.assignment_response_rates(NULL) WHERE consultant_id = '33333333-3333-3333-3333-333333333333';
  IF rr.no_response <> 0 OR rr.answered <> 2 THEN RAISE EXCEPTION 'response rate wrong: %', rr; END IF;
  RAISE NOTICE 'ok 6 unanswered question returned to the client, consultant not counted';
END $$;

-- 7. Decline with reasons: stored privately, anonymous hints for the ticket owner.
INSERT INTO public.ticket_match_requests (id, ticket_id, consultant_id, sent_by)
VALUES ('77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');
DO $$
DECLARE h TEXT[];
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  BEGIN
    PERFORM public.consultant_decline_assignment('77777777-7777-7777-7777-777777777777', ARRAY['made_up']);
    RAISE EXCEPTION 'unknown reason passed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.consultant_decline_assignment('77777777-7777-7777-7777-777777777777', ARRAY['rate_budget', 'other']);
  IF (SELECT status::TEXT FROM public.ticket_match_requests WHERE id = '77777777-7777-7777-7777-777777777777') <> 'rejected' THEN RAISE EXCEPTION 'not declined'; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  h := public.assignment_decline_hints('44444444-4444-4444-4444-444444444444');
  IF h IS DISTINCT FROM ARRAY['rate_budget'] THEN RAISE EXCEPTION 'hints wrong: %', h; END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
  IF cardinality(public.assignment_decline_hints('44444444-4444-4444-4444-444444444444')) <> 0 THEN RAISE EXCEPTION 'hints leaked'; END IF;
  RAISE NOTICE 'ok 7 decline reasons private, hints anonymous';
END $$;

-- 8. The new columns cannot be written directly by a consultant or client.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  PERFORM set_config('app.assignment_policy', 'off', true);
  BEGIN
    UPDATE public.ticket_match_requests SET info_paused_at = now() WHERE id = '55555555-5555-5555-5555-555555555555';
    RAISE EXCEPTION 'direct pause passed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok 8 platform-managed columns guarded';
END $$;
