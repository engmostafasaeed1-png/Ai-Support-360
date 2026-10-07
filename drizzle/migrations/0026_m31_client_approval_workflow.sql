-- M31: client approval workflow.
-- A new client sends the company information, an administrator approves it or sends comments,
-- the client completes it and sends it again, the administrator approves.
-- Until approved a client can sign in, browse and edit the company information,
-- but cannot create requests (tickets) or book sessions. This is enforced here, in the database.

-- 1) helpers that do not depend on the new columns
CREATE OR REPLACE FUNCTION public.client_basics_complete(_company_name text, _company_size text, _industry text, _phone text, _sap_modules text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT btrim(COALESCE(_company_name, '')) <> ''
     AND btrim(COALESCE(_company_size, '')) <> ''
     AND btrim(COALESCE(_industry, '')) <> ''
     AND btrim(COALESCE(_phone, '')) <> ''
     AND COALESCE(array_length(_sap_modules, 1), 0) > 0
$fn$;

-- the whole check can be switched off with platform_settings.client_approval_required = false
CREATE OR REPLACE FUNCTION public.client_approval_required()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE((SELECT lower(ps.value #>> '{}') <> 'false' FROM public.platform_settings ps WHERE ps.key = 'client_approval_required' LIMIT 1), true)
$fn$;

INSERT INTO public.platform_settings (key, value)
SELECT 'client_approval_required', 'true'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'client_approval_required');

-- 2) status columns on the client profile
ALTER TABLE public.client_profiles
  ADD COLUMN approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN approval_submitted_at timestamptz,
  ADD COLUMN approval_reviewed_at timestamptz,
  ADD COLUMN approval_reviewed_by uuid,
  ADD COLUMN approval_comment text;

ALTER TABLE public.client_profiles
  ADD CONSTRAINT client_profiles_approval_status_check
    CHECK (approval_status IN ('draft', 'awaiting_confirmation', 'changes_requested', 'approved', 'rejected')),
  ADD CONSTRAINT client_profiles_approval_comment_length
    CHECK (approval_comment IS NULL OR char_length(approval_comment) <= 2000);

CREATE INDEX client_profiles_approval_status_idx ON public.client_profiles (approval_status, approval_submitted_at);

-- 3) history of every step (read by administrators; a client reads their own history through my_client_approval())
CREATE TABLE public.client_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('submitted', 'resubmitted', 'approved', 'auto_approved', 'changes_requested', 'rejected')),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_approval_events_client_idx ON public.client_approval_events (client_user_id, created_at DESC);
ALTER TABLE public.client_approval_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read client approval events" ON public.client_approval_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));
REVOKE ALL ON public.client_approval_events FROM anon, authenticated;
GRANT SELECT ON public.client_approval_events TO authenticated;

-- 4) existing clients: approved when they had finished the onboarding, draft otherwise
UPDATE public.client_profiles cp
   SET approval_status = 'approved', approval_reviewed_at = now()
 WHERE COALESCE(cp.onboarding_completed, false)
    OR public.client_basics_complete(cp.company_name, cp.company_size, cp.industry, cp.phone, cp.sap_modules);

INSERT INTO public.client_approval_events (client_user_id, event_type, note)
SELECT cp.user_id, 'auto_approved', 'Existing account, approved when the review step was introduced'
  FROM public.client_profiles cp
 WHERE cp.approval_status = 'approved'
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cp.user_id);

-- 5) a client (or anyone who is not an administrator) cannot change the approval fields: such changes are ignored
CREATE OR REPLACE FUNCTION public.guard_client_approval_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.approval_status := 'draft';
    NEW.approval_submitted_at := NULL;
    NEW.approval_reviewed_at := NULL;
    NEW.approval_reviewed_by := NULL;
    NEW.approval_comment := NULL;
  ELSE
    NEW.approval_status := OLD.approval_status;
    NEW.approval_submitted_at := OLD.approval_submitted_at;
    NEW.approval_reviewed_at := OLD.approval_reviewed_at;
    NEW.approval_reviewed_by := OLD.approval_reviewed_by;
    NEW.approval_comment := OLD.approval_comment;
  END IF;
  RETURN NEW;
END;
$fn$;

-- 6) a draft profile that has the required information goes to the administrators by itself
CREATE OR REPLACE FUNCTION public.client_profile_auto_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _name text;
  _admin uuid;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'draft' THEN
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.onboarding_completed, false)
          OR public.client_basics_complete(NEW.company_name, NEW.company_size, NEW.industry, NEW.phone, NEW.sap_modules)) THEN
    RETURN NEW;
  END IF;

  IF NOT public.client_approval_required() THEN
    NEW.approval_status := 'approved';
    NEW.approval_reviewed_at := now();
    INSERT INTO public.client_approval_events (client_user_id, event_type, note)
    VALUES (NEW.user_id, 'auto_approved', 'Client approval is switched off');
    RETURN NEW;
  END IF;

  NEW.approval_status := 'awaiting_confirmation';
  NEW.approval_submitted_at := now();
  NEW.approval_comment := NULL;
  INSERT INTO public.client_approval_events (client_user_id, event_type, actor_id)
  VALUES (NEW.user_id, 'submitted', NEW.user_id);

  BEGIN
    _name := left(COALESCE(NULLIF(btrim((SELECT p.display_name FROM public.profiles p WHERE p.user_id = NEW.user_id LIMIT 1)), ''), 'A client'), 120);
    FOR _admin IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin', 'super_admin') AND ur.user_id <> NEW.user_id
    LOOP
      PERFORM public.safe_insert_notification(
        _admin,
        'A client is waiting for approval',
        _name || COALESCE(' (' || NULLIF(btrim(left(NEW.company_name, 120)), '') || ')', '')
          || ' sent their information for review. Open Client approvals to review it.',
        'approval',
        '/admin/client-approvals'
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'client_profile_auto_submit notice: %', SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

-- 7) an account that is not approved cannot create a request or book a session
CREATE OR REPLACE FUNCTION public.guard_client_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _status text;
BEGIN
  -- no signed-in person (service role, scheduled jobs, SQL console): not a client acting for themselves
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NOT public.client_approval_required() THEN
    RETURN NEW;
  END IF;
  SELECT cp.approval_status INTO _status FROM public.client_profiles cp WHERE cp.user_id = NEW.client_id;
  IF _status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Your account is not approved yet. Requests and sessions open after an administrator approves your company information.'
      USING ERRCODE = '42501', HINT = COALESCE(_status, 'no_profile');
  END IF;
  RETURN NEW;
END;
$fn$;

-- 8) the client reads their own state
CREATE OR REPLACE FUNCTION public.my_client_approval()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _r public.client_profiles%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO _r FROM public.client_profiles WHERE user_id = _uid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'status', _r.approval_status,
    'required', public.client_approval_required(),
    'submitted_at', _r.approval_submitted_at,
    'reviewed_at', _r.approval_reviewed_at,
    'comment', _r.approval_comment,
    'complete', public.client_basics_complete(_r.company_name, _r.company_size, _r.industry, _r.phone, _r.sap_modules),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('event', e.event_type, 'comment', e.note, 'created_at', e.created_at) ORDER BY e.created_at DESC)
      FROM (
        SELECT ev.event_type, ev.note, ev.created_at
        FROM public.client_approval_events ev
        WHERE ev.client_user_id = _uid
        ORDER BY ev.created_at DESC
        LIMIT 20
      ) e
    ), '[]'::jsonb)
  );
END;
$fn$;

-- 9) the client sends the corrected information again
CREATE OR REPLACE FUNCTION public.client_resubmit_for_approval(p_message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _r public.client_profiles%ROWTYPE;
  _msg text := NULLIF(btrim(COALESCE(p_message, '')), '');
  _name text;
  _admin uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _msg IS NOT NULL AND char_length(_msg) > 1000 THEN
    RAISE EXCEPTION 'The message is too long (1000 characters at most)' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('client-approval-resubmit:' || _uid::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many attempts, please try again later' USING ERRCODE = '54000';
  END IF;
  SELECT * INTO _r FROM public.client_profiles WHERE user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF _r.approval_status <> 'changes_requested' THEN
    RAISE EXCEPTION 'There is nothing to send again: no changes were requested' USING ERRCODE = '22023';
  END IF;
  IF NOT public.client_basics_complete(_r.company_name, _r.company_size, _r.industry, _r.phone, _r.sap_modules) THEN
    RAISE EXCEPTION 'Please complete the company name, size, industry, phone and SAP modules first' USING ERRCODE = '22023';
  END IF;

  UPDATE public.client_profiles
     SET approval_status = 'awaiting_confirmation', approval_submitted_at = now(), approval_comment = NULL
   WHERE user_id = _uid;
  INSERT INTO public.client_approval_events (client_user_id, event_type, note, actor_id)
  VALUES (_uid, 'resubmitted', _msg, _uid);

  BEGIN
    _name := left(COALESCE(NULLIF(btrim((SELECT p.display_name FROM public.profiles p WHERE p.user_id = _uid LIMIT 1)), ''), 'A client'), 120);
    FOR _admin IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin', 'super_admin') AND ur.user_id <> _uid
    LOOP
      PERFORM public.safe_insert_notification(
        _admin,
        'A client sent the information again',
        _name || COALESCE(' (' || NULLIF(btrim(left(_r.company_name, 120)), '') || ')', '')
          || ' updated the information you asked for. Open Client approvals to review it.',
        'approval',
        '/admin/client-approvals'
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'client_resubmit_for_approval notice: %', SQLERRM;
  END;
END;
$fn$;

-- 10) the administrator decides: approve, send comments (request_changes) or reject
CREATE OR REPLACE FUNCTION public.admin_review_client(p_user_id uuid, p_decision text, p_comment text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _admin uuid := auth.uid();
  _r public.client_profiles%ROWTYPE;
  _comment text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  _new text;
  _event text;
  _title text;
  _body text;
  _link text;
BEGIN
  IF _admin IS NULL OR NOT (public.has_role(_admin, 'admin'::app_role) OR public.has_role(_admin, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'request_changes', 'reject') THEN
    RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;
  IF _comment IS NOT NULL AND char_length(_comment) > 2000 THEN
    RAISE EXCEPTION 'The comment is too long (2000 characters at most)' USING ERRCODE = '22023';
  END IF;
  IF p_decision <> 'approve' AND (_comment IS NULL OR char_length(_comment) < 3) THEN
    RAISE EXCEPTION 'Write a comment so the client knows what to do' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_user_id = _admin THEN
    RAISE EXCEPTION 'You cannot review your own account' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _r FROM public.client_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_decision = 'approve' THEN
    _new := 'approved'; _event := 'approved';
  ELSIF p_decision = 'request_changes' THEN
    _new := 'changes_requested'; _event := 'changes_requested';
  ELSE
    _new := 'rejected'; _event := 'rejected';
  END IF;

  IF _r.approval_status = 'draft' AND p_decision <> 'approve' THEN
    RAISE EXCEPTION 'This client has not sent their information yet' USING ERRCODE = '22023';
  END IF;
  IF _r.approval_status = _new AND _new <> 'changes_requested' THEN
    RAISE EXCEPTION 'This client is already %', replace(_new, '_', ' ') USING ERRCODE = '22023';
  END IF;

  UPDATE public.client_profiles
     SET approval_status = _new, approval_reviewed_at = now(), approval_reviewed_by = _admin, approval_comment = _comment
   WHERE user_id = p_user_id;
  INSERT INTO public.client_approval_events (client_user_id, event_type, note, actor_id)
  VALUES (p_user_id, _event, _comment, _admin);
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_admin, 'client_approval.' || _event, 'client_profile', p_user_id,
          jsonb_build_object('from', _r.approval_status, 'to', _new, 'comment', left(COALESCE(_comment, ''), 500)));

  IF _new = 'approved' THEN
    _title := 'Your account is approved';
    _body := 'You can now create support requests and book sessions.'
             || COALESCE(' Message from the administrator: ' || left(_comment, 300), '');
    _link := '/client';
  ELSIF _new = 'changes_requested' THEN
    _title := 'Please update your information';
    _body := 'An administrator asked for changes: ' || left(_comment, 300)
             || ' Update your company information and send it again.';
    _link := '/client/company';
  ELSE
    _title := 'Your account was not approved';
    _body := left(_comment, 300);
    _link := '/client/company';
  END IF;
  PERFORM public.safe_insert_notification(p_user_id, _title, _body, 'approval', _link);
END;
$fn$;

-- 11) administrator list and counters
CREATE OR REPLACE FUNCTION public.admin_list_client_approvals(p_status text DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft', 'awaiting_confirmation', 'changes_requested', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x.j ORDER BY x.sort_key DESC)
    FROM (
      SELECT
        COALESCE(cp.approval_submitted_at, cp.created_at) AS sort_key,
        jsonb_build_object(
          'user_id', cp.user_id,
          'name', COALESCE(NULLIF(btrim(p.display_name), ''), u.email),
          'email', u.email,
          'email_confirmed', u.email_confirmed_at IS NOT NULL,
          'avatar_url', p.avatar_url,
          'joined_at', u.created_at,
          'last_sign_in_at', u.last_sign_in_at,
          'status', cp.approval_status,
          'submitted_at', cp.approval_submitted_at,
          'reviewed_at', cp.approval_reviewed_at,
          'reviewed_by_name', rp.display_name,
          'comment', cp.approval_comment,
          'profile', to_jsonb(cp) - 'id' - 'custom_nda_url',
          'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('event', e.event_type, 'comment', e.note, 'created_at', e.created_at, 'actor_name', ap.display_name) ORDER BY e.created_at DESC)
            FROM (
              SELECT ev.event_type, ev.note, ev.created_at, ev.actor_id
              FROM public.client_approval_events ev
              WHERE ev.client_user_id = cp.user_id
              ORDER BY ev.created_at DESC
              LIMIT 30
            ) e
            LEFT JOIN public.profiles ap ON ap.user_id = e.actor_id
          ), '[]'::jsonb)
        ) AS j
      FROM public.client_profiles cp
      JOIN auth.users u ON u.id = cp.user_id
      LEFT JOIN public.profiles p ON p.user_id = cp.user_id
      LEFT JOIN public.profiles rp ON rp.user_id = cp.approval_reviewed_by
      WHERE p_status IS NULL OR cp.approval_status = p_status
      ORDER BY COALESCE(cp.approval_submitted_at, cp.created_at) DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
    ) x
  ), '[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_client_approval_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'draft', count(*) FILTER (WHERE cp.approval_status = 'draft'),
      'awaiting_confirmation', count(*) FILTER (WHERE cp.approval_status = 'awaiting_confirmation'),
      'changes_requested', count(*) FILTER (WHERE cp.approval_status = 'changes_requested'),
      'approved', count(*) FILTER (WHERE cp.approval_status = 'approved'),
      'rejected', count(*) FILTER (WHERE cp.approval_status = 'rejected'),
      'total', count(*)
    )
    FROM public.client_profiles cp
    JOIN auth.users u ON u.id = cp.user_id
  );
END;
$fn$;

-- 12) triggers (the names make the guard run before the automatic submit)
CREATE TRIGGER trg_client_approval_1_guard
  BEFORE INSERT OR UPDATE ON public.client_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_approval_columns();
CREATE TRIGGER trg_client_approval_2_submit
  BEFORE INSERT OR UPDATE ON public.client_profiles
  FOR EACH ROW EXECUTE FUNCTION public.client_profile_auto_submit();
CREATE TRIGGER trg_guard_client_approved
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_approved();
CREATE TRIGGER trg_guard_client_approved
  BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_approved();

-- 13) who may call what
REVOKE ALL ON FUNCTION public.client_basics_complete(text, text, text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_approval_required() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_client_approval_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_profile_auto_submit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_client_approved() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_client_approval() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_resubmit_for_approval(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_client(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_client_approvals(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_client_approval_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_client_approval() TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_resubmit_for_approval(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_client(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_client_approvals(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_client_approval_counts() TO authenticated;