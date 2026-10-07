-- M31b: two fixes to the client approval workflow, found while checking the real sign-up path.
-- 1) The company profile is saved with an upsert (INSERT ... ON CONFLICT DO UPDATE). The automatic submit also ran for the
--    proposed row of such an upsert, so a save of an existing profile could write a second "submitted" event and notify the
--    administrators again. It now acts only on a really new row or on the update.
-- 2) "Ready to send" is what the sign-up flow really requires: a company name and at least one SAP module (industry, size and
--    phone are optional there). A client who only pressed "Skip for now" is not sent to the administrators with an empty profile.

CREATE OR REPLACE FUNCTION public.client_info_ready(_company_name text, _sap_modules text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT btrim(COALESCE(_company_name, '')) <> '' AND COALESCE(array_length(_sap_modules, 1), 0) > 0
$fn$;

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
  -- an upsert on an existing profile proposes a new row first: the update that follows is what counts
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.client_profiles cp WHERE cp.user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  IF NOT public.client_info_ready(NEW.company_name, NEW.sap_modules) THEN
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
    'ready', public.client_info_ready(_r.company_name, _r.sap_modules),
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
  IF NOT public.client_info_ready(_r.company_name, _r.sap_modules) THEN
    RAISE EXCEPTION 'Please add your company name and at least one SAP module first' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.client_info_ready(text, text[]) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.client_basics_complete(text, text, text, text, text[]);