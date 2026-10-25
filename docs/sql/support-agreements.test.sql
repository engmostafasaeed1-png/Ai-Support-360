-- Adversarial tests for support-agreements.sql. ONE rolled-back transaction: run on a scratch copy (nothing kept).
-- Each check raises on failure. SA01-SA36.
BEGIN;

-- Fixtures: company A (owner OA), company B (owner OB), admin AD; consultants K (verified, FI) and U (verified, FI)
-- apply; X is an unrelated consultant (not verified, MM only).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000006a001', 'ad@platform.test'), ('00000000-0000-0000-0000-00000006a002', 'oa@acme.test'),
  ('00000000-0000-0000-0000-00000006a005', 'ob@beta.test'), ('00000000-0000-0000-0000-00000006a006', 'k@cons.test'),
  ('00000000-0000-0000-0000-00000006a007', 'u@cons.test'), ('00000000-0000-0000-0000-00000006a008', 'x@cons.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-00000006a001', 'admin'), ('00000000-0000-0000-0000-00000006a002', 'client'), ('00000000-0000-0000-0000-00000006a005', 'client'),
  ('00000000-0000-0000-0000-00000006a006', 'consultant'), ('00000000-0000-0000-0000-00000006a007', 'consultant'), ('00000000-0000-0000-0000-00000006a008', 'consultant')
ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, name, slug) VALUES ('00000000-0000-0000-0000-00000006ae01', 'Acme', 'acme-sa-test'), ('00000000-0000-0000-0000-00000006ae02', 'Beta', 'beta-sa-test');
INSERT INTO public.tenant_members (tenant_id, user_id, org_role, accepted_at) VALUES
  ('00000000-0000-0000-0000-00000006ae01', '00000000-0000-0000-0000-00000006a002', 'owner', now()),
  ('00000000-0000-0000-0000-00000006ae02', '00000000-0000-0000-0000-00000006a005', 'owner', now());
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-00000006c006', '00000000-0000-0000-0000-00000006a006'),
  ('00000000-0000-0000-0000-00000006c007', '00000000-0000-0000-0000-00000006a007'),
  ('00000000-0000-0000-0000-00000006c008', '00000000-0000-0000-0000-00000006a008');
SET LOCAL session_replication_role = replica;  -- plain fixture values (verification is guarded by triggers)
UPDATE public.consultants SET verification_status = 'verified' WHERE id IN ('00000000-0000-0000-0000-00000006c006', '00000000-0000-0000-0000-00000006c007');
INSERT INTO public.consultant_skills (consultant_id, sap_module) VALUES
  ('00000000-0000-0000-0000-00000006c006', 'FI'), ('00000000-0000-0000-0000-00000006c007', 'FI'), ('00000000-0000-0000-0000-00000006c008', 'MM');
SET LOCAL session_replication_role = origin;
INSERT INTO public.platform_settings (key, value) VALUES ('service_fee_percent', '10'), ('processing_fee_percent', '5'), ('vat_percent', '15')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
DELETE FROM public.platform_settings WHERE key = 'support_agreements';

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN ''; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE OR REPLACE FUNCTION pg_temp.terms(_start date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('name', 'FI support', 'scope', jsonb_build_object('modules', jsonb_build_array('FI'), 'versions', '[]'::jsonb, 'systems', '[]'::jsonb, 'covered', 'Incidents', 'not_covered', 'Projects'),
    'term', jsonb_build_object('start_date', _start, 'end_date', (_start + interval '12 months')::date, 'notice_days', 30, 'auto_renew', false, 'renew_months', 12),
    'model', 'hours_bank', 'bank', jsonb_build_object('hours_per_month', 40, 'rollover', 'none', 'rollover_hours', 0, 'rollover_months', 0, 'unused', 'charge'),
    'rate', jsonb_build_object('currency', 'USD'), 'sla', jsonb_build_object('summary', 'S2 response 2 h'), 'nda_required', true, 'reporting', 'monthly')
$$;

DO $$
DECLARE
  ad uuid := '00000000-0000-0000-0000-00000006a001'; oa uuid := '00000000-0000-0000-0000-00000006a002'; ob uuid := '00000000-0000-0000-0000-00000006a005';
  k uuid := '00000000-0000-0000-0000-00000006a006'; u uuid := '00000000-0000-0000-0000-00000006a007'; x uuid := '00000000-0000-0000-0000-00000006a008';
  ta uuid := '00000000-0000-0000-0000-00000006ae01'; kc uuid := '00000000-0000-0000-0000-00000006c006'; uc uuid := '00000000-0000-0000-0000-00000006c007';
  aid uuid; a2 uuid; app_k uuid; app_u uuid; off uuid; v int; h text; r jsonb; t1 uuid; t2 uuid; chg uuid; n int;
BEGIN
  -- SA01 switch OFF by default: nothing can be created.
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format($q$SELECT public.sa_create(%L, '{}'::jsonb, '{}'::jsonb)$q$, ta)) NOT LIKE '%sa_disabled%' THEN RAISE EXCEPTION 'SA01 off'; END IF;
  PERFORM pg_temp.as_user(ad);
  PERFORM public.sa_admin_set_settings('{"enabled": true}'::jsonb, 'test');
  -- SA02 only admins change settings; fee bounded.
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err($q$SELECT public.sa_admin_set_settings('{"enabled": false}'::jsonb)$q$) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA02 settings'; END IF;

  -- SA03 client owner creates and publishes a request (start today).
  aid := public.sa_create(ta, jsonb_build_object('modules', jsonb_build_array('FI'), 'expected_hours', 40, 'budget', jsonb_build_object('min', 80, 'max', 120)), pg_temp.terms(current_date));
  PERFORM public.sa_publish(aid, now() + interval '7 days', false, '{}');
  IF (SELECT status FROM public.sa_agreements WHERE id = aid) <> 'open' THEN RAISE EXCEPTION 'SA03 open'; END IF;

  -- SA04 visibility: verified FI consultant sees it (budget hidden), unrelated consultant and other company do not.
  PERFORM pg_temp.as_user(k);
  r := public.sa_opportunities();
  IF jsonb_array_length(r) <> 1 OR (r -> 0 -> 'request') ? 'budget' THEN RAISE EXCEPTION 'SA04 candidate %', r; END IF;
  PERFORM pg_temp.as_user(x);
  IF jsonb_array_length(public.sa_opportunities()) <> 0 OR pg_temp.err(format('SELECT public.sa_get(%L)', aid)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA04 unrelated consultant'; END IF;
  PERFORM pg_temp.as_user(ob);
  IF pg_temp.err(format('SELECT public.sa_get(%L)', aid)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA04 third party'; END IF;

  -- SA05 applications: SLA acceptance required, rate bounds enforced server-side.
  PERFORM pg_temp.as_user(k);
  IF pg_temp.err(format($q$SELECT public.sa_apply(%L, 100, 'USD', 'hours_bank', NULL, '', false, 'hi')$q$, aid)) NOT LIKE '%sa_sla_acceptance_required%' THEN RAISE EXCEPTION 'SA05 sla'; END IF;
  IF pg_temp.err(format($q$SELECT public.sa_apply(%L, 5, 'USD', 'hours_bank', NULL, '', true, 'hi')$q$, aid)) NOT LIKE '%sa_rate_out_of_bounds%' THEN RAISE EXCEPTION 'SA05 bounds'; END IF;
  IF pg_temp.err(format($q$SELECT public.sa_apply(%L, 100, 'USD', 'hours_bank', NULL, '', true, 'call +966 55 123 4567')$q$, aid)) NOT LIKE '%sa_contact_details%' THEN RAISE EXCEPTION 'SA05 M60'; END IF;
  app_k := public.sa_apply(aid, 100, 'USD', 'hours_bank', NULL, 'Mornings', true, 'Happy to support FI');
  PERFORM pg_temp.as_user(u);
  app_u := public.sa_apply(aid, 90, 'USD', 'hours_bank', NULL, '', true, 'Available');

  -- SA06 an applicant cannot read other applicants' rates or messages.
  PERFORM pg_temp.as_user(k);
  PERFORM public.sa_post_message(aid, NULL, 'Which SAP release do you run?');
  PERFORM pg_temp.as_user(u);
  r := public.sa_get(aid);
  IF r ? 'applications' OR r ? 'terms' OR (r -> 'my_application' ->> 'hourly_rate')::numeric <> 90 OR r::text LIKE '%' || kc || '%' OR jsonb_array_length(r -> 'messages') <> 0 THEN
    RAISE EXCEPTION 'SA06 applicant leak %', r; END IF;
  PERFORM pg_temp.as_user(oa);
  IF jsonb_array_length(public.sa_get(aid) -> 'applications') <> 2 THEN RAISE EXCEPTION 'SA06 client sees all applications'; END IF;

  -- SA07 client selects K -> negotiating v1; U is no longer a party.
  v := public.sa_select_application(app_k);
  IF v <> 1 OR (SELECT status FROM public.sa_agreements WHERE id = aid) <> 'negotiating' THEN RAISE EXCEPTION 'SA07 select'; END IF;
  PERFORM pg_temp.as_user(u);
  IF pg_temp.err(format($q$SELECT public.sa_offer(%L, '{"rate":{"hourly_rate":80}}'::jsonb)$q$, aid)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA07 other applicant offer'; END IF;

  -- SA08 counter flow: client counters 95; the client cannot accept its own offer; the consultant accepts -> v2.
  PERFORM pg_temp.as_user(oa);
  off := public.sa_offer(aid, '{"rate":{"hourly_rate":95}}'::jsonb, 'Annual volume');
  IF pg_temp.err(format('SELECT public.sa_respond_offer(%L, true)', off)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA08 own offer'; END IF;
  h := (SELECT content_hash FROM public.sa_versions WHERE agreement_id = aid AND version = 1);
  IF pg_temp.err(format($q$SELECT public.sa_accept_terms(%L, 1, %L, 'Olivia Owner')$q$, aid, h)) NOT LIKE '%sa_open_offer%' THEN RAISE EXCEPTION 'SA08 accept while offer open'; END IF;
  PERFORM pg_temp.as_user(k);
  v := public.sa_respond_offer(off, true);
  IF v <> 2 OR (SELECT (terms -> 'rate' ->> 'hourly_rate')::numeric FROM public.sa_agreements WHERE id = aid) <> 95 THEN RAISE EXCEPTION 'SA08 counter accepted'; END IF;
  -- Accepting an older version (or a wrong hash) is refused.
  IF pg_temp.err(format($q$SELECT public.sa_accept_terms(%L, 1, %L, 'Karim Consultant')$q$, aid, h)) NOT LIKE '%sa_version_changed%' THEN RAISE EXCEPTION 'SA08 stale version'; END IF;

  -- SA09 both accept v2 -> agreed, immutable rate record 95, admin review pending (first agreement of this pair), U declined.
  h := (SELECT content_hash FROM public.sa_versions WHERE agreement_id = aid AND version = 2);
  r := public.sa_accept_terms(aid, 2, h, 'Karim Consultant');
  IF (r ->> 'agreed')::boolean THEN RAISE EXCEPTION 'SA09 one party only'; END IF;
  PERFORM pg_temp.as_user(oa);
  r := public.sa_accept_terms(aid, 2, h, 'Olivia Owner');
  IF NOT (r ->> 'agreed')::boolean OR (SELECT status FROM public.sa_agreements WHERE id = aid) <> 'agreed'
     OR (SELECT admin_review FROM public.sa_agreements WHERE id = aid) <> 'pending'
     OR (SELECT hourly_rate FROM public.sa_rate_records WHERE agreement_id = aid AND seq = 1) <> 95
     OR (SELECT status FROM public.sa_applications WHERE id = app_u) <> 'declined' THEN RAISE EXCEPTION 'SA09 agreed %', r; END IF;

  -- SA10 agreed rate records and acceptances are append-only.
  PERFORM pg_temp.as_user(NULL);
  IF pg_temp.err(format('UPDATE public.sa_rate_records SET hourly_rate = 1 WHERE agreement_id = %L', aid)) NOT LIKE '%sa_immutable%' THEN RAISE EXCEPTION 'SA10 rate record'; END IF;
  IF pg_temp.err(format('DELETE FROM public.sa_acceptances WHERE agreement_id = %L', aid)) NOT LIKE '%sa_immutable%' THEN RAISE EXCEPTION 'SA10 acceptance'; END IF;

  -- SA11 activation waits for the admin review and the NDA signed by both.
  IF public.sa_try_activate(aid) THEN RAISE EXCEPTION 'SA11 before review'; END IF;
  PERFORM pg_temp.as_user(ad);
  PERFORM public.sa_admin_review(aid, true, 'ok');
  IF (SELECT status FROM public.sa_agreements WHERE id = aid) <> 'agreed' THEN RAISE EXCEPTION 'SA11 needs NDA'; END IF;
  PERFORM pg_temp.as_user(NULL);
  INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content, signed_at, client_signed_at) VALUES (kc, oa, 'sig', 'nda', now(), now());
  IF NOT public.sa_try_activate(aid) THEN RAISE EXCEPTION 'SA11 activate'; END IF;
  IF (SELECT status FROM public.sa_agreements WHERE id = aid) <> 'active' THEN RAISE EXCEPTION 'SA11 active'; END IF;

  -- SA12 a ticket under the agreement gets the agreed rate and a direct request to the lead (no bidding);
  --      a module outside the scope stays a normal ticket.
  INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency, ticket_context)
  VALUES (oa, ta, 'FB60 posting blocked', 'FI', 'new', 'high', jsonb_build_object('support_agreement_id', aid)) RETURNING id INTO t1;
  IF NOT EXISTS (SELECT 1 FROM public.sa_tickets WHERE ticket_id = t1 AND agreement_id = aid) THEN RAISE EXCEPTION 'SA12 link'; END IF;
  IF (SELECT hourly_rate FROM public.ticket_rates WHERE ticket_id = t1 AND status = 'approved' AND source = 'agreement') <> 95 THEN RAISE EXCEPTION 'SA12 rate'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_match_requests WHERE ticket_id = t1 AND consultant_id = kc AND status::text = 'pending') THEN RAISE EXCEPTION 'SA12 request'; END IF;
  INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency, ticket_context)
  VALUES (oa, ta, 'MM question', 'MM', 'new', 'low', jsonb_build_object('support_agreement_id', aid)) RETURNING id INTO t2;
  IF EXISTS (SELECT 1 FROM public.sa_tickets WHERE ticket_id = t2) THEN RAISE EXCEPTION 'SA12 out of scope'; END IF;
  -- The browser path: a plain ticket attached right after creation by its own client.
  INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency) VALUES (oa, ta, 'Payment run', 'FI', 'new', 'medium') RETURNING id INTO t2;
  PERFORM pg_temp.as_user(oa);
  IF NOT (public.sa_attach_ticket(t2, aid) ->> 'linked')::boolean THEN RAISE EXCEPTION 'SA12 attach'; END IF;
  PERFORM pg_temp.as_user(ob);
  IF pg_temp.err(format('SELECT public.sa_attach_ticket(%L, %L)', t2, aid)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA12 attach other'; END IF;
  PERFORM pg_temp.as_user(NULL);
  -- Company B cannot attach its ticket to company A's agreement.
  INSERT INTO public.tickets (client_id, title, sap_module, status, urgency, ticket_context)
  VALUES (ob, 'Steal', 'FI', 'new', 'low', jsonb_build_object('support_agreement_id', aid)) RETURNING id INTO t2;
  IF EXISTS (SELECT 1 FROM public.sa_tickets WHERE ticket_id = t2) THEN RAISE EXCEPTION 'SA12 foreign ticket'; END IF;

  -- SA13 rate changes are never retroactive and need the other party.
  PERFORM pg_temp.as_user(k);
  IF pg_temp.err(format($q$SELECT public.sa_propose_rate_change(%L, 110, NULL, NULL, NULL, current_date, 'Annual review')$q$, aid)) NOT LIKE '%sa_not_retroactive%' THEN RAISE EXCEPTION 'SA13 today'; END IF;
  chg := public.sa_propose_rate_change(aid, 110, NULL, NULL, NULL, current_date + 30, 'Annual review');
  IF pg_temp.err(format('SELECT public.sa_decide_rate_change(%L, true)', chg)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA13 own proposal'; END IF;
  PERFORM pg_temp.as_user(oa);
  PERFORM public.sa_decide_rate_change(chg, true);
  IF (SELECT hourly_rate FROM public.sa_rate_on(aid, current_date)) <> 95 OR (SELECT hourly_rate FROM public.sa_rate_on(aid, current_date + 30)) <> 110 THEN RAISE EXCEPTION 'SA13 effective dates'; END IF;

  -- SA14 hours-bank rollover maths (same cases as the unit tests).
  r := public.sa_bank_month('2026-11', '[]', 25, '{"rollover":"none","unused":"charge"}', 40);
  IF (r ->> 'charge_hours')::numeric <> 15 OR (r ->> 'overage_hours')::numeric <> 0 THEN RAISE EXCEPTION 'SA14 none %', r; END IF;
  r := public.sa_bank_month('2026-11', '[]', 25, '{"rollover":"hours","rollover_hours":10,"unused":"charge"}', 40);
  IF (r ->> 'charge_hours')::numeric <> 5 OR r -> 'carried_out' <> '[{"month":"2026-11","hours":10}]'::jsonb THEN RAISE EXCEPTION 'SA14 hours %', r; END IF;
  r := public.sa_bank_month('2026-12', '[{"month":"2026-11","hours":10}]', 5, '{"rollover":"hours","rollover_hours":10,"unused":"charge"}', 40);
  IF (r ->> 'expired_hours')::numeric <> 35 THEN RAISE EXCEPTION 'SA14 hours next %', r; END IF;
  r := public.sa_bank_month('2027-01', '[{"month":"2026-11","hours":15},{"month":"2026-12","hours":40}]', 0, '{"rollover":"months","rollover_months":2,"unused":"charge"}', 40);
  IF (r ->> 'expired_hours')::numeric <> 15 THEN RAISE EXCEPTION 'SA14 months %', r; END IF;
  r := public.sa_bank_month('2026-11', '[]', 50, '{"rollover":"none","unused":"charge"}', 40);
  IF (r ->> 'overage_hours')::numeric <> 10 THEN RAISE EXCEPTION 'SA14 overage %', r; END IF;

  -- SA15 month-end settlement: unused committed hours become one platform invoice (pricing v2 fields, fees + VAT).
  PERFORM pg_temp.as_user(NULL);
  r := public.sa_settle_month(aid, current_date);
  IF r IS NULL OR (r ->> 'payment_id') IS NULL THEN RAISE EXCEPTION 'SA15 settled %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = (r ->> 'payment_id')::uuid AND p.pricing_model = 'v2' AND p.service_fee_percent = 10
                   AND p.amount = p.base_amount + p.service_fee_amount + p.processing_fee_amount + p.vat_amount AND p.reference LIKE 'agreement:%') THEN RAISE EXCEPTION 'SA15 invoice'; END IF;
  IF public.sa_settle_month(aid, current_date) IS NOT NULL THEN RAISE EXCEPTION 'SA15 idempotent'; END IF;

  -- SA16 auto-renew only with both consents; otherwise the agreement expires at its end date.
  INSERT INTO public.sa_agreements (tenant_id, client_id, name, status, terms, consultant_id, started_at, start_date, end_date, auto_renew_client_at, auto_renew_consultant_at, last_activity_at)
  VALUES (ta, oa, 'Renew me', 'renewal_due', pg_temp.terms(current_date) || '{"model":"payg"}', kc, now() - interval '1 year', current_date - 365, current_date - 1, now(), now(), now()) RETURNING id INTO a2;
  INSERT INTO public.sa_agreements (tenant_id, client_id, name, status, terms, consultant_id, started_at, start_date, end_date, auto_renew_client_at, last_activity_at)
  VALUES (ta, oa, 'Let me end', 'renewal_due', pg_temp.terms(current_date) || '{"model":"payg"}', kc, now() - interval '1 year', current_date - 365, current_date - 1, now(), now());
  PERFORM public.sa_sweep();
  IF (SELECT status FROM public.sa_agreements WHERE id = a2) <> 'active' OR (SELECT end_date FROM public.sa_agreements WHERE id = a2) <> (current_date - 1 + interval '12 months')::date THEN RAISE EXCEPTION 'SA16 renewed'; END IF;
  IF (SELECT status FROM public.sa_agreements WHERE name = 'Let me end' AND client_id = oa) <> 'expired' THEN RAISE EXCEPTION 'SA16 expired'; END IF;

  -- SA17 termination respects the notice period and needs a reason.
  PERFORM pg_temp.as_user(k);
  IF pg_temp.err(format($q$SELECT public.sa_request_termination(%L, 'bye')$q$, aid)) NOT LIKE '%sa_reason_required%' THEN RAISE EXCEPTION 'SA17 reason'; END IF;
  IF public.sa_request_termination(aid, 'Moving to a full-time role next quarter') <> current_date + 30 THEN RAISE EXCEPTION 'SA17 notice'; END IF;
  PERFORM pg_temp.as_user(NULL);
  PERFORM public.sa_sweep();
  IF (SELECT status FROM public.sa_agreements WHERE id = aid) <> 'active' THEN RAISE EXCEPTION 'SA17 too early'; END IF;
  UPDATE public.sa_agreements SET termination_end = current_date - 1 WHERE id = aid;
  PERFORM public.sa_sweep();
  IF (SELECT status FROM public.sa_agreements WHERE id = aid) <> 'terminated' THEN RAISE EXCEPTION 'SA17 terminated'; END IF;

  -- SA18 bypass alert: an active agreement without ticket or timesheet activity for N weeks alerts administrators once.
  UPDATE public.sa_agreements SET last_activity_at = now() - interval '10 weeks', started_at = now() - interval '20 weeks' WHERE id = a2;
  PERFORM public.sa_sweep();
  PERFORM public.sa_sweep();
  IF (SELECT count(*) FROM public.sa_events WHERE agreement_id = a2 AND kind = 'inactivity_alert') <> 1 THEN RAISE EXCEPTION 'SA18 alert once'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications nn WHERE nn.user_id = ad AND nn.type = 'agreement' AND nn.title LIKE '%without activity%') THEN RAISE EXCEPTION 'SA18 admin notice'; END IF;

  -- SA19 the state machine refuses shortcuts.
  IF pg_temp.err(format($q$SELECT public.sa_set_status(%L, 'active', NULL)$q$, aid)) NOT LIKE '%sa_bad_transition%' THEN RAISE EXCEPTION 'SA19 transition'; END IF;

  -- SA20 tables are closed to the browser; internal functions are not callable by signed-in users.
  IF has_table_privilege('authenticated', 'public.sa_agreements', 'SELECT') OR has_table_privilege('authenticated', 'public.sa_rate_records', 'INSERT')
     OR has_function_privilege('anon', 'public.sa_get(uuid)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.sa_sweep()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sa_settle_month(uuid,date)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.sa_set_status(uuid,text,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SA20 grants'; END IF;

  -- SA21 a team member is visible to the parties; an invited consultant sees the agreement as team, not the applications.
  UPDATE public.sa_agreements SET status = 'active', termination_end = NULL WHERE id = a2;  -- fixture: live again
  PERFORM pg_temp.as_user(oa);
  PERFORM public.sa_invite_member(a2, uc, 'functional', 10, '{"timezone":"Asia/Riyadh","days":[1,2,3,4,5],"from":"08:00","to":"17:00"}'::jsonb, NULL, true);
  PERFORM pg_temp.as_user(u);
  PERFORM public.sa_member_respond(a2, true, true, 'Umar Consultant');
  r := public.sa_get(a2);
  IF r ->> 'role' <> 'team' OR r ? 'applications' AND r -> 'applications' <> 'null'::jsonb THEN RAISE EXCEPTION 'SA21 team view'; END IF;

  -- SA22 rates are only shown to the parties: an unrelated consultant gets nothing.
  PERFORM pg_temp.as_user(x);
  IF pg_temp.err(format('SELECT public.sa_get(%L)', a2)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA22 unrelated'; END IF;

  -- SA23 replacement needs client + admin + new consultant; the rate stays.
  PERFORM pg_temp.as_user(oa);
  chg := public.sa_request_replacement(a2, uc, 'The lead is no longer available enough for us.');
  PERFORM pg_temp.as_user(u);
  IF pg_temp.err(format('SELECT public.sa_replacement_accept(%L, true)', chg)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA23 before admin'; END IF;
  PERFORM pg_temp.as_user(ad);
  PERFORM public.sa_admin_decide_replacement(chg, true, 'ok');
  PERFORM pg_temp.as_user(u);
  PERFORM public.sa_replacement_accept(chg, true);
  IF (SELECT consultant_id FROM public.sa_agreements WHERE id = a2) <> uc THEN RAISE EXCEPTION 'SA23 replaced'; END IF;

  -- SA24 availability commitments reduce the consultant's matching availability share.
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.sa_agreements SET terms = terms || '{"model":"availability","capacity_hours_per_week":20}' WHERE id = a2;
  IF (SELECT share FROM public.sa_reserved_shares(ARRAY[uc])) <> 0.5 THEN RAISE EXCEPTION 'SA24 share'; END IF;

  -- SA25 SLA hook: the agreement's SLA applies to a linked ticket ONLY while the agreement is live (crew confirmed).
  UPDATE public.sa_agreements SET terms = terms || jsonb_build_object('sla', jsonb_build_object('policy_id', '00000000-0000-0000-0000-0000000000aa', 'version', 3)),
         status = 'agreed', started_at = NULL WHERE id = aid;   -- fixture: back to "agreed, crew not confirmed"
  IF EXISTS (SELECT 1 FROM public.sa_ticket_sla(t1)) THEN RAISE EXCEPTION 'SA25 sla before confirmation'; END IF;
  UPDATE public.sa_agreements SET status = 'active', started_at = now() WHERE id = aid;
  IF (SELECT version FROM public.sa_ticket_sla(t1)) <> 3 THEN RAISE EXCEPTION 'SA25 sla hook'; END IF;
  UPDATE public.sa_agreements SET status = 'terminated' WHERE id = aid;
  IF EXISTS (SELECT 1 FROM public.sa_ticket_sla(t1)) THEN RAISE EXCEPTION 'SA25 sla after the end'; END IF;

  -- SA26 Q&A refuses contact details.
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format($q$SELECT public.sa_post_message(%L, %L, 'mail me at boss@acme.com')$q$, a2, uc)) NOT LIKE '%sa_contact_details%' THEN RAISE EXCEPTION 'SA26 M60'; END IF;

  RAISE NOTICE 'support-agreements: SA01-SA26 passed';
END $$;

DO $$
DECLARE
  ad uuid := '00000000-0000-0000-0000-00000006a001'; oa uuid := '00000000-0000-0000-0000-00000006a002'; ob uuid := '00000000-0000-0000-0000-00000006a005';
  k uuid := '00000000-0000-0000-0000-00000006a006'; u uuid := '00000000-0000-0000-0000-00000006a007'; x uuid := '00000000-0000-0000-0000-00000006a008';
  ta uuid := '00000000-0000-0000-0000-00000006ae01'; tb uuid := '00000000-0000-0000-0000-00000006ae02';
  kc uuid := '00000000-0000-0000-0000-00000006c006'; uc uuid := '00000000-0000-0000-0000-00000006c007'; xc uuid := '00000000-0000-0000-0000-00000006c008';
  aid uuid := (SELECT id FROM public.sa_agreements WHERE name = 'FI support' AND tenant_id = '00000000-0000-0000-0000-00000006ae01');
  a3 uuid; d3 uuid; app uuid; h text; r jsonb; ref text; up jsonb; up2 jsonb; doc uuid; pol uuid; pv int; bpol uuid; t jsonb;
BEGIN
  -- SA27 reference number "SA-<year>-<6 digits>", stored in the terms, never changed.
  SELECT reference INTO ref FROM public.sa_agreements WHERE id = aid;
  IF ref !~ '^SA-\d{4}-\d{6}$' OR (SELECT terms ->> 'reference' FROM public.sa_agreements WHERE id = aid) IS DISTINCT FROM ref THEN RAISE EXCEPTION 'SA27 reference %', ref; END IF;
  IF pg_temp.err(format($q$UPDATE public.sa_agreements SET reference = 'SA-1999-000001' WHERE id = %L$q$, aid)) NOT LIKE '%sa_immutable%' THEN RAISE EXCEPTION 'SA27 immutable'; END IF;
  -- ...and appears in the notifications of the parties.
  IF NOT EXISTS (SELECT 1 FROM public.notifications nn WHERE nn.user_id = oa AND nn.type = 'agreement' AND nn.title LIKE '%' || ref || '%') THEN RAISE EXCEPTION 'SA27 notice reference'; END IF;

  -- SA28 names are unique per client company (case and spaces ignored); another company may use the same name.
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format($q$SELECT public.sa_create(%L, '{}'::jsonb, pg_temp.terms(current_date) || '{"name":"  fi SUPPORT "}')$q$, ta)) NOT LIKE '%sa_name_taken%' THEN RAISE EXCEPTION 'SA28 unique'; END IF;
  PERFORM pg_temp.as_user(ob);
  IF pg_temp.err(format($q$SELECT public.sa_create(%L, '{}'::jsonb, pg_temp.terms(current_date))$q$, tb)) <> '' THEN RAISE EXCEPTION 'SA28 other company'; END IF;

  -- SA29 the name can change only in Draft.
  PERFORM pg_temp.as_user(oa);
  d3 := public.sa_create(ta, '{}'::jsonb, pg_temp.terms(current_date) || '{"name":"Basis draft"}');
  PERFORM public.sa_save_draft(d3, '{}'::jsonb, pg_temp.terms(current_date) || '{"name":"Basis support"}');
  IF (SELECT name FROM public.sa_agreements WHERE id = d3) <> 'Basis support' THEN RAISE EXCEPTION 'SA29 rename draft'; END IF;
  PERFORM public.sa_publish(d3, NULL, false, '{}');
  IF pg_temp.err(format($q$SELECT public.sa_save_draft(%L, '{}'::jsonb, pg_temp.terms(current_date) || '{"name":"Basis renamed"}')$q$, d3)) NOT LIKE '%sa_name_locked%' THEN RAISE EXCEPTION 'SA29 locked rpc'; END IF;
  PERFORM pg_temp.as_user(NULL);
  IF pg_temp.err(format($q$UPDATE public.sa_agreements SET name = 'X' WHERE id = %L$q$, d3)) NOT LIKE '%sa_name_locked%' THEN RAISE EXCEPTION 'SA29 locked table'; END IF;

  -- SA30 crew rules: verified consultants only, never a blocked one, statement recipients inside the company only.
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format($q$SELECT public.sa_create(%L, '{}'::jsonb, pg_temp.terms(current_date) || jsonb_build_object('name', 'Crew X', 'team', jsonb_build_array(jsonb_build_object('consultant_id', %L, 'role', 'technical'))))$q$, ta, xc))
     NOT LIKE '%crew_member%' THEN RAISE EXCEPTION 'SA30 unverified'; END IF;
  INSERT INTO public.client_consultant_blocks (tenant_id, consultant_id, created_by) VALUES (ta, uc, oa);
  IF pg_temp.err(format($q$SELECT public.sa_create(%L, '{}'::jsonb, pg_temp.terms(current_date) || jsonb_build_object('name', 'Crew B', 'team', jsonb_build_array(jsonb_build_object('consultant_id', %L, 'role', 'technical'))))$q$, ta, uc))
     NOT LIKE '%crew_blocked%' THEN RAISE EXCEPTION 'SA30 blocked'; END IF;
  DELETE FROM public.client_consultant_blocks WHERE tenant_id = ta AND consultant_id = uc;
  IF pg_temp.err(format($q$SELECT public.sa_create(%L, '{}'::jsonb, pg_temp.terms(current_date) || '{"name":"Mail out","statement_email":true,"statement_recipients":["ob@beta.test"]}')$q$, ta))
     NOT LIKE '%recipient_outside%' THEN RAISE EXCEPTION 'SA30 recipients'; END IF;

  -- SA31 SLA snapshot: only an active policy of the own company / a template; the version body + hash are copied in.
  IF to_regclass('public.sla_policies') IS NOT NULL THEN
    SELECT p.id, p.active_version INTO pol, pv FROM public.sla_policies p WHERE p.is_default AND p.active_version IS NOT NULL LIMIT 1;
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.sla_policies (scope, tenant_id, name, status, current_version, active_version, effective_from) VALUES ('client', tb, 'Beta SLA', 'active', 1, 1, now()) RETURNING id INTO bpol;
    INSERT INTO public.sla_policy_versions (policy_id, version, body, content_hash) SELECT bpol, 1, v.body, v.content_hash FROM public.sla_policy_versions v WHERE v.policy_id = pol AND v.version = pv;
    SET LOCAL session_replication_role = origin;
    IF pg_temp.err(format($q$SELECT public.sa_create(%L, '{}'::jsonb, pg_temp.terms(current_date) || jsonb_build_object('name', 'Steal SLA', 'sla', jsonb_build_object('policy_id', %L)))$q$, ta, bpol))
       NOT LIKE '%sa_sla_invalid%' THEN RAISE EXCEPTION 'SA31 foreign policy'; END IF;
  END IF;

  -- SA32 the crew must be confirmed before the agreement starts: the client plans member U, lead K is selected; after both
  --      accepted the terms the agreement waits for U's acceptance (SLA box required) and U's NDA.
  t := pg_temp.terms(current_date) || jsonb_build_object('name', 'FI crew', 'team', jsonb_build_array(jsonb_build_object('consultant_id', uc, 'role', 'functional', 'capacity_hours_per_week', 10, 'required', true)));
  IF pol IS NOT NULL THEN t := t || jsonb_build_object('sla', jsonb_build_object('policy_id', pol)); END IF;
  a3 := public.sa_create(ta, '{}'::jsonb, t);
  IF pol IS NOT NULL AND ((SELECT terms -> 'sla' ->> 'version' FROM public.sa_agreements WHERE id = a3)::int <> pv
       OR (SELECT terms -> 'sla' -> 'body' FROM public.sa_agreements WHERE id = a3) IS NULL OR (SELECT terms -> 'sla' ->> 'hash' FROM public.sa_agreements WHERE id = a3) IS NULL) THEN
    RAISE EXCEPTION 'SA31 snapshot'; END IF;
  PERFORM public.sa_publish(a3, NULL, false, '{}');
  PERFORM pg_temp.as_user(k);
  app := public.sa_apply(a3, 100, 'USD', 'hours_bank', NULL, '', true, 'Ready');
  PERFORM pg_temp.as_user(oa);
  PERFORM public.sa_select_application(app);
  IF NOT EXISTS (SELECT 1 FROM public.sa_agreements a, jsonb_array_elements(a.terms -> 'team') e WHERE a.id = a3 AND e ->> 'consultant_id' = uc::text AND e ->> 'role' = 'functional') THEN RAISE EXCEPTION 'SA32 plan kept'; END IF;
  h := (SELECT content_hash FROM public.sa_versions WHERE agreement_id = a3 AND version = (SELECT version FROM public.sa_agreements WHERE id = a3));
  PERFORM public.sa_accept_terms(a3, (SELECT version FROM public.sa_agreements WHERE id = a3), h, 'Olivia Owner');
  PERFORM pg_temp.as_user(k);
  PERFORM public.sa_accept_terms(a3, (SELECT version FROM public.sa_agreements WHERE id = a3), h, 'Karim Consultant');
  IF (SELECT status FROM public.sa_agreements WHERE id = a3) <> 'agreed' THEN RAISE EXCEPTION 'SA32 waits for crew'; END IF;
  r := public.sa_confirmation(a3);
  IF (r ->> 'ready')::boolean OR (SELECT (i ->> 'ok')::boolean FROM jsonb_array_elements(r -> 'items') i WHERE i ->> 'key' = 'crew') THEN RAISE EXCEPTION 'SA32 checklist %', r; END IF;
  PERFORM pg_temp.as_user(u);
  IF public.sa_get(a3) ->> 'role' <> 'team' THEN RAISE EXCEPTION 'SA32 invited member view'; END IF;
  IF pg_temp.err(format($q$SELECT public.sa_member_respond(%L, true, false, 'Umar Consultant')$q$, a3)) NOT LIKE '%sa_sla_acceptance_required%' THEN RAISE EXCEPTION 'SA32 sla box'; END IF;
  PERFORM public.sa_member_respond(a3, true, true, 'Umar Consultant');
  IF (SELECT status FROM public.sa_agreements WHERE id = a3) <> 'agreed' THEN RAISE EXCEPTION 'SA32 waits for NDA'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sa_member_acceptances WHERE agreement_id = a3 AND consultant_id = uc AND typed_name = 'Umar Consultant') THEN RAISE EXCEPTION 'SA32 acceptance record'; END IF;
  PERFORM pg_temp.as_user(NULL);
  IF pg_temp.err(format('DELETE FROM public.sa_member_acceptances WHERE agreement_id = %L', a3)) NOT LIKE '%sa_immutable%' THEN RAISE EXCEPTION 'SA32 acceptance immutable'; END IF;
  INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content, signed_at, client_signed_at) VALUES (uc, oa, 'sig', 'nda', now(), now());
  IF NOT public.sa_try_activate(a3) THEN RAISE EXCEPTION 'SA32 activate'; END IF;

  -- SA33 agreement documents: type/size/secret checks, upload only through a prepared name, NDA-gated reading,
  --      every download logged before storage lets the file open, versions immutable.
  INSERT INTO storage.buckets (id, name, public) VALUES ('agreement-documents', 'agreement-documents', false) ON CONFLICT DO NOTHING;
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format($q$SELECT public.sa_document_begin_upload(%L, NULL, 'sow', 'SOW', 'tool.exe', 'application/octet-stream', 100, '', true)$q$, a3)) NOT LIKE '%sa_doc_type%' THEN RAISE EXCEPTION 'SA33 type'; END IF;
  IF pg_temp.err(format($q$SELECT public.sa_document_begin_upload(%L, NULL, 'sow', 'SOW', 'sow.pdf', 'image/png', 100, '', true)$q$, a3)) NOT LIKE '%sa_doc_type%' THEN RAISE EXCEPTION 'SA33 type pair'; END IF;
  IF pg_temp.err(format($q$SELECT public.sa_document_begin_upload(%L, NULL, 'sow', 'SOW', 'sow.pdf', 'application/pdf', 30000000, '', true)$q$, a3)) NOT LIKE '%sa_doc_size%' THEN RAISE EXCEPTION 'SA33 size'; END IF;
  IF pg_temp.err(format($q$SELECT public.sa_document_begin_upload(%L, NULL, 'sow', 'SOW', 'sow.pdf', 'application/pdf', 100, '', false)$q$, a3)) NOT LIKE '%sa_no_secrets_confirm%' THEN RAISE EXCEPTION 'SA33 confirm'; END IF;
  IF pg_temp.err(format($q$SELECT public.sa_document_begin_upload(%L, NULL, 'access_plan', 'Access plan password: Winter2026', 'a.pdf', 'application/pdf', 100, '', true)$q$, a3)) NOT LIKE '%sa_secret_details%' THEN RAISE EXCEPTION 'SA33 secret'; END IF;
  up := public.sa_document_begin_upload(a3, NULL, 'sow', 'Statement of work', 'SOW v1.pdf', 'application/pdf', 1000, 'First draft', true);
  IF NOT public.sa_doc_storage_insert_ok(up ->> 'path') THEN RAISE EXCEPTION 'SA33 prepared name'; END IF;
  IF public.sa_doc_storage_insert_ok(a3 || '/other/file.pdf') THEN RAISE EXCEPTION 'SA33 any name'; END IF;
  PERFORM pg_temp.as_user(x);
  IF public.sa_doc_storage_insert_ok(up ->> 'path') THEN RAISE EXCEPTION 'SA33 other user name'; END IF;
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format('SELECT public.sa_document_finish_upload(%L)', up ->> 'upload_id')) NOT LIKE '%sa_doc_missing%' THEN RAISE EXCEPTION 'SA33 missing file'; END IF;
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('agreement-documents', up ->> 'path', '{"size":1000,"mimetype":"application/pdf"}');
  doc := (public.sa_document_finish_upload((up ->> 'upload_id')::uuid) ->> 'document_id')::uuid;
  PERFORM pg_temp.as_user(x);
  IF pg_temp.err(format('SELECT public.sa_document_open(%L)', doc)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA33 unrelated consultant'; END IF;
  PERFORM pg_temp.as_user(ob);
  IF pg_temp.err(format('SELECT public.sa_document_open(%L)', doc)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA33 other company'; END IF;
  PERFORM pg_temp.as_user(u);
  IF public.sa_doc_storage_read_ok(up ->> 'path') THEN RAISE EXCEPTION 'SA33 read without log'; END IF;
  r := public.sa_document_open(doc);
  IF NOT public.sa_doc_storage_read_ok(r ->> 'path') THEN RAISE EXCEPTION 'SA33 read after log'; END IF;
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.nda_agreements SET revoked_at = now() WHERE consultant_id = uc AND client_id = oa;   -- NDA gate
  PERFORM pg_temp.as_user(u);
  IF pg_temp.err(format('SELECT public.sa_document_open(%L)', doc)) NOT LIKE '%sa_forbidden%' OR public.sa_doc_storage_read_ok(r ->> 'path')
     OR NOT (public.sa_get(a3) ->> 'documents_locked')::boolean THEN RAISE EXCEPTION 'SA33 NDA gate'; END IF;
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.nda_agreements SET revoked_at = NULL WHERE consultant_id = uc AND client_id = oa;
  -- new version by the lead; the version list and the download log show both
  PERFORM pg_temp.as_user(k);
  up2 := public.sa_document_begin_upload(a3, doc, NULL, NULL, 'SOW v2.pdf', 'application/pdf', 2000, 'Signed scope', true);
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('agreement-documents', up2 ->> 'path', '{"size":2000,"mimetype":"application/pdf"}');
  IF (public.sa_document_finish_upload((up2 ->> 'upload_id')::uuid) ->> 'version')::int <> 2 THEN RAISE EXCEPTION 'SA33 version 2'; END IF;
  PERFORM pg_temp.as_user(oa);
  r := public.sa_get(a3);
  IF jsonb_array_length(r -> 'documents' -> 0 -> 'versions') <> 2 OR jsonb_array_length(r -> 'downloads') <> 1 THEN RAISE EXCEPTION 'SA33 lists %', r -> 'downloads'; END IF;
  PERFORM pg_temp.as_user(NULL);
  IF pg_temp.err(format('UPDATE public.sa_document_versions SET file_name = %L WHERE document_id = %L', 'x.pdf', doc)) NOT LIKE '%sa_immutable%'
     OR pg_temp.err(format('DELETE FROM public.sa_document_access WHERE document_id = %L', doc)) NOT LIKE '%sa_immutable%' THEN RAISE EXCEPTION 'SA33 immutable'; END IF;

  -- SA34 an agreement ticket runs on the agreement SLA (header chip) and the lead's SLA acceptance is recorded for it.
  IF pol IS NOT NULL THEN
    PERFORM pg_temp.as_user(NULL);
    INSERT INTO public.tickets (client_id, tenant_id, title, sap_module, status, urgency) VALUES (oa, ta, 'Bank statement import', 'FI', 'new', 'medium') RETURNING id INTO doc;
    PERFORM pg_temp.as_user(oa);
    r := public.sa_attach_ticket(doc, a3);
    IF NOT (r ->> 'linked')::boolean OR NOT ((public.sa_ticket_tags(ARRAY[doc]) -> 0 ->> 'sla_applied')::boolean) THEN RAISE EXCEPTION 'SA34 agreement sla %', r; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sla_acceptances x WHERE x.ticket_id = doc AND x.consultant_id = kc) THEN RAISE EXCEPTION 'SA34 lead acceptance'; END IF;
  END IF;

  -- SA35 crew changes: only the client; the lead cannot be removed; a member may leave with a reason.
  PERFORM pg_temp.as_user(k);
  IF pg_temp.err(format($q$SELECT public.sa_remove_member(%L, %L, 'not needed')$q$, a3, uc)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA35 lead removes'; END IF;
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format($q$SELECT public.sa_remove_member(%L, %L, 'lead out')$q$, a3, kc)) NOT LIKE '%sa_forbidden%' THEN RAISE EXCEPTION 'SA35 remove lead'; END IF;
  PERFORM pg_temp.as_user(u);
  PERFORM public.sa_remove_member(a3, uc, 'Moving to another project');
  IF (SELECT status FROM public.sa_members WHERE agreement_id = a3 AND consultant_id = uc ORDER BY added_at DESC LIMIT 1) <> 'ended' THEN RAISE EXCEPTION 'SA35 leave'; END IF;

  -- SA36 the new browser functions are granted; the internal ones stay closed.
  IF NOT has_function_privilege('authenticated', 'public.sa_document_open(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sa_confirmation(uuid)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.sa_record_crew_sla(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sa_resolve_sla(uuid,uuid,jsonb)', 'EXECUTE') OR has_table_privilege('authenticated', 'public.sa_documents', 'SELECT') THEN
    RAISE EXCEPTION 'SA36 grants'; END IF;

  RAISE NOTICE 'support-agreements: all 36 checks passed';
END $$;

ROLLBACK;
