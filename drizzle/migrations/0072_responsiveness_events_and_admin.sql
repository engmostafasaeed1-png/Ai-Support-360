-- Feature M part 2 (docs/sql/responsiveness.sql steps 6-13): polite notices, event triggers, backfill, consultant/admin RPCs, sweep, critical alarm targets.
CREATE OR REPLACE FUNCTION public.responsiveness_notify(_event_id UUID, _kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev RECORD;
  s JSONB := public.responsiveness_settings();
  v_w INT := (s->>'warnings')::INT;
  v_n INT;
  v_lang TEXT;
  v_title TEXT;
  v_t TEXT;
  v_b TEXT;
  v_k INT;
BEGIN
  SELECT e.*, c.user_id AS uid, t.title AS ttitle INTO ev
    FROM public.responsiveness_events e
    JOIN public.consultants c ON c.id = e.consultant_id
    LEFT JOIN public.tickets t ON t.id = e.ticket_id
   WHERE e.id = _event_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO v_n FROM public.responsiveness_events x
   WHERE x.consultant_id = ev.consultant_id AND x.kind IN ('request', 'bid') AND x.counted AND x.outcome = 'no_response'
     AND x.received_at >= now() - interval '30 days';

  INSERT INTO public.responsiveness_notices (consultant_id, user_id, event_id, kind, count_30d, warnings_total)
  VALUES (ev.consultant_id, ev.uid, _event_id, _kind, v_n, v_w)
  ON CONFLICT (event_id, kind) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  v_lang := public.assignment_user_lang(ev.uid);
  v_title := left(COALESCE(ev.ttitle, CASE WHEN v_lang = 'ar' THEN 'طلب' ELSE 'a request' END), 80);
  IF _kind LIKE 'warning_%' THEN
    -- Owner rule: polite notifications, never the word "warning".
    v_k := substr(_kind, 9)::INT;
    IF v_lang = 'ar' THEN
      v_t := 'إشعار ودي ' || v_k || ' من ' || v_w || ': طلب لم يُرد عليه في الوقت';
      v_b := 'لاحظنا أن الطلب "' || v_title || '" لم يُرد عليه خلال المهلة المحددة، لذا يُحتسب ضمن نسبة استجابتك. هذا الإشعار الودي ' || v_k || ' من ' || v_w
             || '. إذا تكرر عدم الرد فقد يظهر مؤشر الاستجابة على بطاقتك وقد يتأثر ترتيبك. يسعدنا استلام اعتراضك خلال ' || (s->>'dispute_days') || ' أيام إذا لم يكن ذلك بسببك.';
    ELSE
      v_t := 'Friendly notice ' || v_k || ' of ' || v_w || ': a request was not answered in time';
      v_b := 'We noticed that "' || v_title || '" was not answered within the time limit, so it is included in your response rate. This is friendly notice ' || v_k || ' of ' || v_w
             || '. If more requests go unanswered, a Responsiveness indicator may appear on your card and your ranking may be affected. If it was not your fault, you are welcome to dispute it within '
             || (s->>'dispute_days') || ' days.';
    END IF;
  ELSIF _kind = 'badge_visible' THEN
    IF v_lang = 'ar' THEN
      v_t := 'أصبح مؤشر الاستجابة ظاهراً على بطاقتك';
      v_b := 'لاحظنا أن الطلب "' || v_title || '" لم يُرد عليه خلال المهلة المحددة. وبما أن هذا الطلب رقم ' || v_n || ' دون رد خلال 30 يوماً، فقد تُظهر بطاقتك الآن مستوى "يحتاج إلى تحسين" للاستجابة وقد يتأثر ترتيبك. يتحسن المؤشر تلقائياً عندما ترد على الطلبات الجديدة في الوقت، ويسعدنا مساعدتك.';
    ELSE
      v_t := 'Your Responsiveness indicator is now shown';
      v_b := 'We noticed that "' || v_title || '" was not answered within the time limit. As this is unanswered request number ' || v_n || ' in 30 days, your card may now show "Needs improvement" for responsiveness and your ranking may be affected. It improves automatically as you answer new requests in time, and we are happy to help.';
    END IF;
  ELSIF _kind = 'counted' THEN
    IF v_lang = 'ar' THEN
      v_t := 'طلب لم يُرد عليه في الوقت';
      v_b := 'لاحظنا أن الطلب "' || v_title || '" لم يُرد عليه خلال المهلة المحددة، لذا يُحتسب ضمن نسبة استجابتك (' || v_n || ' خلال آخر 30 يوماً).';
    ELSE
      v_t := 'A request was not answered in time';
      v_b := 'We noticed that "' || v_title || '" was not answered within the time limit, so it is included in your response rate (' || v_n || ' in the last 30 days).';
    END IF;
  ELSIF _kind = 'not_counted' THEN
    IF v_lang = 'ar' THEN
      v_t := 'طلب لم يُرد عليه (غير محتسب)';
      v_b := 'لم يُرد على الطلب "' || v_title || '" خلال المهلة، لكنه وصل خارج أوقات توفرك، لذلك لا يُحتسب في نسبة استجابتك. لا يلزم أي إجراء.';
    ELSE
      v_t := 'A request was not answered (not counted)';
      v_b := '"' || v_title || '" was not answered within the time limit, but it arrived outside your availability, so it is not included in your response rate. No action is needed.';
    END IF;
  ELSIF _kind = 'dispute_upheld' THEN
    v_t := CASE WHEN v_lang = 'ar' THEN 'تم قبول اعتراضك' ELSE 'Dispute accepted' END;
    v_b := CASE WHEN v_lang = 'ar' THEN 'أُزيل عدم الرد على "' || v_title || '" من إحصاءاتك.'
                ELSE 'The no-response on "' || v_title || '" was removed from your statistics.' END;
  ELSE
    v_t := CASE WHEN v_lang = 'ar' THEN 'لم يُقبل اعتراضك' ELSE 'Dispute not accepted' END;
    v_b := CASE WHEN v_lang = 'ar' THEN 'بعد المراجعة، لا يزال عدم الرد على "' || v_title || '" محتسباً. شكراً لتفهمك.'
                ELSE 'After review, the no-response on "' || v_title || '" still counts. Thank you for your understanding.' END;
  END IF;
  PERFORM public.safe_insert_notification(ev.uid, v_t, v_b, 'responsiveness', '/consultant/responsiveness?event=' || _event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_notify(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_notify(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.responsiveness_on_no_response(_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev RECORD;
  v_w INT := (public.responsiveness_settings() ->> 'warnings')::INT;
  v_n INT;
  v_kind TEXT;
BEGIN
  SELECT * INTO ev FROM public.responsiveness_events WHERE id = _event_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF ev.kind IN ('request', 'bid') THEN
    IF ev.counted THEN
      SELECT count(*) INTO v_n FROM public.responsiveness_events x
       WHERE x.consultant_id = ev.consultant_id AND x.kind IN ('request', 'bid') AND x.counted AND x.outcome = 'no_response'
         AND x.received_at >= now() - interval '30 days';
      v_kind := CASE WHEN v_n <= v_w THEN 'warning_' || GREATEST(v_n, 1)
                     WHEN v_n = v_w + 1 THEN 'badge_visible'
                     ELSE 'counted' END;
    ELSE
      v_kind := 'not_counted';
    END IF;
    PERFORM public.responsiveness_notify(_event_id, v_kind);
  END IF;
  PERFORM public.responsiveness_recompute(ev.consultant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_on_no_response(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_on_no_response(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.responsiveness_match_request_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.response_due_at IS NOT NULL AND NEW.status::TEXT = 'pending' THEN
    PERFORM public.responsiveness_add_event(NEW.consultant_id, CASE WHEN NEW.response_kind = 'bid' THEN 'bid' ELSE 'request' END,
      NEW.id, NEW.ticket_id, NULL, NEW.created_at, NEW.response_due_at, NEW.is_critical);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness request insert skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_match_request_ins ON public.ticket_match_requests;
CREATE TRIGGER trg_responsiveness_match_request_ins
  AFTER INSERT ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_match_request_ins();

CREATE OR REPLACE FUNCTION public.responsiveness_match_request_upd()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status::TEXT IN ('accepted', 'rejected') THEN
    UPDATE public.responsiveness_events
       SET outcome = 'responded', responded_at = COALESCE(NEW.responded_at, now()), resolved_at = now()
     WHERE kind IN ('request', 'bid') AND source_id = NEW.id AND outcome = 'pending'
     RETURNING consultant_id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.responsiveness_recompute(v_id); END IF;
  ELSIF NEW.status::TEXT = 'withdrawn' THEN
    UPDATE public.responsiveness_events SET outcome = 'withdrawn', resolved_at = now()
     WHERE kind IN ('request', 'bid') AND source_id = NEW.id AND outcome = 'pending';
  ELSIF NEW.status::TEXT = 'expired' THEN
    UPDATE public.responsiveness_events SET outcome = 'no_response', resolved_at = now()
     WHERE kind IN ('request', 'bid') AND source_id = NEW.id AND outcome = 'pending'
     RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.responsiveness_on_no_response(v_id); END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness request update skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_match_request_upd ON public.ticket_match_requests;
CREATE TRIGGER trg_responsiveness_match_request_upd
  AFTER UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_match_request_upd();

CREATE OR REPLACE FUNCTION public.responsiveness_critical_alert_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mins INT;
BEGIN
  SELECT COALESCE(t.critical_minutes, 30) INTO v_mins FROM public.tickets t WHERE t.id = NEW.ticket_id;
  PERFORM public.responsiveness_add_event(NEW.consultant_id, 'critical', NEW.id, NEW.ticket_id, NULL,
    COALESCE(NEW.alerted_at, now()), COALESCE(NEW.alerted_at, now()) + make_interval(mins => COALESCE(v_mins, 30)), true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness critical alert skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_critical_alert_ins ON public.critical_alerts;
CREATE TRIGGER trg_responsiveness_critical_alert_ins
  AFTER INSERT ON public.critical_alerts
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_critical_alert_ins();

CREATE OR REPLACE FUNCTION public.responsiveness_critical_alert_dismiss()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.dismissed_at IS NULL AND NEW.dismissed_at IS NOT NULL THEN
    UPDATE public.responsiveness_events SET outcome = 'responded', responded_at = NEW.dismissed_at, resolved_at = now()
     WHERE kind = 'critical' AND source_id = NEW.id AND outcome = 'pending' AND (due_at IS NULL OR NEW.dismissed_at <= due_at);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness critical dismiss skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_critical_alert_dismiss ON public.critical_alerts;
CREATE TRIGGER trg_responsiveness_critical_alert_dismiss
  AFTER UPDATE OF dismissed_at ON public.critical_alerts
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_critical_alert_dismiss();

CREATE OR REPLACE FUNCTION public.responsiveness_critical_reply_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.responsiveness_events SET outcome = 'responded', responded_at = COALESCE(NEW.replied_at, now()), resolved_at = now()
   WHERE kind = 'critical' AND ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND outcome = 'pending';
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness critical reply skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_critical_reply_ins ON public.critical_replies;
CREATE TRIGGER trg_responsiveness_critical_reply_ins
  AFTER INSERT ON public.critical_replies
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_critical_reply_ins();

CREATE OR REPLACE FUNCTION public.responsiveness_message_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ss RECORD;
  v_win INT;
BEGIN
  IF NEW.message_type::TEXT = 'system' THEN RETURN NEW; END IF;
  SELECT s.id, s.client_id, s.consultant_id, s.ticket_id, c.user_id AS cuid, t.status::TEXT AS tstatus INTO ss
    FROM public.sessions s
    JOIN public.consultants c ON c.id = s.consultant_id
    JOIN public.tickets t ON t.id = s.ticket_id
   WHERE s.id = NEW.session_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.sender_id = ss.cuid THEN
    UPDATE public.responsiveness_events SET outcome = 'responded', responded_at = NEW.created_at, resolved_at = now()
     WHERE kind = 'chat' AND session_id = ss.id AND outcome = 'pending';
  ELSIF NEW.sender_id = ss.client_id AND ss.tstatus IN ('matched', 'in_progress', 'waiting_for_client')
        AND NOT EXISTS (SELECT 1 FROM public.responsiveness_events e WHERE e.kind = 'chat' AND e.session_id = ss.id AND e.outcome = 'pending') THEN
    v_win := (public.responsiveness_settings() ->> 'chat_window')::INT;
    PERFORM public.responsiveness_add_event(ss.consultant_id, 'chat', NEW.id, ss.ticket_id, ss.id,
      NEW.created_at, NEW.created_at + make_interval(mins => v_win), false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness chat skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_message_ins ON public.messages;
CREATE TRIGGER trg_responsiveness_message_ins
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_message_ins();

INSERT INTO public.responsiveness_events
  (consultant_id, kind, source_id, ticket_id, received_at, due_at, is_critical, responded_at, outcome, resolved_at, counted, excluded_reason)
SELECT q.consultant_id, CASE WHEN q.response_kind = 'bid' THEN 'bid' ELSE 'request' END, q.id, q.ticket_id, q.created_at,
       q.response_due_at, q.is_critical,
       CASE WHEN q.status::TEXT IN ('accepted', 'rejected') AND q.expired_at IS NULL THEN q.responded_at END,
       CASE WHEN q.expired_at IS NOT NULL OR q.status::TEXT = 'expired' THEN 'no_response'
            WHEN q.status::TEXT IN ('accepted', 'rejected') THEN 'responded'
            WHEN q.status::TEXT = 'withdrawn' THEN 'withdrawn'
            ELSE 'pending' END,
       CASE WHEN q.status::TEXT <> 'pending' THEN COALESCE(q.expired_at, q.responded_at, q.updated_at) END,
       public.responsiveness_exclusion(q.consultant_id, q.created_at) IS NULL,
       public.responsiveness_exclusion(q.consultant_id, q.created_at)
  FROM public.ticket_match_requests q
 WHERE q.response_due_at IS NOT NULL
ON CONFLICT (kind, source_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.consultant_set_capacity(_max INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _max IS NOT NULL AND (_max < 1 OR _max > 50) THEN RAISE EXCEPTION 'Capacity must be between 1 and 50 active tickets'; END IF;
  UPDATE public.consultants SET max_active_tickets = _max WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_set_capacity(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_set_capacity(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.consultant_dispute_no_response(_event_id UUID, _reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev RECORD;
  v_days INT := (public.responsiveness_settings() ->> 'dispute_days')::INT;
  v_reason TEXT := btrim(COALESCE(_reason, ''));
  v_id UUID;
  v_admin UUID;
BEGIN
  SELECT e.* INTO ev FROM public.responsiveness_events e JOIN public.consultants c ON c.id = e.consultant_id
   WHERE e.id = _event_id AND c.user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF ev.kind NOT IN ('request', 'bid') OR ev.outcome <> 'no_response' OR NOT ev.counted THEN
    RAISE EXCEPTION 'Only a counted no-response can be disputed';
  END IF;
  IF now() > COALESCE(ev.resolved_at, ev.received_at) + make_interval(days => v_days) THEN
    RAISE EXCEPTION 'The dispute window of % days has passed', v_days;
  END IF;
  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN RAISE EXCEPTION 'Please give a reason of 10 to 500 characters'; END IF;
  INSERT INTO public.responsiveness_disputes (event_id, consultant_id, reason) VALUES (_event_id, ev.consultant_id, v_reason)
  ON CONFLICT (event_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'This no-response was already disputed'; END IF;
  FOR v_admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin') LOOP
    PERFORM public.safe_insert_notification(v_admin, 'Responsiveness dispute', 'A consultant disputed a counted no-response.',
      'responsiveness', '/admin/responsiveness?tab=disputes');
  END LOOP;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_dispute_no_response(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_dispute_no_response(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ack_responsiveness_notice(_notice_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.responsiveness_notices SET acked_at = now() WHERE id = _notice_id AND user_id = auth.uid() AND acked_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.ack_responsiveness_notice(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_responsiveness_notice(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_responsiveness()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid UUID;
  v_cap INT;
  r RECORD;
  s JSONB := public.responsiveness_settings();
BEGIN
  SELECT id, max_active_tickets INTO v_cid, v_cap FROM public.consultants WHERE user_id = auth.uid();
  IF v_cid IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultant_responsiveness WHERE consultant_id = v_cid AND computed_at > now() - interval '5 minutes') THEN
    PERFORM public.responsiveness_recompute(v_cid);
  END IF;
  SELECT * INTO r FROM public.consultant_responsiveness WHERE consultant_id = v_cid;
  RETURN jsonb_build_object(
    'public_on', public.platform_flag('responsiveness_public', false),
    'settings', s,
    'summary', jsonb_build_object('level', r.level, 'public_level', r.public_level, 'counted_90d', r.counted_90d,
                                  'rate_90d', r.rate_90d, 'median_90d', r.median_90d, 'no_response_30d', r.no_response_30d,
                                  'warnings_sent', r.warnings_sent, 'stars', r.stars, 'computed_at', r.computed_at),
    'stats', r.stats,
    'capacity', v_cap,
    'active_tickets', (SELECT count(DISTINCT a.ticket_id) FROM public.ticket_assignments a WHERE a.consultant_id = v_cid AND a.status = 'active'),
    'events', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.received_at DESC) FROM (
        SELECT e.id, e.kind, e.received_at, e.due_at, e.responded_at, e.resolved_at, e.outcome, e.counted, e.excluded_reason,
               e.is_critical, left(t.title, 120) AS ticket_title, d.status AS dispute_status, d.admin_note AS dispute_note
          FROM public.responsiveness_events e
          LEFT JOIN public.tickets t ON t.id = e.ticket_id
          LEFT JOIN public.responsiveness_disputes d ON d.event_id = e.id
         WHERE e.consultant_id = v_cid AND e.received_at >= now() - interval '90 days'
         ORDER BY e.received_at DESC
         LIMIT 200) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.my_responsiveness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_responsiveness() TO authenticated;

CREATE OR REPLACE FUNCTION public.responsiveness_public_summary(_consultant_ids UUID[] DEFAULT NULL)
RETURNS TABLE (consultant_id UUID, level TEXT, median_minutes INT, response_rate INT, stars NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.platform_flag('responsiveness_public', false) THEN RETURN; END IF;
  RETURN QUERY
  SELECT c.id,
         COALESCE(r.public_level, 'new'),
         CASE WHEN COALESCE(r.public_level, 'new') <> 'new' THEN r.median_90d END,
         CASE WHEN COALESCE(r.public_level, 'new') <> 'new' THEN r.rate_90d END,
         CASE WHEN COALESCE(r.public_level, 'new') <> 'new' THEN r.stars END
    FROM public.consultants c
    LEFT JOIN public.consultant_responsiveness r ON r.consultant_id = c.id
   WHERE (_consultant_ids IS NULL OR c.id = ANY (_consultant_ids[1:500]))
   LIMIT 3000;
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_public_summary(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responsiveness_public_summary(UUID[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_responsiveness_overview()
RETURNS TABLE (consultant_id UUID, name TEXT, level TEXT, public_level TEXT, counted_90d INT, rate_90d INT, median_90d INT,
               no_response_30d INT, warnings_sent INT, disputes_open INT, disputes_total INT, computed_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT r.consultant_id, p.display_name, r.level, r.public_level, r.counted_90d, r.rate_90d, r.median_90d, r.no_response_30d,
         r.warnings_sent,
         (SELECT count(*) FROM public.responsiveness_disputes d WHERE d.consultant_id = r.consultant_id AND d.status = 'pending')::INT,
         (SELECT count(*) FROM public.responsiveness_disputes d WHERE d.consultant_id = r.consultant_id)::INT,
         r.computed_at
    FROM public.consultant_responsiveness r
    JOIN public.consultants c ON c.id = r.consultant_id
    LEFT JOIN public.profiles p ON p.user_id = c.user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_responsiveness_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_responsiveness_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_responsiveness_disputes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x.status = 'pending') DESC, x.created_at DESC) FROM (
      SELECT d.id, d.event_id, d.consultant_id, p.display_name AS name, d.reason, d.status, d.created_at, d.reviewed_at, d.admin_note,
             e.kind, e.received_at, e.due_at, e.excluded_reason, left(t.title, 120) AS ticket_title
        FROM public.responsiveness_disputes d
        JOIN public.responsiveness_events e ON e.id = d.event_id
        JOIN public.consultants c ON c.id = d.consultant_id
        LEFT JOIN public.profiles p ON p.user_id = c.user_id
        LEFT JOIN public.tickets t ON t.id = e.ticket_id
       ORDER BY d.created_at DESC
       LIMIT 300) x), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_responsiveness_disputes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_responsiveness_disputes() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_responsiveness_dispute(_dispute_id UUID, _uphold BOOLEAN, _note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
  v_note TEXT := NULLIF(left(btrim(COALESCE(_note, '')), 500), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO d FROM public.responsiveness_disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found'; END IF;
  IF d.status <> 'pending' THEN RAISE EXCEPTION 'This dispute was already reviewed'; END IF;
  UPDATE public.responsiveness_disputes
     SET status = CASE WHEN _uphold THEN 'upheld' ELSE 'rejected' END, reviewed_by = auth.uid(), reviewed_at = now(), admin_note = v_note
   WHERE id = _dispute_id;
  IF _uphold THEN
    UPDATE public.responsiveness_events SET outcome = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = v_note
     WHERE id = d.event_id AND outcome = 'no_response';
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN _uphold THEN 'responsiveness_no_response_voided' ELSE 'responsiveness_dispute_rejected' END,
          'responsiveness_event', d.event_id,
          jsonb_build_object('dispute_id', d.id, 'consultant_id', d.consultant_id, 'note', v_note));
  PERFORM public.responsiveness_notify(d.event_id, CASE WHEN _uphold THEN 'dispute_upheld' ELSE 'dispute_rejected' END);
  PERFORM public.responsiveness_recompute(d.consultant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_responsiveness_dispute(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_responsiveness_dispute(UUID, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.responsiveness_recompute_all()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid UUID;
  v_n INT := 0;
BEGIN
  FOR v_cid IN
    SELECT DISTINCT x.cid FROM (
      SELECT e.consultant_id AS cid FROM public.responsiveness_events e
      UNION SELECT r.consultant_id FROM public.consultant_responsiveness r) x
     LIMIT 5000
  LOOP
    PERFORM public.responsiveness_recompute(v_cid);
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO public.responsiveness_runs (kind) VALUES ('nightly');
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_recompute_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_recompute_all() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_recompute_responsiveness()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN public.responsiveness_recompute_all();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_recompute_responsiveness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recompute_responsiveness() TO authenticated;

CREATE OR REPLACE FUNCTION public.responsiveness_sweep()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_touched UUID[];
  v_cid UUID;
  v_nightly INT := 0;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.responsiveness_runs (kind) VALUES ('sweep');

  WITH due AS (
    SELECT e.id, e.consultant_id,
           CASE WHEN t.status::TEXT IN ('resolved', 'closed')
                  OR (e.kind = 'critical' AND t.critical_first_reply_by IS NOT NULL AND t.critical_first_reply_by <> e.consultant_id)
                  OR (t.consultant_id IS NOT NULL AND t.consultant_id <> e.consultant_id AND e.kind = 'critical')
                THEN 'withdrawn' ELSE 'no_response' END AS outcome
      FROM public.responsiveness_events e
      JOIN public.consultants c ON c.id = e.consultant_id
      LEFT JOIN public.tickets t ON t.id = e.ticket_id
     WHERE e.outcome = 'pending' AND e.kind IN ('critical', 'chat') AND e.due_at <= now()
     ORDER BY e.due_at
     LIMIT 2000
     FOR UPDATE OF e SKIP LOCKED
  ), upd AS (
    UPDATE public.responsiveness_events e SET outcome = due.outcome, resolved_at = now()
      FROM due WHERE e.id = due.id
    RETURNING e.consultant_id
  )
  SELECT array_agg(DISTINCT consultant_id) INTO v_touched FROM upd;

  IF v_touched IS NOT NULL THEN
    FOREACH v_cid IN ARRAY v_touched LOOP PERFORM public.responsiveness_recompute(v_cid); END LOOP;
  END IF;

  IF EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Riyadh') BETWEEN 1 AND 4
     AND NOT EXISTS (SELECT 1 FROM public.responsiveness_runs r WHERE r.kind = 'nightly' AND r.ran_at > now() - interval '20 hours') THEN
    v_nightly := public.responsiveness_recompute_all();
  END IF;

  RETURN jsonb_build_object('closed', COALESCE(array_length(v_touched, 1), 0), 'nightly', v_nightly);
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_responsiveness_notices(_limit INT DEFAULT 100)
RETURNS TABLE (notice_id UUID, kind TEXT, user_id UUID, lang TEXT, ticket_title TEXT, count_30d INT, warnings_total INT,
               dispute_days INT, event_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_days INT := (public.responsiveness_settings() ->> 'dispute_days')::INT;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT n.id FROM public.responsiveness_notices n
     WHERE n.emailed_at IS NULL AND n.created_at > now() - interval '3 days'
     ORDER BY n.created_at
     LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 200)
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.responsiveness_notices n SET emailed_at = now() FROM picked WHERE n.id = picked.id
    RETURNING n.id, n.kind, n.user_id, n.event_id, n.count_30d, n.warnings_total
  )
  SELECT u.id, u.kind, u.user_id, public.assignment_user_lang(u.user_id), left(t.title, 120), u.count_30d, u.warnings_total, v_days, u.event_id
    FROM upd u
    JOIN public.responsiveness_events e ON e.id = u.event_id
    LEFT JOIN public.tickets t ON t.id = e.ticket_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_responsiveness_notices(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_responsiveness_notices(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.critical_alert_targets(_ticket_id uuid)
 RETURNS TABLE(consultant_id uuid, user_id uuid, area_match boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _areas text[];
  _toks text[];
  _skip uuid[] := ARRAY[]::uuid[];
  _more uuid[];
BEGIN
  SELECT t.client_id, COALESCE(t.sap_modules, '{}'::text[]) INTO _client, _areas FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[]) INTO _toks
    FROM unnest(_areas) a, unnest(public.sap_area_tokens(a)) x;
  IF to_regclass('public.consultant_responsiveness') IS NOT NULL AND to_regprocedure('public.platform_flag(text,boolean)') IS NOT NULL THEN
    EXECUTE $q$SELECT COALESCE(array_agg(r.consultant_id), ARRAY[]::uuid[]) FROM public.consultant_responsiveness r
               WHERE public.platform_flag('responsiveness_public', false) AND r.public_level = 'needs_improvement'$q$ INTO _more;
    _skip := _skip || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_policy_blocked_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_policy_blocked_ids()' INTO _more;
    _skip := _skip || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  RETURN QUERY
  WITH elig AS (
    SELECT c.id AS cid, c.user_id AS uid, c.sap_technologies AS techs
      FROM public.consultants c
     WHERE c.verification_status = 'verified'
       AND c.user_id <> _client
       AND COALESCE(c.new_case_alerts, true)
       AND NOT (c.id = ANY(_skip))
  ), matched AS (
    SELECT e.cid, e.uid
      FROM elig e
     WHERE EXISTS (SELECT 1 FROM public.consultant_skills s
                    WHERE s.consultant_id = e.cid AND public.sap_area_tokens(s.sap_module) && _toks)
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(e.techs, '{}'::text[])) tech WHERE public.sap_area_tokens(tech) && _toks)
  )
  SELECT m.cid, m.uid, true FROM matched m
  UNION ALL
  SELECT e.cid, e.uid, false FROM elig e WHERE NOT EXISTS (SELECT 1 FROM matched);
END
$function$;