-- Feature Z referral programme: post-apply checks. One transaction, rolled back at the end (no data is kept).
-- Run in a scratch database after docs/sql/referral-program.sql. Raises an exception on the first failed check.
BEGIN;
SET LOCAL client_min_messages = warning;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-0000000000a1'::uuid AS admin,
  '00000000-0000-0000-0000-0000000000b1'::uuid AS client,
  '00000000-0000-0000-0000-0000000000e1'::uuid AS r_user, '00000000-0000-0000-0000-00000000ee01'::uuid AS r,
  '00000000-0000-0000-0000-0000000000e2'::uuid AS d_user, '00000000-0000-0000-0000-00000000ee02'::uuid AS d,
  '00000000-0000-0000-0000-0000000000e3'::uuid AS s_user, '00000000-0000-0000-0000-00000000ee03'::uuid AS s,
  '00000000-0000-0000-0000-0000000000e4'::uuid AS e_user, '00000000-0000-0000-0000-00000000ee04'::uuid AS e,
  '00000000-0000-0000-0000-0000000000e5'::uuid AS f_user, '00000000-0000-0000-0000-00000000ee05'::uuid AS f;
GRANT SELECT ON _ids TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _u IS NULL THEN '' ELSE json_build_object('sub', _u, 'role', 'authenticated')::text END, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; END $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) SELECT admin, 'admin@example.com', '{}' FROM _ids;
INSERT INTO auth.users (id, email, raw_user_meta_data) SELECT r_user, 'rami.saleh@example.com', '{}' FROM _ids;
INSERT INTO public.user_roles (user_id, role) SELECT admin, 'admin' FROM _ids;
INSERT INTO public.profiles (user_id, display_name) SELECT r_user, 'Rami Saleh' FROM _ids;
INSERT INTO public.profiles (user_id, display_name) SELECT d_user, 'Dalia Kamal' FROM _ids;
INSERT INTO public.profiles (user_id, display_name) SELECT s_user, 'Rami Second' FROM _ids;
INSERT INTO public.profiles (user_id, display_name) SELECT e_user, 'Omar Nabil' FROM _ids;
INSERT INTO public.profiles (user_id, display_name) SELECT f_user, 'Fadi Hamed' FROM _ids;
INSERT INTO public.consultants (id, user_id, verification_status) SELECT r, r_user, 'verified' FROM _ids;
INSERT INTO public.consultant_policy_acknowledgements (consultant_id, version) SELECT r, 1 FROM _ids;

-- 1. Codes: readable, generated, case-insensitive, no profanity ----------------------------------------------------------
SELECT pg_temp.check((SELECT code FROM public.consultant_referral_codes WHERE consultant_id = (SELECT r FROM _ids)) ~ '^SAP-RAMI-[A-HJ-NP-Z2-9]{3}$', 'code like SAP-RAMI-7K2');
SELECT pg_temp.check(public.referral_code_blocked_word('SAP-SEX-123'), 'profanity segment blocked');
SELECT pg_temp.check(NOT public.referral_code_blocked_word('SAP-HASSAN-7K2'), 'names containing short words allowed');
CREATE TEMP TABLE _code AS SELECT code FROM public.consultant_referral_codes WHERE consultant_id = (SELECT r FROM _ids);
GRANT SELECT ON _code TO anon, authenticated;

-- 2. Attribution at sign-up (metadata, lower-case code), locked afterwards -----------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT d_user, 'dalia@corp-x.com', jsonb_build_object('role', 'consultant', 'referral_code', lower((SELECT code FROM _code)), 'referral_ack_version', '1', 'referral_ack_lang', 'ar', 'referral_ack_ua', 'TestAgent') FROM _ids;
INSERT INTO public.consultants (id, user_id) SELECT d, d_user FROM _ids;
SELECT pg_temp.check((SELECT status = 'active' AND source = 'signup' AND referrer_consultant_id = (SELECT r FROM _ids)
                        FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)), 'attributed at sign-up');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT r_user FROM _ids) AND title = 'Someone registered with your referral code'
                               AND body = 'D. K**** registered with your code. Your referral becomes active when you both pass the AI interview.'), 'referrer told with masked name');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT d_user FROM _ids)
                               AND body = 'You were invited by R. S****. The referral programme becomes active after you and your referrer pass the AI interview.'), 'referred told at sign-up');
SELECT pg_temp.check((SELECT activation_status FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)) = 'pending', 'pending activation at sign-up');
SELECT pg_temp.check((SELECT source = 'signup' AND language = 'ar' AND user_agent = 'TestAgent' FROM public.referral_acknowledgements WHERE consultant_id = (SELECT d FROM _ids)),
                     'acknowledged in the registration step');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_email_queue WHERE user_id = (SELECT r_user FROM _ids) AND kind = 'signup') = 1, 'sign-up e-mail queued');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_email_queue WHERE user_id = (SELECT d_user FROM _ids) AND kind = 'invited') = 1, 'invitation e-mail queued');
SELECT pg_temp.check(public.referral_attribute((SELECT d FROM _ids), 'SAP-OTHER-111', 'claim', NULL, NULL) = 'already', 'attribution locked');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT d_user FROM _ids));
DO $$ BEGIN
  UPDATE public.consultant_referrals SET referrer_consultant_id = referred_consultant_id;
  RAISE EXCEPTION 'FAILED: non-admin could write the attribution';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- 3. Self-referral and loops are refused -----------------------------------------------------------------------------------
INSERT INTO auth.users (id, email) SELECT s_user, 'Rami.Saleh+second@example.com' FROM _ids;
INSERT INTO public.consultants (id, user_id) SELECT s, s_user FROM _ids;
SELECT pg_temp.check(public.referral_attribute((SELECT s FROM _ids), (SELECT code FROM _code), 'claim', NULL, NULL) = 'self', 'same e-mail = self-referral');
SELECT pg_temp.check(public.referral_attribute((SELECT r FROM _ids), (SELECT code FROM _code), 'claim', NULL, NULL) = 'self', 'own code = self-referral');
SELECT pg_temp.check(public.referral_attribute((SELECT r FROM _ids),
                       (SELECT code FROM public.consultant_referral_codes WHERE consultant_id = (SELECT d FROM _ids)), 'claim', NULL, NULL) = 'loop', 'loop refused');
SELECT pg_temp.check(public.referral_attribute((SELECT s FROM _ids), 'NOPE-123', 'claim', NULL, NULL) = 'invalid', 'unknown code');

-- 4. Late claim (Google / typed later) and same-device flag -> review --------------------------------------------------------
INSERT INTO auth.users (id, email) SELECT e_user, 'omar@example.org' FROM _ids;
INSERT INTO public.consultants (id, user_id) SELECT e, e_user FROM _ids;
INSERT INTO auth.users (id, email) SELECT f_user, 'fadi@example.net' FROM _ids;
INSERT INTO public.consultants (id, user_id) SELECT f, f_user FROM _ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT r_user FROM _ids));
SELECT public.my_referral_overview('device-of-rami');
SELECT pg_temp.as_user((SELECT e_user FROM _ids));
SELECT pg_temp.check((SELECT public.referral_claim((SELECT code FROM _code), 'device-of-omar')) = '{"result": "ok", "name": "R. S****"}'::jsonb, 'claim returns masked name');
SELECT pg_temp.as_user((SELECT f_user FROM _ids));
SELECT pg_temp.check((SELECT public.referral_claim((SELECT code FROM _code), 'device-of-rami')) ->> 'result' = 'ok', 'flagged claim still recorded');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT status = 'review' AND 'same_device' = ANY (flags) FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT f FROM _ids)), 'same device flagged for review');

-- 5. Live validation: only valid/invalid + masked name, rate limited ----------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"x-forwarded-for": "203.0.113.9"}', true);
SELECT pg_temp.check(public.referral_validate_code(lower((SELECT code FROM _code))) = '{"valid": true, "name": "R. S****"}'::jsonb, 'validate: valid + masked name only');
SELECT pg_temp.check(public.referral_validate_code('SAP-NOBODY-999') = '{"valid": false}'::jsonb, 'validate: invalid');
RESET ROLE;

-- 5b. Activation: both passed the AI interview (pass mark 50) and both acknowledged ---------------------------------------
UPDATE public.consultants SET verification_status = 'verified' WHERE id = (SELECT d FROM _ids);
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT r_user FROM _ids) AND title = 'Your referral is verified'), 'verified notice');
-- A paid ticket before activation earns nothing (it still starts the 12-month window).
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference) VALUES
  ('00000000-0000-0000-0000-00000000bb00', (SELECT d FROM _ids), 1000, 1000, 'pending', 'payment:before');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.referral_events WHERE payout_id = '00000000-0000-0000-0000-00000000bb00' AND reason = 'not_active'), 'pending pair earns nothing');
-- Referrer: 49 is not enough, 50 passes (boundary).
INSERT INTO public.interview_sessions (consultant_id, status, overall_score, completed_at) SELECT r, 'completed', 49, now() FROM _ids;
SELECT pg_temp.check(public.referral_passed_at((SELECT r FROM _ids)) IS NULL, '49 does not pass');
SELECT pg_temp.check(public.referral_chip((SELECT d FROM _ids), (SELECT r FROM _ids)) = 'waiting_you', 'referrer chip: waiting for you');
INSERT INTO public.interview_sessions (consultant_id, status, overall_score, completed_at) SELECT r, 'completed', 50, now() FROM _ids;
SELECT pg_temp.check(public.referral_passed_at((SELECT r FROM _ids)) IS NOT NULL, '50 passes');
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE user_id = (SELECT r_user FROM _ids) AND title = 'You passed the AI interview') = 1, 'pass notice once');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT d_user FROM _ids) AND title = 'Your referral partner passed the AI interview'
                               AND body LIKE 'R. S**** passed the AI interview. Next for your referral: Pass the AI interview (score at least 50).'), 'other side told the next step');
-- Referred consultant fails, stays pending, retakes and passes.
INSERT INTO public.interview_sessions (consultant_id, status, overall_score, completed_at) SELECT d, 'completed', 40, now() FROM _ids;
SELECT pg_temp.check((SELECT activation_status FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)) = 'pending', 'failed interview: still pending');
INSERT INTO public.interview_sessions (consultant_id, status, overall_score) SELECT d, 'in_progress', NULL FROM _ids;
UPDATE public.interview_sessions SET status = 'completed', overall_score = 70, completed_at = now() WHERE consultant_id = (SELECT d FROM _ids) AND status = 'in_progress';
-- Both passed, the referrer has not acknowledged yet: still pending.
SELECT pg_temp.check((SELECT activation_status FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)) = 'pending', 'no acknowledgement = no activation');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT r_user FROM _ids));
SELECT pg_temp.check((public.my_referral_overview(NULL) -> 'activation' ->> 'active')::boolean = false, 'referrer locked before acknowledging');
SELECT pg_temp.check((SELECT my_next FROM public.my_referrals() WHERE referred_name = 'D. K****') = 'acknowledge', 'referrer next step: acknowledge');
DO $$ BEGIN
  UPDATE public.consultant_referrals SET activation_status = 'active';
  RAISE EXCEPTION 'FAILED: browser could set active';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT public.referral_accept_terms(1, 'page', 'en', 'TestAgent');
SELECT pg_temp.check((public.my_referral_overview(NULL) -> 'activation' ->> 'active')::boolean, 'referrer active after acknowledging');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT activation_status = 'active' AND activated_at IS NOT NULL FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)), 'pair active');
SELECT public.referral_check_activation((SELECT d FROM _ids));
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE user_id = (SELECT d_user FROM _ids) AND title = 'Your referral is active') = 1, 'active notice once (referred)');
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE user_id = (SELECT r_user FROM _ids) AND title = 'Your referral is active' AND body LIKE '%D. K****%') = 1, 'active notice once (referrer)');
DO $$ BEGIN
  UPDATE public.referral_acknowledgements SET language = 'xx';
  RAISE EXCEPTION 'FAILED: acknowledgement changed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  DELETE FROM public.referral_acknowledgements;
  RAISE EXCEPTION 'FAILED: acknowledgement deleted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
-- Work invoiced before the activation moment earns nothing.
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, created_at) VALUES
  ('00000000-0000-0000-0000-00000000bb01', (SELECT d FROM _ids), 1000, 1000, 'pending', 'payment:early', now() - interval '1 minute');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.referral_events WHERE payout_id = '00000000-0000-0000-0000-00000000bb01' AND reason = 'before_activation'), 'lines before activation earn nothing');

-- 6. Reward = 0.5 % of the referred consultant's fee (never VAT / fees / commission), one line per payout ------------------------
CREATE TEMP TABLE _p (n int PRIMARY KEY, id uuid DEFAULT gen_random_uuid());
INSERT INTO _p (n) SELECT generate_series(1, 12);
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, currency, status, reference)
SELECT id, (SELECT d FROM _ids), 1000, 1000, 'USD', 'pending', 'payment:test1' FROM _p WHERE n = 1;
SELECT pg_temp.check((SELECT amount = 5.00 AND fee_amount = 1000 AND rate_percent = 0.5 AND status = 'pending' FROM public.referral_reward_lines
                        WHERE source_payout_id = (SELECT id FROM _p WHERE n = 1)), '0.5 % of 1000 = 5.00, pending');
SELECT pg_temp.check((SELECT window_ends_at = first_paid_at + interval '12 months' FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)),
                     '12 months from the first paid ticket');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_email_queue WHERE kind = 'first_reward') = 1, 'first reward e-mail queued once');
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, currency, status, reference)
SELECT id, (SELECT d FROM _ids), 333.33, 333.33, 'USD', 'pending', 'payment:test2' FROM _p WHERE n = 2;
SELECT pg_temp.check((SELECT amount FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 2)) = 1.67, 'rounded to 2 decimals');
-- Legacy commission payout: fee before commission is the base, not the transferred amount.
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, commission_percent, commission_amount, currency, status, reference)
SELECT id, (SELECT d FROM _ids), 850, 1000, 15, 150, 'USD', 'pending', 'payment:test3' FROM _p WHERE n = 3;
SELECT pg_temp.check((SELECT amount FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 3)) = 5.00, 'on the fee, not on commission');
UPDATE public.payouts SET status = 'completed' WHERE id = (SELECT id FROM _p WHERE n = 1);
UPDATE public.payouts SET note = 'touch' WHERE id = (SELECT id FROM _p WHERE n = 1);
SELECT pg_temp.check((SELECT count(*) = 1 AND bool_and(status = 'available') FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 1)),
                     'payout completed -> available, still one line');

-- 7. 12-month window boundaries --------------------------------------------------------------------------------------------
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, created_at)
SELECT id, (SELECT d FROM _ids), 200, 200, 'pending', 'payment:test4',
       (SELECT window_ends_at FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)) - interval '1 second' FROM _p WHERE n = 4;
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, created_at)
SELECT id, (SELECT d FROM _ids), 200, 200, 'pending', 'payment:test5',
       (SELECT window_ends_at FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT d FROM _ids)) FROM _p WHERE n = 5;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 4)), 'last second of the window earns');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 5)), 'end of the window earns nothing');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.referral_events WHERE payout_id = (SELECT id FROM _p WHERE n = 5) AND reason = 'outside_window'), 'skip reason logged');

-- 8. Refund reverses, dispute holds and releases ------------------------------------------------------------------------------
INSERT INTO public.payments (id, client_id, consultant_id, amount, status) VALUES
  ('00000000-0000-0000-0000-00000000aa01', (SELECT client FROM _ids), (SELECT d FROM _ids), 1150, 'completed'),
  ('00000000-0000-0000-0000-00000000aa02', (SELECT client FROM _ids), (SELECT d FROM _ids), 1150, 'completed');
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, payment_id)
SELECT id, (SELECT d FROM _ids), 1000, 1000, 'pending', 'payment:aa01', '00000000-0000-0000-0000-00000000aa01' FROM _p WHERE n = 6;
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, payment_id)
SELECT id, (SELECT d FROM _ids), 1000, 1000, 'completed', 'payment:aa02', '00000000-0000-0000-0000-00000000aa02' FROM _p WHERE n = 7;
UPDATE public.payments SET status = 'refunded' WHERE id = '00000000-0000-0000-0000-00000000aa01';
SELECT pg_temp.check((SELECT status FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 6) AND kind = 'reward') = 'reversed', 'refund reverses the reward');
SELECT pg_temp.check((SELECT amount FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 6) AND kind = 'reversal') = -5.00, 'negative reversal line');
UPDATE public.payments SET status = 'disputed' WHERE id = '00000000-0000-0000-0000-00000000aa02';
SELECT pg_temp.check((SELECT status = 'held' AND hold_reason = 'dispute' FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 7)), 'dispute holds');
UPDATE public.payments SET status = 'completed' WHERE id = '00000000-0000-0000-0000-00000000aa02';
SELECT pg_temp.check((SELECT status FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 7)) = 'available', 'dispute settled releases');

-- 9. Eligibility: suspended referrer and flagged referrals ---------------------------------------------------------------------
INSERT INTO public.user_admin_state (user_id, suspended_at) SELECT r_user, now() FROM _ids;
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference)
SELECT id, (SELECT d FROM _ids), 100, 100, 'pending', 'payment:test8' FROM _p WHERE n = 8;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.referral_events WHERE payout_id = (SELECT id FROM _p WHERE n = 8) AND reason = 'referrer_suspended'), 'suspended referrer earns nothing');
DELETE FROM public.user_admin_state WHERE user_id = (SELECT r_user FROM _ids);
UPDATE public.consultants SET verification_status = 'verified' WHERE id = (SELECT f FROM _ids);
INSERT INTO public.interview_sessions (consultant_id, status, overall_score, completed_at) SELECT f, 'completed', 80, now() FROM _ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT f_user FROM _ids));
SELECT public.referral_accept_terms(1, 'popup', 'en', NULL);
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT activation_status FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT f FROM _ids)) = 'active', 'activation does not lift the review flag but activates');
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference)
SELECT id, (SELECT f FROM _ids), 1000, 1000, 'completed', 'payment:test9' FROM _p WHERE n = 9;
SELECT pg_temp.check((SELECT status = 'held' AND hold_reason = 'review' FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 9)), 'flagged referral -> held');

-- 10. Threshold and referral payout ---------------------------------------------------------------------------------------------
-- Available now: payout 1 (5.00) + payout 7 (5.00) = 10.00 (< 25) and no bank details yet.
SELECT pg_temp.check(public.referral_bundle_payouts(NULL) = 0, 'below threshold: no payout');
INSERT INTO public.consultant_payout_details (consultant_id, account_holder, bank_name, iban) SELECT r, 'Rami Saleh', 'Bank', 'SA00 0000 1111' FROM _ids;
SELECT pg_temp.check(public.referral_bundle_payouts(NULL) = 0, 'still below threshold');
SELECT pg_temp.as_user((SELECT admin FROM _ids));
DO $$ BEGIN
  PERFORM public.admin_referral_action('adjust', (SELECT r FROM _ids), '', 15, 'USD');
  RAISE EXCEPTION 'FAILED: adjustment without reason';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT public.admin_referral_action('adjust', (SELECT r FROM _ids), 'Goodwill for the test', 15, 'USD');
SELECT pg_temp.check((public.admin_referral_action('run_payouts', NULL, 'Monthly run test')) ->> 'created' = '1', 'threshold reached: one referral payout');
SELECT pg_temp.as_user(NULL);
CREATE TEMP TABLE _rp AS SELECT id, amount FROM public.payouts WHERE consultant_id = (SELECT r FROM _ids) AND reference LIKE 'referral:%';
SELECT pg_temp.check((SELECT count(*) = 1 AND min(amount) = 25.00 FROM _rp), 'referral payout = 25.00');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _rp)), 'no reward on the referrer''s own payout');
UPDATE public.payouts SET status = 'completed' WHERE id = (SELECT id FROM _rp);
SELECT pg_temp.check((SELECT count(*) FROM public.referral_reward_lines WHERE referral_payout_id = (SELECT id FROM _rp) AND status = 'paid') = 3, 'lines paid');
-- A refund after payment: negative available line, deducted next time.
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT public.admin_referral_action('reverse_line', (SELECT id FROM public.referral_reward_lines WHERE kind = 'reward' AND source_payout_id = (SELECT id FROM _p WHERE n = 1)), 'Chargeback test');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT amount = -5.00 AND status = 'available' FROM public.referral_reward_lines WHERE kind = 'reversal'
                        AND reverses_line_id = (SELECT id FROM public.referral_reward_lines WHERE kind = 'reward' AND source_payout_id = (SELECT id FROM _p WHERE n = 1))), 'paid line reversed by negative line');

-- 11. Referrer views: masked names only, no direct table reads, no admin RPCs --------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT r_user FROM _ids));
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_referrals) = 0, 'referrer cannot read attributions directly');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_reward_lines) = 0, 'referrer cannot read lines directly');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.my_referrals() WHERE referred_name ILIKE '%dalia%' OR referred_name ILIKE '%kamal%'), 'no full names');
SELECT pg_temp.check((SELECT status FROM public.my_referrals() WHERE referred_name = 'D. K****') = 'paying', 'status paying');
SELECT pg_temp.check((SELECT (public.my_referral_overview(NULL) -> 'funnel' ->> 'signups')::int) = 3, 'funnel sign-ups');
SELECT pg_temp.check((SELECT (e ->> 'pending')::numeric FROM jsonb_array_elements(public.my_referral_overview(NULL) -> 'earnings') e WHERE e ->> 'currency' = 'USD') = 7.67,
                     'pending = 1.67 + 5.00 + 1.00');
DO $$ BEGIN
  PERFORM public.admin_referral_overview();
  RAISE EXCEPTION 'FAILED: consultant reached an admin RPC';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
-- Code: change once, old code keeps working, profanity refused.
DO $$ BEGIN
  PERFORM public.referral_update_code('SAP-FUCK');
  RAISE EXCEPTION 'FAILED: profane code accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT pg_temp.check(public.referral_update_code('sap-rami-ok') = 'SAP-RAMI-OK', 'code changed once');
DO $$ BEGIN
  PERFORM public.referral_update_code('SAP-RAMI-TWO');
  RAISE EXCEPTION 'FAILED: second change accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check(public.referral_find_code((SELECT code FROM _code)) = (SELECT r FROM _ids), 'old code still works');

-- 12. Administrators see full names; reasons and loops enforced -----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT pg_temp.check((SELECT referred_name FROM public.admin_referral_referrals(NULL, 'all', 50, 0) WHERE referred_id = (SELECT d FROM _ids)) = 'Dalia Kamal', 'admin sees full name');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.admin_referral_referrals(NULL, 'flagged', 50, 0) WHERE referred_id = (SELECT f FROM _ids)), 'flagged filter');
DO $$ BEGIN
  PERFORM public.admin_referral_action('change_referrer', (SELECT d FROM _ids), 'Wrong referrer', NULL, NULL, (SELECT d FROM _ids));
  RAISE EXCEPTION 'FAILED: self as referrer';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
SELECT public.admin_referral_action('approve_referral', (SELECT f FROM _ids), 'Checked: different people');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT status FROM public.referral_reward_lines WHERE source_payout_id = (SELECT id FROM _p WHERE n = 9)) = 'available', 'approval releases held line');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'referral.approve_referral'), 'admin action audited');

-- 12b. Reminders after 14 days (once) and expiry after the activation period; only an administrator revives -----------
UPDATE public.consultant_referrals SET attributed_at = now() - interval '15 days' WHERE referred_consultant_id = (SELECT e FROM _ids);
SELECT public.referral_activation_sweep();
SELECT public.referral_activation_sweep();
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE user_id = (SELECT e_user FROM _ids) AND title = 'Your referral is still pending') = 1, '14-day reminder once');
UPDATE public.consultant_referrals SET activation_expires_at = now() - interval '1 second' WHERE referred_consultant_id = (SELECT e FROM _ids);
SELECT public.referral_activation_sweep();
SELECT public.referral_activation_sweep();
SELECT pg_temp.check((SELECT activation_status FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT e FROM _ids)) = 'expired', 'expired after the activation period');
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE user_id = (SELECT e_user FROM _ids) AND title = 'Your referral has expired') = 1, 'expiry notice once');
INSERT INTO public.interview_sessions (consultant_id, status, overall_score, completed_at) SELECT e, 'completed', 90, now() FROM _ids;
SELECT pg_temp.check((SELECT activation_status FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT e FROM _ids)) = 'expired', 'passing later does not revive');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT public.admin_referral_action('revive', (SELECT e FROM _ids), 'Interview delayed by our outage');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT activation_status = 'pending' AND activation_expires_at > now() FROM public.consultant_referrals WHERE referred_consultant_id = (SELECT e FROM _ids)), 'admin revived');

-- 13. Old member credit is never paid on top for consultant referrals; jobs are plain database calls --------------------------------
SELECT public.grant_referral_rewards((SELECT d_user FROM _ids));
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.referral_rewards), 'no double reward');
SELECT pg_temp.check((SELECT count(*) FROM cron.job WHERE jobname LIKE 'referral-%' AND command NOT ILIKE '%http%') = 3, 'credential-free jobs');

-- 14. Referral calculations: arithmetic, drill-down, forecast, statements, own-data-only, reconciliation -------------------
INSERT INTO public.ticket_timesheet_submissions (id, ticket_id, submitted_by, status, billable_hours, hourly_rate, signed_at) VALUES
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ab01', (SELECT d_user FROM _ids), 'signed', 50, 8, now()),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-00000000ab02', (SELECT d_user FROM _ids), 'signed', 16, 50, now());
INSERT INTO public.payments (id, client_id, consultant_id, amount, status, ticket_id, timesheet_id, paid_at) VALUES
  ('00000000-0000-0000-0000-00000000aa03', (SELECT client FROM _ids), (SELECT d FROM _ids), 460, 'completed', '00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000ca01', now());
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, payment_id) VALUES
  ('00000000-0000-0000-0000-00000000bb10', (SELECT d FROM _ids), 400, 400, 'pending', 'payment:aa03', '00000000-0000-0000-0000-00000000aa03');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT r_user FROM _ids));
SELECT pg_temp.check((SELECT approved_hours = 50 AND man_days = 6.25 AND hourly_rate = 8 AND fee_amount = 400 AND amount = 2.00 AND ticket_ref = 'T-00000000'
                        AND payment_status = 'completed' AND referred_name = 'D. K****'
                        FROM public.referral_calc_lines(NULL, NULL, NULL, NULL, NULL) WHERE fee_amount = 400 AND kind = 'reward'), 'drill-down: 50 h = 6.25 man-days, $400 x 0.5 % = $2.00');
SELECT pg_temp.check((SELECT bool_and(net = reward_earned + reversed) AND bool_and(man_days = round(approved_hours / 8, 2))
                        FROM public.referral_calc_referrals(NULL, NULL, NULL, NULL)), 'net = earned + reversed; man-days = hours / 8');
SELECT pg_temp.check((SELECT reversed = -10.00 FROM public.referral_calc_referrals(NULL, NULL, NULL, NULL) WHERE referred_name = 'D. K****'), 'reversals per referral');
SELECT pg_temp.check((SELECT expected_fee = 800 AND expected_reward = 4.00 AND timesheets = 1 FROM public.referral_calc_forecast(NULL)), 'forecast only from approved unpaid timesheets');
SELECT pg_temp.check((public.referral_calc_summary(NULL) -> 'referred' ->> 'total')::int = 3, 'summary counts');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.referral_calc_monthly(NULL, 12) WHERE earned <> 0), 'monthly series');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_calc_lines(NULL, NULL, NULL, NULL, 'paid')) = (SELECT count(*) FROM public.referral_calc_lines(NULL, NULL, NULL, NULL, NULL) WHERE status = 'paid'), 'status filter');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_calc_lines(NULL, NULL, (now() + interval '2 days')::date, NULL, NULL)) = 0, 'period filter');
SELECT pg_temp.as_user((SELECT d_user FROM _ids));
DO $$ BEGIN
  PERFORM public.referral_calc_summary((SELECT r FROM _ids));
  RAISE EXCEPTION 'FAILED: consultant read another consultant''s calculations';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.check((SELECT count(*) FROM public.referral_statements) = 0, 'statements own rows only');
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.referral_calc_summary(NULL);
  RAISE EXCEPTION 'FAILED: visitor read calculations';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check(public.referral_generate_statements(now()::date) >= 1, 'monthly statement generated');
SELECT pg_temp.check(public.referral_generate_statements(now()::date) = 0, 'statement not generated twice');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT r_user FROM _ids) AND title = 'Your referral statement is ready'), 'statement notice');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT pg_temp.check((public.referral_calc_summary((SELECT r FROM _ids)) -> 'referred' ->> 'total')::int = 3, 'admin reads any consultant');
SELECT pg_temp.check((SELECT count(*) FROM public.admin_referral_reconcile((SELECT r FROM _ids), true)) = 0, 'reconciliation clean');
RESET ROLE;
UPDATE public.referral_reward_lines SET amount = amount + 0.01 WHERE source_payout_id = '00000000-0000-0000-0000-00000000bb10';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.admin_referral_reconcile((SELECT r FROM _ids), true) WHERE check_name = 'reward_formula' AND NOT ok), 'reconciliation flags a difference');
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- 15. Existing consultants: backfill, claim window, announcement -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'old1@example.com'), ('00000000-0000-0000-0000-0000000000f2', 'old2@example.com'),
  ('00000000-0000-0000-0000-0000000000f3', 'old3@example.com');
INSERT INTO public.profiles (user_id, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Old Pending'), ('00000000-0000-0000-0000-0000000000f2', 'Old Rejected'),
  ('00000000-0000-0000-0000-0000000000f3', 'Old Verified');
INSERT INTO public.consultants (id, user_id, verification_status) VALUES
  ('00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-0000000000f1', 'pending'),
  ('00000000-0000-0000-0000-00000000ff02', '00000000-0000-0000-0000-0000000000f2', 'rejected'),
  ('00000000-0000-0000-0000-00000000ff03', '00000000-0000-0000-0000-0000000000f3', 'verified');
-- Simulate consultants that existed before the programme (no code yet).
DELETE FROM public.consultant_referral_codes WHERE consultant_id IN ('00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-00000000ff02', '00000000-0000-0000-0000-00000000ff03');
SELECT pg_temp.check((public.referral_backfill_preview() ->> 'will_create')::int = 2, 'dry run counts eligible consultants without a code');
SELECT pg_temp.check(public.referral_backfill_codes() = 2, 'backfill creates the missing codes');
SELECT pg_temp.check(public.referral_backfill_codes() = 0, 'rerun creates none');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.consultant_referral_codes WHERE consultant_id = '00000000-0000-0000-0000-00000000ff02'), 'rejected consultants are left out');
SELECT pg_temp.check((SELECT count(*) FROM public.consultants c WHERE c.verification_status NOT IN ('rejected', 'suspended')
                        AND (SELECT count(*) FROM public.consultant_referral_codes k WHERE k.consultant_id = c.id) <> 1) = 0, 'every eligible consultant has exactly one code');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id IN ('00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-00000000ff03')), 'nobody attributed retroactively');
-- Claim window for consultants registered before the launch.
UPDATE auth.users SET created_at = now() - interval '200 days' WHERE id IN ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3');
UPDATE public.platform_settings SET value = to_jsonb(now() - interval '1 day') WHERE key = 'referral_launch_at';
UPDATE public.platform_settings SET value = to_jsonb(now() + interval '13 days') WHERE key = 'referral_claim_until';
SELECT pg_temp.check(public.referral_can_claim('00000000-0000-0000-0000-00000000ff01'), 'existing consultant may claim inside launch window');
INSERT INTO public.payouts (consultant_id, amount, gross_amount, status, reference) VALUES ('00000000-0000-0000-0000-00000000ff03', 10, 10, 'pending', 'payment:old');
SELECT pg_temp.check(NOT public.referral_can_claim('00000000-0000-0000-0000-00000000ff03'), 'not after a paid ticket');
UPDATE public.platform_settings SET value = to_jsonb(now() - interval '1 minute') WHERE key = 'referral_claim_until';
SELECT pg_temp.check(NOT public.referral_can_claim('00000000-0000-0000-0000-00000000ff01'), 'window closed: admin only');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
SELECT pg_temp.check(public.referral_claim((SELECT code FROM _code), NULL) ->> 'result' = 'too_late', 'claim refused after the window');
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT public.admin_referral_action('set_referrer', '00000000-0000-0000-0000-00000000ff01', 'Confirmed by e-mail with both', NULL, NULL, (SELECT r FROM _ids));
SELECT pg_temp.check((SELECT source = 'admin' FROM public.consultant_referrals WHERE referred_consultant_id = '00000000-0000-0000-0000-00000000ff01'), 'admin can set a referrer');
-- Announcement: test to own account first, then once per consultant; rejected / suspended left out.
INSERT INTO public.user_admin_state (user_id, suspended_at) SELECT (SELECT s_user FROM _ids), now();
RESET ROLE;
SELECT pg_temp.check(public.referral_announcement_status((SELECT s FROM _ids)) = 'account_suspended', 'suspended excluded');
SELECT pg_temp.check(public.referral_announcement_status('00000000-0000-0000-0000-00000000ff02') = 'rejected_or_suspended', 'rejected excluded');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((public.admin_referral_announcement_send(true, 200) ->> 'sent')::int = 1, 'test send');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_announcements) = 0, 'test send writes no log');
CREATE TEMP TABLE _ann AS SELECT public.admin_referral_announcement_send(false, 200) AS r;
SELECT pg_temp.check(((SELECT r FROM _ann) ->> 'sent')::int > 0 AND ((SELECT r FROM _ann) ->> 'remaining')::int = 0, 'announcement sent to everyone eligible');
SELECT pg_temp.check((public.admin_referral_announcement_send(false, 200) ->> 'sent')::int = 0, 'never sent twice');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.referral_announcements WHERE consultant_id IN ((SELECT s FROM _ids), '00000000-0000-0000-0000-00000000ff02')), 'excluded not in the log');
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE type = 'referral_intro' AND user_id = (SELECT d_user FROM _ids)) = 1, 'one bell entry each');

SELECT 'referral-program checks passed' AS result;
ROLLBACK;
