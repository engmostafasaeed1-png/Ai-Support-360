-- Adversarial tests for support-agreements.sql. ONE rolled-back transaction: run on a scratch copy (nothing kept).
-- Each check raises on failure. SA01-SA26.
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
  PERFORM public.sa_invite_member(a2, uc);
  PERFORM pg_temp.as_user(u);
  PERFORM public.sa_member_respond(a2, true);
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

  -- SA25 SLA hook: a linked ticket reports the agreement's SLA policy reference.
  UPDATE public.sa_agreements SET terms = terms || jsonb_build_object('sla', jsonb_build_object('policy_id', '00000000-0000-0000-0000-0000000000aa', 'version', 3)) WHERE id = aid;
  IF (SELECT version FROM public.sa_ticket_sla(t1)) <> 3 THEN RAISE EXCEPTION 'SA25 sla hook'; END IF;

  -- SA26 Q&A refuses contact details.
  PERFORM pg_temp.as_user(oa);
  IF pg_temp.err(format($q$SELECT public.sa_post_message(%L, %L, 'mail me at boss@acme.com')$q$, a2, uc)) NOT LIKE '%sa_contact_details%' THEN RAISE EXCEPTION 'SA26 M60'; END IF;

  RAISE NOTICE 'support-agreements: all 26 checks passed';
END $$;

ROLLBACK;
