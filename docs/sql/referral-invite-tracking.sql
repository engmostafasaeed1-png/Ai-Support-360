-- Refer & earn invitation effectiveness: who opened Refer & earn from the invitation, per channel.
-- APPLIED 2026-10-23 on the owner's instruction. Safe to run twice (IF NOT EXISTS / CREATE OR REPLACE).
-- Needs the live referral-invitations.sql objects (referral_invitation_runs / _recipients, ri_is_admin) and Feature R
-- (message_campaign_recipients).
--
-- How it counts (no tracking pixels, nothing hidden in the e-mail):
--   * Invitation links carry only ?tab=programme&from=invite&ch=<in_app|push|telegram|email> - no token, id or address.
--   * When a SIGNED-IN consultant opens /consultant/referrals from such a link, the page calls referral_invite_track_click.
--     The person comes from their own sign-in (auth.uid()), never from the link. A click is stored only when that person
--     really received the invitation (latest referral_invitation_recipients row); anyone else gets false and nothing is written.
--   * One row per person + invitation version + channel (first / last time, capped click count): re-opening does not inflate.
--   * The admins' own "Send to me only" tests are stored with is_test = true and kept out of the totals.
--   * "Read" exists only for the bell notice (notifications.is_read). E-mail opens are NOT measured.
-- Reading: admin_referral_invite_effectiveness (admins / super admins only) returns counts only, no names.

CREATE TABLE IF NOT EXISTS public.referral_invitation_clicks (
  user_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 1000),
  channel text NOT NULL CHECK (channel IN ('in_app', 'push', 'telegram', 'email')),
  is_test boolean NOT NULL DEFAULT false,
  first_clicked_at timestamptz NOT NULL DEFAULT now(),
  last_clicked_at timestamptz NOT NULL DEFAULT now(),
  clicks int NOT NULL DEFAULT 1 CHECK (clicks BETWEEN 1 AND 1000),
  PRIMARY KEY (user_id, version, channel)
);
COMMENT ON TABLE public.referral_invitation_clicks IS 'Refer & earn invitation click-throughs; written only by referral_invite_track_click, read by admins.';
CREATE INDEX IF NOT EXISTS referral_invitation_clicks_version_idx ON public.referral_invitation_clicks (version, channel) WHERE NOT is_test;

REVOKE ALL ON public.referral_invitation_clicks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.referral_invitation_clicks FROM authenticated;
GRANT SELECT ON public.referral_invitation_clicks TO authenticated;
GRANT ALL ON public.referral_invitation_clicks TO service_role;
ALTER TABLE public.referral_invitation_clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral invitation clicks" ON public.referral_invitation_clicks;
CREATE POLICY "Admins read referral invitation clicks" ON public.referral_invitation_clicks FOR SELECT TO authenticated
  USING (public.ri_is_admin(auth.uid()));
-- No insert / update / delete policies: the function below is the only writer.

-- ---------------------------------------------------------------- record one click (signed-in person only)
CREATE OR REPLACE FUNCTION public.referral_invite_track_click(_channel text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _v int;
  _test boolean;
BEGIN
  IF _uid IS NULL OR _channel IS NULL OR _channel NOT IN ('in_app', 'push', 'telegram', 'email') THEN
    RETURN false;
  END IF;

  SELECT r.version, r.outcome = 'test' INTO _v, _test
  FROM public.referral_invitation_recipients r
  WHERE r.user_id = _uid AND r.outcome IN ('queued', 'test')
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF _v IS NULL THEN
    -- The push / Telegram / e-mail "Send to me only" tests write no recipient row: count them only for admins, as tests.
    IF NOT public.ri_is_admin(_uid) THEN
      RETURN false;
    END IF;
    SELECT COALESCE(NULLIF(trim(both '"' FROM value::text), '')::int, 1) INTO _v
    FROM public.platform_settings WHERE key = 'referral_invitation_version';
    _v := COALESCE(_v, 1);
    _test := true;
  END IF;

  INSERT INTO public.referral_invitation_clicks AS c (user_id, version, channel, is_test)
  VALUES (_uid, _v, _channel, COALESCE(_test, false))
  ON CONFLICT (user_id, version, channel) DO UPDATE
    SET last_clicked_at = now(), clicks = LEAST(c.clicks + 1, 1000)
    WHERE c.last_clicked_at < now() - interval '1 minute';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.referral_invite_track_click(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_invite_track_click(text) TO authenticated;

-- ---------------------------------------------------------------- admin summary (counts only)
CREATE OR REPLACE FUNCTION public.admin_referral_invite_effectiveness(_version int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _v int;
  _out jsonb;
BEGIN
  IF NOT public.ri_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;

  _v := COALESCE(_version,
    (SELECT max(version) FROM public.referral_invitation_runs WHERE mode <> 'test'),
    (SELECT NULLIF(trim(both '"' FROM value::text), '')::int FROM public.platform_settings WHERE key = 'referral_invitation_version'),
    1);

  WITH sent AS (
    SELECT DISTINCT m.user_id, m.channel, m.notification_id
    FROM public.referral_invitation_runs r
    JOIN public.message_campaign_recipients m ON m.campaign_id = r.campaign_id
    WHERE r.version = _v AND r.mode <> 'test' AND m.status = 'sent'
  ), clk AS (
    SELECT * FROM public.referral_invitation_clicks WHERE version = _v
  )
  SELECT jsonb_build_object(
    'available', true,
    'version', _v,
    'versions', COALESCE((SELECT jsonb_agg(DISTINCT version) FROM public.referral_invitation_runs WHERE mode <> 'test'), '[]'::jsonb),
    'reached', (SELECT count(DISTINCT user_id) FROM sent),
    'delivered', jsonb_build_object(
      'in_app', (SELECT count(DISTINCT user_id) FROM sent WHERE channel = 'in_app'),
      'push', (SELECT count(DISTINCT user_id) FROM sent WHERE channel = 'push'),
      'telegram', (SELECT count(DISTINCT user_id) FROM sent WHERE channel = 'telegram'),
      'email', 0),
    'read_in_app', (SELECT count(DISTINCT s.user_id) FROM sent s JOIN public.notifications n ON n.id = s.notification_id
                    WHERE s.channel = 'in_app' AND n.is_read),
    'clicked', jsonb_build_object(
      'in_app', (SELECT count(*) FROM clk WHERE NOT is_test AND channel = 'in_app'),
      'push', (SELECT count(*) FROM clk WHERE NOT is_test AND channel = 'push'),
      'telegram', (SELECT count(*) FROM clk WHERE NOT is_test AND channel = 'telegram'),
      'email', (SELECT count(*) FROM clk WHERE NOT is_test AND channel = 'email')),
    'clickers', (SELECT count(DISTINCT user_id) FROM clk WHERE NOT is_test),
    'test_clicks', (SELECT count(*) FROM clk WHERE is_test),
    'first_click_at', (SELECT min(first_clicked_at) FROM clk WHERE NOT is_test),
    'last_click_at', (SELECT max(last_clicked_at) FROM clk WHERE NOT is_test)
  ) INTO _out;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_effectiveness(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_effectiveness(int) TO authenticated;
