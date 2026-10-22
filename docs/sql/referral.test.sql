-- Feature Z referral programme: ADVERSARIAL security checks (fraud, tampering, privacy). Run in a scratch database after
-- docs/sql/referral-program.sql. Part 1 is one transaction rolled back at the end; part 2 (parallel double credit) needs
-- dblink, commits its own fixtures and deletes them again. Raises an exception on the first failed check.
-- Test names below are the ones listed in docs/referral-security.md.
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _u IS NULL THEN '' ELSE json_build_object('sub', _u, 'role', 'authenticated')::text END, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.ip(_ip text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.headers', CASE WHEN _ip IS NULL THEN '' ELSE json_build_object('x-forwarded-for', _ip)::text END, true);
$$;
-- Consultant fixture: auth user + profile + consultant row (the insert trigger generates the code). Returns the consultant id.
CREATE OR REPLACE FUNCTION pg_temp.mk(_name text, _email text, _verified boolean DEFAULT true, _meta jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _u uuid := gen_random_uuid(); _c uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (_u, _email, _meta);
  INSERT INTO public.profiles (user_id, display_name) VALUES (_u, _name);
  INSERT INTO public.consultants (id, user_id, verification_status, profile_submitted_at) VALUES (_c, _u, CASE WHEN _verified THEN 'verified' ELSE 'pending' END, now());
  INSERT INTO public.consultant_policy_acknowledgements (consultant_id, version) VALUES (_c, 1);
  RETURN _c;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(_c uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT user_id FROM public.consultants WHERE id = _c $$;
CREATE OR REPLACE FUNCTION pg_temp.code(_c uuid) RETURNS text LANGUAGE sql AS $$ SELECT code FROM public.consultant_referral_codes WHERE consultant_id = _c $$;
-- Both passed the AI interview and both accepted the terms -> active pair.
CREATE OR REPLACE FUNCTION pg_temp.activate(_referred uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _referred;
  INSERT INTO public.interview_sessions (consultant_id, status, overall_score, completed_at)
  SELECT x, 'completed', 80, now() FROM unnest(ARRAY[r.referrer_consultant_id, _referred]) x
   WHERE public.referral_passed_at(x) IS NULL;
  INSERT INTO public.referral_acknowledgements (consultant_id, user_id, version, role)
  SELECT x, pg_temp.uid(x), 1, 'both' FROM unnest(ARRAY[r.referrer_consultant_id, _referred]) x WHERE public.referral_acked_at(x) IS NULL;
  RETURN public.referral_check_activation(_referred);
END $$;
-- A cleared client payment and a RELEASED consultant payout for the referred consultant. Returns the payout id.
CREATE OR REPLACE FUNCTION pg_temp.pay(_referred uuid, _fee numeric, _client uuid DEFAULT '00000000-0000-0000-0000-0000000000c1', _tenant uuid DEFAULT NULL,
                                       _currency text DEFAULT 'USD') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _p uuid; _o uuid;
BEGIN
  INSERT INTO public.payments (client_id, consultant_id, amount, currency, status, tenant_id) VALUES (_client, _referred, _fee, _currency, 'completed', _tenant) RETURNING id INTO _p;
  INSERT INTO public.payouts (consultant_id, amount, gross_amount, currency, status, reference, payment_id)
  VALUES (_referred, _fee, _fee, _currency, 'completed', 'payment:' || _p::text, _p) RETURNING id INTO _o;
  RETURN _o;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.line(_payout uuid) RETURNS public.referral_reward_lines LANGUAGE sql AS $$
  SELECT * FROM public.referral_reward_lines WHERE source_payout_id = _payout AND kind = 'reward' $$;
CREATE OR REPLACE FUNCTION pg_temp.skip(_payout uuid) RETURNS text LANGUAGE sql AS $$
  SELECT reason FROM public.referral_events WHERE payout_id = _payout AND action = 'reward_skipped' ORDER BY created_at DESC LIMIT 1 $$;
-- Expect a call to fail with a given SQLSTATE class.
CREATE OR REPLACE FUNCTION pg_temp.denied(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.denied(text), pg_temp.check(boolean, text), pg_temp.as_user(uuid), pg_temp.ip(text) TO anon, authenticated;

-- Fixtures: admin, super admins, a client
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin@aisupport360.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'super1@aisupport360.com'), ('00000000-0000-0000-0000-0000000000a3', 'super2@aisupport360.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'buyer@client-co.com');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'super_admin'), ('00000000-0000-0000-0000-0000000000a3', 'super_admin');
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Buyer One');
CREATE TEMP TABLE k (name text PRIMARY KEY, id uuid);
GRANT SELECT ON k TO anon, authenticated;
CREATE OR REPLACE FUNCTION pg_temp.k(_n text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM k WHERE name = _n $$;
GRANT EXECUTE ON FUNCTION pg_temp.k(text) TO anon, authenticated;

-- T01 codes_unguessable ------------------------------------------------------------------------------------------------------
INSERT INTO k VALUES ('ref', pg_temp.mk('John Doe', 'john.doe@gmail.com'));
SELECT pg_temp.check(pg_temp.code(pg_temp.k('ref')) ~ '^SAP-JOHN-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$', 'T01 codes_unguessable: 7 random safe characters');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.consultant_referral_codes WHERE length(replace(code, '-', '')) < 7), 'T01 codes_unguessable: no code under 7 characters');

-- T02 self_referral_email_variants ------------------------------------------------------------------------------------------
INSERT INTO k VALUES ('self1', pg_temp.mk('J Doe', 'JohnDoe+second@googlemail.com', false));
INSERT INTO k VALUES ('self2', pg_temp.mk('J. Doe', 'JOHN.DOE@GMAIL.COM.', false));
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('self1'), pg_temp.code(pg_temp.k('ref')), 'signup', NULL, NULL) = 'self', 'T02 self_referral_email_variants: gmail dots, plus tag, googlemail, case');
SELECT pg_temp.check(public.referral_norm_email('A.B+x@Corp.com') = 'a.b@corp.com' AND public.referral_norm_email('a.b@corp.com') = 'a.b@corp.com', 'T02: plus tag removed on other domains, dots kept');
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('ref'), pg_temp.code(pg_temp.k('ref')), 'signup', NULL, NULL) = 'self', 'T02: own code refused');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('self1')), 'T02: nothing recorded');

-- T03 referral_loops ---------------------------------------------------------------------------------------------------------
INSERT INTO k VALUES ('b', pg_temp.mk('Bilal Aziz', 'bilal@aziz-mail.org'));
INSERT INTO k VALUES ('c', pg_temp.mk('Carla Mendes', 'carla@mendes-mail.net'));
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('b'), pg_temp.code(pg_temp.k('ref')), 'signup', NULL, NULL) = 'ok', 'T03: A refers B');
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('c'), pg_temp.code(pg_temp.k('b')), 'signup', NULL, NULL) = 'ok', 'T03: B refers C');
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('ref'), pg_temp.code(pg_temp.k('b')), 'signup', NULL, NULL) = 'loop', 'T03 referral_loops: A-B-A refused');
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('ref'), pg_temp.code(pg_temp.k('c')), 'signup', NULL, NULL) = 'loop', 'T03 referral_loops: A-B-C-A refused');
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('c'), pg_temp.code(pg_temp.k('ref')), 'claim', NULL, NULL) = 'already', 'T03: first referrer wins, never overwritten');

-- T04 two_signals_under_review / T05 same_bank_hash ---------------------------------------------------------------------------
INSERT INTO k VALUES ('ph', pg_temp.mk('Phone Twin', 'twin@twin-mail.org'));
UPDATE public.profiles SET phone = '+966 50 123 4567' WHERE user_id IN (pg_temp.uid(pg_temp.k('ref')), pg_temp.uid(pg_temp.k('ph')));
UPDATE public.profiles SET phone = '0501234567' WHERE user_id = pg_temp.uid(pg_temp.k('ph'));
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('ph'), pg_temp.code(pg_temp.k('ref')), 'signup', NULL, NULL) = 'ok', 'T04: recorded');
SELECT pg_temp.check((SELECT status = 'review' AND 'same_phone' = ANY (flags) AND flag_score = 2 FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('ph')),
                     'T04 two_signals_under_review: same phone (country prefix ignored) counts 2 -> under review');
UPDATE public.profiles SET phone = NULL WHERE user_id = pg_temp.uid(pg_temp.k('ph'));
INSERT INTO k VALUES ('dev', pg_temp.mk('Device Mate', 'mate@mate-mail.org'));
SELECT public.referral_note_device(pg_temp.k('ref'), 'device-A', '198.51.100.7');
SELECT pg_temp.check(public.referral_attribute(pg_temp.k('dev'), pg_temp.code(pg_temp.k('ref')), 'signup', 'device-A', NULL) = 'ok', 'T04: one signal recorded');
SELECT pg_temp.check((SELECT status = 'active' AND flags = '{same_device}' FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('dev')), 'T04: one weak signal = flagged, not under review');
SELECT public.referral_note_device(pg_temp.k('dev'), NULL, '198.51.100.7');
SELECT pg_temp.check((SELECT status = 'review' AND flags @> '{same_device,same_ip}' FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('dev')),
                     'T04 two_signals_under_review: same network at a later sign-in -> under review');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'consultant_referrals' AND column_name IN ('device_hash', 'ip_hash')),
                     'T04: no hashes in the attribution table');
-- Same bank: different spacing / case, found at the first released payout (bank details added after sign-up).
SELECT pg_temp.activate(pg_temp.k('b'));
INSERT INTO public.consultant_payout_details (consultant_id, account_holder, bank_name, iban) VALUES
  (pg_temp.k('ref'), 'John Doe', 'Bank', 'SA44 2000 0001 2345 6789 1234'), (pg_temp.k('b'), 'Bilal', 'Bank', 'sa4420000001234567891234');
INSERT INTO k VALUES ('po_bank', pg_temp.pay(pg_temp.k('b'), 1000));
SELECT pg_temp.check((SELECT status = 'review' AND 'same_bank' = ANY (flags) FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('b')), 'T05 same_bank_hash: same account -> under review');
SELECT pg_temp.check((pg_temp.line(pg_temp.k('po_bank'))).status = 'held' AND (pg_temp.line(pg_temp.k('po_bank'))).hold_reason = 'review', 'T05: reward held, earns nothing until cleared');
SELECT pg_temp.check(NOT EXISTS (
  SELECT 1 FROM (SELECT to_jsonb(x)::text t FROM public.consultant_referrals x UNION ALL SELECT to_jsonb(x)::text FROM public.referral_reward_lines x
                 UNION ALL SELECT to_jsonb(x)::text FROM public.referral_events x UNION ALL SELECT to_jsonb(x)::text FROM public.referral_attribution_signals x
                 UNION ALL SELECT to_jsonb(x)::text FROM public.referral_devices x) a
   WHERE upper(replace(t, ' ', '')) LIKE '%SA4420000001234567891234%'), 'T05: the account number is never copied into referral tables');
UPDATE public.consultant_payout_details SET iban = 'GB00 1111 2222' WHERE consultant_id = pg_temp.k('b');

-- T06 velocity ---------------------------------------------------------------------------------------------------------------
UPDATE public.platform_settings SET value = '6' WHERE key = 'referral_velocity_per_day';
INSERT INTO k VALUES ('v1', pg_temp.mk('Velo One', 'v1@velo-a.org', false)), ('v2', pg_temp.mk('Velo Two', 'v2@velo-b.org', false));
SELECT public.referral_attribute(pg_temp.k('v1'), pg_temp.code(pg_temp.k('ref')), 'signup', NULL, NULL);
SELECT public.referral_attribute(pg_temp.k('v2'), pg_temp.code(pg_temp.k('ref')), 'signup', NULL, NULL);
SELECT pg_temp.check((SELECT 'velocity_referrer' = ANY (flags) FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('v2')),
                     'T06 velocity: more than N sign-ups a day for one referrer flagged');
UPDATE public.platform_settings SET value = '1' WHERE key = 'referral_velocity_per_ip';
INSERT INTO k VALUES ('ip1', pg_temp.mk('Net One', 'n1@net-a.org', false)), ('ip2', pg_temp.mk('Net Two', 'n2@net-b.org', false)),
                     ('ip_ref', pg_temp.mk('Other Ref', 'oref@other-ref.org'));
SELECT public.referral_attribute(pg_temp.k('ip1'), pg_temp.code(pg_temp.k('ip_ref')), 'signup', NULL, '203.0.113.50');
SELECT public.referral_attribute(pg_temp.k('ip2'), pg_temp.code(pg_temp.k('ip_ref')), 'signup', NULL, '203.0.113.50');
SELECT pg_temp.check((SELECT 'velocity_ip' = ANY (flags) FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('ip2')),
                     'T06 velocity: sign-ups from one network hash flagged');
UPDATE public.platform_settings SET value = '100' WHERE key IN ('referral_velocity_per_day', 'referral_velocity_per_ip');

-- T07 spoofed_signup_metadata ------------------------------------------------------------------------------------------------
INSERT INTO k VALUES ('spoof', pg_temp.mk('Spoof Er', 'spoof@spoof-mail.org', false,
  jsonb_build_object('referral_code', 'NOT-A-REAL-CODE-1', 'referrer_consultant_id', pg_temp.k('ip_ref'), 'status', 'active', 'amount', 999, 'rate_percent', 50)));
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('spoof')), 'T07 spoofed_signup_metadata: referrer id / status / amount in metadata ignored');
INSERT INTO k VALUES ('stale', pg_temp.mk('Stale Link', 'stale@stale-mail.org', false,
  jsonb_build_object('referral_code', pg_temp.code(pg_temp.k('ip_ref')), 'referral_captured_at', (now() - interval '31 days')::text)));
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('stale')), 'T07: link captured more than 30 days ago ignored');
INSERT INTO k VALUES ('fresh', pg_temp.mk('Fresh Link', 'fresh@fresh-mail.org', false,
  jsonb_build_object('referral_code', lower(pg_temp.code(pg_temp.k('ip_ref'))), 'referral_captured_at', (now() - interval '29 days')::text)));
SELECT pg_temp.check((SELECT referrer_consultant_id = pg_temp.k('ip_ref') AND source = 'signup' FROM public.consultant_referrals WHERE referred_consultant_id = pg_temp.k('fresh')), 'T07: valid code within 30 days attributed');

-- T08 code_bruteforce_lockout / T09 enumeration_identical ------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_temp.ip('192.0.2.10');
SELECT pg_temp.check(public.referral_validate_code(lower(pg_temp.code(pg_temp.k('ip_ref')))) = jsonb_build_object('valid', true, 'name', 'O. R****'), 'T09: valid -> masked name only');
RESET ROLE;
UPDATE public.consultant_referral_codes SET disabled_at = now() WHERE consultant_id = pg_temp.k('ip_ref');
SET LOCAL ROLE anon;
SELECT pg_temp.check(public.referral_validate_code(pg_temp.code(pg_temp.k('ip_ref')))::text = public.referral_validate_code('SAP-NOBODY-ZZZZZZZ')::text
                     AND public.referral_validate_code('SAP-NOBODY-ZZZZZZZ') = '{"valid": false}'::jsonb
                     AND public.referral_validate_code('AB') = '{"valid": false}'::jsonb, 'T09 enumeration_identical: disabled = unknown = too short');
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..6 LOOP PERFORM public.referral_validate_code('SAP-GUESS-' || i || 'ABCDEF'); END LOOP;   -- 10 invalid in total now
  PERFORM public.referral_validate_code('SAP-GUESS-XABCDEF');
  RAISE EXCEPTION 'FAILED: T08 no lock-out after 10 invalid codes';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FAILED%' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.referral_validate_code(lower((SELECT code FROM public.consultant_referral_codes LIMIT 1)));
  RAISE EXCEPTION 'FAILED: T08 valid code answered during lock-out';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FAILED%' THEN RAISE; END IF;
  IF SQLERRM <> 'Too many code checks. Please wait a few minutes and try again.' THEN RAISE EXCEPTION 'FAILED: T08 lock-out message not generic'; END IF;
END $$;
SELECT pg_temp.ip('192.0.2.11');
SELECT pg_temp.check(public.referral_validate_code('SAP-OTHER-NET1234') = '{"valid": false}'::jsonb, 'T08 code_bruteforce_lockout: per network hash (other network still answered)');
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.referral_code_attempts WHERE who LIKE '%192.0.2%'), 'T08: attempts stored only as salted hashes');
-- A signed-in account is locked as well (claim path), whatever network it uses.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.uid(pg_temp.k('spoof')));
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..10 LOOP PERFORM pg_temp.ip('192.0.2.' || (100 + i)); PERFORM public.referral_claim('SAP-WRONG-' || i || 'ZZZZZZ'); END LOOP;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT pg_temp.ip('192.0.2.250');
DO $$ BEGIN
  PERFORM public.referral_claim('SAP-WRONG-LASTZZZ');
  RAISE EXCEPTION 'FAILED: T08 account not locked';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FAILED%' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.ip(NULL);
SELECT pg_temp.check((SELECT invalid >= 10 AND locked_until > now() FROM public.referral_code_attempts WHERE who = 'u:' || pg_temp.uid(pg_temp.k('spoof'))::text),
                     'T08 code_bruteforce_lockout: account locked after 10 invalid codes from 10 networks');
UPDATE public.consultant_referral_codes SET disabled_at = NULL WHERE consultant_id = pg_temp.k('ip_ref');

-- T10 min_invoice / T11 hold_period_boundaries ----------------------------------------------------------------------------
INSERT INTO k VALUES ('d', pg_temp.mk('Dina Farouk', 'dina@farouk-mail.org'));
SELECT public.referral_attribute(pg_temp.k('d'), pg_temp.code(pg_temp.k('ip_ref')), 'signup', NULL, NULL);
SELECT pg_temp.activate(pg_temp.k('d'));
INSERT INTO k VALUES ('po_small', pg_temp.pay(pg_temp.k('d'), 19.99));
SELECT pg_temp.check(pg_temp.line(pg_temp.k('po_small')) IS NULL AND pg_temp.skip(pg_temp.k('po_small')) = 'below_min_invoice', 'T10 min_invoice: 19.99 earns nothing');
INSERT INTO k VALUES ('po_min', pg_temp.pay(pg_temp.k('d'), 20.00));
SELECT pg_temp.check((pg_temp.line(pg_temp.k('po_min'))).amount = 0.10, 'T10 min_invoice: 20.00 earns (0.5 % = 0.10)');
INSERT INTO k VALUES ('po_hold', pg_temp.pay(pg_temp.k('d'), 1000));
SELECT pg_temp.check((SELECT status = 'pending' AND matures_at = released_at + interval '14 days' FROM public.referral_reward_lines WHERE source_payout_id = pg_temp.k('po_hold')),
                     'T11: pending for 14 days after release');
SELECT public.referral_mature_lines(now() + interval '14 days' - interval '1 second');
SELECT pg_temp.check((pg_temp.line(pg_temp.k('po_hold'))).status = 'pending', 'T11 hold_period_boundaries: one second before the end still pending');
SELECT public.referral_mature_lines(now() + interval '14 days');
SELECT pg_temp.check((pg_temp.line(pg_temp.k('po_hold'))).status = 'available', 'T11 hold_period_boundaries: available exactly at the end');
-- Payment not cleared: no reward at release.
INSERT INTO public.payments (id, client_id, consultant_id, amount, status) VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', pg_temp.k('d'), 500, 'pending');
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, payment_id)
  VALUES ('00000000-0000-0000-0000-0000000000f2', pg_temp.k('d'), 500, 500, 'completed', 'payment:f1', '00000000-0000-0000-0000-0000000000f1');
SELECT pg_temp.check(pg_temp.skip('00000000-0000-0000-0000-0000000000f2') = 'payment_not_cleared', 'T11: reward only on a CLEARED client payment');
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference) VALUES ('00000000-0000-0000-0000-0000000000f3', pg_temp.k('d'), 500, 500, 'completed', 'payment:none');
SELECT pg_temp.check(pg_temp.skip('00000000-0000-0000-0000-0000000000f3') = 'no_invoice', 'T11: no invoice, no reward');
INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, payment_id)
  SELECT '00000000-0000-0000-0000-0000000000f4', pg_temp.k('d'), 500, 500, 'pending', 'payment:p4', id FROM public.payments WHERE id = '00000000-0000-0000-0000-0000000000f1';
UPDATE public.payments SET status = 'completed' WHERE id = '00000000-0000-0000-0000-0000000000f1';
SELECT pg_temp.check(pg_temp.line('00000000-0000-0000-0000-0000000000f4') IS NULL, 'T11: nothing before the payout is released');
UPDATE public.payouts SET status = 'completed' WHERE id = '00000000-0000-0000-0000-0000000000f4';
SELECT pg_temp.check((pg_temp.line('00000000-0000-0000-0000-0000000000f4')).status = 'pending', 'T11: line created at the payout-release event');

-- T12 refund_reversal ---------------------------------------------------------------------------------------------------------
UPDATE public.payments SET status = 'refunded' WHERE id = (SELECT payment_id FROM public.payouts WHERE id = '00000000-0000-0000-0000-0000000000f4');
SELECT pg_temp.check((SELECT bool_and(CASE kind WHEN 'reward' THEN status = 'reversed' ELSE amount = -2.50 AND rate_percent = 0.5 AND tier_name = 'Tier 1' END) AND count(*) = 2
                        FROM public.referral_reward_lines WHERE source_payout_id = '00000000-0000-0000-0000-0000000000f4'), 'T12 refund_reversal: reversed, mirror line keeps rate and tier');
SELECT public.referral_mature_lines(now() + interval '30 days');
SELECT pg_temp.check((pg_temp.line('00000000-0000-0000-0000-0000000000f4')).status = 'reversed', 'T12: a reversed line never matures');
SELECT pg_temp.check(public.referral_reverse_line((pg_temp.line('00000000-0000-0000-0000-0000000000f4')).id, NULL, 'again') IS NULL, 'T12: one reversal per reward');
-- Dispute during the hold period: held, never matured while disputed.
INSERT INTO k VALUES ('po_disp', pg_temp.pay(pg_temp.k('d'), 400));
UPDATE public.payments SET status = 'disputed' WHERE id = (SELECT payment_id FROM public.payouts WHERE id = pg_temp.k('po_disp'));
SELECT public.referral_mature_lines(now() + interval '30 days');
SELECT pg_temp.check((pg_temp.line(pg_temp.k('po_disp'))).status = 'held', 'T12: disputed payment holds the reward');

-- T13 related_party ------------------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c2', 'boss@farouk-mail.org');
INSERT INTO k VALUES ('po_rel', pg_temp.pay(pg_temp.k('d'), 300, '00000000-0000-0000-0000-0000000000c2'));
SELECT pg_temp.check((pg_temp.line(pg_temp.k('po_rel'))).hold_reason = 'related_party' AND 'client_same_domain' = ANY ((pg_temp.line(pg_temp.k('po_rel'))).flags),
                     'T13 related_party: client on the referred consultant''s company domain -> review');
INSERT INTO public.tenant_members (tenant_id, user_id) VALUES ('00000000-0000-0000-0000-00000000aaaa', pg_temp.uid(pg_temp.k('ip_ref')));
INSERT INTO k VALUES ('po_ten', pg_temp.pay(pg_temp.k('d'), 300, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000aaaa'));
SELECT pg_temp.check((pg_temp.line(pg_temp.k('po_ten'))).hold_reason = 'related_party' AND 'tenant_member' = ANY ((pg_temp.line(pg_temp.k('po_ten'))).flags),
                     'T13 related_party: referrer is a member of the paying company');
INSERT INTO public.referral_party_signals (user_id, kind, hash) VALUES ('00000000-0000-0000-0000-0000000000c1', 'ip', public.referral_hash('198.51.100.99'));
SELECT public.referral_note_device(pg_temp.k('ip_ref'), NULL, '198.51.100.99');
INSERT INTO k VALUES ('po_ip', pg_temp.pay(pg_temp.k('d'), 300));
SELECT pg_temp.check('client_same_ip' = ANY ((pg_temp.line(pg_temp.k('po_ip'))).flags) AND (pg_temp.line(pg_temp.k('po_ip'))).status = 'held',
                     'T13 related_party: client and referrer share a network hash');
DELETE FROM public.referral_devices WHERE consultant_id = pg_temp.k('ip_ref');

-- T14 caps_flag_not_cut ---------------------------------------------------------------------------------------------------------
UPDATE public.platform_settings SET value = '8' WHERE key = 'referral_monthly_cap_per_referrer';
INSERT INTO k VALUES ('po_cap', pg_temp.pay(pg_temp.k('d'), 2000));
SELECT pg_temp.check((SELECT amount = 10.00 AND status = 'held' AND hold_reason = 'cap' AND 'cap_referrer_month' = ANY (flags) FROM public.referral_reward_lines WHERE source_payout_id = pg_temp.k('po_cap')),
                     'T14 caps_flag_not_cut: full 10.00 kept, held for review');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-0000000000a1' AND title = 'Referral reward held for review'), 'T14: administrators told');
UPDATE public.platform_settings SET value = '1000' WHERE key = 'referral_monthly_cap_per_referrer';
UPDATE public.platform_settings SET value = '3' WHERE key = 'referral_monthly_cap_per_referred';
INSERT INTO k VALUES ('po_cap2', pg_temp.pay(pg_temp.k('d'), 100));
SELECT pg_temp.check('cap_referred_month' = ANY ((pg_temp.line(pg_temp.k('po_cap2'))).flags), 'T14: per-referred monthly cap flagged');
UPDATE public.platform_settings SET value = '250' WHERE key = 'referral_monthly_cap_per_referred';

-- T15 double_credit_repeated --------------------------------------------------------------------------------------------------
SELECT public.referral_create_reward(pg_temp.k('po_hold')), public.referral_create_reward(pg_temp.k('po_hold'));
UPDATE public.payouts SET status = 'processing' WHERE id = pg_temp.k('po_hold');
UPDATE public.payouts SET status = 'completed' WHERE id = pg_temp.k('po_hold');
SELECT public.referral_nightly();
SELECT pg_temp.check((SELECT count(*) FROM public.referral_reward_lines WHERE source_payout_id = pg_temp.k('po_hold') AND kind = 'reward') = 1, 'T15 double_credit_repeated: trigger + job + replays = one line');
DO $$ BEGIN
  INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, referred_consultant_id, source_payout_id, fee_amount, rate_percent, amount, currency, status)
  VALUES ('reward:other-key', 'reward', pg_temp.k('ip_ref'), pg_temp.k('d'), pg_temp.k('po_hold'), 1000, 0.5, 5, 'USD', 'pending');
  RAISE EXCEPTION 'FAILED: T15 second reward for one payout';
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- T16 money_constraints ---------------------------------------------------------------------------------------------------------
DO $$ BEGIN
  INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, source_payout_id, fee_amount, rate_percent, amount, currency, status)
  VALUES ('t16a', 'reward', pg_temp.k('ip_ref'), pg_temp.k('po_min'), 100, 0.5, -1, 'USD', 'pending');
  RAISE EXCEPTION 'FAILED: T16 negative reward';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, amount, currency, status) VALUES ('t16b', 'reversal', pg_temp.k('ip_ref'), -1, 'USD', 'available');
  RAISE EXCEPTION 'FAILED: T16 reversal without original';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, created_by, amount, currency, status) VALUES ('t16c', 'adjustment', pg_temp.k('ip_ref'), pg_temp.k('ip_ref'), 1.234, 'USD', 'available');
  RAISE EXCEPTION 'FAILED: T16 three decimals';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, created_by, amount, currency, status) VALUES ('t16d', 'adjustment', pg_temp.k('ip_ref'), pg_temp.k('ip_ref'), 1, 'usd', 'available');
  RAISE EXCEPTION 'FAILED: T16 bad currency';
EXCEPTION WHEN check_violation THEN NULL; END $$;
SELECT pg_temp.check(public.referral_money(0.005) = 0.01 AND public.referral_money(0.004) = 0.00 AND public.referral_money(1.665) = 1.67, 'T16: one rounding rule, 2 decimals half-up');

-- T17 tier_gaming ---------------------------------------------------------------------------------------------------------------
INSERT INTO k VALUES ('tier', pg_temp.mk('Tara Tier', 'tara@tier-mail.org'));
CREATE TEMP TABLE tk (n int PRIMARY KEY, id uuid);
INSERT INTO tk SELECT g, pg_temp.mk('Tier Kid' || g, 'kid' || g || '@kid' || g || '.org') FROM generate_series(1, 12) g;
SELECT public.referral_attribute(id, pg_temp.code(pg_temp.k('tier')), 'signup', NULL, NULL) FROM tk;
SELECT pg_temp.activate(id) FROM tk;
SELECT pg_temp.check(public.referral_verified_count(pg_temp.k('tier')) = 0, 'T17 tier_gaming: no paid ticket yet -> not counted (referral_tier_requires_paid)');
UPDATE public.consultant_referrals SET first_paid_at = now() + interval '10 days' WHERE referred_consultant_id IN (SELECT id FROM tk);
SELECT pg_temp.check((public.referral_tier_for(public.referral_verified_count(pg_temp.k('tier'))) ->> 'rate')::numeric = 0.6, 'T17: 12 qualified -> Tier 2 (0.6 %)');
UPDATE public.consultant_referrals SET first_paid_at = COALESCE(referred_verified_at, attributed_at) + interval '91 days' WHERE referred_consultant_id = (SELECT id FROM tk WHERE n = 1);
UPDATE public.consultants SET verification_status = 'rejected' WHERE id = (SELECT id FROM tk WHERE n = 2);
SELECT pg_temp.check(public.referral_verified_count(pg_temp.k('tier')) = 10 AND (public.referral_tier_for(10) ->> 'rate')::numeric = 0.5,
                     'T17 tier_gaming: paid after 90 days and rejected accounts drop out -> 10 = Tier 1');
UPDATE public.consultant_referrals SET approved_at = now() + interval '5 days' WHERE referred_consultant_id = (SELECT id FROM tk WHERE n = 1);
SELECT pg_temp.check(public.referral_verified_count(pg_temp.k('tier')) = 11, 'T17: administrator approval restarts the 90-day window');
INSERT INTO public.user_admin_state (user_id, merged_into) VALUES (pg_temp.uid((SELECT id FROM tk WHERE n = 3)), gen_random_uuid());
INSERT INTO public.user_admin_state (user_id, anonymised_at) VALUES (pg_temp.uid((SELECT id FROM tk WHERE n = 4)), now());
INSERT INTO public.user_admin_state (user_id, suspended_at) VALUES (pg_temp.uid((SELECT id FROM tk WHERE n = 5)), now());
UPDATE public.consultants SET profile_submitted_at = NULL WHERE id = (SELECT id FROM tk WHERE n = 6);
UPDATE public.consultant_referrals SET status = 'review' WHERE referred_consultant_id = (SELECT id FROM tk WHERE n = 7);
SELECT pg_temp.check(public.referral_verified_count(pg_temp.k('tier')) = 6, 'T17 tier_gaming: merged, anonymised, suspended, no profile gate, under review drop out');
INSERT INTO k VALUES ('t_unver', pg_temp.mk('Not Verified', 'nv@nv-mail.org', false));
SELECT public.referral_attribute(pg_temp.k('t_unver'), pg_temp.code(pg_temp.k('tier')), 'signup', NULL, NULL);
UPDATE public.consultant_referrals SET activation_status = 'active', first_paid_at = now() WHERE referred_consultant_id = pg_temp.k('t_unver');
SELECT pg_temp.check(public.referral_verified_count(pg_temp.k('tier')) = 6, 'T17: unverified never counts');

-- T18 browser_cannot_write / T19 internal_functions_denied ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.uid(pg_temp.k('ip_ref')));
SELECT pg_temp.check(pg_temp.denied($q$UPDATE public.referral_reward_lines SET status = 'available', amount = 9999, rate_percent = 10$q$), 'T18: forged amount/rate/status update denied');
SELECT pg_temp.check(pg_temp.denied($q$UPDATE public.consultant_referrals SET status = 'active', referrer_consultant_id = referred_consultant_id$q$), 'T18: forged referrer/status denied');
SELECT pg_temp.check(pg_temp.denied($q$INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, amount, currency, status) VALUES ('x', 'adjustment', gen_random_uuid(), 100, 'USD', 'available')$q$), 'T18: insert line denied');
SELECT pg_temp.check(pg_temp.denied($q$UPDATE public.consultant_referral_codes SET disabled_at = NULL, edits_used = 0$q$), 'T18: code row write denied');
SELECT pg_temp.check(pg_temp.denied($q$INSERT INTO public.referral_acknowledgements (consultant_id, user_id, version, role) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'both')$q$), 'T18: acknowledgement insert denied');
SELECT pg_temp.check(pg_temp.denied($q$DELETE FROM public.referral_events$q$), 'T18 browser_cannot_write: audit trail delete denied');
SELECT pg_temp.check(pg_temp.denied($q$UPDATE public.platform_settings SET value = '10' WHERE key = 'referral_max_rate'$q$) OR NOT has_table_privilege('authenticated', 'public.platform_settings', 'UPDATE'), 'T18: settings not writable');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_create_reward(gen_random_uuid())$q$), 'T19: create_reward denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_mature_lines(now() + interval '1 year')$q$), 'T19: mature_lines denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_reverse_line(gen_random_uuid(), NULL, 'x')$q$), 'T19: reverse_line denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_bundle_payouts(NULL)$q$), 'T19: bundle_payouts denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_attribute(gen_random_uuid(), 'X', 'admin', NULL, NULL)$q$), 'T19: attribute denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_add_flags(gen_random_uuid(), '{}', 'x')$q$), 'T19: add_flags denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_nightly()$q$), 'T19: nightly denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.referral_daily_reconcile()$q$), 'T19 internal_functions_denied: reconcile job denied');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.admin_referral_action('adjust', gen_random_uuid(), 'Give me money', 500, 'USD')$q$), 'T19: admin RPC denied to a consultant');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.admin_referral_decide_adjustment(gen_random_uuid(), true, 'approve myself')$q$), 'T19: four-eyes decision denied to a consultant');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.my_referral_overview(NULL)$q$) AND pg_temp.denied($q$SELECT public.referral_create_reward(gen_random_uuid())$q$)
                     AND pg_temp.denied($q$SELECT * FROM public.referral_reward_lines$q$), 'T19: anonymous visitors reach nothing but the public checks');
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- T20 rls_own_data_only / T21 masked_names_only -----------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.uid(pg_temp.k('ip_ref')));
SELECT pg_temp.check((SELECT count(*) = 1 AND bool_and(consultant_id = pg_temp.k('ip_ref')) FROM public.consultant_referral_codes), 'T20: only the own code row');
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_referrals) = 0 AND (SELECT count(*) FROM public.referral_reward_lines) = 0
                     AND (SELECT count(*) FROM public.referral_events) = 0, 'T20: attributions, lines and events not readable directly');
SELECT pg_temp.check(pg_temp.denied($q$SELECT ip_hash FROM public.referral_acknowledgements$q$) AND pg_temp.denied($q$SELECT * FROM public.referral_attribution_signals$q$)
                     AND pg_temp.denied($q$SELECT * FROM public.referral_devices$q$) AND pg_temp.denied($q$SELECT * FROM public.referral_party_signals$q$)
                     AND pg_temp.denied($q$SELECT * FROM public.referral_code_attempts$q$) AND pg_temp.denied($q$SELECT * FROM public.referral_adjust_requests$q$),
                     'T20: hashes and service tables never reach the browser');
DO $$ BEGIN
  PERFORM public.referral_calc_lines(pg_temp.k('ref'), NULL, NULL, NULL, NULL);
  RAISE EXCEPTION 'FAILED: T20 read another consultant''s calculations';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
CREATE TEMP TABLE _out AS
  SELECT (SELECT jsonb_agg(to_jsonb(x)) FROM public.my_referrals() x)::text AS a,
         (SELECT jsonb_agg(to_jsonb(x)) FROM public.my_referral_history(500) x)::text AS b,
         (SELECT jsonb_agg(to_jsonb(x)) FROM public.referral_calc_lines(NULL, NULL, NULL, NULL, NULL) x)::text AS c,
         (SELECT jsonb_agg(to_jsonb(x)) FROM public.referral_calc_referrals(NULL, NULL, NULL, NULL) x)::text AS d,
         public.my_referral_overview(NULL)::text AS e, public.referral_calc_summary(NULL)::text AS f;
SELECT pg_temp.check((SELECT a || b || c || d || e || f FROM _out) !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'T21: no ids (consultant, ticket, payment, client) in consultant answers');
SELECT pg_temp.check((SELECT a || b || c || d FROM _out) !~* '(dina|farouk|buyer|client-co|@|hourly|ticket_ref)', 'T21 masked_names_only: no full name, e-mail, client or hourly rate');
SELECT pg_temp.check((SELECT c FROM _out) ~ 'Engagement #[0-9A-F]{4}' AND (SELECT a FROM _out) ~ 'D\. F\*\*\*\*', 'T21: masked name and anonymous engagement reference');
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- T22 admin_self_and_four_eyes ---------------------------------------------------------------------------------------
-- The admin is also a consultant with a referral account.
INSERT INTO public.consultants (id, user_id, verification_status) VALUES ('00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-0000000000a1', 'verified');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
DO $$ BEGIN
  PERFORM public.admin_referral_action('adjust', '00000000-0000-0000-0000-00000000ad01', 'Bonus for myself', 50, 'USD');
  RAISE EXCEPTION 'FAILED: T22 admin adjusted own account';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.check((public.admin_referral_action('adjust', pg_temp.k('ip_ref'), 'Goodwill small amount', 100, 'USD')) ? 'line', 'T22: up to the threshold applied at once');
CREATE TEMP TABLE _req AS SELECT (public.admin_referral_action('adjust', pg_temp.k('ip_ref'), 'Large goodwill payment', 150, 'USD')) ->> 'pending_approval' AS id;
GRANT SELECT ON _req TO authenticated;
SELECT pg_temp.check((SELECT id FROM _req) IS NOT NULL, 'T22: above the threshold waits for approval');
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.admin_referral_decide_adjustment((SELECT id::uuid FROM _req), true, 'I approve my own')$q$), 'T22: plain admin can not approve');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
CREATE TEMP TABLE _req2 AS SELECT (public.admin_referral_action('adjust', pg_temp.k('ip_ref'), 'Second large goodwill', 200, 'USD')) ->> 'pending_approval' AS id;
GRANT SELECT ON _req2 TO authenticated;
SELECT pg_temp.check(pg_temp.denied($q$SELECT public.admin_referral_decide_adjustment((SELECT id::uuid FROM _req2), true, 'Approving my own request')$q$), 'T22: requester can not approve');
SELECT public.admin_referral_decide_adjustment((SELECT id::uuid FROM _req), true, 'Checked the e-mail thread');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
SELECT public.admin_referral_decide_adjustment((SELECT id::uuid FROM _req2), false, 'Not justified');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT count(*) FROM public.referral_reward_lines WHERE kind = 'adjustment' AND referrer_consultant_id = pg_temp.k('ip_ref') AND amount IN (100, 150)) = 2
                     AND NOT EXISTS (SELECT 1 FROM public.referral_reward_lines WHERE kind = 'adjustment' AND amount = 200),
                     'T22 admin_self_and_four_eyes: approved line created once, rejected one never');
SELECT pg_temp.check((SELECT count(*) FROM public.referral_events WHERE action IN ('adjust', 'adjust_requested', 'adjust_approved', 'adjust_rejected') AND reason IS NOT NULL AND actor IS NOT NULL) = 5,
                     'T22: every step audited with actor and reason');
-- Line approval of an own referral line is refused too.
UPDATE public.consultant_referrals SET referrer_consultant_id = '00000000-0000-0000-0000-00000000ad01' WHERE referred_consultant_id = pg_temp.k('b');
UPDATE public.referral_reward_lines SET referrer_consultant_id = '00000000-0000-0000-0000-00000000ad01' WHERE source_payout_id = pg_temp.k('po_bank');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.check(pg_temp.denied(format($q$SELECT public.admin_referral_action('approve_line', %L, 'Release my own reward')$q$, (pg_temp.line(pg_temp.k('po_bank'))).id)), 'T22: own reward line can not be approved');
SELECT pg_temp.check(pg_temp.denied(format($q$SELECT public.admin_referral_action('approve_referral', %L, 'Clear my own referral')$q$, pg_temp.k('b'))), 'T22: own referral can not be cleared');
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- T23 payout_cooldown ---------------------------------------------------------------------------------------------------
UPDATE public.consultant_payout_details SET iban = 'SA00 9999 8888', verified_at = now() - interval '30 days', created_at = now() - interval '30 days' WHERE consultant_id = pg_temp.k('ref');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = pg_temp.uid(pg_temp.k('ref')) AND title = 'Your bank details were changed')
                     AND EXISTS (SELECT 1 FROM public.referral_email_queue WHERE user_id = pg_temp.uid(pg_temp.k('ref')) AND kind = 'payout_details_changed'), 'T23: consultant told in the app and by e-mail');
INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, amount, currency, status, created_by, note, available_at)
  VALUES ('t23', 'adjustment', pg_temp.k('ref'), 50, 'USD', 'available', '00000000-0000-0000-0000-0000000000a2', 'test', now());
UPDATE public.consultant_payout_details SET updated_at = now() - interval '1 day' WHERE consultant_id = pg_temp.k('ref');
SELECT public.referral_bundle_payouts(NULL);
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.payouts WHERE consultant_id = pg_temp.k('ref') AND reference LIKE 'referral:%'), 'T23 payout_cooldown: no referral payout within 7 days of a bank change');
UPDATE public.consultant_payout_details SET updated_at = now() - interval '8 days', verified_at = NULL WHERE consultant_id = pg_temp.k('ref');
SELECT public.referral_bundle_payouts(NULL);
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.payouts WHERE consultant_id = pg_temp.k('ref') AND reference LIKE 'referral:%'), 'T23: unverified payout details never paid');
UPDATE public.consultant_payout_details SET verified_at = now() - interval '8 days' WHERE consultant_id = pg_temp.k('ref');
SELECT public.referral_bundle_payouts(NULL);
SELECT pg_temp.check((SELECT count(*) = 1 AND min(amount) = 50 FROM public.payouts WHERE consultant_id = pg_temp.k('ref') AND reference LIKE 'referral:%'), 'T23: paid through the normal payout flow after the cool-down');

-- T24 reconcile_alert -------------------------------------------------------------------------------------------------------
SELECT pg_temp.check(public.referral_daily_reconcile() = 0, 'T24: clean books -> no alert');
ALTER TABLE public.referral_reward_lines DISABLE TRIGGER USER;
UPDATE public.referral_reward_lines SET amount = amount + 1 WHERE source_payout_id = pg_temp.k('po_min');   -- simulated tampering (superuser)
ALTER TABLE public.referral_reward_lines ENABLE TRIGGER USER;
SELECT pg_temp.check(public.referral_daily_reconcile() > 0, 'T24: tampering found');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-0000000000a2' AND title = 'Referral reconciliation failed' AND type = 'security')
                     AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-0000000000a1' AND title = 'Referral reconciliation failed'),
                     'T24 reconcile_alert: security notice to super administrators');

-- T25 function_privileges_catalogue -----------------------------------------------------------------------------------------
SELECT pg_temp.check(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname ~ '^(referral_|my_referral|admin_referral_)' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')), 'T25: every definer function pins search_path');
SELECT pg_temp.check(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname ~ '^(referral_|my_referral|admin_referral_)' AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('referral_validate_code', 'referral_track_click', 'referral_public_settings')), 'T25: anon only reaches the three public checks');
SELECT pg_temp.check(NOT EXISTS (
  SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname ~ '^(referral_|my_referral|admin_referral_)' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND p.proname NOT LIKE 'admin_referral_%' AND p.proname NOT LIKE 'my_referral%'
     AND p.proname NOT IN ('referral_validate_code', 'referral_track_click', 'referral_public_settings', 'referral_claim', 'referral_accept_terms',
                           'referral_update_code', 'referral_is_admin', 'referral_calc_summary', 'referral_calc_referrals', 'referral_calc_lines',
                           'referral_calc_monthly', 'referral_calc_forecast', 'referral_calc_statements')),
  'T25 function_privileges_catalogue: signed-in users reach only the listed RPCs');
SELECT pg_temp.check(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants g
   WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
     AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     AND (g.table_name LIKE 'referral_%' OR g.table_name IN ('consultant_referral_codes', 'consultant_referrals'))), 'T25: no write grant on any referral table');

ROLLBACK;

-- Part 2. T26 double_credit_parallel: two sessions create the reward for the same released payout at the same time --------
CREATE EXTENSION IF NOT EXISTS dblink;
DO $$
DECLARE
  _conn text := format('dbname=%s host=%s port=%s user=%s', current_database(), split_part(current_setting('unix_socket_directories'), ',', 1),
                       current_setting('port'), current_user);
BEGIN
  -- Committed fixtures (deleted again below).
  INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000d0001', 'par.ref@par-a.org'), ('00000000-0000-0000-0000-0000000d0002', 'par.kid@par-b.org');
  INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-0000000d0001', 'Par Ref'), ('00000000-0000-0000-0000-0000000d0002', 'Par Kid');
  INSERT INTO public.consultants (id, user_id, verification_status) VALUES ('00000000-0000-0000-0000-0000000dc001', '00000000-0000-0000-0000-0000000d0001', 'verified'),
                                                                         ('00000000-0000-0000-0000-0000000dc002', '00000000-0000-0000-0000-0000000d0002', 'verified');
  INSERT INTO public.consultant_policy_acknowledgements (consultant_id, version) VALUES ('00000000-0000-0000-0000-0000000dc001', 1);
  PERFORM public.referral_attribute('00000000-0000-0000-0000-0000000dc002', (SELECT code FROM public.consultant_referral_codes WHERE consultant_id = '00000000-0000-0000-0000-0000000dc001'), 'signup', NULL, NULL);
  UPDATE public.consultant_referrals SET activation_status = 'active', activated_at = now() - interval '1 day' WHERE referred_consultant_id = '00000000-0000-0000-0000-0000000dc002';
  INSERT INTO public.payments (id, client_id, consultant_id, amount, status) VALUES ('00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-0000000d0009', '00000000-0000-0000-0000-0000000dc002', 1000, 'completed');
  INSERT INTO public.payouts (id, consultant_id, amount, gross_amount, status, reference, payment_id)
  VALUES ('00000000-0000-0000-0000-0000000db001', '00000000-0000-0000-0000-0000000dc002', 1000, 1000, 'pending', 'payment:par', '00000000-0000-0000-0000-0000000da001');
  SET LOCAL session_replication_role = replica;   -- released without the trigger, so both sessions race
  UPDATE public.payouts SET status = 'completed' WHERE id = '00000000-0000-0000-0000-0000000db001';
  SET LOCAL session_replication_role = origin;
  PERFORM dblink_connect('par1', _conn);
  PERFORM dblink_connect('par2', _conn);
END $$;
SELECT dblink_exec('par1', 'BEGIN');
SELECT * FROM dblink('par1', $q$SELECT public.referral_create_reward('00000000-0000-0000-0000-0000000db001')::text$q$) AS t(id text);
SELECT dblink_send_query('par2', $q$SELECT public.referral_create_reward('00000000-0000-0000-0000-0000000db001')::text$q$);   -- waits for par1's lock
SELECT dblink_exec('par1', 'COMMIT');
SELECT * FROM dblink_get_result('par2') AS t(id text);
DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.referral_reward_lines WHERE source_payout_id = '00000000-0000-0000-0000-0000000db001' AND kind = 'reward';
  PERFORM dblink_disconnect('par1'); PERFORM dblink_disconnect('par2');
  -- Clean up the committed fixtures.
  DELETE FROM public.referral_events WHERE referred_consultant_id = '00000000-0000-0000-0000-0000000dc002' OR referrer_consultant_id = '00000000-0000-0000-0000-0000000dc001';
  DELETE FROM public.referral_reward_lines WHERE source_payout_id = '00000000-0000-0000-0000-0000000db001';
  DELETE FROM public.payouts WHERE id = '00000000-0000-0000-0000-0000000db001';
  DELETE FROM public.payments WHERE id = '00000000-0000-0000-0000-0000000da001';
  DELETE FROM public.referral_email_queue WHERE user_id IN ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0002');
  DELETE FROM public.notifications WHERE user_id IN ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0002');
  DELETE FROM public.consultants WHERE id IN ('00000000-0000-0000-0000-0000000dc001', '00000000-0000-0000-0000-0000000dc002');
  DELETE FROM public.consultant_policy_acknowledgements WHERE consultant_id = '00000000-0000-0000-0000-0000000dc001';
  DELETE FROM public.profiles WHERE user_id IN ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0002');
  DELETE FROM auth.users WHERE id IN ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0002');
  IF _n <> 1 THEN RAISE EXCEPTION 'FAILED: T26 double_credit_parallel: % reward lines', _n; END IF;
END $$;

SELECT 'referral security checks passed' AS result;
