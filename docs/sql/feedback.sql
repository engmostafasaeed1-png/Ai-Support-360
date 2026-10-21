-- Feature U: in-app feedback (bug reports, improvement ideas, questions, compliments).
-- Prepared for the owner to apply. Nothing here changes existing tables or functions.
--
-- After applying:
--   1. Create the PRIVATE storage bucket "feedback" (5 MB per file, png/jpeg/webp). Only admins can read it
--      (policy below); uploads happen only in the feedback function with the service role.
--   2. Optional settings (defaults apply when a row is missing):
--        feedback_enabled = true, feedback_public_enabled = true, feedback_digest_enabled = true,
--        feedback_attachment_retention_days = 180, feedback_report_retention_days = 730.
--
-- Separate from the automatic error logger (error_reports): reports here are always written by a person.

-- ---------------------------------------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS public.feedback_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,                                   -- null for visitors; plain id, no link to the auth schema
  tenant_id uuid,
  role text NOT NULL DEFAULT 'visitor' CHECK (role IN ('visitor', 'client', 'consultant', 'admin', 'super_admin')),
  type text NOT NULL CHECK (type IN ('bug', 'idea', 'question', 'compliment')),
  severity text CHECK (severity IN ('blocks', 'annoying', 'minor')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  route text NOT NULL DEFAULT '' CHECK (char_length(route) <= 300),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(context::text) <= 8192),
  contact_email text CHECK (contact_email IS NULL OR (char_length(contact_email) <= 254 AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  consent_contact boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid,
  admin_notes text CHECK (admin_notes IS NULL OR char_length(admin_notes) <= 4000),
  duplicate_of uuid REFERENCES public.feedback_reports(id) ON DELETE SET NULL,
  attachments integer NOT NULL DEFAULT 0 CHECK (attachments BETWEEN 0 AND 3),
  ip_hash text CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 128),
  CHECK (severity IS NULL OR type = 'bug'),
  CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);
CREATE INDEX IF NOT EXISTS feedback_reports_status_idx ON public.feedback_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_reports_user_idx ON public.feedback_reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_reports_created_idx ON public.feedback_reports (created_at);

CREATE TABLE IF NOT EXISTS public.feedback_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.feedback_reports(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE CHECK (char_length(path) <= 200),
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS feedback_attachments_report_idx ON public.feedback_attachments (report_id);

CREATE TABLE IF NOT EXISTS public.feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.feedback_reports(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  kind text NOT NULL CHECK (kind IN ('submitted', 'status', 'priority', 'assigned', 'duplicate', 'note', 'reply')),
  from_value text,
  to_value text,
  message text CHECK (message IS NULL OR char_length(message) <= 2000),
  visible_to_user boolean NOT NULL DEFAULT false,
  emailed_at timestamptz
);
CREATE INDEX IF NOT EXISTS feedback_events_report_idx ON public.feedback_events (report_id, created_at);

-- Reads only; every write goes through the functions below.
GRANT SELECT ON public.feedback_reports, public.feedback_attachments, public.feedback_events TO authenticated;
GRANT ALL ON public.feedback_reports, public.feedback_attachments, public.feedback_events TO service_role;

ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read feedback" ON public.feedback_reports;
CREATE POLICY "Admins read feedback" ON public.feedback_reports FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Admins read feedback attachments" ON public.feedback_attachments;
CREATE POLICY "Admins read feedback attachments" ON public.feedback_attachments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Admins read feedback events" ON public.feedback_events;
CREATE POLICY "Admins read feedback events" ON public.feedback_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Screenshots: admins may read (signed links); nobody may write from the browser.
DROP POLICY IF EXISTS "Admins read feedback screenshots" ON storage.objects;
CREATE POLICY "Admins read feedback screenshots" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'feedback' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')));

-- ---------------------------------------------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION public.feedback_setting_int(_key text, _default integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN (value #>> '{}') ~ '^[0-9]{1,6}$' THEN (value #>> '{}')::integer END
                   FROM public.platform_settings WHERE key = _key), _default)
$$;

CREATE OR REPLACE FUNCTION public.feedback_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'super_admin'))
$$;

-- Removes tags and masks strings that look like secrets (long tokens, card-like digit runs).
CREATE OR REPLACE FUNCTION public.feedback_clean_text(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(COALESCE(_t, ''), '<[^>]*>', '', 'g'),
        '(\d[ -]?){12,18}\d', '[hidden number]', 'g'),
      '[A-Za-z0-9_=+-]{32,}', '[hidden]', 'g'))
$$;

-- Public switches only (no counts, no ids).
CREATE OR REPLACE FUNCTION public.feedback_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', public.platform_flag('feedback_enabled', true),
    'public_enabled', public.platform_flag('feedback_enabled', true) AND public.platform_flag('feedback_public_enabled', true))
$$;

-- ---------------------------------------------------------------------------------------------- submit

-- Called only by the feedback function (service role), which supplies the verified user id or the visitor's IP hash.
CREATE OR REPLACE FUNCTION public.submit_feedback(_user_id uuid, _ip_hash text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _type text := _payload->>'type';
  _severity text := NULLIF(_payload->>'severity', '');
  _title text := left(public.feedback_clean_text(_payload->>'title'), 120);
  _desc text := left(public.feedback_clean_text(_payload->>'description'), 2000);
  _route text := left(split_part(split_part(COALESCE(_payload->>'route', ''), '?', 1), '#', 1), 300);
  _ctx jsonb := COALESCE(_payload->'context', '{}'::jsonb);
  _email text := NULLIF(lower(btrim(COALESCE(_payload->>'contact_email', ''))), '');
  _consent boolean := COALESCE((_payload->>'consent_contact')::boolean, false);
  _role text := 'visitor';
  _tenant uuid;
  _id uuid;
  _admin uuid;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.platform_flag('feedback_enabled', true) THEN RAISE EXCEPTION 'feedback_disabled'; END IF;

  -- Spam checks: a filled hidden field is silently dropped; very fast visitor submits are refused.
  IF COALESCE(_payload->>'website', '') <> '' THEN RETURN jsonb_build_object('id', NULL, 'dropped', true); END IF;
  IF _user_id IS NULL THEN
    IF NOT public.platform_flag('feedback_public_enabled', true) THEN RAISE EXCEPTION 'feedback_disabled'; END IF;
    IF _ip_hash IS NULL OR char_length(_ip_hash) < 16 THEN RAISE EXCEPTION 'invalid_request'; END IF;
    IF COALESCE((_payload->>'elapsed_ms')::bigint, 0) < 3000 THEN RAISE EXCEPTION 'too_fast'; END IF;
    IF NOT public.check_rate_limit('feedback-ip:' || _ip_hash, 3, 3600) THEN RAISE EXCEPTION 'rate_limited'; END IF;
  ELSE
    IF NOT public.check_rate_limit('feedback-user:' || _user_id, 5, 3600) THEN RAISE EXCEPTION 'rate_limited'; END IF;
  END IF;

  IF _type IS NULL OR _type NOT IN ('bug', 'idea', 'question', 'compliment') THEN RAISE EXCEPTION 'invalid_type'; END IF;
  IF _type <> 'bug' THEN _severity := NULL;
  ELSIF _severity IS NOT NULL AND _severity NOT IN ('blocks', 'annoying', 'minor') THEN RAISE EXCEPTION 'invalid_severity'; END IF;
  IF char_length(_title) < 3 THEN RAISE EXCEPTION 'invalid_title'; END IF;
  IF char_length(_desc) < 10 THEN RAISE EXCEPTION 'invalid_description'; END IF;
  IF _email IS NOT NULL AND (char_length(_email) > 254 OR _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  IF jsonb_typeof(_ctx) <> 'object' THEN _ctx := '{}'::jsonb; END IF;
  IF octet_length(_ctx::text) > 8192 THEN
    _ctx := jsonb_strip_nulls(jsonb_build_object('route', _ctx->'route', 'lang', _ctx->'lang', 'theme', _ctx->'theme',
      'viewport', _ctx->'viewport', 'browser', _ctx->'browser', 'os', _ctx->'os', 'version', _ctx->'version', 'truncated', true));
    IF octet_length(_ctx::text) > 8192 THEN _ctx := '{"truncated": true}'::jsonb; END IF;
  END IF;

  IF _user_id IS NOT NULL THEN
    SELECT CASE WHEN bool_or(role = 'super_admin') THEN 'super_admin' WHEN bool_or(role = 'admin') THEN 'admin'
                WHEN bool_or(role = 'consultant') THEN 'consultant' ELSE 'client' END
      INTO _role FROM public.user_roles WHERE user_id = _user_id;
    _role := COALESCE(_role, 'client');
    SELECT tenant_id INTO _tenant FROM public.tenant_members WHERE user_id = _user_id ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO public.feedback_reports (user_id, tenant_id, role, type, severity, title, description, route, context,
                                       contact_email, consent_contact, ip_hash)
  VALUES (_user_id, _tenant, _role, _type, _severity, _title, _desc, _route, _ctx,
          _email, _consent AND (_email IS NOT NULL OR _user_id IS NOT NULL), _ip_hash)
  RETURNING id INTO _id;
  INSERT INTO public.feedback_events (report_id, actor_id, kind, to_value) VALUES (_id, _user_id, 'submitted', 'new');

  -- Blocking bugs alert every administrator at once (the normal admin e-mail switch then applies).
  IF _type = 'bug' AND _severity = 'blocks' THEN
    FOR _admin IN SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('admin', 'super_admin') LIMIT 25 LOOP
      PERFORM public.safe_insert_notification(_admin, 'Blocking problem reported', left(_title, 120),
        'feedback_blocker', '/admin/feedback?id=' || _id);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', _id);
END $$;

-- Records screenshots already stored by the feedback function. At most 3 per report.
CREATE OR REPLACE FUNCTION public.feedback_add_attachments(_report_id uuid, _files jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _f jsonb;
  _n integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_files) <> 'array' OR jsonb_array_length(_files) > 3 THEN RAISE EXCEPTION 'too_many_files'; END IF;
  SELECT count(*) INTO _n FROM public.feedback_attachments WHERE report_id = _report_id;
  IF _n + jsonb_array_length(_files) > 3 THEN RAISE EXCEPTION 'too_many_files'; END IF;
  FOR _f IN SELECT * FROM jsonb_array_elements(_files) LOOP
    IF (_f->>'path') NOT LIKE _report_id::text || '/%' THEN RAISE EXCEPTION 'invalid_path'; END IF;
    INSERT INTO public.feedback_attachments (report_id, path, content_type, size)
    VALUES (_report_id, _f->>'path', _f->>'content_type', (_f->>'size')::integer);
  END LOOP;
  UPDATE public.feedback_reports SET attachments = (SELECT count(*) FROM public.feedback_attachments WHERE report_id = _report_id)
   WHERE id = _report_id;
  RETURN jsonb_array_length(_files);
END $$;

-- ---------------------------------------------------------------------------------------------- submitter

-- The signed-in submitter's own reports, their status and the replies meant for them (no internal notes).
CREATE OR REPLACE FUNCTION public.my_feedback()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'created_at') DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('id', r.id, 'created_at', r.created_at, 'updated_at', r.updated_at, 'type', r.type,
      'severity', r.severity, 'title', r.title, 'status', r.status,
      'updates', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'to_value', e.to_value, 'message', e.message,
                                     'created_at', e.created_at) ORDER BY e.created_at)
                  FROM public.feedback_events e WHERE e.report_id = r.id AND e.visible_to_user), '[]'::jsonb)) AS row
    FROM public.feedback_reports r
    WHERE auth.uid() IS NOT NULL AND r.user_id = auth.uid()
    ORDER BY r.created_at DESC LIMIT 100) s
$$;

-- ---------------------------------------------------------------------------------------------- admin

-- Status / priority / assignee / duplicate / internal notes for up to 200 reports; every change is audited.
CREATE OR REPLACE FUNCTION public.feedback_admin_update(_ids uuid[], _patch jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r public.feedback_reports;
  _n integer := 0;
  _status text := _patch->>'status';
  _priority text := _patch->>'priority';
  _assign uuid;
  _dup uuid;
  _notes text;
BEGIN
  IF NOT public.feedback_is_admin(_uid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF _ids IS NULL OR cardinality(_ids) = 0 OR cardinality(_ids) > 200 THEN RAISE EXCEPTION 'invalid_selection'; END IF;
  IF NOT public.check_rate_limit('feedback-admin:' || _uid, 300, 3600) THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF _status IS NOT NULL AND _status NOT IN ('new', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF _priority IS NOT NULL AND _priority NOT IN ('low', 'normal', 'high', 'urgent') THEN RAISE EXCEPTION 'invalid_priority'; END IF;
  IF _patch ? 'assigned_to' THEN
    _assign := NULLIF(_patch->>'assigned_to', '')::uuid;
    IF _assign IS NOT NULL AND NOT public.feedback_is_admin(_assign) THEN RAISE EXCEPTION 'invalid_assignee'; END IF;
  END IF;
  IF _patch ? 'duplicate_of' THEN
    _dup := NULLIF(_patch->>'duplicate_of', '')::uuid;
    IF _dup IS NOT NULL AND (_dup = ANY(_ids) OR NOT EXISTS (SELECT 1 FROM public.feedback_reports WHERE id = _dup)) THEN
      RAISE EXCEPTION 'invalid_duplicate';
    END IF;
  END IF;
  IF _patch ? 'admin_notes' THEN _notes := left(public.feedback_clean_text(_patch->>'admin_notes'), 4000); END IF;

  FOR _r IN SELECT * FROM public.feedback_reports WHERE id = ANY(_ids) FOR UPDATE LOOP
    IF _status IS NOT NULL AND _status <> _r.status THEN
      INSERT INTO public.feedback_events (report_id, actor_id, kind, from_value, to_value, visible_to_user)
      VALUES (_r.id, _uid, 'status', _r.status, _status, true);
      IF _status = 'fixed' AND _r.user_id IS NOT NULL THEN
        PERFORM public.safe_insert_notification(_r.user_id, 'Thank you — we fixed the problem you reported',
          left(_r.title, 120), 'feedback_fixed', '/my-feedback');
      END IF;
    END IF;
    IF _priority IS NOT NULL AND _priority <> _r.priority THEN
      INSERT INTO public.feedback_events (report_id, actor_id, kind, from_value, to_value) VALUES (_r.id, _uid, 'priority', _r.priority, _priority);
    END IF;
    IF _patch ? 'assigned_to' AND _assign IS DISTINCT FROM _r.assigned_to THEN
      INSERT INTO public.feedback_events (report_id, actor_id, kind, from_value, to_value) VALUES (_r.id, _uid, 'assigned', _r.assigned_to::text, _assign::text);
    END IF;
    IF _patch ? 'duplicate_of' AND _dup IS DISTINCT FROM _r.duplicate_of THEN
      INSERT INTO public.feedback_events (report_id, actor_id, kind, from_value, to_value) VALUES (_r.id, _uid, 'duplicate', _r.duplicate_of::text, _dup::text);
    END IF;
    IF _patch ? 'admin_notes' AND _notes IS DISTINCT FROM COALESCE(_r.admin_notes, '') THEN
      INSERT INTO public.feedback_events (report_id, actor_id, kind, message) VALUES (_r.id, _uid, 'note', left(_notes, 2000));
    END IF;
    UPDATE public.feedback_reports SET
      status = COALESCE(CASE WHEN _patch ? 'duplicate_of' AND _dup IS NOT NULL AND _status IS NULL THEN 'duplicate' END, _status, status),
      priority = COALESCE(_priority, priority),
      assigned_to = CASE WHEN _patch ? 'assigned_to' THEN _assign ELSE assigned_to END,
      duplicate_of = CASE WHEN _patch ? 'duplicate_of' THEN _dup ELSE duplicate_of END,
      admin_notes = CASE WHEN _patch ? 'admin_notes' THEN NULLIF(_notes, '') ELSE admin_notes END,
      updated_at = now()
    WHERE id = _r.id;
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (_uid, 'feedback.update', 'feedback_report', _r.id,
            jsonb_build_object('before', jsonb_build_object('status', _r.status, 'priority', _r.priority, 'assigned_to', _r.assigned_to,
                                                            'duplicate_of', _r.duplicate_of),
                               'change', _patch - 'admin_notes', 'notes_changed', _patch ? 'admin_notes'));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- A reply the submitter sees on My feedback and as a notification. Returns the reply id (for the optional e-mail).
CREATE OR REPLACE FUNCTION public.feedback_admin_reply(_id uuid, _message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg text := left(public.feedback_clean_text(_message), 2000);
  _r public.feedback_reports;
  _event uuid;
BEGIN
  IF NOT public.feedback_is_admin(_uid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(_msg) < 2 THEN RAISE EXCEPTION 'invalid_message'; END IF;
  IF NOT public.check_rate_limit('feedback-admin:' || _uid, 300, 3600) THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT * INTO _r FROM public.feedback_reports WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO public.feedback_events (report_id, actor_id, kind, message, visible_to_user)
  VALUES (_id, _uid, 'reply', _msg, true) RETURNING id INTO _event;
  UPDATE public.feedback_reports SET updated_at = now(), status = CASE WHEN status = 'new' THEN 'triaged' ELSE status END WHERE id = _id;
  IF _r.user_id IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_r.user_id, 'Reply to your feedback', left(_msg, 200), 'feedback_reply', '/my-feedback');
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'feedback.reply', 'feedback_report', _id, jsonb_build_object('event_id', _event, 'length', char_length(_msg)));
  RETURN _event;
END $$;

-- Service only: returns where to e-mail a reply once, and only when the submitter agreed to be contacted.
CREATE OR REPLACE FUNCTION public.feedback_reply_email_claim(_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  _e public.feedback_events;
  _r public.feedback_reports;
  _to text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _e FROM public.feedback_events WHERE id = _event_id AND kind = 'reply' AND emailed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO _r FROM public.feedback_reports WHERE id = _e.report_id;
  IF NOT _r.consent_contact THEN RETURN NULL; END IF;
  _to := COALESCE(_r.contact_email, (SELECT email FROM auth.users WHERE id = _r.user_id));
  IF _to IS NULL THEN RETURN NULL; END IF;
  UPDATE public.feedback_events SET emailed_at = now() WHERE id = _event_id;
  RETURN jsonb_build_object('to', _to, 'user_id', _r.user_id, 'title', _r.title, 'message', _e.message,
                            'lang', COALESCE(_r.context->>'lang', 'en'));
END $$;

CREATE OR REPLACE FUNCTION public.feedback_admin_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.feedback_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT jsonb_build_object(
    'new', count(*) FILTER (WHERE status = 'new'),
    'triaged', count(*) FILTER (WHERE status = 'triaged'),
    'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
    'fixed', count(*) FILTER (WHERE status = 'fixed'),
    'wont_fix', count(*) FILTER (WHERE status = 'wont_fix'),
    'duplicate', count(*) FILTER (WHERE status = 'duplicate'),
    'blocking_open', count(*) FILTER (WHERE severity = 'blocks' AND status IN ('new', 'triaged', 'in_progress')),
    'total', count(*)) FROM public.feedback_reports);
END $$;

CREATE OR REPLACE FUNCTION public.feedback_admin_log_export(_count integer, _filters jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.feedback_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, metadata)
  VALUES (auth.uid(), 'feedback.export_csv', 'feedback_report',
          jsonb_build_object('rows', GREATEST(COALESCE(_count, 0), 0), 'filters', COALESCE(_filters, '{}'::jsonb)));
END $$;

-- ---------------------------------------------------------------------------------------------- schedules

-- Weekly in-app summary for administrators (their normal admin e-mail switch applies). At most once in 6 days.
CREATE OR REPLACE FUNCTION public.feedback_weekly_digest()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new integer;
  _open integer;
  _blocking integer;
  _admin uuid;
  _n integer := 0;
BEGIN
  IF NOT public.platform_flag('feedback_digest_enabled', true) THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE type = 'feedback_digest' AND created_at > now() - interval '6 days') THEN RETURN 0; END IF;
  SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days'),
         count(*) FILTER (WHERE status IN ('new', 'triaged', 'in_progress')),
         count(*) FILTER (WHERE severity = 'blocks' AND status IN ('new', 'triaged', 'in_progress'))
    INTO _new, _open, _blocking FROM public.feedback_reports;
  IF _new = 0 AND _open = 0 THEN RETURN 0; END IF;
  FOR _admin IN SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('admin', 'super_admin') LIMIT 25 LOOP
    PERFORM public.safe_insert_notification(_admin, 'Weekly feedback summary',
      format('%s new this week · %s open · %s blocking', _new, _open, _blocking), 'feedback_digest', '/admin/feedback');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- Service only: screenshots past their retention are handed to the feedback function for removal through the
-- storage API, then marked; reports past their retention (with no screenshot left to remove) are deleted.
CREATE OR REPLACE FUNCTION public.feedback_claim_retention(_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _paths jsonb;
  _deleted integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  WITH due AS (
    SELECT a.id FROM public.feedback_attachments a
     WHERE a.deleted_at IS NULL
       AND a.created_at < now() - make_interval(days => GREATEST(public.feedback_setting_int('feedback_attachment_retention_days', 180), 1))
     ORDER BY a.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.feedback_attachments a SET deleted_at = now() FROM due WHERE a.id = due.id RETURNING a.path
  )
  SELECT COALESCE(jsonb_agg(path), '[]'::jsonb) INTO _paths FROM upd;

  WITH gone AS (
    DELETE FROM public.feedback_reports r
     WHERE r.created_at < now() - make_interval(days => GREATEST(public.feedback_setting_int('feedback_report_retention_days', 730), 30))
       AND NOT EXISTS (SELECT 1 FROM public.feedback_attachments a WHERE a.report_id = r.id AND a.deleted_at IS NULL)
    RETURNING 1)
  SELECT count(*) INTO _deleted FROM gone;
  RETURN jsonb_build_object('paths', _paths, 'reports_deleted', _deleted);
END $$;

-- ---------------------------------------------------------------------------------------------- access

REVOKE ALL ON FUNCTION public.feedback_setting_int(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feedback_clean_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_feedback(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_add_attachments(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_reply_email_claim(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_weekly_digest() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feedback_claim_retention(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_feedback() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feedback_admin_update(uuid[], jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feedback_admin_reply(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feedback_admin_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feedback_admin_log_export(integer, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.feedback_config() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.feedback_is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_feedback() TO authenticated;
GRANT EXECUTE ON FUNCTION public.feedback_admin_update(uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.feedback_admin_reply(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.feedback_admin_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.feedback_admin_log_export(integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_feedback(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_add_attachments(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_reply_email_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_weekly_digest() TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_claim_retention(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_setting_int(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_clean_text(text) TO service_role;

-- Weekly digest on Mondays 07:23 UTC (the function itself refuses to send twice within 6 days).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'feedback-weekly-digest';
    PERFORM cron.schedule('feedback-weekly-digest', '23 7 * * 1', 'SELECT public.feedback_weekly_digest()');
  END IF;
END $$;
