-- Feature L addition: decision preview, "Request more information" and decline reasons for assignment requests.
-- APPLIED 2026-10-21 (drizzle migration 0073, identical text). Needs docs/sql/assignment-response.sql (live since 2026-10-20);
-- works with or without docs/sql/responsiveness.sql (probed with to_regclass / to_regprocedure).
--
-- 1. "Open ticket description": assignment_request_preview returns a decision preview (title, description as written with
--    contact details and the client's names masked, SAP area, urgency, industry, country, hours/budget/rate, deadlines and
--    the attachment LIST: names + type + size only). Files, credentials, remote access, links and contact details stay
--    locked behind the existing NDA + rate + engagement gates (nothing here changes those tables or policies).
--    Opening it stores viewed_at (shown to the client as "Viewed by ..."); it is not an answer and the clock keeps running.
-- 2. "Request more information": consultant_request_assignment_info (up to 3 per request, one open at a time, 3 topics,
--    500 characters, contact-bypass filter). The reply clock pauses; the request counts as RESPONDED at that moment
--    (Feature M time to first response, Feature L response rate). The client answers with client_answer_assignment_info
--    (text + optional ticket document); the clock resumes with the time that was left, at least 2 hours. Without an
--    answer within the platform time (assignment_reminder_minutes.info_wait, default 24 h) the question is returned to the
--    client as "Waiting for your answer"; the consultant is never counted as non-responsive for it.
-- 3. Decline reasons (optional): consultant_decline_assignment stores them privately (administrators, the consultant);
--    the ticket owner only gets anonymous "next best" hints through assignment_decline_hints. Never shown publicly.
-- E-mails go through the assignment-reminders function (credential-free callback + the 5-minute sweep, which also
-- returns unanswered questions to the client) via the service-only claim_assignment_info_emails.

-- 1. Request columns (platform-managed, see the guard in step 4).
ALTER TABLE public.ticket_match_requests
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS info_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS info_remaining_seconds INT,
  ADD COLUMN IF NOT EXISTS info_resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS info_first_asked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS info_requests_count INT NOT NULL DEFAULT 0;

-- 2. Information requests and private decline reasons.
CREATE TABLE IF NOT EXISTS public.assignment_info_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.ticket_match_requests(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  topics TEXT[] NOT NULL DEFAULT '{}',
  question TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'timed_out', 'closed')),
  asked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_due_at TIMESTAMPTZ NOT NULL,
  answer TEXT,
  answer_document_id UUID REFERENCES public.ticket_documents(id) ON DELETE SET NULL,
  answer_file_name TEXT,
  answer_file_type TEXT,
  answered_at TIMESTAMPTZ,
  timed_out_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  ask_email_at TIMESTAMPTZ,
  answer_email_at TIMESTAMPTZ,
  timeout_email_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assignment_info_topics_check CHECK (
    cardinality(topics) <= 3 AND topics <@ ARRAY['scope', 'system', 'error', 'timeline_budget', 'access']::TEXT[]),
  CONSTRAINT assignment_info_question_check CHECK (char_length(question) <= 500),
  CONSTRAINT assignment_info_answer_check CHECK (answer IS NULL OR char_length(answer) <= 1000)
);
-- One open question per request at a time.
CREATE UNIQUE INDEX IF NOT EXISTS assignment_info_one_open_idx
  ON public.assignment_info_requests (request_id) WHERE status IN ('open', 'timed_out');
CREATE INDEX IF NOT EXISTS assignment_info_ticket_idx ON public.assignment_info_requests (ticket_id, asked_at DESC);
CREATE INDEX IF NOT EXISTS assignment_info_due_idx ON public.assignment_info_requests (client_due_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.assignment_decline_reasons (
  request_id UUID PRIMARY KEY REFERENCES public.ticket_match_requests(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assignment_decline_reasons_check CHECK (
    cardinality(reasons) <= 6
    AND reasons <@ ARRAY['not_my_module', 'no_capacity', 'rate_budget', 'timing', 'info_missing', 'other']::TEXT[])
);
CREATE INDEX IF NOT EXISTS assignment_decline_reasons_ticket_idx ON public.assignment_decline_reasons (ticket_id);

GRANT SELECT ON public.assignment_info_requests TO authenticated;
GRANT ALL ON public.assignment_info_requests TO service_role;
GRANT SELECT ON public.assignment_decline_reasons TO authenticated;
GRANT ALL ON public.assignment_decline_reasons TO service_role;
ALTER TABLE public.assignment_info_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_decline_reasons ENABLE ROW LEVEL SECURITY;

-- Read only; every write goes through the RPCs below.
DROP POLICY IF EXISTS "Consultant, client, company and admins read info requests" ON public.assignment_info_requests;
CREATE POLICY "Consultant, client, company and admins read info requests"
  ON public.assignment_info_requests FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = assignment_info_requests.consultant_id AND c.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = assignment_info_requests.ticket_id AND t.client_id = auth.uid())
    OR public.ticket_in_my_company(ticket_id)
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "The consultant and admins read decline reasons" ON public.assignment_decline_reasons;
CREATE POLICY "The consultant and admins read decline reasons"
  ON public.assignment_decline_reasons FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = assignment_decline_reasons.consultant_id AND c.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'assignment_info_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.assignment_info_requests;
  END IF;
END $$;

-- 3. Timings: info_wait (minutes the client has to answer, default 24 h) joins the admin timings.
CREATE OR REPLACE FUNCTION public.assignment_policy_minutes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d CONSTANT JSONB := '{"r1":120,"r2":240,"r3":1440,"expire":1440,"critical_r1":10,"critical_r2":20,"critical_r3":30,"critical_expire":30,"hourly_limit":6,"extend":1440,"info_wait":1440}';
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

-- The policy sentence gains one sentence about information requests (mirror of policyText(..., { info: true })).
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
      || '. إذا لم يصل رد يُبلَّغ العميل وقد يختار استشارياً آخر؛ وتكرار عدم الرد يخفض معدل استجابتك وترتيبك.'
      || ' يمكنك أيضاً طلب معلومات إضافية من العميل: يتوقف العدّاد حتى يجيب، ويُحتسب طلبك في الوقت المحدد رداً.';
  END IF;
  RETURN 'Please accept or decline within ' || public.assignment_duration_label((m->>'expire')::INT, l, false)
    || ' (' || public.assignment_duration_label((m->>'critical_expire')::INT, l, false) || ' for Critical requests). We remind you after '
    || public.assignment_duration_label((m->>'r1')::INT, l) || ', ' || public.assignment_duration_label((m->>'r2')::INT, l)
    || ' and ' || public.assignment_duration_label((m->>'r3')::INT, l)
    || '. If there is no reply the client is told and may choose another consultant; repeated non-response lowers your response rate and ranking.'
    || ' You can also ask the client for more information: the clock pauses until they answer, and asking in time counts as a response.';
END;
$$;
REVOKE ALL ON FUNCTION public.assignment_policy_text(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_policy_text(TEXT) TO authenticated, service_role;

-- The portal asks this to switch the new buttons on (missing function = feature not applied yet).
CREATE OR REPLACE FUNCTION public.assignment_info_ready()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.assignment_info_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_info_ready() TO authenticated, service_role;

-- 4. Guard: the new columns are platform-managed like the deadline fields.
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
     OR NEW.extended_at IS DISTINCT FROM OLD.extended_at
     OR NEW.viewed_at IS DISTINCT FROM OLD.viewed_at
     OR NEW.last_viewed_at IS DISTINCT FROM OLD.last_viewed_at
     OR NEW.info_paused_at IS DISTINCT FROM OLD.info_paused_at
     OR NEW.info_remaining_seconds IS DISTINCT FROM OLD.info_remaining_seconds
     OR NEW.info_resumed_at IS DISTINCT FROM OLD.info_resumed_at
     OR NEW.info_first_asked_at IS DISTINCT FROM OLD.info_first_asked_at
     OR NEW.info_requests_count IS DISTINCT FROM OLD.info_requests_count THEN
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

-- When a request leaves "pending" (accepted, declined, withdrawn, expired), its open question is closed.
CREATE OR REPLACE FUNCTION public.assignment_info_close_on_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status::TEXT = 'pending' AND NEW.status::TEXT <> 'pending' THEN
    UPDATE public.assignment_info_requests SET status = 'closed', closed_at = now()
     WHERE request_id = NEW.id AND status IN ('open', 'timed_out');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_assignment_info_close_on_status ON public.ticket_match_requests;
CREATE TRIGGER trg_assignment_info_close_on_status
  AFTER UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.assignment_info_close_on_status();

-- 5. Masking (the same patterns as contact_details_in_text) and the client's own names.
CREATE OR REPLACE FUNCTION public.mask_contact_details(_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           COALESCE(_text, ''),
           '[a-z0-9._%+-]+\s?(@|\[at\]|\(at\))\s?[a-z0-9-]+(\.|\s?\[dot\]\s?)[a-z]{2,}', '[hidden]', 'gi'),
           '(https?://|www\.)[^\s]+', '[hidden]', 'gi'),
           '\m[a-z0-9-]+\.(com|net|org|io|me|co|app|dev|ai|info|biz|sa|ae|eg)(/|\M)', '[hidden]', 'gi'),
           '\m(whats\s?app|telegram|skype|viber|wechat|signal app|t\.me)\M', '[hidden]', 'gi'),
           '(\+|\m00)\d[\d\s().-]{7,}\d', '[hidden]', 'g'),
           '\m\d{9,}\M', '[hidden]', 'g'),
           '\m\d{3}[\s.-]\d{3,4}[\s.-]\d{4}\M', '[hidden]', 'g'),
           '\m\d{2,4}[\s.-]\d{7,8}\M', '[hidden]', 'g')
$$;
REVOKE ALL ON FUNCTION public.mask_contact_details(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mask_contact_details(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assignment_mask_text(_text TEXT, _deny TEXT[])
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s TEXT := public.mask_contact_details(_text);
  term TEXT;
  p INT;
  guard INT;
BEGIN
  FOREACH term IN ARRAY COALESCE(_deny, '{}'::TEXT[]) LOOP
    term := btrim(COALESCE(term, ''));
    CONTINUE WHEN char_length(term) < 3;
    guard := 0;
    LOOP
      p := strpos(lower(s), lower(term));
      EXIT WHEN p = 0 OR guard >= 50;
      s := overlay(s PLACING '[client]' FROM p FOR char_length(term));
      guard := guard + 1;
    END LOOP;
  END LOOP;
  RETURN s;
END;
$$;
REVOKE ALL ON FUNCTION public.assignment_mask_text(TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_mask_text(TEXT, TEXT[]) TO service_role;

CREATE OR REPLACE FUNCTION public.assignment_info_topic_label(_topic TEXT, _lang TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _lang = 'ar' THEN
    CASE _topic WHEN 'scope' THEN 'نطاق العمل' WHEN 'system' THEN 'إصدار النظام وبيئته' WHEN 'error' THEN 'رسالة الخطأ أو لقطة شاشة'
                WHEN 'timeline_budget' THEN 'الجدول الزمني أو الميزانية' WHEN 'access' THEN 'طريقة الوصول' ELSE _topic END
  ELSE
    CASE _topic WHEN 'scope' THEN 'Scope' WHEN 'system' THEN 'System version / landscape' WHEN 'error' THEN 'Error message / screenshot'
                WHEN 'timeline_budget' THEN 'Timeline / budget' WHEN 'access' THEN 'Access method' ELSE _topic END
  END
$$;

-- 5b. Reminder claim (unchanged except one line): no reminders or "No response" while the clock is paused.
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
       -- Paused while the consultant waits for the client's answer (only the first message still goes out).
       AND (q.info_paused_at IS NULL OR l.step = 'request')
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

-- 6. "Open ticket description": decision preview for the consultant of the request (or an administrator).
CREATE OR REPLACE FUNCTION public.assignment_request_preview(_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q RECORD;
  t RECORD;
  v_cons UUID;
  v_admin BOOLEAN;
  v_deny TEXT[];
  v_industry TEXT;
  v_country TEXT;
  v_rate NUMERIC;
  v_cur TEXT;
  v_files JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;
  v_admin := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin');
  SELECT c.id INTO v_cons FROM public.consultants c WHERE c.user_id = auth.uid();
  SELECT * INTO q FROM public.ticket_match_requests WHERE id = _request_id;
  IF NOT FOUND OR (q.consultant_id IS DISTINCT FROM v_cons AND NOT v_admin) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = '42501';
  END IF;
  -- Same reach as the existing ticket link: open or accepted requests only.
  IF q.status::TEXT NOT IN ('pending', 'accepted') AND NOT v_admin THEN
    RAISE EXCEPTION 'This request is no longer open' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO t FROM public.tickets WHERE id = q.ticket_id;

  -- Names that identify the client are replaced in every text (company, company account, person).
  SELECT array_remove(ARRAY[
           (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = t.client_id LIMIT 1),
           (SELECT tn.name FROM public.tenants tn WHERE tn.id = t.tenant_id),
           (SELECT p.display_name FROM public.profiles p WHERE p.user_id = t.client_id)
         ], NULL) INTO v_deny;
  SELECT COALESCE(NULLIF(t.ticket_context->>'industry', ''), NULLIF(cp.industry, ''), NULLIF(tn.industry, '')),
         COALESCE(NULLIF(t.ticket_context->>'country', ''), NULLIF(cp.country, ''))
    INTO v_industry, v_country
    FROM (SELECT 1) one
    LEFT JOIN public.client_profiles cp ON cp.user_id = t.client_id
    LEFT JOIN public.tenants tn ON tn.id = t.tenant_id
   LIMIT 1;
  SELECT tr.hourly_rate, tr.currency INTO v_rate, v_cur
    FROM public.ticket_rates tr
   WHERE tr.ticket_id = q.ticket_id AND tr.consultant_id = q.consultant_id AND tr.status <> 'rejected'
   ORDER BY tr.created_at DESC LIMIT 1;

  -- Attachment LIST only: name, type and size; never the storage path or a link.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', public.assignment_mask_text(f.file_name, v_deny), 'type', f.mime_type, 'size', f.file_size)
                            ORDER BY f.created_at), '[]'::jsonb)
    INTO v_files
    FROM (
      (SELECT DISTINCT ON (d.file_name) d.file_name, d.mime_type, d.file_size, d.created_at
         FROM public.ticket_documents d WHERE d.ticket_id = q.ticket_id
        ORDER BY d.file_name, d.version DESC)
      UNION ALL
      (SELECT a.file_name, a.mime_type, a.file_size, a.created_at
         FROM public.attachments a WHERE a.entity_id = q.ticket_id AND COALESCE(a.entity_type, 'ticket') = 'ticket')
    ) f;

  -- Log the view (the consultant's own views only). It is not an answer: status, reminders and the clock are untouched.
  IF q.consultant_id = v_cons THEN
    PERFORM set_config('app.assignment_policy', 'on', true);
    UPDATE public.ticket_match_requests SET viewed_at = COALESCE(viewed_at, now()), last_viewed_at = now() WHERE id = q.id;
  END IF;

  RETURN jsonb_build_object(
    'request_id', q.id,
    'title', public.assignment_mask_text(t.title, v_deny),
    'description', public.assignment_mask_text(t.description, v_deny),
    'sap_module', t.sap_module,
    'sap_modules', to_jsonb(COALESCE(t.sap_modules, '{}'::TEXT[])),
    'sap_module_other', NULLIF(public.assignment_mask_text(t.sap_module_other, v_deny), ''),
    'area_details', NULLIF(public.assignment_mask_text(t.area_details, v_deny), ''),
    'urgency', t.urgency::TEXT,
    'critical', COALESCE(q.is_critical, false),
    'industry', v_industry,
    'country', v_country,
    'planned_hours', t.planned_hours,
    'planned_cost', t.planned_cost,
    'cost_currency', t.cost_currency,
    'budget_max_rate', t.ticket_context->>'budget_max_rate',
    'proposed_rate', v_rate,
    'rate_currency', v_cur,
    'response_due_at', q.response_due_at,
    'bid_deadline', t.bid_deadline,
    'attachments', v_files,
    'info_paused', q.status::TEXT = 'pending' AND q.info_paused_at IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.assignment_request_preview(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_request_preview(UUID) TO authenticated;

-- Wakes the e-mail sender for one information request (credential-free; the 5-minute sweep is the fallback).
CREATE OR REPLACE FUNCTION public.assignment_info_wake(_info_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/assignment-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('info_id', _info_id),
    timeout_milliseconds := 1000);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.assignment_info_wake(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_info_wake(UUID) TO service_role;

-- 7. "Request more information" (the consultant of a pending request).
CREATE OR REPLACE FUNCTION public.consultant_request_assignment_info(_request_id UUID, _topics TEXT[], _question TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cons UUID;
  v_name TEXT;
  q RECORD;
  t RECORD;
  v_topics TEXT[];
  v_text TEXT := btrim(COALESCE(_question, ''));
  v_wait INT;
  v_id UUID;
  v_ev UUID;
  v_lang TEXT;
  v_labels TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;
  SELECT c.id INTO v_cons FROM public.consultants c WHERE c.user_id = auth.uid();
  SELECT * INTO q FROM public.ticket_match_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_cons IS NULL OR q.consultant_id IS DISTINCT FROM v_cons THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = '42501';
  END IF;
  SELECT id, title, client_id, status::TEXT AS status INTO t FROM public.tickets WHERE id = q.ticket_id;
  IF q.status::TEXT <> 'pending' OR t.status IN ('resolved', 'closed') THEN
    RAISE EXCEPTION 'This request is no longer open' USING ERRCODE = 'P0001';
  END IF;
  IF q.response_due_at IS NOT NULL AND q.response_due_at <= now() AND q.info_paused_at IS NULL THEN
    RAISE EXCEPTION 'The response time for this request has ended' USING ERRCODE = 'P0001';
  END IF;
  IF q.info_paused_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.assignment_info_requests
                                              WHERE request_id = q.id AND status IN ('open', 'timed_out')) THEN
    RAISE EXCEPTION 'You already asked a question on this request. Please wait for the client''s answer.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.assignment_info_requests WHERE request_id = q.id) >= 3 THEN
    RAISE EXCEPTION 'You can ask for more information up to 3 times per request' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::TEXT[]) INTO v_topics
    FROM unnest(COALESCE(_topics, '{}'::TEXT[])) x WHERE x IS NOT NULL AND btrim(x) <> '';
  IF NOT v_topics <@ ARRAY['scope', 'system', 'error', 'timeline_budget', 'access']::TEXT[] OR cardinality(v_topics) > 3 THEN
    RAISE EXCEPTION 'Pick up to 3 of the listed topics' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_topics) = 0 AND v_text = '' THEN
    RAISE EXCEPTION 'Pick a topic or write what you need' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_text) > 500 THEN
    RAISE EXCEPTION 'Please keep it to 500 characters' USING ERRCODE = '22023';
  END IF;
  IF public.contact_details_in_text(v_text) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.'
      USING ERRCODE = '22023';
  END IF;

  v_wait := COALESCE((public.assignment_policy_minutes()->>'info_wait')::INT, 1440);
  INSERT INTO public.assignment_info_requests (request_id, ticket_id, consultant_id, topics, question, client_due_at)
  VALUES (q.id, q.ticket_id, q.consultant_id, v_topics, v_text, now() + make_interval(mins => v_wait))
  RETURNING id INTO v_id;

  -- Pause the reply clock; asking in time counts as the first response.
  PERFORM set_config('app.assignment_policy', 'on', true);
  UPDATE public.ticket_match_requests
     SET info_paused_at = now(),
         info_remaining_seconds = CASE WHEN response_due_at IS NULL THEN NULL
                                       ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (response_due_at - now()))))::INT END,
         info_first_asked_at = COALESCE(info_first_asked_at, now()),
         info_requests_count = info_requests_count + 1
   WHERE id = q.id;

  IF to_regclass('public.responsiveness_events') IS NOT NULL THEN
    BEGIN
      UPDATE public.responsiveness_events
         SET outcome = 'responded', responded_at = now(), resolved_at = now()
       WHERE kind IN ('request', 'bid') AND source_id = q.id AND outcome = 'pending'
       RETURNING consultant_id INTO v_ev;
      IF v_ev IS NOT NULL AND to_regprocedure('public.responsiveness_recompute(uuid)') IS NOT NULL THEN
        PERFORM public.responsiveness_recompute(v_ev);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'responsiveness update skipped (%)', SQLSTATE;
    END;
  END IF;

  SELECT p.display_name INTO v_name FROM public.profiles p WHERE p.user_id = auth.uid();
  v_lang := public.assignment_user_lang(t.client_id);
  SELECT string_agg(public.assignment_info_topic_label(x, v_lang), ', ') INTO v_labels FROM unnest(v_topics) x;
  PERFORM public.safe_insert_notification(
    t.client_id,
    CASE WHEN v_lang = 'ar' THEN 'يطلب الاستشاري معلومات إضافية' ELSE 'A consultant asks for more information' END,
    left(CASE WHEN v_lang = 'ar'
      THEN COALESCE(v_name, 'الاستشاري') || ' يسأل عن "' || left(COALESCE(t.title, 'طلبك'), 80) || '": '
           || COALESCE(v_labels || CASE WHEN v_text <> '' THEN ' - ' ELSE '' END, '') || left(v_text, 200)
      ELSE COALESCE(v_name, 'The consultant') || ' asks about "' || left(COALESCE(t.title, 'your request'), 80) || '": '
           || COALESCE(v_labels || CASE WHEN v_text <> '' THEN ' - ' ELSE '' END, '') || left(v_text, 200)
    END, 1000),
    'match_request',
    '/client/tickets/' || q.ticket_id || '?info=' || v_id);
  PERFORM public.assignment_info_wake(v_id);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_request_assignment_info(UUID, TEXT[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_request_assignment_info(UUID, TEXT[], TEXT) TO authenticated;

-- 8. The ticket's client answers (text + optional ticket document uploaded through the normal safe upload).
CREATE OR REPLACE FUNCTION public.client_answer_assignment_info(_info_id UUID, _answer TEXT, _document_id UUID DEFAULT NULL)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i RECORD;
  q RECORD;
  t RECORD;
  v_fname TEXT;
  v_ftype TEXT;
  v_text TEXT := btrim(COALESCE(_answer, ''));
  v_due TIMESTAMPTZ;
  v_shift INTERVAL;
  v_cuid UUID;
  v_lang TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO i FROM public.assignment_info_requests WHERE id = _info_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = '42501';
  END IF;
  SELECT id, title, client_id INTO t FROM public.tickets WHERE id = i.ticket_id;
  IF t.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = '42501';
  END IF;
  IF i.status NOT IN ('open', 'timed_out') THEN
    RAISE EXCEPTION 'This question was already answered or closed' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO q FROM public.ticket_match_requests WHERE id = i.request_id FOR UPDATE;
  IF q.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'The consultant already answered this request' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_text) < 1 OR char_length(v_text) > 1000 THEN
    RAISE EXCEPTION 'An answer has 1 to 1000 characters' USING ERRCODE = '22023';
  END IF;
  IF public.contact_details_in_text(v_text) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.'
      USING ERRCODE = '22023';
  END IF;
  IF _document_id IS NOT NULL THEN
    SELECT file_name, mime_type INTO v_fname, v_ftype FROM public.ticket_documents
     WHERE id = _document_id AND ticket_id = i.ticket_id AND uploaded_by = auth.uid();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The attached file was not found on this ticket' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.assignment_info_requests
     SET status = 'answered', answer = v_text, answered_at = now(), answer_document_id = _document_id,
         answer_file_name = CASE WHEN _document_id IS NULL THEN NULL ELSE public.mask_contact_details(v_fname) END,
         answer_file_type = CASE WHEN _document_id IS NULL THEN NULL ELSE v_ftype END
   WHERE id = i.id;

  -- Resume: the time that was left, at least 2 hours. Unsent reminders move by the pause, "No response" to the new deadline.
  PERFORM set_config('app.assignment_policy', 'on', true);
  v_shift := now() - COALESCE(q.info_paused_at, now());
  IF q.response_due_at IS NOT NULL THEN
    v_due := now() + make_interval(secs => GREATEST(COALESCE(q.info_remaining_seconds, 0), 7200));
    UPDATE public.assignment_reminder_log
       SET due_at = LEAST(due_at + v_shift, v_due)
     WHERE request_id = q.id AND sent_at IS NULL AND cancelled_at IS NULL AND step IN ('r1', 'r2', 'r3');
    UPDATE public.assignment_reminder_log
       SET due_at = v_due
     WHERE request_id = q.id AND sent_at IS NULL AND cancelled_at IS NULL AND step IN ('expire', 'expire2');
  END IF;
  UPDATE public.ticket_match_requests
     SET info_paused_at = NULL, info_remaining_seconds = NULL, info_resumed_at = now(),
         response_due_at = COALESCE(v_due, response_due_at)
   WHERE id = q.id;

  SELECT c.user_id INTO v_cuid FROM public.consultants c WHERE c.id = q.consultant_id;
  v_lang := public.assignment_user_lang(v_cuid);
  PERFORM public.safe_insert_notification(
    v_cuid,
    CASE WHEN v_lang = 'ar' THEN 'أجاب العميل عن سؤالك' ELSE 'The client answered your question' END,
    CASE WHEN v_lang = 'ar'
      THEN 'أجاب العميل عن سؤالك بشأن "' || left(COALESCE(t.title, 'طلب'), 80) || '". يمكنك الآن القبول أو الرفض أو السؤال مرة أخرى'
           || CASE WHEN v_due IS NOT NULL THEN '، والوقت المتبقي ' || public.assignment_duration_label(CEIL(EXTRACT(EPOCH FROM (v_due - now())) / 60)::INT, 'ar', false) || '.' ELSE '.' END
      ELSE 'The client answered your question about "' || left(COALESCE(t.title, 'a request'), 80) || '". You can now accept, decline or ask once more'
           || CASE WHEN v_due IS NOT NULL THEN '; ' || public.assignment_duration_label(CEIL(EXTRACT(EPOCH FROM (v_due - now())) / 60)::INT, 'en', false) || ' left to reply.' ELSE '.' END
    END,
    'match_request',
    '/consultant/requests?request=' || q.id);
  PERFORM public.assignment_info_wake(i.id);
  RETURN v_due;
END;
$$;
REVOKE ALL ON FUNCTION public.client_answer_assignment_info(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_answer_assignment_info(UUID, TEXT, UUID) TO authenticated;

-- 9. Decline with optional reasons (stored privately).
CREATE OR REPLACE FUNCTION public.consultant_decline_assignment(_request_id UUID, _reasons TEXT[] DEFAULT '{}')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cons UUID;
  q RECORD;
  v_reasons TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;
  SELECT c.id INTO v_cons FROM public.consultants c WHERE c.user_id = auth.uid();
  SELECT * INTO q FROM public.ticket_match_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_cons IS NULL OR q.consultant_id IS DISTINCT FROM v_cons THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = '42501';
  END IF;
  IF q.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'This request is no longer open' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::TEXT[]) INTO v_reasons
    FROM unnest(COALESCE(_reasons, '{}'::TEXT[])) x WHERE x IS NOT NULL AND btrim(x) <> '';
  IF NOT v_reasons <@ ARRAY['not_my_module', 'no_capacity', 'rate_budget', 'timing', 'info_missing', 'other']::TEXT[] THEN
    RAISE EXCEPTION 'Unknown decline reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ticket_match_requests SET status = 'rejected', responded_at = now() WHERE id = q.id;
  IF cardinality(v_reasons) > 0 THEN
    INSERT INTO public.assignment_decline_reasons (request_id, ticket_id, consultant_id, reasons)
    VALUES (q.id, q.ticket_id, q.consultant_id, v_reasons)
    ON CONFLICT (request_id) DO UPDATE SET reasons = EXCLUDED.reasons, created_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_decline_assignment(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_decline_assignment(UUID, TEXT[]) TO authenticated;

-- "Next best" hints for the ticket owner: the distinct reasons only, never who gave them.
CREATE OR REPLACE FUNCTION public.assignment_decline_hints(_ticket_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = auth.uid())
     AND NOT public.ticket_in_my_company(_ticket_id)
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RETURN '{}'::TEXT[];
  END IF;
  SELECT COALESCE(array_agg(DISTINCT r ORDER BY r), '{}'::TEXT[]) INTO out
    FROM public.assignment_decline_reasons d, unnest(d.reasons) r
   WHERE d.ticket_id = _ticket_id AND r <> 'other';
  RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.assignment_decline_hints(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_decline_hints(UUID) TO authenticated;

-- 10. Service-only: returns unanswered questions to the client after info_wait, and claims e-mails (each once).
CREATE OR REPLACE FUNCTION public.claim_assignment_info_emails(_limit INT DEFAULT 100, _info_id UUID DEFAULT NULL)
RETURNS TABLE (
  info_id UUID,
  request_id UUID,
  kind TEXT,
  recipient_user_id UUID,
  lang TEXT,
  ticket_id UUID,
  ticket_title TEXT,
  consultant_name TEXT,
  topics TEXT[],
  question TEXT,
  client_due_at TIMESTAMPTZ,
  response_due_at TIMESTAMPTZ,
  timezone TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(_limit, 100), 1), 200);
  r RECORD;
  v_n INT := 0;
  v_l TEXT;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Unanswered within info_wait: back to the client as "Waiting for your answer" (never counted against the consultant).
  FOR r IN
    SELECT i.id AS iid, i.request_id AS qid, i.ticket_id AS tid, t.client_id AS clid, t.title AS ttitle, c.user_id AS cuid
      FROM public.assignment_info_requests i
      JOIN public.tickets t ON t.id = i.ticket_id
      JOIN public.consultants c ON c.id = i.consultant_id
     WHERE i.status = 'open' AND i.client_due_at <= now() AND (_info_id IS NULL OR i.id = _info_id)
     ORDER BY i.client_due_at
     LIMIT v_limit
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.assignment_info_requests SET status = 'timed_out', timed_out_at = now() WHERE id = r.iid;
    v_l := public.assignment_user_lang(r.clid);
    PERFORM public.safe_insert_notification(r.clid,
      CASE WHEN v_l = 'ar' THEN 'بانتظار إجابتك' ELSE 'Waiting for your answer' END,
      CASE WHEN v_l = 'ar' THEN 'ما زال الاستشاري ينتظر إجابتك عن سؤاله بشأن "' || left(COALESCE(r.ttitle, 'طلبك'), 80) || '". أجب في بطاقة التذكرة ليتمكن من الرد.'
           ELSE 'The consultant is still waiting for your answer about "' || left(COALESCE(r.ttitle, 'your request'), 80) || '". Answer on the ticket card so they can decide.' END,
      'match_request', '/client/tickets/' || r.tid || '?info=' || r.iid);
    v_l := public.assignment_user_lang(r.cuid);
    PERFORM public.safe_insert_notification(r.cuid,
      CASE WHEN v_l = 'ar' THEN 'لم يُجب العميل بعد' ELSE 'The client has not answered yet' END,
      CASE WHEN v_l = 'ar' THEN 'طلب "' || left(COALESCE(r.ttitle, 'طلب'), 80) || '" متوقف حتى يجيب العميل، ولا يُحتسب ضدك. ما زال بإمكانك القبول أو الرفض.'
           ELSE '"' || left(COALESCE(r.ttitle, 'A request'), 80) || '" stays paused until the client answers and is not counted against you. You can still accept or decline.' END,
      'match_request', '/consultant/requests?request=' || r.qid);
  END LOOP;

  FOR r IN
    SELECT i.id AS iid, i.request_id AS qid, i.ticket_id AS tid, i.status AS st, i.topics AS tp, i.question AS qu,
           i.client_due_at AS cdue, i.ask_email_at, i.answer_email_at, i.timeout_email_at,
           t.client_id AS clid, t.title AS ttitle, c.user_id AS cuid, q.response_due_at AS rdue,
           COALESCE(NULLIF(c.timezone, ''), 'Asia/Riyadh') AS tz, p.display_name AS cname
      FROM public.assignment_info_requests i
      JOIN public.ticket_match_requests q ON q.id = i.request_id
      JOIN public.tickets t ON t.id = i.ticket_id
      JOIN public.consultants c ON c.id = i.consultant_id
      LEFT JOIN public.profiles p ON p.user_id = c.user_id
     WHERE i.asked_at > now() - interval '14 days'
       AND (_info_id IS NULL OR i.id = _info_id)
       AND (i.ask_email_at IS NULL
            OR (i.status = 'answered' AND i.answer_email_at IS NULL)
            OR (i.status = 'timed_out' AND i.timeout_email_at IS NULL))
     ORDER BY i.asked_at
     LIMIT v_limit
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= v_limit;
    info_id := r.iid; request_id := r.qid; ticket_id := r.tid; ticket_title := r.ttitle; consultant_name := r.cname;
    topics := r.tp; question := r.qu; client_due_at := r.cdue; response_due_at := r.rdue;
    IF r.ask_email_at IS NULL THEN
      UPDATE public.assignment_info_requests SET ask_email_at = now() WHERE id = r.iid;
      -- An answer or a time-out that already happened makes the question e-mail pointless; mark it, send the newer one.
      IF r.st = 'open' THEN
        kind := 'ask'; recipient_user_id := r.clid; lang := public.assignment_user_lang(r.clid); timezone := 'Asia/Riyadh';
        v_n := v_n + 1;
        RETURN NEXT;
      END IF;
    END IF;
    IF r.st = 'answered' AND r.answer_email_at IS NULL THEN
      UPDATE public.assignment_info_requests SET answer_email_at = now() WHERE id = r.iid;
      kind := 'answer'; recipient_user_id := r.cuid; lang := public.assignment_user_lang(r.cuid); timezone := r.tz;
      v_n := v_n + 1;
      RETURN NEXT;
    ELSIF r.st = 'timed_out' AND r.timeout_email_at IS NULL THEN
      UPDATE public.assignment_info_requests SET timeout_email_at = now() WHERE id = r.iid;
      kind := 'timeout'; recipient_user_id := r.clid; lang := public.assignment_user_lang(r.clid); timezone := 'Asia/Riyadh';
      v_n := v_n + 1;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_assignment_info_emails(INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_assignment_info_emails(INT, UUID) TO service_role;

-- 11. Response rate: asking for information in time counts as answered; it is "no response" only without any action.
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
    SELECT q.consultant_id AS cid, q.status::TEXT AS st, q.responded_at, q.info_first_asked_at AS asked,
           EXISTS (SELECT 1 FROM public.assignment_reminder_log l
                    WHERE l.request_id = q.id AND l.step IN ('expire', 'expire2') AND l.sent_at IS NOT NULL) AS expired_once
      FROM public.ticket_match_requests q
     WHERE q.response_due_at IS NOT NULL
       AND (_consultant_ids IS NULL OR q.consultant_id = ANY (_consultant_ids))
  )
  SELECT b.cid,
         count(*) FILTER (WHERE b.asked IS NOT NULL
                             OR (NOT b.expired_once AND b.st IN ('accepted', 'rejected') AND b.responded_at IS NOT NULL))::INT,
         count(*) FILTER (WHERE b.expired_once AND b.asked IS NULL)::INT
    FROM base b
   GROUP BY b.cid;
END;
$$;
REVOKE ALL ON FUNCTION public.assignment_response_rates(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_response_rates(UUID[]) TO authenticated, service_role;

-- 12. Admin statistics: the existing card gains information requests and decline reasons (30 days).
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
    'info_requests_30d', (SELECT count(*) FROM public.assignment_info_requests WHERE asked_at >= now() - interval '30 days'),
    'info_waiting_client', (SELECT count(*) FROM public.assignment_info_requests WHERE status IN ('open', 'timed_out')),
    'decline_reasons_30d', COALESCE((
      SELECT jsonb_object_agg(x.reason, x.n)
        FROM (SELECT r AS reason, count(*) AS n
                FROM public.assignment_decline_reasons d, unnest(d.reasons) r
               WHERE d.created_at >= now() - interval '30 days'
               GROUP BY r) x), '{}'::jsonb),
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
