-- Feature L: assignment response policy (alerts, reminders, escalation).
-- NOT APPLIED by the agent — review and apply yourself.
--
-- Covers every assignment request / invitation (ticket_match_requests, the table behind "Send request",
-- the expert picks of a new request and private bid invitations). Feature I team members marked "Invited"
-- can reuse the same log + claim once docs/sql/team-engagement.sql is live.
--
-- Schedule (admin-editable, platform setting assignment_reminder_minutes; switch assignment_reminders):
--   normal:   request now, reminders 2 h / 4 h / 24 h, "No response" at 24 h (after reminder 3 went out)
--   Critical: request now, reminders 10 / 20 / 30 min, "No response" at 30 min
--   private bid invitations: the ticket bid deadline replaces the 24 h window when one is set
-- Existing requests (created before this file) get no reminders and never expire.
-- Accepting is unchanged: the NDA, rate and verification checks still apply.
--
-- Order: run step 0 on its own first if your SQL editor complains that a new enum value cannot be used
-- in the same transaction; the rest of the file never uses the value at creation time.

-- 0. New request status "No response".
ALTER TYPE public.match_request_status ADD VALUE IF NOT EXISTS 'expired';

-- 1. Request columns (all managed by the platform; see the guard trigger in step 5).
ALTER TABLE public.ticket_match_requests
  ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_kind TEXT NOT NULL DEFAULT 'request',
  ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminders_sent INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extended_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_match_requests_response_kind_check') THEN
    ALTER TABLE public.ticket_match_requests
      ADD CONSTRAINT ticket_match_requests_response_kind_check CHECK (response_kind IN ('request', 'bid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ticket_match_requests_consultant_status_idx
  ON public.ticket_match_requests (consultant_id, status);

-- 2. Reminder log: one row per message of one request, sent once (unique step per request).
CREATE TABLE IF NOT EXISTS public.assignment_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.ticket_match_requests(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('request', 'r1', 'r2', 'r3', 'expire', 'expire2')),
  due_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  email_error TEXT,
  digested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, step)
);
CREATE INDEX IF NOT EXISTS assignment_reminder_log_due_idx
  ON public.assignment_reminder_log (due_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS assignment_reminder_log_sent_idx
  ON public.assignment_reminder_log (sent_at DESC) WHERE sent_at IS NOT NULL;

-- Sweep runs (for the repeat-call guard of the edge function).
CREATE TABLE IF NOT EXISTS public.assignment_reminder_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignment_reminder_runs_ran_idx ON public.assignment_reminder_runs (ran_at DESC);

GRANT ALL ON public.assignment_reminder_log TO service_role;
GRANT ALL ON public.assignment_reminder_runs TO service_role;
-- No client access: RLS on, no policies for anon/authenticated (admins read through the stats RPC).
ALTER TABLE public.assignment_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_reminder_runs ENABLE ROW LEVEL SECURITY;

-- 3. Admin settings with the owner's defaults.
INSERT INTO public.platform_settings (key, value) VALUES
  ('assignment_reminders', 'true'::jsonb),
  ('assignment_reminder_minutes',
   '{"r1":120,"r2":240,"r3":1440,"expire":1440,"critical_r1":10,"critical_r2":20,"critical_r3":30,"critical_expire":30,"hourly_limit":6,"extend":1440}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Timings with defaults and sanity checks (same rules as readPolicyMinutes in _shared/assignmentPolicy.ts).
-- Readable by signed-in users: it holds timings only (the popup and the policy text use it).
CREATE OR REPLACE FUNCTION public.assignment_policy_minutes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d CONSTANT JSONB := '{"r1":120,"r2":240,"r3":1440,"expire":1440,"critical_r1":10,"critical_r2":20,"critical_r3":30,"critical_expire":30,"hourly_limit":6,"extend":1440}';
  raw JSONB;
  k TEXT;
  v INT;
  o JSONB := d;
BEGIN
  SELECT value INTO raw FROM public.platform_settings WHERE key = 'assignment_reminder_minutes';
  IF jsonb_typeof(raw) = 'object' THEN
    FOR k IN SELECT jsonb_object_keys(d) LOOP
      BEGIN
        v := (raw ->> k)::INT;
      EXCEPTION WHEN OTHERS THEN
        v := NULL;
      END;
      IF v IS NOT NULL AND v BETWEEN 1 AND 10080 THEN
        o := jsonb_set(o, ARRAY[k], to_jsonb(v));
      END IF;
    END LOOP;
  END IF;
  IF NOT ((o->>'r1')::INT < (o->>'r2')::INT AND (o->>'r2')::INT < (o->>'r3')::INT AND (o->>'r3')::INT <= (o->>'expire')::INT) THEN
    o := o || jsonb_build_object('r1', 120, 'r2', 240, 'r3', 1440, 'expire', 1440);
  END IF;
  IF NOT ((o->>'critical_r1')::INT < (o->>'critical_r2')::INT AND (o->>'critical_r2')::INT < (o->>'critical_r3')::INT
          AND (o->>'critical_r3')::INT <= (o->>'critical_expire')::INT) THEN
    o := o || jsonb_build_object('critical_r1', 10, 'critical_r2', 20, 'critical_r3', 30, 'critical_expire', 30);
  END IF;
  o := jsonb_set(o, '{hourly_limit}', to_jsonb(LEAST((o->>'hourly_limit')::INT, 60)));
  RETURN o;
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_policy_minutes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_policy_minutes() TO authenticated, service_role;

-- Duration labels for notification text (mirror of durationLabel in _shared/assignmentPolicy.ts).
CREATE OR REPLACE FUNCTION public.assignment_duration_label(_minutes INT, _lang TEXT, _prefer_days BOOLEAN DEFAULT true)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  m INT := GREATEST(0, COALESCE(_minutes, 0));
  n INT;
BEGIN
  IF m < 60 THEN
    IF _lang = 'ar' THEN
      RETURN CASE WHEN m = 1 THEN 'دقيقة واحدة' WHEN m = 2 THEN 'دقيقتين' WHEN m BETWEEN 3 AND 10 THEN m || ' دقائق' ELSE m || ' دقيقة' END;
    END IF;
    RETURN m || CASE WHEN m = 1 THEN ' minute' ELSE ' minutes' END;
  END IF;
  IF _prefer_days AND m % 1440 = 0 THEN
    n := m / 1440;
    IF _lang = 'ar' THEN
      RETURN CASE WHEN n = 1 THEN 'يوم واحد' WHEN n = 2 THEN 'يومين' WHEN n BETWEEN 3 AND 10 THEN n || ' أيام' ELSE n || ' يوماً' END;
    END IF;
    RETURN n || CASE WHEN n = 1 THEN ' day' ELSE ' days' END;
  END IF;
  IF m % 60 = 0 THEN
    n := m / 60;
    IF _lang = 'ar' THEN
      RETURN CASE WHEN n = 1 THEN 'ساعة واحدة' WHEN n = 2 THEN 'ساعتين' WHEN n BETWEEN 3 AND 10 THEN n || ' ساعات' ELSE n || ' ساعة' END;
    END IF;
    RETURN n || CASE WHEN n = 1 THEN ' hour' ELSE ' hours' END;
  END IF;
  IF _lang = 'ar' THEN
    RETURN (m / 60) || ' س ' || (m % 60) || ' د';
  END IF;
  RETURN (m / 60) || ' h ' || (m % 60) || ' min';
END;
$$;

-- The policy sentence (with the defaults it is the owner's exact wording).
CREATE OR REPLACE FUNCTION public.assignment_policy_text(_lang TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m JSONB := public.assignment_policy_minutes();
  l TEXT := CASE WHEN _lang = 'ar' THEN 'ar' ELSE 'en' END;
BEGIN
  IF l = 'ar' THEN
    RETURN 'يرجى القبول أو الرفض خلال ' || public.assignment_duration_label((m->>'expire')::INT, l, false)
      || ' (' || public.assignment_duration_label((m->>'critical_expire')::INT, l, false) || ' للطلبات الحرجة). نذكّرك بعد '
      || public.assignment_duration_label((m->>'r1')::INT, l) || ' و' || public.assignment_duration_label((m->>'r2')::INT, l)
      || ' و' || public.assignment_duration_label((m->>'r3')::INT, l)
      || '. إذا لم يصل رد يُبلَّغ العميل وقد يختار استشارياً آخر؛ وتكرار عدم الرد يخفض معدل استجابتك وترتيبك.';
  END IF;
  RETURN 'Please accept or decline within ' || public.assignment_duration_label((m->>'expire')::INT, l, false)
    || ' (' || public.assignment_duration_label((m->>'critical_expire')::INT, l, false) || ' for Critical requests). We remind you after '
    || public.assignment_duration_label((m->>'r1')::INT, l) || ', ' || public.assignment_duration_label((m->>'r2')::INT, l)
    || ' and ' || public.assignment_duration_label((m->>'r3')::INT, l)
    || '. If there is no reply the client is told and may choose another consultant; repeated non-response lowers your response rate and ranking.';
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_policy_text(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_policy_text(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assignment_user_lang(_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN (SELECT preferred_language FROM public.profiles WHERE user_id = _user_id) LIKE 'ar%' THEN 'ar' ELSE 'en' END;
$$;
REVOKE ALL ON FUNCTION public.assignment_user_lang(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_user_lang(UUID) TO service_role;

-- 4. New request: deadline, kind and the full message schedule.
CREATE OR REPLACE FUNCTION public.assignment_request_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m JSONB := public.assignment_policy_minutes();
  t RECORD;
  created TIMESTAMPTZ := COALESCE(NEW.created_at, now());
  crit BOOLEAN;
  bid BOOLEAN;
BEGIN
  SELECT urgency::TEXT AS urgency, COALESCE(critical_response, false) AS critical_response, bid_deadline
    INTO t FROM public.tickets WHERE id = NEW.ticket_id;
  crit := COALESCE(t.urgency = 'critical', false) OR COALESCE(t.critical_response, false);
  bid := NOT crit AND COALESCE(NEW.message, '') LIKE 'Private bid invitation%';
  NEW.created_at := created;
  NEW.is_critical := crit;
  NEW.response_kind := CASE WHEN bid THEN 'bid' ELSE 'request' END;
  NEW.response_due_at := CASE
    WHEN crit THEN created + make_interval(mins => (m->>'critical_expire')::INT)
    WHEN bid AND t.bid_deadline IS NOT NULL AND t.bid_deadline > created THEN t.bid_deadline
    ELSE created + make_interval(mins => (m->>'expire')::INT)
  END;
  NEW.reminders_sent := 0;
  NEW.last_reminder_at := NULL;
  NEW.expired_at := NULL;
  NEW.extended_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_request_defaults ON public.ticket_match_requests;
CREATE TRIGGER trg_assignment_request_defaults
  BEFORE INSERT ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.assignment_request_defaults();

CREATE OR REPLACE FUNCTION public.assignment_request_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Send the first e-mail right away (credential-free callback; the 5-minute sweep is the fallback).
  BEGIN
    PERFORM net.http_post(
      url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/assignment-reminders',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('request_id', NEW.id),
      timeout_milliseconds := 1000);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_request_schedule ON public.ticket_match_requests;
CREATE TRIGGER trg_assignment_request_schedule
  AFTER INSERT ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.assignment_request_schedule();

-- The first in-app notification now carries the deadline and the policy (replaces the old text).
CREATE OR REPLACE FUNCTION public.notify_match_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consultant_user_id UUID;
  _tz TEXT;
  _ticket RECORD;
  _lang TEXT;
  _when TEXT;
  _area TEXT;
BEGIN
  SELECT user_id, COALESCE(NULLIF(timezone, ''), 'Asia/Riyadh') INTO _consultant_user_id, _tz FROM public.consultants WHERE id = NEW.consultant_id;
  SELECT title, tenant_id, urgency::TEXT AS urgency, COALESCE(NULLIF(sap_module, ''), array_to_string(sap_modules, ', ')) AS area
    INTO _ticket FROM public.tickets WHERE id = NEW.ticket_id;
  IF _consultant_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    _when := to_char(NEW.response_due_at AT TIME ZONE _tz, 'DD Mon HH24:MI') || ' (' || _tz || ')';
  EXCEPTION WHEN OTHERS THEN
    _when := to_char(NEW.response_due_at AT TIME ZONE 'Asia/Riyadh', 'DD Mon HH24:MI') || ' (Asia/Riyadh)';
  END;
  _lang := public.assignment_user_lang(_consultant_user_id);
  _area := COALESCE(NULLIF(_ticket.area, ''), 'SAP');
  INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
  VALUES (
    _consultant_user_id,
    CASE WHEN _lang = 'ar' THEN 'طلب تعيين جديد' ELSE 'New assignment request' END,
    CASE WHEN _lang = 'ar'
      THEN '"' || left(COALESCE(_ticket.title, 'طلب'), 80) || '" · ' || _area || ' · ' || COALESCE(_ticket.urgency, 'medium')
           || CASE WHEN _when IS NOT NULL THEN '. يرجى الرد قبل ' || _when ELSE '' END || '. ' || public.assignment_policy_text('ar')
      ELSE '"' || left(COALESCE(_ticket.title, 'Untitled'), 80) || '" · ' || _area || ' · ' || COALESCE(_ticket.urgency, 'medium')
           || CASE WHEN _when IS NOT NULL THEN '. Please reply by ' || _when ELSE '' END || '. ' || public.assignment_policy_text('en')
    END,
    'match_request',
    '/consultant/requests?request=' || NEW.id,
    _ticket.tenant_id
  );
  RETURN NEW;
END;
$$;

-- 5. Guard: deadline, reminder and expiry fields are platform-managed; an expired request can only be withdrawn
--    (or extended by the client through client_extend_assignment_request).
CREATE OR REPLACE FUNCTION public.guard_assignment_request_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.assignment_policy', true) = 'on'
     OR (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
     OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.response_due_at IS DISTINCT FROM OLD.response_due_at
     OR NEW.response_kind IS DISTINCT FROM OLD.response_kind
     OR NEW.is_critical IS DISTINCT FROM OLD.is_critical
     OR NEW.reminders_sent IS DISTINCT FROM OLD.reminders_sent
     OR NEW.last_reminder_at IS DISTINCT FROM OLD.last_reminder_at
     OR NEW.expired_at IS DISTINCT FROM OLD.expired_at
     OR NEW.extended_at IS DISTINCT FROM OLD.extended_at THEN
    RAISE EXCEPTION 'These request details are managed by the platform' USING ERRCODE = '42501';
  END IF;
  IF NEW.status::TEXT = 'expired' AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'Only the platform marks a request as No response' USING ERRCODE = '42501';
  END IF;
  IF OLD.status::TEXT = 'expired' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status::TEXT <> 'withdrawn' THEN
    RAISE EXCEPTION 'This request is no longer open: the response time ended. The client can give more time once.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_assignment_request_update ON public.ticket_match_requests;
CREATE TRIGGER trg_guard_assignment_request_update
  BEFORE UPDATE ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_request_update();

-- Stop: the moment a request leaves "pending" (answered, withdrawn, expired), every unsent message is cancelled.
CREATE OR REPLACE FUNCTION public.assignment_request_stop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status::TEXT = 'pending' AND NEW.status::TEXT <> 'pending' THEN
    UPDATE public.assignment_reminder_log
       SET cancelled_at = now()
     WHERE request_id = NEW.id AND sent_at IS NULL AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_request_stop ON public.ticket_match_requests;
CREATE TRIGGER trg_assignment_request_stop
  AFTER UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.assignment_request_stop();

-- Stop when the ticket closes.
CREATE OR REPLACE FUNCTION public.assignment_ticket_closed_stop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::TEXT IN ('resolved', 'closed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.assignment_reminder_log l
       SET cancelled_at = now()
      FROM public.ticket_match_requests q
     WHERE q.id = l.request_id AND q.ticket_id = NEW.id AND l.sent_at IS NULL AND l.cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_ticket_closed_stop ON public.tickets;
CREATE TRIGGER trg_assignment_ticket_closed_stop
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.assignment_ticket_closed_stop();

-- 6. Claim RPC (service role only): returns due messages atomically and records them as sent.
--    _request_id: only that request (immediate first e-mail); NULL: the 5-minute sweep.
CREATE OR REPLACE FUNCTION public.claim_assignment_reminders(_limit INT DEFAULT 100, _request_id UUID DEFAULT NULL)
RETURNS TABLE (
  log_id UUID,
  request_id UUID,
  step TEXT,
  recipient TEXT,
  recipient_user_id UUID,
  ticket_id UUID,
  ticket_title TEXT,
  sap_area TEXT,
  urgency TEXT,
  is_critical BOOLEAN,
  response_kind TEXT,
  response_due_at TIMESTAMPTZ,
  minutes_left INT,
  proposed_rate NUMERIC,
  rate_currency TEXT,
  consultant_name TEXT,
  can_extend BOOLEAN,
  lang TEXT,
  timezone TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_flag BOOLEAN;
  m JSONB;
  v_limit INT;
  v_hourly INT;
  r RECORD;
  v_last_rem UUID;
  v_sent INT;
  v_n INT := 0;
  v_left INT;
  v_lang TEXT;
  v_name TEXT;
  v_rate NUMERIC;
  v_cur TEXT;
  v_num INT;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.assignment_policy', 'on', true);
  v_flag := public.platform_flag('assignment_reminders', true);
  m := public.assignment_policy_minutes();
  v_hourly := (m->>'hourly_limit')::INT;
  v_limit := LEAST(GREATEST(COALESCE(_limit, 100), 1), 200);

  -- Answered, withdrawn or expired requests and closed tickets: cancel what is still unsent.
  UPDATE public.assignment_reminder_log l
     SET cancelled_at = now()
    FROM public.ticket_match_requests q
    JOIN public.tickets t ON t.id = q.ticket_id
   WHERE l.request_id = q.id AND l.sent_at IS NULL AND l.cancelled_at IS NULL
     AND (q.status::TEXT <> 'pending' OR t.status::TEXT IN ('resolved', 'closed'))
     AND (_request_id IS NULL OR q.id = _request_id);

  FOR r IN
    SELECT l.id AS lid, l.step AS lstep, q.id AS qid, q.ticket_id AS tid, q.consultant_id AS cid,
           q.response_due_at AS due, q.is_critical AS crit, q.response_kind AS kind, q.extended_at AS ext,
           c.user_id AS cuid, COALESCE(NULLIF(c.timezone, ''), 'Asia/Riyadh') AS tz,
           t.client_id AS clid, t.title AS ttitle, t.urgency::TEXT AS urg,
           COALESCE(NULLIF(t.sap_module, ''), array_to_string(t.sap_modules, ', ')) AS area
      FROM public.assignment_reminder_log l
      JOIN public.ticket_match_requests q ON q.id = l.request_id
      JOIN public.consultants c ON c.id = q.consultant_id
      JOIN public.tickets t ON t.id = q.ticket_id
     WHERE l.sent_at IS NULL AND l.cancelled_at IS NULL AND l.due_at <= now()
       AND q.status::TEXT = 'pending'
       AND t.status::TEXT NOT IN ('resolved', 'closed')
       AND (_request_id IS NULL OR l.request_id = _request_id)
       AND (l.step = 'request' OR v_flag)
     ORDER BY l.request_id, l.due_at DESC
     LIMIT v_limit * 4
     FOR UPDATE OF l SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= v_limit;

    IF r.lstep IN ('expire', 'expire2') THEN
      -- "No response" only after the first message and every reminder went out in an earlier run.
      IF EXISTS (SELECT 1 FROM public.assignment_reminder_log x
                  WHERE x.request_id = r.qid AND x.step IN ('request', 'r1', 'r2', 'r3')
                    AND x.cancelled_at IS NULL AND (x.sent_at IS NULL OR x.sent_at >= now())) THEN
        CONTINUE;
      END IF;
    ELSIF r.lstep IN ('r1', 'r2', 'r3') THEN
      IF v_last_rem = r.qid THEN
        -- A later reminder of this request was sent in this run: the older one is superseded.
        UPDATE public.assignment_reminder_log SET cancelled_at = now() WHERE id = r.lid;
        CONTINUE;
      END IF;
      SELECT count(*) INTO v_sent
        FROM public.assignment_reminder_log x
        JOIN public.ticket_match_requests y ON y.id = x.request_id
       WHERE y.consultant_id = r.cid AND x.step IN ('r1', 'r2', 'r3') AND x.sent_at > now() - interval '1 hour';
      IF v_sent >= v_hourly THEN
        CONTINUE; -- per-consultant rate limit: picked up by a later run
      END IF;
    END IF;

    UPDATE public.assignment_reminder_log SET sent_at = now() WHERE id = r.lid;
    v_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (r.due - now())) / 60))::INT;
    SELECT p.display_name INTO v_name FROM public.profiles p WHERE p.user_id = r.cuid;
    SELECT tr.hourly_rate, tr.currency INTO v_rate, v_cur
      FROM public.ticket_rates tr
     WHERE tr.ticket_id = r.tid AND tr.consultant_id = r.cid AND tr.status <> 'rejected'
     ORDER BY tr.created_at DESC LIMIT 1;

    IF r.lstep IN ('r1', 'r2', 'r3') THEN
      v_num := substr(r.lstep, 2)::INT;
      v_last_rem := r.qid;
      UPDATE public.ticket_match_requests
         SET reminders_sent = GREATEST(reminders_sent, v_num), last_reminder_at = now()
       WHERE id = r.qid;
      v_lang := public.assignment_user_lang(r.cuid);
      PERFORM public.safe_insert_notification(
        r.cuid,
        CASE WHEN v_lang = 'ar' THEN 'تذكير: طلب تعيين بانتظار ردك' ELSE 'Reminder: assignment request waiting' END,
        CASE WHEN v_lang = 'ar'
          THEN '"' || left(COALESCE(r.ttitle, 'طلب'), 80) || '": '
               || CASE WHEN v_left > 0 THEN 'متبقٍ ' || public.assignment_duration_label(v_left, 'ar', false) || ' للقبول أو الرفض. '
                       ELSE 'انتهى وقت الرد الآن، هذا آخر تذكير. ' END
               || public.assignment_policy_text('ar')
          ELSE '"' || left(COALESCE(r.ttitle, 'A request'), 80) || '": '
               || CASE WHEN v_left > 0 THEN public.assignment_duration_label(v_left, 'en', false) || ' left to accept or decline. '
                       ELSE 'The response time ends now; this is the last reminder. ' END
               || public.assignment_policy_text('en')
        END,
        'match_request',
        '/consultant/requests?request=' || r.qid);
      recipient := 'consultant';
      recipient_user_id := r.cuid;
    ELSIF r.lstep IN ('expire', 'expire2') THEN
      UPDATE public.ticket_match_requests SET status = 'expired', expired_at = now() WHERE id = r.qid;
      v_lang := public.assignment_user_lang(r.clid);
      PERFORM public.safe_insert_notification(
        r.clid,
        CASE WHEN v_lang = 'ar' THEN 'لا يوجد رد من الاستشاري' ELSE 'No reply from the consultant' END,
        CASE WHEN v_lang = 'ar'
          THEN COALESCE(v_name, 'الاستشاري') || ' لم يرد خلال المهلة على "' || left(COALESCE(r.ttitle, 'طلبك'), 80)
               || '". ادعُ استشارياً آخر من أفضل التطابقات، أو افتح الطلب للعروض'
               || CASE WHEN r.ext IS NULL THEN '، أو امنحه 24 ساعة إضافية (مرة واحدة).' ELSE '.' END
          ELSE COALESCE(v_name, 'The consultant') || ' did not respond within the time limit on "' || left(COALESCE(r.ttitle, 'your request'), 80)
               || '". Invite another of the best matches, open the request for bids'
               || CASE WHEN r.ext IS NULL THEN ', or wait 24 hours longer (once).' ELSE '.' END
        END,
        'match_request',
        '/client/tickets/' || r.tid || '?noresponse=' || r.qid);
      -- The consultant is told privately; nothing is shown to other clients.
      PERFORM public.safe_insert_notification(
        r.cuid,
        CASE WHEN public.assignment_user_lang(r.cuid) = 'ar' THEN 'انتهى وقت الرد على طلب' ELSE 'Request closed: no reply in time' END,
        CASE WHEN public.assignment_user_lang(r.cuid) = 'ar'
          THEN 'لم يصل ردك على "' || left(COALESCE(r.ttitle, 'طلب'), 80) || '" في الوقت المحدد، وقد أُبلغ العميل.'
          ELSE 'You did not reply to "' || left(COALESCE(r.ttitle, 'a request'), 80) || '" in time. The client was told.' END,
        'match_request',
        '/consultant/requests?request=' || r.qid);
      recipient := 'client';
      recipient_user_id := r.clid;
    ELSE
      -- 'request': the in-app notification was written by notify_match_request at insert time.
      v_lang := public.assignment_user_lang(r.cuid);
      recipient := 'consultant';
      recipient_user_id := r.cuid;
    END IF;

    log_id := r.lid;
    request_id := r.qid;
    step := r.lstep;
    ticket_id := r.tid;
    ticket_title := r.ttitle;
    sap_area := r.area;
    urgency := r.urg;
    is_critical := r.crit;
    response_kind := r.kind;
    response_due_at := r.due;
    minutes_left := v_left;
    proposed_rate := v_rate;
    rate_currency := v_cur;
    consultant_name := v_name;
    can_extend := r.ext IS NULL;
    lang := v_lang;
    timezone := r.tz;
    v_rate := NULL;
    v_cur := NULL;
    v_n := v_n + 1;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_assignment_reminders(INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_assignment_reminders(INT, UUID) TO service_role;

-- 7. Admin digest: at most one in-app line per administrator per hour, only when requests expired.
CREATE OR REPLACE FUNCTION public.assignment_admin_digest()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
  a RECORD;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assignment_reminder_log WHERE digested_at > now() - interval '1 hour') THEN
    RETURN 0;
  END IF;
  WITH pick AS (
    SELECT l.id FROM public.assignment_reminder_log l
     WHERE l.step IN ('expire', 'expire2') AND l.sent_at IS NOT NULL AND l.digested_at IS NULL
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.assignment_reminder_log l SET digested_at = now() FROM pick WHERE l.id = pick.id RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  IF n = 0 THEN
    RETURN 0;
  END IF;
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin') LOOP
    PERFORM public.safe_insert_notification(a.user_id, 'Assignment requests without reply',
      n || CASE WHEN n = 1 THEN ' assignment request' ELSE ' assignment requests' END
        || ' got no reply within the time limit. The clients were told.',
      'admin', '/admin/settings#assignment-reminders');
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_admin_digest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_admin_digest() TO service_role;

-- 8. "Wait longer": the ticket's client (or an administrator) gives one extra window after "No response".
CREATE OR REPLACE FUNCTION public.client_extend_assignment_request(_request_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_due TIMESTAMPTZ;
  m JSONB := public.assignment_policy_minutes();
  v_lang TEXT;
BEGIN
  SELECT q.id, q.status::TEXT AS status, q.extended_at, q.consultant_id, t.id AS tid, t.client_id, t.title, t.status::TEXT AS tstatus, c.user_id AS cuid
    INTO r
    FROM public.ticket_match_requests q
    JOIN public.tickets t ON t.id = q.ticket_id
    JOIN public.consultants c ON c.id = q.consultant_id
   WHERE q.id = _request_id
   FOR UPDATE OF q;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.client_id IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'expired' THEN
    RAISE EXCEPTION 'Only a request without reply can get more time' USING ERRCODE = 'P0001';
  END IF;
  IF r.extended_at IS NOT NULL THEN
    RAISE EXCEPTION 'This request already got more time once' USING ERRCODE = 'P0001';
  END IF;
  IF r.tstatus IN ('resolved', 'closed') THEN
    RAISE EXCEPTION 'The ticket is closed' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.assignment_policy', 'on', true);
  v_due := now() + make_interval(mins => (m->>'extend')::INT);
  UPDATE public.ticket_match_requests
     SET status = 'pending', extended_at = now(), expired_at = NULL, response_due_at = v_due
   WHERE id = _request_id;
  INSERT INTO public.assignment_reminder_log (request_id, step, due_at) VALUES (_request_id, 'expire2', v_due)
    ON CONFLICT DO NOTHING;
  v_lang := public.assignment_user_lang(r.cuid);
  PERFORM public.safe_insert_notification(r.cuid,
    CASE WHEN v_lang = 'ar' THEN 'منحك العميل وقتاً إضافياً' ELSE 'The client gave you more time' END,
    CASE WHEN v_lang = 'ar'
      THEN 'يمكنك الآن الرد على "' || left(COALESCE(r.title, 'طلب'), 80) || '" خلال ' || public.assignment_duration_label((m->>'extend')::INT, 'ar', false) || '. ' || public.assignment_policy_text('ar')
      ELSE 'You can now answer "' || left(COALESCE(r.title, 'a request'), 80) || '" within ' || public.assignment_duration_label((m->>'extend')::INT, 'en', false) || '. ' || public.assignment_policy_text('en') END,
    'match_request', '/consultant/requests?request=' || _request_id);
  RETURN v_due;
END;
$$;

REVOKE ALL ON FUNCTION public.client_extend_assignment_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_extend_assignment_request(UUID) TO authenticated;

-- 9. Response rate (matching + admins only; never shown to clients or other consultants).
--    Counts requests under this policy: answered = accepted/declined without ever expiring; no response = expired at least once.
CREATE OR REPLACE FUNCTION public.assignment_response_rates(_consultant_ids UUID[] DEFAULT NULL)
RETURNS TABLE (consultant_id UUID, answered INT, no_response INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT q.consultant_id AS cid, q.status::TEXT AS st, q.responded_at,
           EXISTS (SELECT 1 FROM public.assignment_reminder_log l
                    WHERE l.request_id = q.id AND l.step IN ('expire', 'expire2') AND l.sent_at IS NOT NULL) AS missed
      FROM public.ticket_match_requests q
     WHERE q.response_due_at IS NOT NULL
       AND (_consultant_ids IS NULL OR q.consultant_id = ANY (_consultant_ids))
  )
  SELECT b.cid,
         count(*) FILTER (WHERE NOT b.missed AND b.st IN ('accepted', 'rejected') AND b.responded_at IS NOT NULL)::INT,
         count(*) FILTER (WHERE b.missed)::INT
    FROM base b
   GROUP BY b.cid;
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_response_rates(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_response_rates(UUID[]) TO authenticated, service_role;

-- 10. Admin statistics for the settings card.
CREATE OR REPLACE FUNCTION public.admin_assignment_reminder_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN jsonb_build_object(
    'last_run', (SELECT max(ran_at) FROM public.assignment_reminder_runs),
    'sent_today', (SELECT count(*) FROM public.assignment_reminder_log
                    WHERE sent_at >= date_trunc('day', now()) AND step IN ('r1', 'r2', 'r3')),
    'waiting', (SELECT count(*) FROM public.ticket_match_requests WHERE status::TEXT = 'pending' AND response_due_at IS NOT NULL),
    'no_response_30d', (SELECT count(*) FROM public.assignment_reminder_log
                         WHERE step IN ('expire', 'expire2') AND sent_at >= now() - interval '30 days'),
    'lowest', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.rate, x.no_response DESC)
        FROM (
          SELECT rr.consultant_id, p.display_name AS name, rr.answered, rr.no_response,
                 round(rr.answered::NUMERIC / NULLIF(rr.answered + rr.no_response, 0), 2) AS rate
            FROM public.assignment_response_rates(NULL) rr
            JOIN public.consultants c ON c.id = rr.consultant_id
            LEFT JOIN public.profiles p ON p.user_id = c.user_id
           WHERE rr.no_response > 0
           ORDER BY rate, rr.no_response DESC
           LIMIT 10
        ) x), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assignment_reminder_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assignment_reminder_stats() TO authenticated;

-- 11. Sweep every 5 minutes (credential-free; the claim RPC and the function's guard bound the work).
SELECT cron.schedule(
  'assignment-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/assignment-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
