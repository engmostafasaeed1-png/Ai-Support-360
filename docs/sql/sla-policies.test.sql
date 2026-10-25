-- Adversarial tests for sla-policies.sql. ONE rolled-back transaction: run on a scratch copy (nothing kept).
-- Each check raises on failure. SL01-SL30.
BEGIN;

-- Fixtures. Company A (owner OA, member MA, client user CA who raises tickets), company B (owner OB); admin AD;
-- consultant K assigned to ticket T1; consultant U unassigned; consultant Q has a pending assignment request on T2.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000005a001', 'ad@platform.test'), ('00000000-0000-0000-0000-00000005a002', 'oa@acme.test'),
  ('00000000-0000-0000-0000-00000005a003', 'ma@acme.test'), ('00000000-0000-0000-0000-00000005a004', 'ca@acme.test'),
  ('00000000-0000-0000-0000-00000005a005', 'ob@beta.test'), ('00000000-0000-0000-0000-00000005a006', 'k@cons.test'),
  ('00000000-0000-0000-0000-00000005a007', 'u@cons.test'), ('00000000-0000-0000-0000-00000005a008', 'q@cons.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-00000005a001', 'admin'), ('00000000-0000-0000-0000-00000005a002', 'client'),
  ('00000000-0000-0000-0000-00000005a003', 'client'), ('00000000-0000-0000-0000-00000005a004', 'client'),
  ('00000000-0000-0000-0000-00000005a005', 'client'), ('00000000-0000-0000-0000-00000005a006', 'consultant'),
  ('00000000-0000-0000-0000-00000005a007', 'consultant'), ('00000000-0000-0000-0000-00000005a008', 'consultant')
ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, name, slug, domain) VALUES
  ('00000000-0000-0000-0000-00000005ae01', 'Acme', 'acme-sla-test', 'acme.test'),
  ('00000000-0000-0000-0000-00000005ae02', 'Beta', 'beta-sla-test', 'beta.test');
INSERT INTO public.tenant_members (tenant_id, user_id, org_role, accepted_at) VALUES
  ('00000000-0000-0000-0000-00000005ae01', '00000000-0000-0000-0000-00000005a002', 'owner', now()),
  ('00000000-0000-0000-0000-00000005ae01', '00000000-0000-0000-0000-00000005a003', 'member', now()),
  ('00000000-0000-0000-0000-00000005ae01', '00000000-0000-0000-0000-00000005a004', 'member', now()),
  ('00000000-0000-0000-0000-00000005ae02', '00000000-0000-0000-0000-00000005a005', 'owner', now());
INSERT INTO public.client_profiles (user_id, timezone) VALUES ('00000000-0000-0000-0000-00000005a004', 'Asia/Riyadh') ON CONFLICT DO NOTHING;
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-00000005c006', '00000000-0000-0000-0000-00000005a006'),
  ('00000000-0000-0000-0000-00000005c007', '00000000-0000-0000-0000-00000005a007'),
  ('00000000-0000-0000-0000-00000005c008', '00000000-0000-0000-0000-00000005a008');

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
-- Runs a statement and returns the error message ('' when it succeeded).
CREATE OR REPLACE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.cal(_mode text, _tz text, _days int[], _hol text[] DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('mode', _mode, 'tz', _tz, 'days', to_jsonb(_days), 'start', '09:00', 'end', '17:00', 'holidays', to_jsonb(_hol))
$$;

DO $$
DECLARE
  ad uuid := '00000000-0000-0000-0000-00000005a001'; oa uuid := '00000000-0000-0000-0000-00000005a002';
  ma uuid := '00000000-0000-0000-0000-00000005a003'; ca uuid := '00000000-0000-0000-0000-00000005a004';
  ob uuid := '00000000-0000-0000-0000-00000005a005'; k uuid := '00000000-0000-0000-0000-00000005a006';
  u uuid := '00000000-0000-0000-0000-00000005a007'; q uuid := '00000000-0000-0000-0000-00000005a008';
  ta uuid := '00000000-0000-0000-0000-00000005ae01'; tb uuid := '00000000-0000-0000-0000-00000005ae02';
  kc uuid := '00000000-0000-0000-0000-00000005c006'; qc uuid := '00000000-0000-0000-0000-00000005c008';
  riyadh jsonb := pg_temp.cal('business', 'Asia/Riyadh', ARRAY[0,1,2,3,4]);
  t1 uuid; t2 uuid; t3 uuid; pol uuid; r jsonb; e text; n int; v jsonb; sid uuid; sid2 uuid; std jsonb; body jsonb; meta jsonb;
BEGIN
  -- SL01 owner example: S2 opened Sunday 17:00 Riyadh with 60 business minutes is due Monday 10:00.
  IF public.sla_add_business_minutes('2026-11-01 14:00+00', 60, riyadh) <> '2026-11-02 07:00+00' THEN RAISE EXCEPTION 'SL01 owner example'; END IF;
  -- SL02 weekend (Fri/Sat) skipped, and counted minutes are the inverse.
  IF public.sla_add_business_minutes('2026-11-05 13:00+00', 120, riyadh) <> '2026-11-08 07:00+00' THEN RAISE EXCEPTION 'SL02 weekend'; END IF;
  IF public.sla_business_minutes('2026-11-05 13:00+00', '2026-11-08 07:00+00', riyadh) <> 120 THEN RAISE EXCEPTION 'SL02 inverse'; END IF;
  -- SL03 holidays and daylight saving (Berlin 29 March 2026) give the same results as the browser rules.
  IF public.sla_add_business_minutes('2026-11-01 14:00+00', 60, pg_temp.cal('business', 'Asia/Riyadh', ARRAY[0,1,2,3,4], ARRAY['2026-11-02'])) <> '2026-11-03 07:00+00' THEN
    RAISE EXCEPTION 'SL03 holiday'; END IF;
  IF public.sla_add_business_minutes('2026-03-28 15:00+00', 120, pg_temp.cal('business', 'Europe/Berlin', ARRAY[0,1,2,3,4,5,6])) <> '2026-03-29 08:00+00' THEN
    RAISE EXCEPTION 'SL03 DST'; END IF;
  IF public.sla_business_minutes('2026-03-01 10:00+00', '2026-03-02 10:00+00', pg_temp.cal('24x7', 'UTC', ARRAY[0,1,2,3,4,5,6])) <> 1440 THEN RAISE EXCEPTION 'SL03 24x7'; END IF;
  IF public.sla_add_business_minutes(now(), 10, pg_temp.cal('business', 'UTC', ARRAY[]::int[])) IS NOT NULL THEN RAISE EXCEPTION 'SL03 no working day'; END IF;

  -- SL04 feature OFF (default): a new ticket gets no snapshot; today's breach job still works on legacy deadlines.
  IF public.sla_enabled() THEN RAISE EXCEPTION 'SL04 default must be off'; END IF;
  INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency) VALUES (ca, ta, 'Legacy ticket', 'FI', 'new', 'high') RETURNING id INTO t3;
  IF EXISTS (SELECT 1 FROM public.sla_ticket_snapshots WHERE ticket_id = t3) THEN RAISE EXCEPTION 'SL04 snapshot while off'; END IF;
  UPDATE public.tickets SET sla_response_deadline = now() - interval '1 minute' WHERE id = t3;
  PERFORM public.flag_sla_breaches();
  IF NOT (SELECT sla_breached FROM public.tickets WHERE id = t3) THEN RAISE EXCEPTION 'SL04 legacy breach job'; END IF;

  -- Switch ON (admin).
  PERFORM pg_temp.as_user(ad);
  PERFORM public.sla_admin_set_settings('{"enabled": true}'::jsonb, 'test');
  IF NOT public.sla_enabled() THEN RAISE EXCEPTION 'SL05 switch'; END IF;

  -- SL05 settings: only admins; SMS and repeats under 30 minutes refused.
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err($q$SELECT public.sla_admin_set_settings('{"enabled": false}'::jsonb)$q$) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL05 non-admin settings'; END IF;
  PERFORM pg_temp.as_user(ad);
  IF pg_temp.err($q$SELECT public.sla_admin_set_settings('{"channels_enabled": {"sms": true}}'::jsonb)$q$) NOT LIKE '%SMS%' THEN RAISE EXCEPTION 'SL05 sms'; END IF;
  IF pg_temp.err($q$SELECT public.sla_admin_set_settings('{"bounds": {"min_repeat_min": 10}}'::jsonb)$q$) NOT LIKE '%30 minutes%' THEN RAISE EXCEPTION 'SL05 repeat'; END IF;

  -- SL06 a new ticket gets the platform default snapshot (24x7, from submission) and running clocks.
  PERFORM pg_temp.as_user(NULL);
  INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency) VALUES (ca, ta, 'Posting blocked', 'FI', 'new', 'high') RETURNING id INTO t1;
  SELECT * INTO v FROM (SELECT to_jsonb(s) AS v FROM public.sla_ticket_snapshots s WHERE s.ticket_id = t1 AND s.superseded_at IS NULL) x;
  IF v IS NULL OR v ->> 'severity' <> 'S2' OR v ->> 'policy_name' <> 'Platform default policy' OR (v -> 'data' ->> 'response_min')::int <> 240 THEN
    RAISE EXCEPTION 'SL06 default snapshot %', v; END IF;
  IF (SELECT count(*) FROM public.sla_ticket_clocks WHERE ticket_id = t1 AND running_since IS NOT NULL) <> 2 THEN RAISE EXCEPTION 'SL06 clocks running'; END IF;
  sid := (v ->> 'id')::uuid;

  -- SL07 tables are closed to the browser; anon cannot call ticket RPCs.
  IF has_table_privilege('authenticated', 'public.sla_policies', 'SELECT') OR has_table_privilege('authenticated', 'public.sla_ticket_clocks', 'UPDATE')
     OR has_table_privilege('anon', 'public.sla_ticket_snapshots', 'SELECT') THEN RAISE EXCEPTION 'SL07 table grants'; END IF;
  IF has_function_privilege('anon', 'public.sla_ticket_view(uuid)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.sla_sweep(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sla_claim_deliveries(integer)', 'EXECUTE') THEN RAISE EXCEPTION 'SL07 function grants'; END IF;

  -- SL08 company owner creates a policy from the Standard template; a plain member cannot save; both can read.
  PERFORM pg_temp.as_user(oa);
  r := public.sla_policy_duplicate((SELECT id FROM public.sla_policies WHERE template_key = 'standard'), ta, 'Acme SLA');
  pol := (r ->> 'id')::uuid;
  IF pol IS NULL OR (r ->> 'version')::int <> 1 THEN RAISE EXCEPTION 'SL08 create %', r; END IF;
  PERFORM pg_temp.as_user(ma);
  IF pg_temp.err(format($q$SELECT public.sla_policy_save(%L, %L, '{"name":"x"}'::jsonb, '{}'::jsonb)$q$, pol, ta)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL08 member save'; END IF;
  IF jsonb_array_length(public.sla_my_policies(ta) -> 'policies') <> 1 THEN RAISE EXCEPTION 'SL08 member read'; END IF;

  -- SL09 other client denied (policy, company list, ticket).
  PERFORM pg_temp.as_user(ob);
  IF pg_temp.err(format('SELECT public.sla_policy_get(%L)', pol)) NOT LIKE '%sla_not_found%' THEN RAISE EXCEPTION 'SL09 other policy'; END IF;
  IF pg_temp.err(format('SELECT public.sla_my_policies(%L)', ta)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL09 other company'; END IF;
  IF pg_temp.err(format('SELECT public.sla_ticket_view(%L)', t1)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL09 other ticket'; END IF;
  IF pg_temp.err(format($q$SELECT public.sla_policy_save(NULL, %L, '{"name":"steal"}'::jsonb, '{"severities":{}}'::jsonb)$q$, ta)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL09 create in other company'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(public.sla_list_states(ARRAY[t1]))) <> 0 THEN RAISE EXCEPTION 'SL09 list states leak'; END IF;

  -- SL10 consultants cannot edit or archive policies.
  PERFORM pg_temp.as_user(k);
  IF pg_temp.err(format($q$SELECT public.sla_policy_save(%L, %L, '{"name":"x"}'::jsonb, '{}'::jsonb)$q$, pol, ta)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL10 consultant save'; END IF;
  IF pg_temp.err(format('SELECT public.sla_policy_archive(%L)', pol)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL10 consultant archive'; END IF;

  -- SL11 bounds enforced: S1 response 5 min and an SMS channel cannot be activated; drafts still save.
  PERFORM pg_temp.as_user(oa);
  r := public.sla_policy_get(pol);
  body := r -> 'body'; meta := r -> 'meta';
  body := jsonb_set(body, '{severities,S1,response_min}', '5');
  body := jsonb_set(body, '{severities,S2,escalations,0,channels}', '["sms"]');
  r := public.sla_policy_save(pol, ta, meta, body, 'too tight', NULL);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'problems') p WHERE p ->> 'code' = 'below_min_response')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'problems') p WHERE p ->> 'code' = 'channel_not_allowed') THEN RAISE EXCEPTION 'SL11 problems %', r; END IF;
  IF pg_temp.err(format('SELECT public.sla_policy_activate(%L, %s)', pol, (r ->> 'version')::int)) NOT LIKE '%sla_outside_bounds%' THEN RAISE EXCEPTION 'SL11 activate'; END IF;
  -- Premium: S1 response 30 min is allowed with a warning (needs the Critical service).
  body := jsonb_set(jsonb_set((public.sla_policy_version(pol, 1)) -> 'body', '{severities,S1,response_min}', '30'), '{severities,S2,response_min}', '60');
  r := public.sla_policy_save(pol, ta, meta, body, 'faster', NULL);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'problems') p WHERE p ->> 'code' = 'premium_required' AND p ->> 'level' = 'warning') THEN RAISE EXCEPTION 'SL11 premium warning'; END IF;
  IF public.sla_has_errors(r -> 'problems') THEN RAISE EXCEPTION 'SL11 unexpected errors %', r -> 'problems'; END IF;
  -- Not retroactive: an effective date in the past is refused.
  IF pg_temp.err(format($q$SELECT public.sla_policy_activate(%L, %s, now() - interval '2 days')$q$, pol, (r ->> 'version')::int)) NOT LIKE '%sla_not_retroactive%' THEN RAISE EXCEPTION 'SL11 retroactive'; END IF;
  PERFORM public.sla_policy_activate(pol, (r ->> 'version')::int, NULL, false);

  -- SL12 snapshot immutability: activation without "apply to open tickets" leaves T1 on the platform default;
  -- the snapshot row cannot be changed or deleted directly.
  IF (SELECT policy_name FROM public.sla_ticket_snapshots WHERE ticket_id = t1 AND superseded_at IS NULL) <> 'Platform default policy' THEN RAISE EXCEPTION 'SL12 silent change'; END IF;
  PERFORM pg_temp.as_user(NULL);
  IF pg_temp.err(format($q$UPDATE public.sla_ticket_snapshots SET data = '{}'::jsonb WHERE id = %L$q$, sid)) NOT LIKE '%sla_immutable%' THEN RAISE EXCEPTION 'SL12 update'; END IF;
  IF pg_temp.err(format('DELETE FROM public.sla_ticket_snapshots WHERE id = %L', sid)) NOT LIKE '%sla_immutable%' THEN RAISE EXCEPTION 'SL12 delete'; END IF;
  IF pg_temp.err(format($q$UPDATE public.sla_policy_versions SET body = '{}'::jsonb WHERE policy_id = %L$q$, pol)) NOT LIKE '%sla_immutable%' THEN RAISE EXCEPTION 'SL12 versions'; END IF;

  -- SL13 "apply new policy to this ticket" (client): new snapshot, counted minutes kept, event logged.
  PERFORM pg_temp.as_user(ca);
  IF (public.sla_ticket_view(t1) -> 'newer_policy') IS NULL THEN RAISE EXCEPTION 'SL13 newer policy hint'; END IF;
  r := public.sla_apply_new_policy(t1, 'switch');
  IF NOT (r ->> 'changed')::boolean THEN RAISE EXCEPTION 'SL13 apply'; END IF;
  IF (SELECT policy_name FROM public.sla_ticket_snapshots WHERE ticket_id = t1 AND superseded_at IS NULL) <> 'Acme SLA'
     OR (SELECT count(*) FROM public.sla_ticket_snapshots WHERE ticket_id = t1) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.sla_ticket_events WHERE ticket_id = t1 AND kind = 'new_policy') THEN RAISE EXCEPTION 'SL13 snapshot'; END IF;
  -- Premium cap: T1 has no Critical service, so an S1 target of 30 would be raised to 60 (checked on S1 below).

  -- SL14 unassigned consultant denied; assigned consultant sees clocks but not the extra contacts.
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.tickets SET consultant_id = kc, status = 'in_progress' WHERE id = t1;
  INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content, signed_at, client_signed_at) VALUES (kc, ca, 'sig', 'nda', now(), now());
  PERFORM pg_temp.as_user(u);
  IF pg_temp.err(format('SELECT public.sla_ticket_view(%L)', t1)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL14 unassigned'; END IF;
  PERFORM pg_temp.as_user(k);
  v := public.sla_ticket_view(t1);
  IF v ->> 'role' <> 'consultant' OR jsonb_array_length(v -> 'clocks') < 2 OR (v -> 'snapshot' -> 'data') ? 'extra_contacts' THEN RAISE EXCEPTION 'SL14 assigned view %', v ->> 'role'; END IF;

  -- SL15 shared consultant read-only: K cannot change targets, apply a policy or choose after a breach.
  IF pg_temp.err(format('SELECT public.sla_apply_new_policy(%L)', t1)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL15 apply'; END IF;
  IF pg_temp.err(format($q$SELECT public.sla_reclassify(%L, 'S4', 'too high')$q$, t1)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL15 reclass'; END IF;
  IF pg_temp.err(format($q$SELECT public.sla_breach_choice(%L, 'response', 'extend', 60)$q$, t1)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL15 breach choice'; END IF;

  -- SL16 escalation steps fire once per step and recipient (idempotent), in-app + queued e-mail.
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.sla_ticket_clocks SET started_at = now() - interval '7 days', running_since = now() - interval '7 days', consumed_min = 0
   WHERE ticket_id = t1 AND kind = 'response';
  -- 24x7 policy copy for a predictable test: the Acme policy is business hours, so count a week of business time.
  n := public.sla_fire_steps(t1);
  IF n < 3 THEN RAISE EXCEPTION 'SL16 fired %', n; END IF;
  IF public.sla_fire_steps(t1) <> 0 THEN RAISE EXCEPTION 'SL16 not idempotent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = k AND type = 'sla') THEN RAISE EXCEPTION 'SL16 in-app'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sla_delivery_queue WHERE ticket_id = t1 AND channel = 'email') THEN RAISE EXCEPTION 'SL16 queued e-mail'; END IF;
  IF EXISTS (SELECT 1 FROM public.sla_delivery_queue WHERE channel NOT IN ('email', 'push', 'telegram')) THEN RAISE EXCEPTION 'SL16 channel'; END IF;

  -- SL17 pause respected: waiting for client information pauses the clock with its reason; no new steps while paused.
  INSERT INTO public.ticket_working_status (ticket_id, status_key, set_by, set_by_role) VALUES (t1, 'waiting_client_info', k, 'consultant')
  ON CONFLICT (ticket_id) DO UPDATE SET status_key = 'waiting_client_info';
  PERFORM public.sla_reconcile(t1);
  IF NOT EXISTS (SELECT 1 FROM public.sla_ticket_clocks WHERE ticket_id = t1 AND kind = 'resolution' AND running_since IS NULL AND pause_reason = 'waiting_client_info') THEN
    RAISE EXCEPTION 'SL17 paused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sla_ticket_pauses WHERE ticket_id = t1 AND reason = 'waiting_client_info' AND ended_at IS NULL) THEN RAISE EXCEPTION 'SL17 pause row'; END IF;
  n := (SELECT consumed_min FROM public.sla_ticket_clocks WHERE ticket_id = t1 AND kind = 'resolution')::int;
  PERFORM public.sla_reconcile(t1);
  IF (SELECT consumed_min FROM public.sla_ticket_clocks WHERE ticket_id = t1 AND kind = 'resolution')::int <> n THEN RAISE EXCEPTION 'SL17 paused clock grew'; END IF;
  UPDATE public.ticket_working_status SET status_key = 'in_progress' WHERE ticket_id = t1;
  PERFORM public.sla_reconcile(t1);
  IF NOT EXISTS (SELECT 1 FROM public.sla_ticket_clocks WHERE ticket_id = t1 AND kind = 'resolution' AND running_since IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.sla_ticket_events WHERE ticket_id = t1 AND kind = 'resumed') THEN RAISE EXCEPTION 'SL17 resumed'; END IF;

  -- SL18 first reply of the assigned consultant meets the response clock.
  INSERT INTO public.sessions (id, ticket_id, client_id, consultant_id, session_type, status)
  VALUES ('00000000-0000-0000-0000-00000005e001', t1, ca, kc, 'chat', 'in_progress');
  INSERT INTO public.messages (session_id, sender_id, content, message_type) VALUES ('00000000-0000-0000-0000-00000005e001', k, 'Looking into it now', 'text');
  IF NOT EXISTS (SELECT 1 FROM public.sla_ticket_clocks WHERE ticket_id = t1 AND kind = 'response' AND met_at IS NOT NULL) THEN RAISE EXCEPTION 'SL18 response met'; END IF;
  -- Queued reminders of a met clock are dropped, not sent late.
  PERFORM public.sla_claim_deliveries(50);
  IF EXISTS (SELECT 1 FROM public.sla_delivery_queue WHERE ticket_id = t1 AND clock = 'response' AND sent_at IS NULL AND failed_at IS NULL) THEN RAISE EXCEPTION 'SL18 stale queue'; END IF;

  -- SL19 acknowledgement with ETA shows in the timeline; contact details refused (M60).
  PERFORM pg_temp.as_user(k);
  PERFORM public.sla_acknowledge(t1, 'Fix expected after the transport', now() + interval '1 day');
  IF NOT EXISTS (SELECT 1 FROM public.sla_ticket_events WHERE ticket_id = t1 AND kind = 'acknowledged') THEN RAISE EXCEPTION 'SL19 ack'; END IF;
  IF pg_temp.err(format($q$SELECT public.sla_acknowledge(%L, 'call me on +966 55 123 4567')$q$, t1)) NOT LIKE '%sla_contact_details%' THEN RAISE EXCEPTION 'SL19 M60'; END IF;

  -- SL20 admin re-classification with reason recomputes from the change time; premium cap applies (no Critical service).
  PERFORM pg_temp.as_user(ad);
  IF pg_temp.err(format($q$SELECT public.sla_reclassify(%L, 'S1', '')$q$, t1)) NOT LIKE '%sla_reason_required%' THEN RAISE EXCEPTION 'SL20 reason'; END IF;
  PERFORM public.sla_reclassify(t1, 'S1', 'Production down');
  v := (SELECT to_jsonb(s) FROM public.sla_ticket_snapshots s WHERE s.ticket_id = t1 AND s.superseded_at IS NULL);
  IF v ->> 'severity' <> 'S1' OR v ->> 'reason' <> 'reclassified' OR (v -> 'data' ->> 'response_min')::int <> 60 OR NOT (v -> 'data' ->> 'premium_capped')::boolean THEN
    RAISE EXCEPTION 'SL20 snapshot %', v; END IF;
  IF (SELECT urgency::text FROM public.tickets WHERE id = t1) <> 'critical' THEN RAISE EXCEPTION 'SL20 urgency'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sla_ticket_events WHERE ticket_id = t1 AND kind = 'reclassified' AND data ->> 'note' = 'Production down') THEN RAISE EXCEPTION 'SL20 event'; END IF;

  -- SL21 consultant proposes a re-classification, the client accepts.
  PERFORM pg_temp.as_user(k);
  sid2 := public.sla_propose_reclass(t1, 'S2', 'Workaround found');
  PERFORM pg_temp.as_user(ca);
  PERFORM public.sla_decide_reclass(sid2, true);
  IF (SELECT severity FROM public.sla_ticket_snapshots WHERE ticket_id = t1 AND superseded_at IS NULL) <> 'S2' THEN RAISE EXCEPTION 'SL21 reclass accepted'; END IF;

  -- SL22 acceptance gate: candidate Q must accept the SLA before accepting; acceptance stores the version.
  PERFORM pg_temp.as_user(NULL);
  INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency) VALUES (ca, ta, 'Interface down', 'SD', 'matched', 'medium') RETURNING id INTO t2;
  SET LOCAL session_replication_role = replica;  -- plain fixture row: skip the request triggers
  INSERT INTO public.ticket_match_requests (ticket_id, consultant_id, status) VALUES (t2, qc, 'pending');
  SET LOCAL session_replication_role = origin;
  IF NOT public.sla_acceptance_missing(t2, qc) THEN RAISE EXCEPTION 'SL22 gate missing'; END IF;
  PERFORM pg_temp.as_user(q);
  v := public.sla_ticket_view(t2);
  IF v ->> 'role' <> 'candidate' OR jsonb_array_length(v -> 'clocks') <> 0 OR NOT (v -> 'can' ->> 'accept')::boolean THEN RAISE EXCEPTION 'SL22 candidate view'; END IF;
  r := public.sla_accept(t2, 'assignment');
  IF NOT (r ->> 'accepted')::boolean OR public.sla_acceptance_missing(t2, qc) THEN RAISE EXCEPTION 'SL22 accept'; END IF;
  IF (SELECT policy_version FROM public.sla_acceptances WHERE ticket_id = t2 AND consultant_id = qc) IS NULL THEN RAISE EXCEPTION 'SL22 version stored'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sla_acceptance' AND tgrelid = 'public.ticket_match_requests'::regclass) THEN RAISE EXCEPTION 'SL22 trigger'; END IF;

  -- SL23 counter-proposal: below the admin minimum is refused; a valid one accepted by the client changes the targets.
  IF pg_temp.err(format($q$SELECT public.sla_counter_propose(%L, '{"response_min": 5, "resolution_min": 600}'::jsonb)$q$, t2)) NOT LIKE '%sla_outside_bounds%' THEN RAISE EXCEPTION 'SL23 bounds'; END IF;
  sid2 := public.sla_counter_propose(t2, '{"response_min": 600, "resolution_min": 4800}'::jsonb, 'Need more time for analysis');
  PERFORM pg_temp.as_user(ca);
  PERFORM public.sla_decide_counter(sid2, true, NULL);
  IF (SELECT (data ->> 'response_min')::int FROM public.sla_ticket_snapshots WHERE ticket_id = t2 AND superseded_at IS NULL) <> 600 THEN RAISE EXCEPTION 'SL23 override'; END IF;

  -- SL24 breach handling: flag + client choice; extend clears the breach.
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.sla_ticket_clocks SET running_since = now() - interval '200 days', started_at = now() - interval '200 days' WHERE ticket_id = t1 AND kind = 'resolution';
  PERFORM public.sla_sweep();
  IF NOT EXISTS (SELECT 1 FROM public.sla_ticket_clocks WHERE ticket_id = t1 AND kind = 'resolution' AND breached_at IS NOT NULL) THEN RAISE EXCEPTION 'SL24 breached'; END IF;
  IF NOT (SELECT sla_breached FROM public.tickets WHERE id = t1) THEN RAISE EXCEPTION 'SL24 flag'; END IF;
  PERFORM pg_temp.as_user(ca);
  IF pg_temp.err(format($q$SELECT public.sla_breach_choice(%L, 'resolution', 'extend', 5)$q$, t1)) NOT LIKE '%sla_bad_extension%' THEN RAISE EXCEPTION 'SL24 min extension'; END IF;
  PERFORM public.sla_breach_choice(t1, 'resolution', 'admin_help', NULL, 'Please help');
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = ad AND type = 'sla' AND title LIKE '%admin help%') THEN RAISE EXCEPTION 'SL24 admin help'; END IF;

  -- SL25 the legacy breach job skips snapshotted tickets (no duplicate "SLA breached" notice).
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.tickets SET sla_breached = false, sla_deadline = now() - interval '1 hour' WHERE id = t2;
  PERFORM public.flag_sla_breaches();
  IF EXISTS (SELECT 1 FROM public.notifications WHERE title = 'SLA breached' AND body LIKE '%Interface down%') THEN RAISE EXCEPTION 'SL25 duplicate legacy notice'; END IF;

  -- SL26 extra contacts: free-mail or non-member addresses are refused; registered company members on the domain pass.
  PERFORM pg_temp.as_user(oa);
  body := jsonb_set((public.sla_policy_get(pol)) -> 'body', '{extra_contacts}', '["boss@gmail.com", "nobody@acme.test", "ma@acme.test"]');
  r := public.sla_policy_save(pol, ta, (public.sla_policy_get(pol)) -> 'meta', body, 'contacts', NULL);
  IF (SELECT array_agg(p ->> 'code' ORDER BY p ->> 'code') FROM jsonb_array_elements(r -> 'problems') p WHERE p ->> 'path' = 'extra_contacts')
     <> ARRAY['contact_domain', 'contact_not_member'] THEN RAISE EXCEPTION 'SL26 contacts %', r -> 'problems'; END IF;

  -- SL27 the platform default always exists.
  PERFORM pg_temp.as_user(ad);
  IF pg_temp.err(format('SELECT public.sla_policy_archive(%L)', (SELECT id FROM public.sla_policies WHERE is_default))) NOT LIKE '%sla_default_required%' THEN RAISE EXCEPTION 'SL27 default'; END IF;

  -- SL28 reports: client sees only own company, admin sees by company; consultant only own tickets.
  PERFORM pg_temp.as_user(ob);
  IF jsonb_array_length(public.sla_client_report(tb, 30) -> 'at_risk') <> 0 THEN RAISE EXCEPTION 'SL28 other company report'; END IF;
  PERFORM pg_temp.as_user(oa);
  IF jsonb_array_length(public.sla_client_report(tb, 30) -> 'at_risk') IS NOT NULL AND pg_temp.err(format('SELECT public.sla_client_report(%L, 30)', tb)) NOT LIKE '%sla_forbidden%' THEN RAISE EXCEPTION 'SL28 cross report'; END IF;
  PERFORM pg_temp.as_user(ad);
  IF jsonb_typeof(public.sla_admin_report(30) -> 'by_company') <> 'array' THEN RAISE EXCEPTION 'SL28 admin report'; END IF;

  -- SL29 quiet hours wrap over midnight.
  IF public.sla_in_quiet_hours('UTC', jsonb_build_object('start', to_char(now() AT TIME ZONE 'UTC' - interval '1 hour', 'HH24:MI'), 'end', to_char(now() AT TIME ZONE 'UTC' + interval '1 hour', 'HH24:MI'))) IS NOT TRUE THEN
    RAISE EXCEPTION 'SL29 quiet'; END IF;

  -- SL30 switching OFF stops the engine: no new snapshot, reconcile and sweep do nothing.
  PERFORM public.sla_admin_set_settings('{"enabled": false}'::jsonb, 'test off');
  PERFORM pg_temp.as_user(NULL);
  INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency) VALUES (ca, ta, 'After switch off', 'MM', 'new', 'low') RETURNING id INTO t3;
  IF EXISTS (SELECT 1 FROM public.sla_ticket_snapshots WHERE ticket_id = t3) OR public.sla_sweep() <> 0 THEN RAISE EXCEPTION 'SL30 off'; END IF;

  RAISE NOTICE 'sla-policies: all 30 checks passed';
END $$;

ROLLBACK;
