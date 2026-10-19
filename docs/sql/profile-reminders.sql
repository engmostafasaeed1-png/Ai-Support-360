-- Feature B: daily consultant profile-completion reminders.
-- NOT APPLIED by the agent — review and apply yourself.
-- Creates: reminder log table, admin settings, claim + stats RPCs, hourly cron.

-- 1. Log table (replaces the old unique(consultant_id, step) design).
CREATE TABLE IF NOT EXISTS public.profile_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly'))
);
CREATE INDEX IF NOT EXISTS profile_reminder_log_consultant_idx
  ON public.profile_reminder_log (consultant_id, sent_at DESC);

GRANT ALL ON public.profile_reminder_log TO service_role;
-- No client access: RLS enabled, no policies for anon/authenticated.
ALTER TABLE public.profile_reminder_log ENABLE ROW LEVEL SECURITY;

-- 2. Admin-editable settings (defaults ON / 30 days).
INSERT INTO public.platform_settings (key, value) VALUES
  ('profile_reminder_emails', 'true'::jsonb),
  ('profile_reminder_daily_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Claim RPC: returns consultants due right now and records the claim atomically.
-- "Complete" = consultant_missing_fields returns no rows AND a completed AI interview exists.
-- Runs hourly from cron; sends only at 09:00 in the consultant's time zone (fallback Asia/Riyadh).
CREATE OR REPLACE FUNCTION public.claim_profile_reminders(_limit INT DEFAULT 200)
RETURNS TABLE (
  consultant_id UUID,
  user_id UUID,
  kind TEXT,
  percent INT,
  missing TEXT[],
  interview_done BOOLEAN,
  earned_badge TEXT,
  payout_ready BOOLEAN,
  lang TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag TEXT;
  v_daily_days INT;
BEGIN
  -- Only the service role may claim reminders.
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT value #>> '{}' INTO v_flag FROM public.platform_settings WHERE key = 'profile_reminder_emails';
  IF v_flag = 'false' THEN RETURN; END IF;
  SELECT COALESCE(NULLIF(value #>> '{}', '')::INT, 30) INTO v_daily_days
    FROM public.platform_settings WHERE key = 'profile_reminder_daily_days';
  v_daily_days := COALESCE(v_daily_days, 30);

  RETURN QUERY
  WITH eligible AS (
    SELECT c.id AS consultant_id, c.user_id,
           COALESCE(c.timezone, 'Asia/Riyadh') AS tz,
           c.created_at AS signed_up_at,
           (SELECT max(l.sent_at) FROM public.profile_reminder_log l WHERE l.consultant_id = c.id) AS last_sent,
           NOT EXISTS (SELECT 1 FROM public.consultant_missing_fields(c.id) f) AS complete,
           EXISTS (SELECT 1 FROM public.interview_sessions s
                   WHERE s.consultant_id = c.id AND s.interview_type = 'ai' AND s.status = 'completed') AS interview_done,
           COALESCE((SELECT (p.value #>> '{}')::BOOLEAN FROM public.platform_settings p WHERE p.key = 'x'), false) AS unused
    FROM public.consultants c
    WHERE COALESCE(c.disabled, false) = false
      AND EXTRACT(HOUR FROM now() AT TIME ZONE COALESCE(c.timezone, 'Asia/Riyadh')) = 9
  ),
  due AS (
    SELECT e.*,
      CASE WHEN e.last_sent IS NULL THEN 'daily'
           WHEN now() - e.signed_up_at >= make_interval(days => v_daily_days) THEN 'weekly'
           ELSE 'daily' END AS kind
    FROM eligible e
    WHERE NOT (e.complete AND e.interview_done)
      AND (
        (e.last_sent IS NULL AND now() - e.signed_up_at >= interval '24 hours')
        OR (e.last_sent IS NOT NULL AND now() - e.last_sent >= interval '20 hours'
            AND (now() - e.signed_up_at < make_interval(days => v_daily_days)
                 OR now() - e.last_sent >= interval '7 days'))
      )
    ORDER BY e.signed_up_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    INSERT INTO public.profile_reminder_log (consultant_id, kind)
    SELECT d.consultant_id, d.kind FROM due d
    RETURNING profile_reminder_log.consultant_id, profile_reminder_log.kind
  )
  SELECT d.consultant_id, d.user_id, cl.kind,
         (SELECT COALESCE(round(100.0 * (15 - count(*)) / 15), 0)::INT
          FROM public.consultant_missing_fields(d.consultant_id)) AS percent,
         (SELECT array_agg(f.label) FROM (SELECT f.label FROM public.consultant_missing_fields(d.consultant_id) f LIMIT 5) f) AS missing,
         d.interview_done,
         (SELECT s.credibility_tier FROM public.interview_sessions s
          WHERE s.consultant_id = d.consultant_id AND s.interview_type = 'ai' AND s.status = 'completed'
          ORDER BY s.completed_at DESC NULLS LAST LIMIT 1) AS earned_badge,
         EXISTS (SELECT 1 FROM public.consultant_payout_details pd WHERE pd.consultant_id = d.consultant_id) AS payout_ready,
         COALESCE((SELECT pr.language FROM public.profiles pr WHERE pr.user_id = d.user_id), 'en') AS lang
  FROM due d
  JOIN claimed cl ON cl.consultant_id = d.consultant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_profile_reminders(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_profile_reminders(INT) TO service_role;

-- 4. Admin stats for the settings card.
CREATE OR REPLACE FUNCTION public.admin_profile_reminder_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN jsonb_build_object(
    'last_run', (SELECT max(sent_at) FROM public.profile_reminder_log),
    'sent_today', (SELECT count(*) FROM public.profile_reminder_log WHERE sent_at >= date_trunc('day', now())),
    'incomplete', (SELECT count(*) FROM public.consultants c
                   WHERE COALESCE(c.disabled, false) = false
                     AND (EXISTS (SELECT 1 FROM public.consultant_missing_fields(c.id))
                          OR NOT EXISTS (SELECT 1 FROM public.interview_sessions s
                                         WHERE s.consultant_id = c.id AND s.interview_type = 'ai' AND s.status = 'completed'))),
    'unsubscribed', (SELECT count(*) FROM public.suppressed_emails)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_profile_reminder_stats() TO authenticated;

-- 5. Hourly cron: calls the edge function at minute 7 of every hour; the claim RPC
--    only releases consultants whose local time is 09:00.
SELECT cron.schedule(
  'consultant-profile-reminders',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/consultant-profile-reminder',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
