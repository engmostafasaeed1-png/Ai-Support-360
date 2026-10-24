-- ------------------------------------------------------------------ e-mail worker RPCs (service role only)

CREATE OR REPLACE FUNCTION public.tt_claim_emails(_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, user_id uuid, ticket_id uuid, kind text, payload jsonb, dedupe_key text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
#variable_conflict use_column
BEGIN
  -- Rows for people who are no longer on the ticket, or while the feature is off, are dropped (not sent later).
  UPDATE public.ticket_tracking_email_queue q SET failed_at = now(), last_error = 'not_applicable'
   WHERE q.sent_at IS NULL AND q.failed_at IS NULL
     AND (NOT COALESCE((public.tt_settings() ->> 'enabled')::boolean, false)
          OR public.tt_viewer_role(q.ticket_id, q.user_id) IS NULL
          OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = q.ticket_id AND t.status::text = 'closed' AND q.kind <> 'status'));
  RETURN QUERY
  UPDATE public.ticket_tracking_email_queue q SET attempts = q.attempts + 1, lease_until = now() + interval '10 minutes'
   WHERE q.id IN (SELECT q2.id FROM public.ticket_tracking_email_queue q2
                   WHERE q2.sent_at IS NULL AND q2.failed_at IS NULL AND q2.attempts < 5
                     AND (q2.lease_until IS NULL OR q2.lease_until < now())
                   ORDER BY q2.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
                   FOR UPDATE SKIP LOCKED)
  RETURNING q.id, q.user_id, q.ticket_id, q.kind, q.payload, q.dedupe_key;
END
$$;
REVOKE ALL ON FUNCTION public.tt_claim_emails(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tt_claim_emails(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.tt_finish_email(_id uuid, _ok boolean, _error text DEFAULT NULL)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.ticket_tracking_email_queue SET
    sent_at = CASE WHEN _ok THEN now() END,
    failed_at = CASE WHEN NOT _ok AND attempts >= 5 THEN now() END,
    last_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'failed'), 200) END,
    lease_until = NULL
   WHERE id = _id
$$;
REVOKE ALL ON FUNCTION public.tt_finish_email(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tt_finish_email(uuid, boolean, text) TO service_role;

-- ------------------------------------------------------------------ daily reminders

-- Once a day: "due tomorrow" and "overdue" to the responsible side, and "ready for your review for N days" to the
-- client. Max one reminder per item per day, capped counts, bounded to 500 rows, never for rows the backfill made.
CREATE OR REPLACE FUNCTION public.tt_reminder_sweep()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s jsonb := public.tt_settings(); r record; rec record; _kind text; _court text; _roles text[]; _n int := 0;
  _days int := COALESCE((s ->> 'review_reminder_days')::int, 3);
  _maxr int := COALESCE((s ->> 'max_review_reminders')::int, 3);
  _maxo int := COALESCE((s ->> 'max_overdue_reminders')::int, 3);
  _lang text; _title text; _body text; _label text;
BEGIN
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) THEN RETURN 0; END IF;
  FOR r IN
    SELECT w.*, t.title, t.status::text AS ticket_status
      FROM public.ticket_working_status w JOIN public.tickets t ON t.id = w.ticket_id
     WHERE t.status::text <> 'closed' AND COALESCE(t.close_outcome, '') <> 'cancelled'
       AND w.set_by_role <> 'system' AND w.status_key <> 'completed'
       AND w.last_reminder_on IS DISTINCT FROM current_date
       AND ((w.expected_date = current_date + 1)
         OR (w.expected_date < current_date AND w.overdue_reminders < _maxo)
         OR (w.status_key = 'ready_for_review' AND w.review_reminders < _maxr AND w.set_at::date <= current_date - _days
             AND (w.review_reminded_on IS NULL OR w.review_reminded_on <= current_date - _days)))
     ORDER BY w.set_at
     LIMIT 500
  LOOP
    BEGIN
      _kind := CASE WHEN r.expected_date = current_date + 1 THEN 'due_tomorrow'
                    WHEN r.expected_date < current_date AND r.overdue_reminders < _maxo THEN 'overdue'
                    ELSE 'review' END;
      IF _kind = 'review' THEN
        _roles := ARRAY['client'];
      ELSE
        _court := COALESCE(r.responsible, (SELECT x ->> 'court' FROM jsonb_array_elements(s -> 'statuses') x WHERE x ->> 'key' = r.status_key LIMIT 1), 'none');
        IF _court = 'other' THEN _court := CASE r.set_by_role WHEN 'client' THEN 'consultant' WHEN 'consultant' THEN 'client' ELSE 'none' END; END IF;
        _roles := CASE WHEN _court IN ('client', 'consultant') THEN ARRAY[_court] ELSE ARRAY['client', 'consultant'] END;
      END IF;
      FOR rec IN SELECT * FROM public.tt_recipients(r.ticket_id) x WHERE x.role = ANY (_roles) LOOP
        _lang := public.tt_lang(rec.user_id);
        _label := public.tt_status_label(r.status_key, _lang);
        IF _kind = 'review' THEN
          _title := CASE WHEN _lang = 'ar' THEN 'العمل بانتظار مراجعتك' ELSE 'Work is waiting for your review' END;
          _body := CASE WHEN _lang = 'ar' THEN '«' || left(r.title, 120) || '» جاهز لمراجعتك منذ ' || _days || ' أيام أو أكثر.'
                        ELSE '"' || left(r.title, 120) || '" has been ready for your review for ' || _days || ' days or more.' END;
        ELSIF _kind = 'due_tomorrow' THEN
          _title := CASE WHEN _lang = 'ar' THEN 'الموعد المتوقع غداً' ELSE 'Expected date is tomorrow' END;
          _body := CASE WHEN _lang = 'ar' THEN '«' || left(r.title, 120) || '»: ' || _label || ' - الموعد المتوقع ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.'
                        ELSE '"' || left(r.title, 120) || '": ' || _label || ' - expected by ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.' END;
        ELSE
          _title := CASE WHEN _lang = 'ar' THEN 'تجاوز الموعد المتوقع' ELSE 'Expected date has passed' END;
          _body := CASE WHEN _lang = 'ar' THEN '«' || left(r.title, 120) || '»: ' || _label || ' - كان الموعد المتوقع ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.'
                        ELSE '"' || left(r.title, 120) || '": ' || _label || ' - was expected by ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.' END;
        END IF;
        PERFORM public.tt_push_notice(rec.user_id, r.ticket_id, rec.role, _title, _body);
        PERFORM public.tt_queue_email(rec.user_id, r.ticket_id, rec.role, _kind,
          jsonb_build_object('lang', _lang, 'ticket_title', left(r.title, 120), 'status_label', _label,
                             'expected_date', r.expected_date, 'days', _days),
          'tt:' || _kind || ':' || r.ticket_id::text || ':' || rec.user_id::text || ':' || current_date::text);
      END LOOP;
      UPDATE public.ticket_working_status SET
        last_reminder_on = current_date,
        overdue_reminders = overdue_reminders + CASE WHEN _kind = 'overdue' THEN 1 ELSE 0 END,
        review_reminders = review_reminders + CASE WHEN _kind = 'review' THEN 1 ELSE 0 END,
        review_reminded_on = CASE WHEN _kind = 'review' THEN current_date ELSE review_reminded_on END
       WHERE ticket_id = r.ticket_id;
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ticket tracking reminder skipped for %: %', r.ticket_id, SQLERRM;
    END;
  END LOOP;
  RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.tt_reminder_sweep() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'ticket-tracking-reminders';
    PERFORM cron.schedule('ticket-tracking-reminders', '43 6 * * *', 'SELECT public.tt_reminder_sweep()');
  END IF;
END
$do$;

-- ------------------------------------------------------------------ admin

CREATE OR REPLACE FUNCTION public.tt_admin_set_settings(_value jsonb, _reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid(); _before jsonb := public.tt_settings(); _after jsonb; x jsonb; _keys text[] := ARRAY[]::text[];
  _k text; _m jsonb; _num text;
BEGIN
  IF NOT public.tt_is_admin(_uid) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _value IS NULL OR jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE = '22023'; END IF;
  _after := _before;
  IF _value ? 'enabled' THEN
    IF jsonb_typeof(_value -> 'enabled') <> 'boolean' THEN RAISE EXCEPTION 'enabled must be true or false' USING ERRCODE = '22023'; END IF;
    _after := _after || jsonb_build_object('enabled', _value -> 'enabled');
  END IF;
  IF _value ? 'email_enabled' THEN
    IF jsonb_typeof(_value -> 'email_enabled') <> 'boolean' THEN RAISE EXCEPTION 'email_enabled must be true or false' USING ERRCODE = '22023'; END IF;
    _after := _after || jsonb_build_object('email_enabled', _value -> 'email_enabled');
  END IF;
  FOREACH _num IN ARRAY ARRAY['note_max:50:2000', 'rate_limit_per_hour:1:200', 'throttle_minutes:1:240', 'review_reminder_days:1:30',
                               'max_review_reminders:0:10', 'max_overdue_reminders:0:10', 'stuck_days:1:90'] LOOP
    _k := split_part(_num, ':', 1);
    IF _value ? _k THEN
      IF jsonb_typeof(_value -> _k) <> 'number' OR (_value ->> _k)::numeric <> floor((_value ->> _k)::numeric)
         OR (_value ->> _k)::int < split_part(_num, ':', 2)::int OR (_value ->> _k)::int > split_part(_num, ':', 3)::int THEN
        RAISE EXCEPTION '% must be a whole number between % and %', _k, split_part(_num, ':', 2), split_part(_num, ':', 3) USING ERRCODE = '22023';
      END IF;
      _after := _after || jsonb_build_object(_k, (_value ->> _k)::int);
    END IF;
  END LOOP;
  IF _value ? 'statuses' THEN
    IF jsonb_typeof(_value -> 'statuses') <> 'array' OR jsonb_array_length(_value -> 'statuses') NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'The working status list must have 1 to 20 entries' USING ERRCODE = '22023';
    END IF;
    FOR x IN SELECT * FROM jsonb_array_elements(_value -> 'statuses') LOOP
      IF jsonb_typeof(x) <> 'object' OR COALESCE(x ->> 'key', '') !~ '^[a-z_]{2,40}$' OR (x ->> 'key') = ANY (_keys)
         OR char_length(btrim(COALESCE(x ->> 'label_en', ''))) NOT BETWEEN 1 AND 60
         OR char_length(btrim(COALESCE(x ->> 'label_ar', ''))) NOT BETWEEN 1 AND 60
         OR COALESCE(x ->> 'color', '') NOT IN ('muted', 'primary', 'accent', 'info', 'success', 'warning', 'destructive')
         OR COALESCE(x ->> 'icon', '') NOT IN ('circle', 'search', 'hourglass', 'user-clock', 'key', 'wrench', 'flask', 'eye', 'rotate', 'pause', 'check')
         OR COALESCE(x ->> 'court', '') NOT IN ('client', 'consultant', 'both', 'third_party', 'none', 'other')
         OR jsonb_typeof(x -> 'order') <> 'number' OR jsonb_typeof(x -> 'enabled') <> 'boolean'
         OR public.contact_details_in_text(x ->> 'label_en') OR public.contact_details_in_text(x ->> 'label_ar') THEN
        RAISE EXCEPTION 'Invalid working status entry: %', left(COALESCE(x ->> 'key', '?'), 40) USING ERRCODE = '22023';
      END IF;
      _keys := _keys || (x ->> 'key');
    END LOOP;
    FOREACH _k IN ARRAY ARRAY['not_started', 'on_hold', 'ready_for_review', 'needs_rework', 'completed'] LOOP
      IF NOT _k = ANY (_keys) THEN RAISE EXCEPTION 'The status "%" can be renamed or switched off, not removed', _k USING ERRCODE = '22023'; END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_value -> 'statuses') x WHERE x ->> 'key' = 'not_started' AND (x ->> 'enabled')::boolean) THEN
      RAISE EXCEPTION '"Not started" must stay switched on' USING ERRCODE = '22023';
    END IF;
    _after := _after || jsonb_build_object('statuses', _value -> 'statuses');
  END IF;
  IF _value ? 'matrix' THEN
    IF jsonb_typeof(_value -> 'matrix') <> 'object' THEN RAISE EXCEPTION 'Invalid permission matrix' USING ERRCODE = '22023'; END IF;
    _after := _after || jsonb_build_object('matrix', _value -> 'matrix');
  END IF;
  -- Every status needs a complete matrix row (client / consultant / note as true or false).
  FOR x IN SELECT * FROM jsonb_array_elements(_after -> 'statuses') LOOP
    _m := _after -> 'matrix' -> (x ->> 'key');
    IF _m IS NULL OR jsonb_typeof(_m -> 'client') <> 'boolean' OR jsonb_typeof(_m -> 'consultant') <> 'boolean' OR jsonb_typeof(_m -> 'note') <> 'boolean' THEN
      RAISE EXCEPTION 'The permission matrix has no complete row for "%"', x ->> 'key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.platform_settings (key, value) VALUES ('ticket_tracking', _after)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'ticket_tracking.settings_changed', 'platform_settings', NULL,
          jsonb_build_object('before', _before, 'after', _after, 'reason', NULLIF(left(btrim(COALESCE(_reason, '')), 500), '')));
  RETURN _after;
END
$$;
REVOKE ALL ON FUNCTION public.tt_admin_set_settings(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_admin_set_settings(jsonb, text) TO authenticated;

-- Admin overview: counts per working status of open tickets and the tickets stuck in one status for more than N days.
CREATE OR REPLACE FUNCTION public.tt_admin_overview(_days integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s jsonb := public.tt_settings(); _d int;
BEGIN
  IF NOT public.tt_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  _d := LEAST(GREATEST(COALESCE(_days, (s ->> 'stuck_days')::int, 7), 1), 365);
  RETURN jsonb_build_object(
    'settings', s,
    'days', _d,
    'counts', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
        SELECT COALESCE(w.status_key, 'not_started') k, count(*) n FROM public.tickets t
          LEFT JOIN public.ticket_working_status w ON w.ticket_id = t.id
         WHERE t.status::text <> 'closed' GROUP BY 1) z), '{}'::jsonb),
    'stuck', COALESCE((SELECT jsonb_agg(z ORDER BY z.days DESC) FROM (
        SELECT t.id AS ticket_id, left(t.title, 120) AS title, t.status::text AS status, COALESCE(w.status_key, 'not_started') AS status_key,
               COALESCE(w.set_by_role, 'system') AS set_by_role, floor(extract(epoch FROM now() - COALESCE(w.set_at, t.created_at)) / 86400)::int AS days,
               w.expected_date
          FROM public.tickets t LEFT JOIN public.ticket_working_status w ON w.ticket_id = t.id
         WHERE t.status::text <> 'closed' AND COALESCE(w.set_at, t.created_at) < now() - make_interval(days => _d)
         ORDER BY COALESCE(w.set_at, t.created_at) LIMIT 50) z), '[]'::jsonb),
    'changes_7d', (SELECT count(*) FROM public.ticket_working_status_events e WHERE e.created_at > now() - interval '7 days' AND NOT e.backfill));
END
$$;
REVOKE ALL ON FUNCTION public.tt_admin_overview(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_admin_overview(integer) TO authenticated;

-- ------------------------------------------------------------------ new tickets + backfill (no notifications)

CREATE OR REPLACE FUNCTION public.tt_on_ticket_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    INSERT INTO public.ticket_working_status (ticket_id, status_key, set_by_role, set_at, version)
    VALUES (NEW.id, 'not_started', 'system', COALESCE(NEW.created_at, now()), 1) ON CONFLICT (ticket_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'working status row skipped: %', SQLERRM;  -- never blocks creating a ticket
  END;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.tt_on_ticket_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tt_ticket_insert ON public.tickets;
CREATE TRIGGER trg_tt_ticket_insert AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.tt_on_ticket_insert();

-- Backfill rule (documented in docs/ticket-tracking.md): waiting_for_client -> "Waiting for client information",
-- in_progress -> "In analysis", resolved -> "Ready for client review", closed -> "Completed (from my side)",
-- everything else -> "Not started". Set by 'system' (so no reminders) at the ticket's last update; one history row each
-- marked backfill. Inserting directly (not through tt_set_working_status) means no notifications.
WITH ins AS (
  INSERT INTO public.ticket_working_status (ticket_id, status_key, set_by_role, set_at, version)
  SELECT t.id,
         CASE t.status::text WHEN 'waiting_for_client' THEN 'waiting_client_info' WHEN 'in_progress' THEN 'in_analysis'
                             WHEN 'resolved' THEN 'ready_for_review' WHEN 'closed' THEN 'completed' ELSE 'not_started' END,
         'system', COALESCE(t.updated_at, t.created_at), 1
    FROM public.tickets t
  ON CONFLICT (ticket_id) DO NOTHING
  RETURNING ticket_id, status_key, set_at
)
INSERT INTO public.ticket_working_status_events (ticket_id, from_key, to_key, actor_role, backfill, created_at)
SELECT ins.ticket_id, NULL, ins.status_key, 'system', true, ins.set_at FROM ins;