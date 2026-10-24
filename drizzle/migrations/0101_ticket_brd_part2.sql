-- ------------------------------------------------------------------------------------------------ content checks
-- Contact-bypass mask (M60) over every string of the document.
CREATE OR REPLACE FUNCTION public.brd_mask_jsonb(_j jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  k text;
  v jsonb;
  res jsonb;
BEGIN
  CASE jsonb_typeof(_j)
    WHEN 'string' THEN RETURN to_jsonb(public.mask_contact_details(_j #>> '{}'));
    WHEN 'object' THEN
      res := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(_j) LOOP
        res := res || jsonb_build_object(k, public.brd_mask_jsonb(v));
      END LOOP;
      RETURN res;
    WHEN 'array' THEN
      SELECT COALESCE(jsonb_agg(public.brd_mask_jsonb(e) ORDER BY o), '[]'::jsonb) INTO res
      FROM jsonb_array_elements(_j) WITH ORDINALITY AS a(e, o);
      RETURN res;
    ELSE RETURN _j;
  END CASE;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_validate_content(_c jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _c IS NULL OR jsonb_typeof(_c) <> 'object' THEN RAISE EXCEPTION 'brd_invalid_content' USING ERRCODE = '22023'; END IF;
  IF octet_length(_c::text) > 400000 THEN RAISE EXCEPTION 'brd_too_large' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(_c -> 'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(_c -> 'sections') > 20 THEN
    RAISE EXCEPTION 'brd_invalid_sections' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(_c -> 'requirements', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_c -> 'requirements', '[]'::jsonb)) > 150 THEN
    RAISE EXCEPTION 'brd_too_many_requirements' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(_c -> 'questions', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_c -> 'questions', '[]'::jsonb)) > 8 THEN
    RAISE EXCEPTION 'brd_too_many_questions' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_c ->> 'language', 'en') NOT IN ('en', 'ar', 'both') OR COALESCE(_c ->> 'template', 'standard') NOT IN ('standard', 'short', 'technical', 'incident') THEN
    RAISE EXCEPTION 'brd_invalid_options' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_c #>> '{control,title}', '')) > 200 THEN RAISE EXCEPTION 'brd_title_too_long' USING ERRCODE = '22023'; END IF;
  -- Markup allowlist: no scripts, frames, images, links, styles or event handlers can be stored.
  IF _c::text ~* '<\s*/?\s*(script|iframe|frame|object|embed|style|link|meta|svg|math|img|video|audio|source|form|input|button|a|base)\M'
     OR _c::text ~* '<[^>]*\son[a-z]+\s*=' OR _c::text ~* '<[^>]*(java|vb)script\s*:' OR _c::text ~* '<[^>]*data\s*:\s*text/html' THEN
    RAISE EXCEPTION 'brd_markup_not_allowed' USING ERRCODE = '22023';
  END IF;
END
$$;

-- ------------------------------------------------------------------------------------------------ immutability
CREATE OR REPLACE FUNCTION public.brd_guard_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only the cascade of a deleted ticket may remove versions.
    IF EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'BRD versions cannot be deleted (archive instead)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id OR NEW.brd_id <> OLD.brd_id OR NEW.ticket_id <> OLD.ticket_id OR NEW.version <> OLD.version
     OR NEW.status <> OLD.status OR NEW.content <> OLD.content OR NEW.change_note <> OLD.change_note
     OR NEW.restored_from IS DISTINCT FROM OLD.restored_from OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'BRD versions are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.archived_at IS NOT NULL AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by) THEN
    RAISE EXCEPTION 'BRD version already archived' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_version ON public.ticket_brd_versions;
CREATE TRIGGER brd_guard_version BEFORE UPDATE OR DELETE ON public.ticket_brd_versions FOR EACH ROW EXECUTE FUNCTION public.brd_guard_version();

CREATE OR REPLACE FUNCTION public.brd_guard_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_events ON public.ticket_brd_events;
CREATE TRIGGER brd_guard_events BEFORE UPDATE OR DELETE ON public.ticket_brd_events FOR EACH ROW EXECUTE FUNCTION public.brd_guard_append_only();
DROP TRIGGER IF EXISTS brd_guard_access_log ON public.ticket_brd_access_log;
CREATE TRIGGER brd_guard_access_log BEFORE UPDATE OR DELETE ON public.ticket_brd_access_log FOR EACH ROW EXECUTE FUNCTION public.brd_guard_append_only();

-- BRD document rows: only the superseded / unattached marks may change; never deleted while the ticket exists.
CREATE OR REPLACE FUNCTION public.brd_guard_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.doc_type = 'brd' AND EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'An attached BRD cannot be deleted (unattach it instead)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.doc_type = 'brd' OR NEW.doc_type = 'brd' THEN
    IF NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.ticket_id <> OLD.ticket_id OR NEW.file_url <> OLD.file_url
       OR NEW.file_name <> OLD.file_name OR NEW.brd_version IS DISTINCT FROM OLD.brd_version OR NEW.uploaded_by <> OLD.uploaded_by
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'An attached BRD cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_document ON public.ticket_documents;
CREATE TRIGGER brd_guard_document BEFORE UPDATE OR DELETE ON public.ticket_documents FOR EACH ROW EXECUTE FUNCTION public.brd_guard_document();

-- ------------------------------------------------------------------------------------------------ policies
-- ticket_documents: restrictive policies (ANDed with the existing permissive ones) for BRD rows.
DROP POLICY IF EXISTS "BRD rows: readers only" ON public.ticket_documents;
CREATE POLICY "BRD rows: readers only" ON public.ticket_documents AS RESTRICTIVE FOR SELECT TO public
  USING (doc_type <> 'brd' OR public.brd_doc_visible(ticket_id, unattached_at));
DROP POLICY IF EXISTS "BRD rows: added by the BRD functions only" ON public.ticket_documents;
CREATE POLICY "BRD rows: added by the BRD functions only" ON public.ticket_documents AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (doc_type <> 'brd');
DROP POLICY IF EXISTS "BRD rows: changed by the BRD functions only" ON public.ticket_documents;
CREATE POLICY "BRD rows: changed by the BRD functions only" ON public.ticket_documents AS RESTRICTIVE FOR UPDATE TO public
  USING (doc_type <> 'brd') WITH CHECK (doc_type <> 'brd');
DROP POLICY IF EXISTS "BRD rows: never deleted" ON public.ticket_documents;
CREATE POLICY "BRD rows: never deleted" ON public.ticket_documents AS RESTRICTIVE FOR DELETE TO public
  USING (doc_type <> 'brd');

-- storage.objects in ticket-documents under <ticket>/brd/: readers only, client/admin upload, never replaced/deleted.
DROP POLICY IF EXISTS "BRD files: readers only" ON storage.objects;
CREATE POLICY "BRD files: readers only" ON storage.objects AS RESTRICTIVE FOR SELECT TO public
  USING (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd' OR public.brd_file_readable(name));
DROP POLICY IF EXISTS "BRD files: client or admin upload" ON storage.objects;
CREATE POLICY "BRD files: client or admin upload" ON storage.objects AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd' OR public.brd_storage_can_insert(name));
DROP POLICY IF EXISTS "BRD files: never replaced" ON storage.objects;
CREATE POLICY "BRD files: never replaced" ON storage.objects AS RESTRICTIVE FOR UPDATE TO public
  USING (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd')
  WITH CHECK (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd');
DROP POLICY IF EXISTS "BRD files: never deleted" ON storage.objects;
CREATE POLICY "BRD files: never deleted" ON storage.objects AS RESTRICTIVE FOR DELETE TO public
  USING (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd');
-- Permissive read for BRD readers who are not covered by the older bucket policy (team members, company members).
DROP POLICY IF EXISTS "BRD files: readers can open" ON storage.objects;
CREATE POLICY "BRD files: readers can open" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ticket-documents' AND split_part(name, '/', 2) = 'brd' AND public.brd_file_readable(name));
DROP POLICY IF EXISTS "BRD files: writers can upload" ON storage.objects;
CREATE POLICY "BRD files: writers can upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ticket-documents' AND split_part(name, '/', 2) = 'brd' AND public.brd_storage_can_insert(name));

-- ------------------------------------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION public.brd_log_event(_ticket uuid, _brd uuid, _actor uuid, _action text, _version integer, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.ticket_brd_events (ticket_id, brd_id, actor_id, action, version, detail)
  VALUES (_ticket, _brd, _actor, _action, _version, COALESCE(_detail, '{}'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.brd_ref(_ticket uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT upper(left(replace(_ticket::text, '-', ''), 8))
$$;

-- Display name of a person for the viewer: consultants through the name-privacy rule, everyone else by profile.
CREATE OR REPLACE FUNCTION public.brd_person_name(_uid uuid, _consultant uuid, _viewer uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n text;
BEGIN
  IF _consultant IS NOT NULL THEN
    BEGIN
      n := public.consultant_name_for(_consultant, _viewer);
    EXCEPTION WHEN others THEN n := NULL;
    END;
    RETURN COALESCE(n, 'Consultant');
  END IF;
  SELECT display_name INTO n FROM public.profiles WHERE user_id = _uid;
  RETURN COALESCE(NULLIF(trim(n), ''), 'User');
END
$$;

CREATE OR REPLACE FUNCTION public.brd_consultant_of(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.consultants WHERE user_id = _uid LIMIT 1
$$;

-- Users who may read attached versions as consultants (for notices).
CREATE OR REPLACE FUNCTION public.brd_consultant_readers(_ticket uuid)
RETURNS TABLE (user_id uuid, consultant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT c.user_id, c.id
  FROM public.consultants c
  WHERE (c.id = (SELECT consultant_id FROM public.tickets WHERE id = _ticket)
         OR c.id IN (SELECT tm.consultant_id FROM public.ticket_team_members tm WHERE tm.ticket_id = _ticket AND tm.status IN ('ready', 'active')))
    AND public.brd_role_for(_ticket, c.user_id) = 'consultant'
$$;

-- ------------------------------------------------------------------------------------------------ read
CREATE OR REPLACE FUNCTION public.brd_get(_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  s jsonb := public.brd_settings();
  t record;
  b public.ticket_brds;
  writer boolean;
  full_view boolean;
  res jsonb;
BEGIN
  IF r IS NULL THEN
    RETURN jsonb_build_object('role', NULL, 'enabled', COALESCE((s ->> 'enabled')::boolean, false));
  END IF;
  full_view := r IN ('admin', 'client');
  writer := public.brd_can_write_for(_ticket, uid);
  SELECT tk.id, tk.title, tk.status::text AS status, tk.client_id, tk.sap_module, tk.urgency::text AS urgency, tk.created_at,
         (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = tk.client_id LIMIT 1) AS company,
         (SELECT p.display_name FROM public.profiles p WHERE p.user_id = tk.client_id LIMIT 1) AS requester
    INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket;

  res := jsonb_build_object(
    'role', r,
    'can_write', writer,
    'enabled', COALESCE((s ->> 'enabled')::boolean, false),
    'settings', CASE WHEN full_view THEN s - 'draft_model' - 'deep_model' ELSE jsonb_build_object('require_nda', s -> 'require_nda') END,
    'ticket', jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'ref', public.brd_ref(t.id), 'sap_module', t.sap_module,
                                 'urgency', t.urgency, 'company', t.company, 'requester', t.requester, 'created_at', t.created_at),
    'brd', NULL, 'versions', '[]'::jsonb, 'attachments', '[]'::jsonb, 'comments', '[]'::jsonb, 'access_log', '[]'::jsonb
  );
  IF b.id IS NULL THEN RETURN res; END IF;

  res := res || jsonb_build_object('brd', jsonb_build_object(
    'id', b.id, 'language', b.language, 'template', b.template, 'latest_version', b.latest_version, 'shared_version', b.shared_version,
    'edit_unlocked', b.edit_unlocked, 'created_at', b.created_at,
    'draft', CASE WHEN full_view THEN b.draft END,
    'draft_rev', CASE WHEN full_view THEN b.draft_rev END,
    'draft_saved_at', CASE WHEN full_view THEN b.draft_saved_at END));

  res := res || jsonb_build_object('versions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'version', v.version, 'status', v.status, 'change_note', v.change_note, 'restored_from', v.restored_from,
      'created_at', v.created_at, 'author', public.brd_person_name(v.created_by, NULL, uid),
      'archived_at', v.archived_at, 'archive_reason', CASE WHEN full_view THEN v.archive_reason END,
      'attached', public.brd_version_attached(_ticket, v.version)) ORDER BY v.version DESC)
    FROM public.ticket_brd_versions v
    WHERE v.brd_id = b.id AND (full_view OR public.brd_version_attached(_ticket, v.version))), '[]'::jsonb));

  res := res || jsonb_build_object('attachments', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'version', d.brd_version, 'file_name', d.file_name, 'file_url', d.file_url, 'file_size', d.file_size,
      'attached_at', d.created_at, 'attached_by', public.brd_person_name(d.uploaded_by, NULL, uid),
      'superseded_at', d.superseded_at, 'unattached_at', d.unattached_at) ORDER BY d.created_at DESC)
    FROM public.ticket_documents d
    WHERE d.ticket_id = _ticket AND d.doc_type = 'brd' AND (full_view OR d.unattached_at IS NULL)), '[]'::jsonb));

  res := res || jsonb_build_object('comments', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'version', c.version, 'section_key', c.section_key, 'parent_id', c.parent_id, 'kind', c.kind, 'body', c.body,
      'suggested_text', c.suggested_text, 'status', c.status, 'created_at', c.created_at, 'author_role', c.author_role,
      'mine', c.author_id = uid, 'author', public.brd_person_name(c.author_id, c.author_consultant_id, uid)) ORDER BY c.created_at)
    FROM public.ticket_brd_comments c
    WHERE c.brd_id = b.id AND (full_view OR c.author_id = uid OR public.brd_version_attached(_ticket, c.version))), '[]'::jsonb));

  res := res || jsonb_build_object('last_client_update', (
    SELECT max(v.created_at) FROM public.ticket_brd_versions v WHERE v.brd_id = b.id AND public.brd_version_attached(_ticket, v.version)));

  IF full_view THEN
    res := res || jsonb_build_object('access_log', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x ->> 'at') DESC) FROM (
        SELECT jsonb_build_object('viewer', public.brd_person_name(a.viewer_id, a.viewer_consultant_id, uid), 'role', a.viewer_role,
                                  'version', a.version, 'action', a.action, 'at', a.created_at) AS x
        FROM public.ticket_brd_access_log a WHERE a.brd_id = b.id ORDER BY a.created_at DESC LIMIT 300) q), '[]'::jsonb),
      'usage', jsonb_build_object(
        'ticket_today', (SELECT count(*) FROM public.ticket_brd_ai_usage u WHERE u.ticket_id = _ticket AND u.status <> 'refused' AND u.created_at > now() - interval '1 day'),
        'deep_today', (SELECT count(*) FROM public.ticket_brd_ai_usage u WHERE u.ticket_id = _ticket AND u.status <> 'refused' AND u.kind LIKE 'deep%' AND u.created_at > now() - interval '1 day')));
  END IF;
  RETURN res;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_get_version(_ticket uuid, _version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  v public.ticket_brd_versions;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.ticket_brd_versions WHERE ticket_id = _ticket AND version = _version;
  IF NOT FOUND THEN RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF r NOT IN ('admin', 'client') AND NOT public.brd_version_attached(_ticket, _version) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF r IN ('consultant', 'company') AND NOT EXISTS (
       SELECT 1 FROM public.ticket_brd_access_log a WHERE a.brd_id = v.brd_id AND a.viewer_id = uid AND a.version = _version
         AND a.action = 'view' AND a.created_at > now() - interval '10 minutes') THEN
    INSERT INTO public.ticket_brd_access_log (brd_id, ticket_id, version, viewer_id, viewer_role, viewer_consultant_id, action)
    VALUES (v.brd_id, _ticket, _version, uid, r, public.brd_consultant_of(uid), 'view');
  END IF;
  RETURN jsonb_build_object('version', v.version, 'status', v.status, 'change_note', v.change_note, 'created_at', v.created_at,
                            'archived_at', v.archived_at, 'content', v.content);
END
$$;

-- Downloads (and views of the PDF) are logged before the short-lived link is made.
CREATE OR REPLACE FUNCTION public.brd_log_access(_ticket uuid, _version integer, _action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  bid uuid;
BEGIN
  IF r IS NULL OR _action NOT IN ('view', 'download') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF r NOT IN ('admin', 'client') AND NOT public.brd_version_attached(_ticket, _version) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT id INTO bid FROM public.ticket_brds WHERE ticket_id = _ticket;
  IF bid IS NULL THEN RETURN false; END IF;
  IF r = 'client' THEN RETURN true; END IF; -- the owner's own opens are not interesting to the owner
  IF EXISTS (SELECT 1 FROM public.ticket_brd_access_log a WHERE a.brd_id = bid AND a.viewer_id = uid AND a.version = _version
               AND a.action = _action AND a.created_at > now() - interval '2 minutes') THEN
    RETURN true;
  END IF;
  INSERT INTO public.ticket_brd_access_log (brd_id, ticket_id, version, viewer_id, viewer_role, viewer_consultant_id, action)
  VALUES (bid, _ticket, _version, uid, r, public.brd_consultant_of(uid), _action);
  RETURN true;
END
$$;