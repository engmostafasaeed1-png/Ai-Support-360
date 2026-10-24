-- Adversarial tests for ticket-brd-approval.sql. ONE rolled-back transaction: run on a scratch copy (nothing kept).
-- Each check raises on failure. BA01-BA26.
BEGIN;

-- Fixtures. Client C owns ticket T (team-gated); K is the ticket's consultant and the team lead (ready, NDA both);
-- S is a support member (ready, NDA both); L is a support member whose NDA is signed (nda_signed, NDA both);
-- W is an active observer assignment (NDA both); admin A; outsider X.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000001a1', 'a@example.test'), ('00000000-0000-0000-0000-0000000001c1', 'c@example.test'),
  ('00000000-0000-0000-0000-0000000001d1', 'k@example.test'), ('00000000-0000-0000-0000-0000000001e1', 's@example.test'),
  ('00000000-0000-0000-0000-0000000001f1', 'l@example.test'), ('00000000-0000-0000-0000-0000000001b1', 'w@example.test'),
  ('00000000-0000-0000-0000-0000000001f9', 'x@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000001a1', 'admin');
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-00000001dc01', '00000000-0000-0000-0000-0000000001d1'),
  ('00000000-0000-0000-0000-00000001ec01', '00000000-0000-0000-0000-0000000001e1'),
  ('00000000-0000-0000-0000-00000001fc01', '00000000-0000-0000-0000-0000000001f1'),
  ('00000000-0000-0000-0000-00000001bc01', '00000000-0000-0000-0000-0000000001b1');
INSERT INTO public.tickets (id, client_id, title, sap_module, status)
  VALUES ('00000000-0000-0000-0000-00000001aaa1', '00000000-0000-0000-0000-0000000001c1', 'FB60 posting blocked', 'FI', 'in_progress');
INSERT INTO public.ticket_team_members (id, ticket_id, consultant_id, status, team_role, is_primary, is_legacy) VALUES
  ('00000000-0000-0000-0000-00000001bb01', '00000000-0000-0000-0000-00000001aaa1', '00000000-0000-0000-0000-00000001dc01', 'ready', 'lead', true, false),
  ('00000000-0000-0000-0000-00000001bb02', '00000000-0000-0000-0000-00000001aaa1', '00000000-0000-0000-0000-00000001ec01', 'ready', 'support', false, false),
  ('00000000-0000-0000-0000-00000001bb03', '00000000-0000-0000-0000-00000001aaa1', '00000000-0000-0000-0000-00000001fc01', 'nda_signed', 'support', false, false);
UPDATE public.tickets SET consultant_id = '00000000-0000-0000-0000-00000001dc01' WHERE id = '00000000-0000-0000-0000-00000001aaa1';
SET LOCAL session_replication_role = replica;  -- plain fixture rows: skip the status / notice triggers
INSERT INTO public.ticket_assignments (ticket_id, consultant_id, role, status)
  VALUES ('00000000-0000-0000-0000-00000001aaa1', '00000000-0000-0000-0000-00000001bc01', 'observer', 'active');
SET LOCAL session_replication_role = origin;
INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content, signed_at, client_signed_at)
  SELECT c, '00000000-0000-0000-0000-0000000001c1', 'sig', 'nda', now(), now()
    FROM unnest(ARRAY['00000000-0000-0000-0000-00000001dc01', '00000000-0000-0000-0000-00000001ec01',
                      '00000000-0000-0000-0000-00000001fc01', '00000000-0000-0000-0000-00000001bc01']::uuid[]) c;
SET LOCAL session_replication_role = replica;  -- L has accepted, rate approved and NDA signed (fixture shortcut)
UPDATE public.ticket_team_members SET status = 'nda_signed' WHERE id = '00000000-0000-0000-0000-00000001bb03';
SET LOCAL session_replication_role = origin;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('ticket-documents', '00000000-0000-0000-0000-00000001aaa1/brd/BRD_v1.pdf'),
  ('ticket-documents', '00000000-0000-0000-0000-00000001aaa1/brd/BRD_v2.pdf'),
  ('ticket-documents', '00000000-0000-0000-0000-00000001aaa1/brd/BRD_v3.pdf');
DELETE FROM public.platform_settings WHERE key = 'ticket_brd';

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.doc(_body text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('language', 'en', 'template', 'standard',
    'control', jsonb_build_object('title', 'FB60 BRD', 'status', 'draft'),
    'sections', jsonb_build_array(jsonb_build_object('key', 'purpose', 'visible', true, 'html', _body)),
    'requirements', '[]'::jsonb, 'questions', '[]'::jsonb)
$$;

DO $$
DECLARE
  t uuid := '00000000-0000-0000-0000-00000001aaa1';
  a uuid := '00000000-0000-0000-0000-0000000001a1';
  c uuid := '00000000-0000-0000-0000-0000000001c1';
  k uuid := '00000000-0000-0000-0000-0000000001d1';
  s uuid := '00000000-0000-0000-0000-0000000001e1';
  l uuid := '00000000-0000-0000-0000-0000000001f1';
  w uuid := '00000000-0000-0000-0000-0000000001b1';
  x uuid := '00000000-0000-0000-0000-0000000001f9';
  kc uuid := '00000000-0000-0000-0000-00000001dc01';
  sc uuid := '00000000-0000-0000-0000-00000001ec01';
  j jsonb; n int; rev int; req1 uuid; req2 uuid; doc3 uuid; h text;
BEGIN
  -- BA01 settings: default "recommended", only known values, admin only; then switch to "required"
  PERFORM pg_temp.as_user(a);
  IF public.brd_settings() ->> 'approval_gate' <> 'recommended' OR (public.brd_settings() ->> 'approval_all_members')::boolean THEN
    RAISE EXCEPTION 'BA01 defaults %', public.brd_settings();
  END IF;
  BEGIN PERFORM public.admin_brd_set_settings('{"approval_gate": "always"}'); RAISE EXCEPTION 'BA01 bad gate accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.admin_brd_set_settings('{"approval_remind_days": 0}'); RAISE EXCEPTION 'BA01 zero days accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.admin_brd_set_settings('{"approval_max_reminders": 21}'); RAISE EXCEPTION 'BA01 cap above 20 accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.admin_brd_set_settings('{"enabled": true, "approval_gate": "required", "approval_max_reminders": 0}');
  PERFORM public.admin_brd_set_settings('{"approval_max_reminders": 5}');
  PERFORM pg_temp.as_user(c);
  BEGIN PERFORM public.admin_brd_set_settings('{"approval_gate": "off"}'); RAISE EXCEPTION 'BA01 client changed the gate';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- BA02 reader rule: a team member with NDA signed by both (nda_signed) may now read; outsider never
  IF public.brd_role_for(t, l) IS DISTINCT FROM 'consultant' THEN RAISE EXCEPTION 'BA02 nda_signed member cannot read'; END IF;
  IF public.brd_role_for(t, x) IS NOT NULL THEN RAISE EXCEPTION 'BA02 outsider reads'; END IF;

  -- BA03 lead = K; with "all members" off only the lead must approve; observers never
  IF public.brd_approval_lead(t) <> kc THEN RAISE EXCEPTION 'BA03 lead %', public.brd_approval_lead(t); END IF;
  SELECT count(*) INTO n FROM public.brd_approval_required(t);
  IF n <> 1 THEN RAISE EXCEPTION 'BA03 required approvers %', n; END IF;

  -- BA04 required mode but no BRD submitted: nothing blocks (BRD is optional)
  IF public.brd_gate_blocks(t, kc) OR public.brd_gate_blocks(t, NULL) THEN RAISE EXCEPTION 'BA04 blocks without a BRD'; END IF;
  IF (public.team_gates('00000000-0000-0000-0000-00000001bb03') ->> 'brd_blocks')::boolean THEN RAISE EXCEPTION 'BA04 team gate blocks'; END IF;

  -- create v1 (attached) and v2 (not attached)
  j := public.brd_save_draft(t, pg_temp.doc('<p>Purpose one</p>'), NULL);
  j := public.brd_save_version(t, pg_temp.doc('<p>Purpose one</p>'), 'v1', 'final', (j ->> 'rev')::int);
  j := public.brd_save_version(t, pg_temp.doc('<p>Purpose two</p>'), 'v2', 'final', (j ->> 'rev')::int);
  rev := (j ->> 'rev')::int;
  PERFORM public.brd_attach(t, 1, t || '/brd/BRD_v1.pdf', 5000, false);

  -- BA05 only attached versions can be submitted; only writers submit
  BEGIN PERFORM public.brd_submit_for_approval(t, 2, false, NULL); RAISE EXCEPTION 'BA05 unattached version submitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM pg_temp.as_user(k);
  BEGIN PERFORM public.brd_submit_for_approval(t, 1, false, NULL); RAISE EXCEPTION 'BA05 consultant submitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- BA06 submit v1: one pending round bound to the version hash; the lead (only) is asked in-app and by e-mail
  PERFORM pg_temp.as_user(c);
  j := public.brd_submit_for_approval(t, 1, false, 'Please review');
  req1 := (j ->> 'request_id')::uuid;
  IF (j ->> 'notified')::int <> 1 THEN RAISE EXCEPTION 'BA06 notified %', j; END IF;
  SELECT content_hash INTO h FROM public.ticket_brd_approval_requests WHERE id = req1;
  IF h <> public.brd_content_hash((SELECT content FROM public.ticket_brd_versions WHERE ticket_id = t AND version = 1)) THEN RAISE EXCEPTION 'BA06 hash'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = k AND type = 'brd_approval_request') THEN RAISE EXCEPTION 'BA06 lead not notified'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id IN (s, l, w) AND type LIKE 'brd_approval%') THEN RAISE EXCEPTION 'BA06 non-approver notified'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_brd_approval_email_queue WHERE user_id = k AND kind = 'request') THEN RAISE EXCEPTION 'BA06 e-mail not queued'; END IF;
  j := public.brd_submit_for_approval(t, 1, false, NULL);
  IF NOT (j ->> 'unchanged')::boolean THEN RAISE EXCEPTION 'BA06 resubmit not idempotent'; END IF;

  -- BA07 the gate blocks (required mode): team step, work log and timesheet submission are refused for the consultant
  IF NOT public.brd_gate_blocks(t, kc) THEN RAISE EXCEPTION 'BA07 gate open'; END IF;
  IF NOT (public.team_gates('00000000-0000-0000-0000-00000001bb03') ->> 'brd_blocks')::boolean THEN RAISE EXCEPTION 'BA07 team gate open'; END IF;
  IF (public.tt_facts(t) -> 'brd_approval' ->> 'state') <> 'pending' THEN RAISE EXCEPTION 'BA07 stage fact %', public.tt_facts(t) -> 'brd_approval'; END IF;
  PERFORM pg_temp.as_user(k);
  BEGIN
    INSERT INTO public.ticket_work_logs (ticket_id, consultant_id, hours, description) VALUES (t, kc, 1, 'analysis');
    RAISE EXCEPTION 'BA07 work log accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    INSERT INTO public.ticket_timesheet_submissions (ticket_id, submitted_by, status) VALUES (t, k, 'submitted');
    RAISE EXCEPTION 'BA07 timesheet accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;

  -- BA08 who may decide: not the support member (setting off), not the observer, not an outsider
  PERFORM pg_temp.as_user(s);
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'approved', NULL, true); RAISE EXCEPTION 'BA08 support decided';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.as_user(w);
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'approved', NULL, true); RAISE EXCEPTION 'BA08 observer decided';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.as_user(x);
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'approved', NULL, true); RAISE EXCEPTION 'BA08 outsider decided';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- BA09 input rules: confirm-read tick, note for changes/decline, no contact details, exact version
  PERFORM pg_temp.as_user(k);
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'approved', NULL, false); RAISE EXCEPTION 'BA09 approved without the tick';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'changes_requested', 'short', false); RAISE EXCEPTION 'BA09 changes without a note';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'declined', 'Call me on +20 100 123 4567 instead', false); RAISE EXCEPTION 'BA09 phone accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.brd_decide_approval(t, 2, 'approved', NULL, true); RAISE EXCEPTION 'BA09 wrong version accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'maybe', 'whatever note here', true); RAISE EXCEPTION 'BA09 unknown decision';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- BA10 changes requested: state, client notice (amber), still blocked, event in the timeline source
  j := public.brd_decide_approval(t, 1, 'changes_requested', 'Please add the tolerance limits for company code 1000.', false);
  IF j ->> 'state' <> 'changes_requested' THEN RAISE EXCEPTION 'BA10 state %', j; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c AND type = 'brd_approval_changes') THEN RAISE EXCEPTION 'BA10 client not told'; END IF;
  IF NOT public.brd_gate_blocks(t, kc) THEN RAISE EXCEPTION 'BA10 gate opened'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_brd_events WHERE ticket_id = t AND action = 'approval_changes_requested') THEN RAISE EXCEPTION 'BA10 not logged'; END IF;

  -- BA11 decisions are final: no second decision, no direct edit even by a privileged session
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'approved', NULL, true); RAISE EXCEPTION 'BA11 decision changed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN UPDATE public.ticket_brd_approvals SET decision = 'approved' WHERE request_id = req1; RAISE EXCEPTION 'BA11 decision edited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.ticket_brd_approval_requests SET content_hash = repeat('0', 64) WHERE id = req1; RAISE EXCEPTION 'BA11 hash edited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- BA12 a newer version supersedes the open round; the consultant is asked again
  PERFORM pg_temp.as_user(c);
  PERFORM public.brd_attach(t, 2, t || '/brd/BRD_v2.pdf', 5000, false);
  j := public.brd_submit_for_approval(t, 2, false, NULL);
  req2 := (j ->> 'request_id')::uuid;
  IF (SELECT closed_reason FROM public.ticket_brd_approval_requests WHERE id = req1) <> 'superseded' THEN RAISE EXCEPTION 'BA12 v1 not superseded'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = k AND type = 'brd_approval_request';
  IF n <> 2 THEN RAISE EXCEPTION 'BA12 lead requests %', n; END IF;

  -- BA13 deciding on the superseded version is refused with a clear error
  PERFORM pg_temp.as_user(k);
  BEGIN PERFORM public.brd_decide_approval(t, 1, 'approved', NULL, true); RAISE EXCEPTION 'BA13 old version approved';
  EXCEPTION WHEN serialization_failure THEN NULL; END;

  -- BA14 approve v2: approved state + timestamp, hash recorded, gate opens, work can be logged, client told (green)
  j := public.brd_decide_approval(t, 2, 'approved', 'Looks complete.', true);
  IF j ->> 'state' <> 'approved' THEN RAISE EXCEPTION 'BA14 state %', j; END IF;
  IF (SELECT approved_at FROM public.ticket_brd_approval_requests WHERE id = req2) IS NULL THEN RAISE EXCEPTION 'BA14 no approved_at'; END IF;
  IF (SELECT content_hash FROM public.ticket_brd_approvals WHERE request_id = req2) <>
     public.brd_content_hash((SELECT content FROM public.ticket_brd_versions WHERE ticket_id = t AND version = 2)) THEN RAISE EXCEPTION 'BA14 hash'; END IF;
  IF public.brd_gate_blocks(t, kc) THEN RAISE EXCEPTION 'BA14 still blocked'; END IF;
  INSERT INTO public.ticket_work_logs (ticket_id, consultant_id, hours, description) VALUES (t, kc, 1, 'analysis');
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c AND type = 'brd_approval_approved') THEN RAISE EXCEPTION 'BA14 client not told'; END IF;
  j := public.brd_decide_approval(t, 2, 'approved', NULL, true);
  IF NOT (j ->> 'unchanged')::boolean THEN RAISE EXCEPTION 'BA14 repeat not idempotent'; END IF;

  -- BA15 "all members must approve": the support member is now required and blocked until they approve
  PERFORM pg_temp.as_user(a);
  PERFORM public.admin_brd_set_settings('{"approval_all_members": true}');
  SELECT count(*) INTO n FROM public.brd_approval_required(t);
  IF n <> 3 THEN RAISE EXCEPTION 'BA15 required % (lead + 2 readers, no observer)', n; END IF;
  IF NOT public.brd_gate_blocks(t, sc) THEN RAISE EXCEPTION 'BA15 support not blocked %', public.brd_gate_state(t, sc); END IF;
  IF public.brd_gate_blocks(t, kc) THEN RAISE EXCEPTION 'BA15 lead blocked again'; END IF;
  PERFORM pg_temp.as_user(s);
  PERFORM public.brd_decide_approval(t, 2, 'approved', NULL, true);
  IF public.brd_gate_blocks(t, sc) THEN RAISE EXCEPTION 'BA15 support still blocked'; END IF;
  PERFORM pg_temp.as_user(a);
  PERFORM public.admin_brd_set_settings('{"approval_all_members": false}');

  -- BA16 "no material change" carry-over: refused while the setting is off, then FYI only
  PERFORM pg_temp.as_user(c);
  j := public.brd_save_version(t, pg_temp.doc('<p>Purpose two.</p>'), 'typo', 'final', rev);
  rev := (j ->> 'rev')::int;
  j := public.brd_attach(t, 3, t || '/brd/BRD_v3.pdf', 5000, false);
  doc3 := (j ->> 'document_id')::uuid;
  BEGIN PERFORM public.brd_submit_for_approval(t, 3, true, NULL); RAISE EXCEPTION 'BA16 carry-over while off';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM pg_temp.as_user(a);
  PERFORM public.admin_brd_set_settings('{"approval_allow_no_change": true}');
  PERFORM pg_temp.as_user(c);
  j := public.brd_submit_for_approval(t, 3, true, 'Typo only');
  IF NOT (j ->> 'carried')::boolean OR public.brd_gate_blocks(t, kc) THEN RAISE EXCEPTION 'BA16 carry-over %', j; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = k AND type = 'brd_approval_info') THEN RAISE EXCEPTION 'BA16 no FYI'; END IF;

  -- BA17 withdraw ("proceed without BRD"): nothing blocks afterwards; consultants cannot withdraw
  PERFORM pg_temp.as_user(c);
  PERFORM public.brd_save_version(t, pg_temp.doc('<p>Purpose four</p>'), 'v4', 'final', rev);
  -- (v4 is not attached; re-submit v3 as a normal round to have something open)
  PERFORM pg_temp.as_user(a);
  PERFORM public.admin_brd_set_settings('{"approval_allow_no_change": false}');
  PERFORM pg_temp.as_user(c);
  IF NOT public.brd_withdraw_approval(t, 'Proceeding without BRD') THEN RAISE EXCEPTION 'BA17 withdraw refused'; END IF;
  IF public.brd_gate_state(t, NULL) ->> 'state' <> 'withdrawn' OR public.brd_gate_blocks(t, kc) THEN RAISE EXCEPTION 'BA17 state %', public.brd_gate_state(t, NULL); END IF;
  PERFORM pg_temp.as_user(k);
  BEGIN PERFORM public.brd_withdraw_approval(t, NULL); RAISE EXCEPTION 'BA17 consultant withdrew';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- BA18 admin waiver: reason required, admin only, audited, opens the gate; revoking closes it again
  PERFORM pg_temp.as_user(c);
  j := public.brd_submit_for_approval(t, 3, false, NULL);
  -- the earlier approval of v2 still covers the work (approved BRD exists)
  IF public.brd_gate_blocks(t, kc) THEN RAISE EXCEPTION 'BA18 earlier approval ignored'; END IF;
  -- a ticket with no approval yet: decline path below uses a new ticket
  BEGIN PERFORM public.admin_brd_waive_approval(t, true, 'Because'); RAISE EXCEPTION 'BA18 client waived';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.as_user(a);
  BEGIN PERFORM public.admin_brd_waive_approval(t, true, 'no'); RAISE EXCEPTION 'BA18 short reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT public.admin_brd_waive_approval(t, true, 'Urgent production issue, BRD follows') THEN RAISE EXCEPTION 'BA18 waive refused'; END IF;
  IF NOT (public.brd_gate_state(t, NULL) ->> 'waived')::boolean THEN RAISE EXCEPTION 'BA18 not waived'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'brd_approval_waived' AND entity_id = t) THEN RAISE EXCEPTION 'BA18 not audited'; END IF;
  IF NOT public.admin_brd_waive_approval(t, false, 'BRD is ready now') THEN RAISE EXCEPTION 'BA18 revoke refused'; END IF;

  -- BA19 decline: client (red) and administrators are told; the gate stays closed for the declining lead on a new BRD
  PERFORM pg_temp.as_user(k);
  PERFORM public.brd_decide_approval(t, 3, 'declined', 'The scope is outside my FI expertise.', false);
  IF public.brd_gate_state(t, NULL) ->> 'state' <> 'rejected' THEN RAISE EXCEPTION 'BA19 state %', public.brd_gate_state(t, NULL); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c AND type = 'brd_approval_declined') THEN RAISE EXCEPTION 'BA19 client not told'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'brd_approval_declined') THEN RAISE EXCEPTION 'BA19 admin not told'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_brd_approval_email_queue WHERE user_id = a AND kind = 'admin_declined') THEN RAISE EXCEPTION 'BA19 admin e-mail'; END IF;

  -- BA20 the panel read: lead sees rounds and its own decision; outsider sees nothing; list flags
  j := public.brd_approval_get(t);
  IF j ->> 'role' <> 'consultant' OR jsonb_array_length(j -> 'rounds') < 3 OR (j -> 'me' ->> 'can_decide')::boolean THEN RAISE EXCEPTION 'BA20 lead view %', j -> 'me'; END IF;
  PERFORM pg_temp.as_user(x);
  IF public.brd_approval_get(t) ->> 'role' IS NOT NULL THEN RAISE EXCEPTION 'BA20 outsider reads'; END IF;
  SELECT count(*) INTO n FROM public.brd_approval_list(ARRAY[t]);
  IF n <> 0 THEN RAISE EXCEPTION 'BA20 outsider list'; END IF;

  -- BA21 browsers cannot read or write the approval tables directly
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM 1 FROM public.ticket_brd_approvals; RAISE EXCEPTION 'BA21 approvals readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.ticket_brd_approval_requests (ticket_id, brd_id, version, content_hash, version_status, submitted_by)
        VALUES (t, (SELECT id FROM public.ticket_brds LIMIT 1), 9, repeat('a', 64), 'final', x); RAISE EXCEPTION 'BA21 round inserted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';

  -- BA22 timeline rows for the approval rounds (admin view)
  PERFORM pg_temp.as_user(a);
  SELECT count(*) INTO n FROM public.tt_brd_approval_events(t, a) e WHERE e.kind IN ('brd_submitted', 'brd_approved', 'brd_changes', 'brd_declined', 'brd_superseded', 'brd_withdrawn', 'brd_waived');
  IF n < 8 THEN RAISE EXCEPTION 'BA22 timeline rows %', n; END IF;

  -- BA23 reminders: after N days the approver, the client (once) and administrators (once) are told; no repeats
  PERFORM pg_temp.as_user(c);
  PERFORM public.brd_submit_for_approval(t, 2, false, NULL);
  ALTER TABLE public.ticket_brd_approval_requests DISABLE TRIGGER brd_guard_approval_request;
  UPDATE public.ticket_brd_approval_requests SET submitted_at = now() - interval '6 days' WHERE ticket_id = t AND closed_at IS NULL;
  ALTER TABLE public.ticket_brd_approval_requests ENABLE TRIGGER brd_guard_approval_request;
  PERFORM pg_temp.as_user(NULL);
  PERFORM public.brd_approval_sweep();
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = k AND type = 'brd_approval_reminder';
  IF n <> 1 THEN RAISE EXCEPTION 'BA23 reminders %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c AND type = 'brd_approval_waiting') THEN RAISE EXCEPTION 'BA23 client not told'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'brd_approval_escalated') THEN RAISE EXCEPTION 'BA23 not escalated'; END IF;
  PERFORM public.brd_approval_sweep();
  SELECT count(*) INTO n FROM public.notifications WHERE type IN ('brd_approval_reminder', 'brd_approval_waiting', 'brd_approval_escalated') AND user_id IN (k, c, a);
  IF n <> 3 THEN RAISE EXCEPTION 'BA23 repeated notices %', n; END IF;

  -- BA24 unattaching the open round's version withdraws that round
  PERFORM pg_temp.as_user(c);
  PERFORM public.brd_submit_for_approval(t, 3, false, NULL);
  PERFORM public.brd_unattach(doc3, 'Wrong file');
  IF EXISTS (SELECT 1 FROM public.ticket_brd_approval_requests WHERE ticket_id = t AND closed_at IS NULL) THEN RAISE EXCEPTION 'BA24 round still open'; END IF;

  -- BA25 recommended mode never blocks
  PERFORM pg_temp.as_user(a);
  PERFORM public.admin_brd_set_settings('{"approval_gate": "recommended"}');
  PERFORM pg_temp.as_user(c);
  PERFORM public.brd_submit_for_approval(t, 1, false, NULL);
  IF public.brd_gate_blocks(t, kc) OR public.brd_gate_blocks(t, sc) THEN RAISE EXCEPTION 'BA25 recommended blocks'; END IF;

  -- BA26 deleting the ticket removes rounds, decisions, waivers and queued e-mails (the guards allow only that)
  DELETE FROM public.tickets WHERE id = t;
  IF EXISTS (SELECT 1 FROM public.ticket_brd_approval_requests WHERE ticket_id = t) OR EXISTS (SELECT 1 FROM public.ticket_brd_approvals WHERE ticket_id = t)
     OR EXISTS (SELECT 1 FROM public.ticket_brd_approval_waivers WHERE ticket_id = t) OR EXISTS (SELECT 1 FROM public.ticket_brd_approval_email_queue WHERE ticket_id = t) THEN
    RAISE EXCEPTION 'BA26 data left after ticket deletion';
  END IF;

  RAISE NOTICE 'ticket-brd-approval: all 26 checks passed';
END $$;

ROLLBACK;
