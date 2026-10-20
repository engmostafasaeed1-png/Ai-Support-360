-- Feature B: daily consultant profile-completion reminders.
-- NOT APPLIED by the agent — review and apply yourself.
-- Apply docs/sql/interview-completion.sql first (this file uses consultant_completion).
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
-- Requires docs/sql/interview-completion.sql (consultant_completion) to be applied first.
-- Stops when ALL profile items are complete AND a completed AI interview exists (a pending session does not count),
-- so "percent" here is the same number the app shows, including the AI interview share.
-- Runs hourly from cron; sends only at 09:00 in the consultant's time zone (fallback Asia/Riyadh).
-- Disabled account = banned or deleted sign-in account.
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
  v_daily_days := COALESCE(LEAST(GREATEST(v_daily_days, 1), 365), 30);

  RETURN QUERY
  WITH locked AS (
    -- Row locks on the consultant so two overlapping runs never claim the same person.
    SELECT c.id AS cid, c.user_id AS uid, c.created_at AS signed_up_at,
           (SELECT max(l.sent_at) FROM public.profile_reminder_log l WHERE l.consultant_id = c.id) AS last_sent
    FROM public.consultants c
    WHERE EXTRACT(HOUR FROM now() AT TIME ZONE COALESCE(NULLIF(c.timezone, ''), 'Asia/Riyadh')) = 9
      AND EXISTS (SELECT 1 FROM auth.users u
                  WHERE u.id = c.user_id AND u.deleted_at IS NULL
                    AND (u.banned_until IS NULL OR u.banned_until < now()))
    ORDER BY c.created_at
    FOR UPDATE OF c SKIP LOCKED
  ),
  scored AS (
    SELECT lk.*, public.consultant_completion(lk.cid) AS comp FROM locked lk
  ),
  due AS (
    SELECT s.*,
      CASE WHEN s.last_sent IS NOT NULL AND now() - s.signed_up_at >= make_interval(days => v_daily_days)
           THEN 'weekly' ELSE 'daily' END AS due_kind
    FROM scored s
    WHERE NOT ((s.comp ->> 'fields_complete')::BOOLEAN AND (s.comp ->> 'interview_done')::BOOLEAN)
      AND (
        (s.last_sent IS NULL AND now() - s.signed_up_at >= interval '24 hours')
        OR (s.last_sent IS NOT NULL AND now() - s.last_sent >= interval '20 hours'
            AND (now() - s.signed_up_at < make_interval(days => v_daily_days)
                 OR now() - s.last_sent >= interval '7 days'))
      )
    ORDER BY s.signed_up_at
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 200), 200))
  ),
  claimed AS (
    INSERT INTO public.profile_reminder_log (consultant_id, kind)
    SELECT d.cid, d.due_kind FROM due d
    RETURNING profile_reminder_log.consultant_id AS cid, profile_reminder_log.kind AS ckind
  )
  SELECT d.cid, d.uid, cl.ckind,
         (d.comp ->> 'percent')::INT,
         (SELECT array_agg(x) FROM (SELECT jsonb_array_elements_text(d.comp -> 'missing_items') AS x LIMIT 5) m),
         (d.comp ->> 'interview_done')::BOOLEAN,
         CASE WHEN (d.comp ->> 'interview_done')::BOOLEAN THEN COALESCE(
           (SELECT c2.ai_interview_badge FROM public.consultants c2 WHERE c2.id = d.cid),
           (SELECT CASE WHEN s.overall_score >= 85 THEN 'Gold'
                        WHEN s.overall_score >= 70 THEN 'Silver'
                        WHEN s.overall_score >= 50 THEN 'Bronze'
                        ELSE 'Verified' END
              FROM public.interview_sessions s
             WHERE s.consultant_id = d.cid AND s.interview_type = 'ai' AND s.status IN ('completed', 'reviewed')
             ORDER BY s.completed_at DESC NULLS LAST LIMIT 1)) END,
         (d.comp ->> 'payout_ready')::BOOLEAN,
         CASE WHEN (SELECT pr.preferred_language FROM public.profiles pr WHERE pr.user_id = d.uid) LIKE 'ar%' THEN 'ar' ELSE 'en' END
  FROM due d
  JOIN claimed cl ON cl.cid = d.cid;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_profile_reminders(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_profile_reminders(INT) TO service_role;

-- 4. Admin stats for the settings card ("incomplete" = profile items missing OR no completed AI interview).
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
    'incomplete', (SELECT count(*) FROM public.consultants c, LATERAL public.consultant_completion(c.id) comp
                   WHERE NOT ((comp ->> 'fields_complete')::BOOLEAN AND (comp ->> 'interview_done')::BOOLEAN)),
    'unsubscribed', (SELECT count(*) FROM public.suppressed_emails)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_profile_reminder_stats() FROM PUBLIC, anon;
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
