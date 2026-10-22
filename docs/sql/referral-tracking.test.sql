-- Checks for docs/sql/referral-tracking.sql (Refer & earn page tracking RPCs). Scratch database only, after
-- docs/sql/referral-program.sql and docs/sql/referral-tracking.sql. One transaction, rolled back; raises on the first
-- failed check. Test names are listed in docs/referral-security.md (TR01-TR08).
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _u IS NULL THEN '' ELSE json_build_object('sub', _u, 'role', 'authenticated')::text END, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.mk(_name text, _email text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _u uuid := gen_random_uuid(); _c uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_u, _email);
  INSERT INTO public.profiles (user_id, display_name) VALUES (_u, _name);
  INSERT INTO public.consultants (id, user_id, verification_status, profile_submitted_at) VALUES (_c, _u, 'verified', now());
  INSERT INTO public.consultant_policy_acknowledgements (consultant_id, user_id, version, language) VALUES (_c, _u, 1, 'en');
  RETURN _c;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(_c uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT user_id FROM public.consultants WHERE id = _c $$;
CREATE OR REPLACE FUNCTION pg_temp.code(_c uuid) RETURNS text LANGUAGE sql AS $$ SELECT code FROM public.consultant_referral_codes WHERE consultant_id = _c $$;
CREATE OR REPLACE FUNCTION pg_temp.activate(_referred uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _referred;
  INSERT INTO public.interview_sessions (consultant_id, status, interview_type, overall_score, completed_at)
  SELECT x, 'completed', 'ai', 80, now() FROM unnest(ARRAY[r.referrer_consultant_id, _referred]) x WHERE public.referral_passed_at(x) IS NULL;
  INSERT INTO public.referral_acknowledgements (consultant_id, user_id, version, role)
  SELECT x, pg_temp.uid(x), 1, 'both' FROM unnest(ARRAY[r.referrer_consultant_id, _referred]) x WHERE public.referral_acked_at(x) IS NULL;
  RETURN public.referral_check_activation(_referred);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.pay(_referred uuid, _fee numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _p uuid; _o uuid;
BEGIN
  INSERT INTO public.payments (client_id, consultant_id, amount, currency, status) VALUES ('00000000-0000-0000-0000-0000000000c1', _referred, _fee, 'USD', 'completed') RETURNING id INTO _p;
  INSERT INTO public.payouts (consultant_id, amount, gross_amount, currency, status, reference, payment_id)
  VALUES (_referred, _fee, _fee, 'USD', 'completed', 'payment:' || _p::text, _p) RETURNING id INTO _o;
  RETURN _o;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.denied(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.denied(text), pg_temp.check(boolean, text), pg_temp.as_user(uuid) TO anon, authenticated;

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c1', 'buyer@client-co.com');
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Buyer One');
CREATE TEMP TABLE k (name text PRIMARY KEY, id uuid);
GRANT SELECT ON k TO anon, authenticated;
CREATE OR REPLACE FUNCTION pg_temp.k(_n text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM k WHERE name = _n $$;
GRANT EXECUTE ON FUNCTION pg_temp.k(text) TO anon, authenticated;

-- Fixtures: referrer R, active referred D with three released payouts, pending referred P, removed referred X.
INSERT INTO k VALUES ('r', pg_temp.mk('Rami Nabil', 'rami.nabil@example.org'));
INSERT INTO k VALUES ('d', pg_temp.mk('Dina Farouk', 'dina@farouk-mail.org'));
INSERT INTO k VALUES ('p', pg_temp.mk('Pierre Laurent', 'pierre@laurent-mail.net'));
INSERT INTO k VALUES ('x', pg_temp.mk('Xena Moor', 'xena@moor-mail.net'));
SELECT public.referral_attribute(pg_temp.k('d'), pg_temp.code(pg_temp.k('r')), 'signup', NULL, NULL);
SELECT public.referral_attribute(pg_temp.k('p'), pg_temp.code(pg_temp.k('r')), 'signup', NULL, NULL);
SELECT public.referral_attribute(pg_temp.k('x'), pg_temp.code(pg_temp.k('r')), 'signup', NULL, NULL);
SELECT pg_temp.check(pg_temp.activate(pg_temp.k('d')) = 'active', 'fixture: D active');
INSERT INTO k VALUES ('po1', pg_temp.pay(pg_temp.k('d'), 1000));
INSERT INTO k VALUES ('po2', pg_temp.pay(pg_temp.k('d'), 400));
INSERT INTO k VALUES ('po3', pg_temp.pay(pg_temp.k('d'), 600));
SELECT pg_temp.check((SELECT count(*) FROM public.referral_reward_lines WHERE referrer_consultant_id = pg_temp.k('r') AND kind = 'reward') = 3, 'fixture: three reward lines');
-- po2: client payment disputed (held: dispute). po3: held as related party (must read as plain "review").
UPDATE public.payments SET status = 'disputed' WHERE id = (SELECT payment_id FROM public.payouts WHERE id = pg_temp.k('po2'));
UPDATE public.referral_reward_lines SET status = 'held', hold_reason = 'related_party', flags = ARRAY['client_same_domain'] WHERE source_payout_id = pg_temp.k('po3');
-- X removed by an administrator after fraud signals (reason must be plain, without the flags).
UPDATE public.consultant_referrals SET status = 'removed', flags = ARRAY['same_ip'], flag_score = 1 WHERE referred_consultant_id = pg_temp.k('x');
-- A referral payout of R with a bank transfer reference.
INSERT INTO public.payouts (consultant_id, amount, gross_amount, currency, status, reference, bank_reference, commission_percent, commission_amount, note, due_by)
VALUES (pg_temp.k('r'), 30, 30, 'USD', 'pending', 'referral:' || gen_random_uuid()::text, 'TRX-2026-0042', 0, 0, 'Referral reward', current_date + 3);

-- TR01 tracking_functions_denied --------------------------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check(pg_temp.denied('SELECT * FROM public.my_referral_reward_lines(10)') AND pg_temp.denied('SELECT * FROM public.my_referral_payouts()')
                     AND pg_temp.denied('SELECT public.my_referral_tracking()') AND pg_temp.denied('SELECT public.my_referral_nav_state()'),
                     'TR01 tracking_functions_denied: anon can call none of the tracking functions');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.uid(pg_temp.k('r')));
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_payout_ref(gen_random_uuid())$q$) AND pg_temp.denied($q$SELECT public.referral_public_hold_reason('cap')$q$),
                     'TR01: internal helpers are not callable from the browser');
-- A signed-in client (not a consultant): lines refused, menu state NULL (never an error on every page).
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
DO $$ BEGIN
  PERFORM * FROM public.my_referral_reward_lines(10);
  RAISE EXCEPTION 'FAILED: TR01 a client read reward lines';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.check(public.my_referral_nav_state() IS NULL, 'TR01: menu state is NULL for non-consultants');

-- TR02 reward_line_breakdown ------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.uid(pg_temp.k('r')));
CREATE TEMP TABLE _l AS SELECT * FROM public.my_referral_reward_lines(100);
SELECT pg_temp.check((SELECT count(*) FROM _l) = 3, 'TR02: the referrer sees exactly their three lines');
SELECT pg_temp.check((SELECT fee_amount = 1000 AND rate_percent = 0.5 AND amount = 5.00 AND status = 'pending' AND matures_at > now() AND hold_reason IS NULL
                        FROM _l WHERE fee_amount = 1000), 'TR02 reward_line_breakdown: fee x rate = reward, pending with the release date');
SELECT pg_temp.check((SELECT bool_and(line_ref ~ '^L-[0-9A-F]{6}$' AND engagement_ref ~ '^Engagement #[0-9A-F]{4}$') FROM _l), 'TR02: anonymous line and engagement references');

-- TR03 hold_reason_public ---------------------------------------------------------------------------------------------------
SELECT pg_temp.check((SELECT hold_reason FROM _l WHERE fee_amount = 400) = 'dispute' AND (SELECT hold_reason FROM _l WHERE fee_amount = 600) = 'review',
                     'TR03 hold_reason_public: dispute stays dispute, related party reads as review');
SELECT pg_temp.check((SELECT jsonb_agg(to_jsonb(x))::text FROM _l x) !~* '(related|client_same|same_ip|flag)', 'TR03: no fraud signal words reach the referrer');

-- TR04 privacy_no_ids_names_rates -------------------------------------------------------------------------------------------
CREATE TEMP TABLE _o AS
  SELECT (SELECT jsonb_agg(to_jsonb(x)) FROM _l x)::text AS a,
         (SELECT jsonb_agg(to_jsonb(x)) FROM public.my_referral_payouts() x)::text AS b,
         public.my_referral_tracking()::text AS c, public.my_referral_nav_state()::text AS d;
SELECT pg_temp.check((SELECT a || b || c || d FROM _o) !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'TR04: no ids in any tracking answer');
SELECT pg_temp.check((SELECT a || b || c FROM _o) !~* '(dina|farouk|xena|moor|buyer|client-co|@|hourly)', 'TR04 privacy_no_ids_names_rates: no full name, e-mail, client or hourly rate');
SELECT pg_temp.check((SELECT a FROM _o) ~ 'D\. F\*\*\*\*', 'TR04: masked name only');

-- TR05 payouts_with_reference -----------------------------------------------------------------------------------------------
SELECT pg_temp.check((SELECT count(*) = 1 AND bool_and(payout_ref ~ '^RP-[0-9A-F]{8}$' AND bank_reference = 'TRX-2026-0042' AND amount = 30 AND status = 'pending')
                        FROM public.my_referral_payouts()), 'TR05 payouts_with_reference: own referral payout with reference numbers');

-- TR06 rejected_reason_plain ------------------------------------------------------------------------------------------------
SELECT pg_temp.check((public.my_referral_tracking() -> 'rejected' -> 0 ->> 'reason') = 'review_failed'
                     AND jsonb_array_length(public.my_referral_tracking() -> 'rejected') = 1, 'TR06 rejected_reason_plain: one rejected referral, plain reason');

-- TR07 terms_status ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.check((public.my_referral_tracking() -> 'terms' ->> 'accepted_version')::int = 1
                     AND (public.my_referral_tracking() -> 'terms' ->> 'accepted_at') IS NOT NULL
                     AND (public.my_referral_tracking() -> 'terms' ->> 'current_version')::int = 1, 'TR07 terms_status: accepted version and date');

-- TR08 nav_state ------------------------------------------------------------------------------------------------------------
SELECT pg_temp.check((public.my_referral_nav_state() ->> 'pending_referrals')::int = 1 AND (public.my_referral_nav_state() ->> 'latest_line_at') IS NOT NULL,
                     'TR08 nav_state: one referral waiting, newest reward time');
-- The referred consultant D sees none of R's lines or payouts.
SELECT pg_temp.as_user(pg_temp.uid(pg_temp.k('d')));
SELECT pg_temp.check((SELECT count(*) FROM public.my_referral_reward_lines(100)) = 0 AND (SELECT count(*) FROM public.my_referral_payouts()) = 0
                     AND jsonb_array_length(public.my_referral_tracking() -> 'rejected') = 0, 'TR08: own data only (referred consultant sees nothing of the referrer)');
-- No browser write path exists: the tracking functions are read-only.
SELECT pg_temp.check(pg_temp.denied($q$UPDATE public.referral_reward_lines SET amount = 999$q$) OR (SELECT count(*) FROM public.referral_reward_lines) = 0,
                     'TR08: reward lines can not be changed from the browser');
RESET ROLE;
SELECT pg_temp.as_user(NULL);

DO $$ BEGIN RAISE WARNING 'referral-tracking.test.sql: all checks passed'; END $$;
ROLLBACK;
