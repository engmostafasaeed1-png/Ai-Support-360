-- Background jobs (existing cron jobs + pg_net wake-ups) prove they come from the database with a private token header.
CREATE TABLE IF NOT EXISTS public.job_invoke_secret (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token text NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.job_invoke_secret FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_invoke_secret TO service_role;
ALTER TABLE public.job_invoke_secret ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.job_invoke_headers()
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE _t text;
BEGIN
  INSERT INTO public.job_invoke_secret (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT token INTO _t FROM public.job_invoke_secret WHERE id = 1;
  RETURN jsonb_build_object('Content-Type', 'application/json', 'x-job-token', _t);
END $$;
REVOKE ALL ON FUNCTION public.job_invoke_headers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_invoke_headers() TO service_role;

CREATE OR REPLACE FUNCTION public.job_token_valid(_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT _token IS NOT NULL AND length(_token) = 64
     AND EXISTS (SELECT 1 FROM public.job_invoke_secret s WHERE s.id = 1 AND s.token = _token)
$$;
REVOKE ALL ON FUNCTION public.job_token_valid(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_token_valid(text) TO service_role;

CREATE OR REPLACE FUNCTION public.assignment_info_wake(_info_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/assignment-reminders',
    headers := public.job_invoke_headers(),
    body := jsonb_build_object('info_id', _info_id),
    timeout_milliseconds := 1000);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assignment_request_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m JSONB := public.assignment_policy_minutes();
  offs INT[];
  i INT;
  due TIMESTAMPTZ;
BEGIN
  IF NEW.response_due_at IS NULL THEN
    RETURN NEW;
  END IF;
  offs := CASE WHEN NEW.is_critical
    THEN ARRAY[(m->>'critical_r1')::INT, (m->>'critical_r2')::INT, (m->>'critical_r3')::INT]
    ELSE ARRAY[(m->>'r1')::INT, (m->>'r2')::INT, (m->>'r3')::INT] END;
  INSERT INTO public.assignment_reminder_log (request_id, step, due_at) VALUES (NEW.id, 'request', NEW.created_at)
    ON CONFLICT DO NOTHING;
  FOR i IN 1..3 LOOP
    due := NEW.created_at + make_interval(mins => offs[i]);
    IF due <= NEW.response_due_at THEN
      INSERT INTO public.assignment_reminder_log (request_id, step, due_at) VALUES (NEW.id, 'r' || i, due)
        ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  INSERT INTO public.assignment_reminder_log (request_id, step, due_at) VALUES (NEW.id, 'expire', NEW.response_due_at)
    ON CONFLICT DO NOTHING;
  BEGIN
    PERFORM net.http_post(
      url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/assignment-reminders',
      headers := public.job_invoke_headers(),
      body := jsonb_build_object('request_id', NEW.id),
      timeout_milliseconds := 1000);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bm_arm_worker()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _next TIMESTAMPTZ; _expr TEXT;
BEGIN
  IF public.platform_flag('bulk_messaging_enabled', true) THEN
    IF EXISTS (SELECT 1 FROM public.message_campaigns WHERE status = 'sending')
       OR EXISTS (SELECT 1 FROM public.message_campaigns WHERE status = 'scheduled' AND scheduled_at <= now() + interval '1 minute') THEN
      _expr := '* * * * *';
    ELSE
      SELECT min(scheduled_at) INTO _next FROM public.message_campaigns WHERE status = 'scheduled';
      IF _next IS NOT NULL THEN
        _expr := to_char(_next AT TIME ZONE 'UTC', 'FMMI FMHH24 FMDD FMMM') || ' *';
      END IF;
    END IF;
  END IF;
  IF _expr IS NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bulk-messages-run';
    RETURN 'off';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bulk-messages-run' AND schedule = _expr AND command ILIKE '%job_invoke_headers%') THEN RETURN _expr; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bulk-messages-run';
  PERFORM cron.schedule('bulk-messages-run', _expr, $job$
  SELECT net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/bulk-messages-run',
    headers := public.job_invoke_headers(),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $job$);
  RETURN _expr;
END $function$;

CREATE OR REPLACE FUNCTION public.referral_wake()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF to_regnamespace('net') IS NULL THEN RETURN; END IF;
IF NOT EXISTS (SELECT 1 FROM public.referral_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/referral-run';
END
$function$;

-- Existing jobs keep their names and timings; only the request headers change.
DO $do$
DECLARE r record; _fn text;
BEGIN
  FOR r IN SELECT jobid, jobname FROM cron.job
           WHERE jobname IN ('assignment-reminders', 'consultant-policy-run', 'consultant-profile-reminders', 'responsiveness-run')
  LOOP
    _fn := CASE r.jobname WHEN 'consultant-profile-reminders' THEN 'consultant-profile-reminder' ELSE r.jobname END;
    PERFORM cron.alter_job(r.jobid, command := format(
      'SELECT net.http_post(url := %L, headers := public.job_invoke_headers(), body := ''{}''::jsonb, timeout_milliseconds := 5000);',
      'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/' || _fn));
  END LOOP;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bulk-messages-run') THEN
    PERFORM public.bm_arm_worker();
  END IF;
END
$do$;

-- Version choices: signed-in users read only active rows; administrators keep full access via their own policy.
DROP POLICY IF EXISTS "Signed-in users read version options" ON public.sap_version_options;
CREATE POLICY "Signed-in users read version options" ON public.sap_version_options
  FOR SELECT TO authenticated USING (is_active = true);