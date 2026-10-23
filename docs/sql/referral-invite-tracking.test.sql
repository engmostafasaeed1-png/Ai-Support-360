-- Adversarial tests for referral-invite-tracking.sql. ONE rolled-back transaction: run on a scratch copy (or live, nothing
-- is kept). Each check raises on failure. IT01-IT08.
BEGIN;

-- fixtures: admin A, consultant C (invited, version 1), outsider O (never invited)
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
INSERT INTO public.referral_invitation_runs (id, admin_id, idempotency_key, version, mode, campaign_id)
  VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 1, 'selected', NULL);
INSERT INTO public.referral_invitation_recipients (run_id, user_id, version, outcome)
  VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000c1', 1, 'queued');

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', _u::text, true);
$$;

DO $$
DECLARE r boolean; j jsonb; n int;
BEGIN
  -- IT01 signed-out caller: nothing recorded
  PERFORM set_config('request.jwt.claims', '{}', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.referral_invite_track_click('email') THEN RAISE EXCEPTION 'IT01 anonymous click accepted'; END IF;

  -- IT02 a person who never received the invitation cannot add clicks
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  IF public.referral_invite_track_click('email') THEN RAISE EXCEPTION 'IT02 outsider click accepted'; END IF;

  -- IT03 unknown channel refused
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  IF public.referral_invite_track_click('sms') THEN RAISE EXCEPTION 'IT03 unknown channel accepted'; END IF;

  -- IT04 recipient click counted once per channel; immediate repeat does not inflate
  IF NOT public.referral_invite_track_click('email') THEN RAISE EXCEPTION 'IT04 recipient click refused'; END IF;
  PERFORM public.referral_invite_track_click('email');
  SELECT clicks INTO n FROM public.referral_invitation_clicks WHERE user_id = '00000000-0000-0000-0000-0000000000c1' AND channel = 'email';
  IF n <> 1 THEN RAISE EXCEPTION 'IT04 repeat inflated clicks to %', n; END IF;
  PERFORM public.referral_invite_track_click('in_app');

  -- IT05 consultant cannot read the summary
  BEGIN
    PERFORM public.admin_referral_invite_effectiveness(1);
    RAISE EXCEPTION 'IT05 non-admin read the summary';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- IT06 admin self-test click (no recipient row) is kept apart as a test
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  IF NOT public.referral_invite_track_click('email') THEN RAISE EXCEPTION 'IT06 admin test click refused'; END IF;
  IF NOT (SELECT is_test FROM public.referral_invitation_clicks WHERE user_id = '00000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'IT06 admin click not marked test';
  END IF;

  -- IT07 summary: one real clicker on two channels, test excluded
  j := public.admin_referral_invite_effectiveness(1);
  IF (j->>'clickers')::int <> 1 OR (j->'clicked'->>'email')::int <> 1 OR (j->'clicked'->>'in_app')::int <> 1 OR (j->>'test_clicks')::int <> 1 THEN
    RAISE EXCEPTION 'IT07 wrong summary %', j;
  END IF;
  IF (j->'delivered'->>'email')::int <> 0 THEN RAISE EXCEPTION 'IT07 e-mail delivery invented'; END IF;
END $$;

-- IT08 browser roles cannot write the table directly
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.referral_invitation_clicks', 'INSERT')
     OR has_table_privilege('anon', 'public.referral_invitation_clicks', 'SELECT')
     OR has_function_privilege('anon', 'public.referral_invite_track_click(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'IT08 browser roles can write or anonymous can read';
  END IF;
END $$;

ROLLBACK;
