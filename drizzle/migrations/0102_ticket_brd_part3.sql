-- ------------------------------------------------------------------------------------------------ write
CREATE OR REPLACE FUNCTION public.brd_store_draft(_ticket uuid, _uid uuid, _content jsonb, _rev integer)
RETURNS public.ticket_brds LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.ticket_brds;
  masked jsonb;
  cl uuid;
BEGIN
  PERFORM public.brd_validate_content(_content);
  masked := public.brd_mask_jsonb(_content);
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket FOR UPDATE;
  IF NOT FOUND THEN
    SELECT client_id INTO cl FROM public.tickets WHERE id = _ticket;
    INSERT INTO public.ticket_brds (ticket_id, client_id, language, template, draft, draft_rev, draft_saved_at, draft_saved_by, created_by)
    VALUES (_ticket, cl, COALESCE(masked ->> 'language', 'en'), COALESCE(masked ->> 'template', 'standard'), masked, 1, now(), _uid, _uid)
    ON CONFLICT (ticket_id) DO NOTHING
    RETURNING * INTO b;
    IF b.id IS NULL THEN RAISE EXCEPTION 'brd_draft_conflict' USING ERRCODE = '40001'; END IF;
    PERFORM public.brd_log_event(_ticket, b.id, _uid, 'create', NULL, jsonb_build_object('language', b.language, 'template', b.template));
    RETURN b;
  END IF;
  IF _rev IS NOT NULL AND _rev <> b.draft_rev THEN
    RAISE EXCEPTION 'brd_draft_conflict' USING ERRCODE = '40001', HINT = 'The document was saved in another tab or by another person. Reload to continue.';
  END IF;
  UPDATE public.ticket_brds
     SET draft = masked, language = COALESCE(masked ->> 'language', language), template = COALESCE(masked ->> 'template', template),
         draft_rev = draft_rev + 1, draft_saved_at = now(), draft_saved_by = _uid, updated_at = now()
   WHERE id = b.id RETURNING * INTO b;
  RETURN b;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_save_draft(_ticket uuid, _content jsonb, _rev integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  b := public.brd_store_draft(_ticket, uid, _content, _rev);
  RETURN jsonb_build_object('rev', b.draft_rev, 'saved_at', b.draft_saved_at, 'masked', b.draft <> _content,
                            'content', CASE WHEN b.draft <> _content THEN b.draft END);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_save_version(_ticket uuid, _content jsonb, _note text, _status text DEFAULT 'draft', _rev integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
  n integer;
  c jsonb;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _status NOT IN ('draft', 'final') THEN RAISE EXCEPTION 'brd_invalid_status' USING ERRCODE = '22023'; END IF;
  IF char_length(COALESCE(_note, '')) > 500 THEN RAISE EXCEPTION 'brd_note_too_long' USING ERRCODE = '22023'; END IF;
  c := jsonb_set(_content, '{control,status}', to_jsonb(_status), true);
  b := public.brd_store_draft(_ticket, uid, c, _rev);
  IF (SELECT count(*) FROM public.ticket_brd_versions WHERE brd_id = b.id) >= 500 THEN
    RAISE EXCEPTION 'brd_too_many_versions' USING ERRCODE = '22023';
  END IF;
  n := b.latest_version + 1;
  INSERT INTO public.ticket_brd_versions (brd_id, ticket_id, version, status, content, change_note, created_by)
  VALUES (b.id, _ticket, n, _status, b.draft, public.mask_contact_details(trim(COALESCE(_note, ''))), uid);
  UPDATE public.ticket_brds SET latest_version = n, updated_at = now() WHERE id = b.id;
  PERFORM public.brd_log_event(_ticket, b.id, uid, CASE WHEN _status = 'final' THEN 'final' ELSE 'version' END, n, '{}'::jsonb);
  RETURN jsonb_build_object('version', n, 'rev', b.draft_rev, 'status', _status, 'content', b.draft);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_restore_version(_ticket uuid, _version integer, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
  v public.ticket_brd_versions;
  n integer;
  c jsonb;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket FOR UPDATE;
  SELECT * INTO v FROM public.ticket_brd_versions WHERE brd_id = b.id AND version = _version;
  IF v.id IS NULL THEN RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002'; END IF;
  n := b.latest_version + 1;
  c := jsonb_set(v.content, '{control,status}', '"draft"', true);
  INSERT INTO public.ticket_brd_versions (brd_id, ticket_id, version, status, content, change_note, restored_from, created_by)
  VALUES (b.id, _ticket, n, 'draft', c, public.mask_contact_details(left(trim(COALESCE(_note, '')), 500)), _version, uid);
  UPDATE public.ticket_brds SET latest_version = n, draft = c, draft_rev = draft_rev + 1, draft_saved_at = now(), draft_saved_by = uid, updated_at = now()
   WHERE id = b.id RETURNING * INTO b;
  PERFORM public.brd_log_event(_ticket, b.id, uid, 'restore', n, jsonb_build_object('from', _version));
  RETURN jsonb_build_object('version', n, 'rev', b.draft_rev, 'content', c);
END
$$;

-- Soft archive (admins only, audited). Versions are never deleted.
CREATE OR REPLACE FUNCTION public.brd_archive_version(_ticket uuid, _version integer, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); bid uuid;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(trim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'brd_reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.ticket_brd_versions SET archived_at = now(), archived_by = uid, archive_reason = left(trim(_reason), 300)
   WHERE ticket_id = _ticket AND version = _version AND archived_at IS NULL RETURNING brd_id INTO bid;
  IF bid IS NULL THEN RETURN false; END IF;
  PERFORM public.brd_log_event(_ticket, bid, uid, 'archive', _version, jsonb_build_object('reason', left(trim(_reason), 300)));
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ attach
CREATE OR REPLACE FUNCTION public.brd_attach(_ticket uuid, _version integer, _path text, _size bigint, _notify boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
  v public.ticket_brd_versions;
  doc_id uuid;
  fname text;
  title text;
  rec record;
  notified integer := 0;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket FOR UPDATE;
  SELECT * INTO v FROM public.ticket_brd_versions WHERE brd_id = b.id AND version = _version;
  IF v.id IS NULL OR v.archived_at IS NOT NULL THEN RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _path IS NULL OR _path !~ ('^' || _ticket::text || '/brd/[A-Za-z0-9_.-]{1,120}\.pdf$') THEN
    RAISE EXCEPTION 'brd_invalid_path' USING ERRCODE = '22023';
  END IF;
  IF _size IS NULL OR _size < 100 OR _size > 20 * 1024 * 1024 THEN RAISE EXCEPTION 'brd_invalid_size' USING ERRCODE = '22023'; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ticket-documents' AND o.name = _path) THEN
      RAISE EXCEPTION 'brd_file_missing' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  fname := 'BRD_' || public.brd_ref(_ticket) || '_v' || _version || '_' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '.pdf';
  UPDATE public.ticket_documents SET superseded_at = now()
   WHERE ticket_id = _ticket AND doc_type = 'brd' AND superseded_at IS NULL AND unattached_at IS NULL;
  INSERT INTO public.ticket_documents (ticket_id, uploaded_by, file_name, file_url, file_size, mime_type, version, comment, doc_type, brd_version)
  VALUES (_ticket, uid, fname, _path, _size, 'application/pdf', _version, 'Business Requirements Document v' || _version, 'brd', _version)
  RETURNING id INTO doc_id;
  UPDATE public.ticket_brds SET shared_version = _version, updated_at = now() WHERE id = b.id;
  PERFORM public.brd_log_event(_ticket, b.id, uid, 'attach', _version, jsonb_build_object('document_id', doc_id, 'notify', COALESCE(_notify, false)));

  IF COALESCE(_notify, false) THEN
    SELECT tk.title INTO title FROM public.tickets tk WHERE tk.id = _ticket;
    FOR rec IN SELECT * FROM public.brd_consultant_readers(_ticket) LOOP
      PERFORM public.safe_insert_notification(rec.user_id,
        'BRD v' || _version || ' attached',
        'BRD v' || _version || ' was attached to "' || left(COALESCE(title, 'your ticket'), 120) || '".',
        'brd', '/consultant/cases/' || _ticket || '/brd');
      INSERT INTO public.ticket_brd_notices (document_id, ticket_id, user_id, version, created_by)
      VALUES (doc_id, _ticket, rec.user_id, _version, uid) ON CONFLICT DO NOTHING;
      notified := notified + 1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('document_id', doc_id, 'file_name', fname, 'notified', notified);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_unattach(_document_id uuid, _reason text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  d public.ticket_documents;
  prev uuid;
  prev_version integer;
BEGIN
  SELECT * INTO d FROM public.ticket_documents WHERE id = _document_id AND doc_type = 'brd' FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'brd_document_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.brd_can_write_for(d.ticket_id, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF d.unattached_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.ticket_documents SET unattached_at = now(), unattached_by = uid WHERE id = d.id;
  IF d.superseded_at IS NULL THEN
    -- The current one was removed: the newest remaining attachment becomes current again.
    SELECT id, brd_version INTO prev, prev_version FROM public.ticket_documents
     WHERE ticket_id = d.ticket_id AND doc_type = 'brd' AND unattached_at IS NULL AND id <> d.id
     ORDER BY created_at DESC LIMIT 1;
    IF prev IS NOT NULL THEN UPDATE public.ticket_documents SET superseded_at = NULL WHERE id = prev; END IF;
    UPDATE public.ticket_brds SET shared_version = prev_version, updated_at = now() WHERE ticket_id = d.ticket_id;
  END IF;
  PERFORM public.brd_log_event(d.ticket_id, (SELECT id FROM public.ticket_brds WHERE ticket_id = d.ticket_id), uid, 'unattach', d.brd_version,
                               jsonb_build_object('document_id', d.id, 'reason', left(trim(COALESCE(_reason, '')), 300)));
  RETURN true;
END
$$;

-- E-mail part of the "notify the consultant" tick: the ticket-brd function claims each notice once.
CREATE OR REPLACE FUNCTION public.brd_claim_notices(_document_id uuid, _caller uuid)
RETURNS TABLE (user_id uuid, version integer, ticket_id uuid, ticket_title text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.ticket_documents;
BEGIN
  SELECT * INTO d FROM public.ticket_documents WHERE id = _document_id AND doc_type = 'brd';
  IF d.id IS NULL OR NOT (d.uploaded_by = _caller OR public.brd_is_admin(_caller)) THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.ticket_brd_notices n SET emailed_at = now()
     WHERE n.document_id = _document_id AND n.emailed_at IS NULL AND n.created_at > now() - interval '1 hour'
       AND public.brd_role_for(n.ticket_id, n.user_id) = 'consultant'
    RETURNING n.user_id, n.version, n.ticket_id, (SELECT tk.title FROM public.tickets tk WHERE tk.id = n.ticket_id);
END
$$;

-- ------------------------------------------------------------------------------------------------ comments
CREATE OR REPLACE FUNCTION public.brd_add_comment(_ticket uuid, _version integer, _section text, _body text,
  _parent uuid DEFAULT NULL, _kind text DEFAULT 'comment', _suggested text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  b public.ticket_brds;
  cid uuid;
  par public.ticket_brd_comments;
  new_id uuid;
  cap integer := COALESCE((public.brd_settings() ->> 'comments_per_user_per_day')::integer, 60);
  ttl text;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket;
  IF b.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.ticket_brd_versions WHERE brd_id = b.id AND version = _version) THEN
    RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r NOT IN ('admin', 'client') AND NOT public.brd_version_attached(_ticket, _version) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _section IS NULL OR _section NOT IN ('general', 'control', 'purpose', 'objectives', 'scope', 'current_future', 'stakeholders', 'functional',
       'non_functional', 'sap_landscape', 'data_migration', 'assumptions', 'risks', 'testing', 'timeline', 'open_questions', 'attachments', 'change_log') THEN
    RAISE EXCEPTION 'brd_invalid_section' USING ERRCODE = '22023';
  END IF;
  IF _kind NOT IN ('comment', 'suggestion') OR (_kind = 'suggestion' AND r NOT IN ('consultant', 'admin', 'company')) THEN
    RAISE EXCEPTION 'brd_invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(COALESCE(_body, ''))) = 0 OR char_length(_body) > 4000 OR char_length(COALESCE(_suggested, '')) > 20000
     OR (_kind = 'suggestion' AND char_length(trim(COALESCE(_suggested, ''))) = 0) THEN
    RAISE EXCEPTION 'brd_invalid_comment' USING ERRCODE = '22023';
  END IF;
  IF public.contact_details_in_text(_body) OR public.contact_details_in_text(_suggested) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.ticket_brd_comments WHERE author_id = uid AND created_at > now() - interval '1 day') >= cap THEN
    RAISE EXCEPTION 'brd_comment_limit' USING ERRCODE = '54000';
  END IF;
  IF _parent IS NOT NULL THEN
    SELECT * INTO par FROM public.ticket_brd_comments WHERE id = _parent AND brd_id = b.id;
    IF par.id IS NULL THEN RAISE EXCEPTION 'brd_invalid_parent' USING ERRCODE = '22023'; END IF;
  END IF;
  cid := CASE WHEN r = 'consultant' THEN public.brd_consultant_of(uid) END;
  INSERT INTO public.ticket_brd_comments (brd_id, ticket_id, version, section_key, parent_id, author_id, author_role, author_consultant_id, kind, body, suggested_text)
  VALUES (b.id, _ticket, _version, _section, _parent, uid, r, cid, _kind, trim(_body), NULLIF(trim(COALESCE(_suggested, '')), ''))
  RETURNING id INTO new_id;
  PERFORM public.brd_log_event(_ticket, b.id, uid, CASE WHEN _kind = 'suggestion' THEN 'suggestion' ELSE 'comment' END, _version, jsonb_build_object('comment_id', new_id, 'section', _section));

  SELECT title INTO ttl FROM public.tickets WHERE id = _ticket;
  IF r IN ('consultant', 'company') THEN
    PERFORM public.safe_insert_notification(b.client_id,
      CASE WHEN _kind = 'suggestion' THEN 'Suggested change on your BRD' ELSE 'New comment on your BRD' END,
      'On "' || left(COALESCE(ttl, 'your ticket'), 120) || '", BRD v' || _version || '.', 'brd', '/client/tickets/' || _ticket || '/brd');
  ELSIF par.id IS NOT NULL AND par.author_role = 'consultant' AND par.author_id <> uid THEN
    PERFORM public.safe_insert_notification(par.author_id, 'Reply on the BRD',
      'The client replied on "' || left(COALESCE(ttl, 'the ticket'), 120) || '", BRD v' || _version || '.', 'brd', '/consultant/cases/' || _ticket || '/brd');
  END IF;
  RETURN new_id;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_set_comment_status(_comment uuid, _status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.ticket_brd_comments;
BEGIN
  SELECT * INTO c FROM public.ticket_brd_comments WHERE id = _comment;
  IF c.id IS NULL THEN RAISE EXCEPTION 'brd_comment_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _status NOT IN ('open', 'resolved', 'accepted', 'declined') THEN RAISE EXCEPTION 'brd_invalid_status' USING ERRCODE = '22023'; END IF;
  IF NOT public.brd_can_write_for(c.ticket_id, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.ticket_brd_comments SET status = _status, status_by = uid, status_at = now() WHERE id = c.id;
  PERFORM public.brd_log_event(c.ticket_id, c.brd_id, uid, 'comment_' || _status, c.version, jsonb_build_object('comment_id', c.id));
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ AI limits (service role)
CREATE OR REPLACE FUNCTION public.brd_ai_claim(_ticket uuid, _actor uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.brd_settings();
  cl uuid;
  n_ticket integer;
  n_client integer;
  n_deep integer;
  reason text;
  new_id uuid;
  deep boolean := _kind LIKE 'deep%';
BEGIN
  IF _kind NOT IN ('draft', 'section', 'improve', 'shorter', 'deep_draft', 'deep_section') THEN RAISE EXCEPTION 'brd_invalid_kind' USING ERRCODE = '22023'; END IF;
  IF NOT public.brd_can_write_for(_ticket, _actor) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('brd_ai:' || _ticket::text));
  SELECT client_id INTO cl FROM public.tickets WHERE id = _ticket;
  SELECT count(*) INTO n_ticket FROM public.ticket_brd_ai_usage WHERE ticket_id = _ticket AND status <> 'refused' AND created_at > now() - interval '1 day';
  SELECT count(*) INTO n_client FROM public.ticket_brd_ai_usage WHERE client_id = cl AND status <> 'refused' AND created_at > now() - interval '1 day';
  SELECT count(*) INTO n_deep FROM public.ticket_brd_ai_usage WHERE ticket_id = _ticket AND status <> 'refused' AND kind LIKE 'deep%' AND created_at > now() - interval '1 day';
  IF n_ticket >= COALESCE((s ->> 'ai_calls_per_ticket_per_day')::integer, 12) THEN reason := 'ticket_limit';
  ELSIF n_client >= COALESCE((s ->> 'ai_calls_per_client_per_day')::integer, 40) THEN reason := 'client_limit';
  ELSIF deep AND n_deep >= COALESCE((s ->> 'deep_calls_per_ticket_per_day')::integer, 3) THEN reason := 'deep_limit';
  END IF;
  INSERT INTO public.ticket_brd_ai_usage (ticket_id, client_id, actor_id, kind, model, status, reason)
  VALUES (_ticket, cl, _actor, _kind, CASE WHEN deep THEN s ->> 'deep_model' ELSE s ->> 'draft_model' END,
          CASE WHEN reason IS NULL THEN 'running' ELSE 'refused' END, reason)
  RETURNING id INTO new_id;
  IF reason IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', reason); END IF;
  RETURN jsonb_build_object('ok', true, 'id', new_id, 'model', CASE WHEN deep THEN s ->> 'deep_model' ELSE s ->> 'draft_model' END,
                            'max_attachments', COALESCE((s ->> 'max_attachments')::integer, 3),
                            'max_attachment_chars', COALESCE((s ->> 'max_attachment_chars')::integer, 6000));
END
$$;

CREATE OR REPLACE FUNCTION public.brd_ai_finish(_id uuid, _status text, _input integer, _output integer, _reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ticket_brd_ai_usage
     SET status = CASE WHEN _status IN ('ok', 'failed') THEN _status ELSE 'failed' END,
         input_tokens = GREATEST(0, COALESCE(_input, 0)), output_tokens = GREATEST(0, COALESCE(_output, 0)),
         reason = left(_reason, 120), finished_at = now()
   WHERE id = _id AND status = 'running'
$$;

-- ------------------------------------------------------------------------------------------------ admin
CREATE OR REPLACE FUNCTION public.admin_brd_set_settings(_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  before jsonb := public.brd_settings();
  merged jsonb := public.brd_settings();
  k text;
  v jsonb;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _value IS NULL OR jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'brd_invalid_settings' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(_value) LOOP
    IF k IN ('enabled', 'require_nda') THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023'; END IF;
    ELSIF k IN ('ai_calls_per_ticket_per_day', 'ai_calls_per_client_per_day', 'deep_calls_per_ticket_per_day', 'max_attachments', 'max_attachment_chars', 'comments_per_user_per_day') THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         OR (v #>> '{}')::integer < 0
         OR (k = 'max_attachment_chars' AND (v #>> '{}')::integer > 20000)
         OR (k = 'max_attachments' AND (v #>> '{}')::integer > 10)
         OR (k LIKE '%per_day' AND (v #>> '{}')::integer > 1000) THEN
        RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSIF k IN ('draft_model', 'deep_model') THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^(openai|google)/[a-z0-9][a-z0-9.-]{1,60}$' THEN
        RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'brd_unknown_setting %', k USING ERRCODE = '22023';
    END IF;
    merged := merged || jsonb_build_object(k, v);
  END LOOP;
  INSERT INTO public.platform_settings (key, value) VALUES ('ticket_brd', merged)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (uid, 'brd_settings_changed', 'platform_settings', NULL, jsonb_build_object('before', before, 'after', merged));
  RETURN merged;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_brd_unlock(_ticket uuid, _unlocked boolean, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); bid uuid;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(trim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'brd_reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.ticket_brds SET edit_unlocked = COALESCE(_unlocked, false), updated_at = now() WHERE ticket_id = _ticket RETURNING id INTO bid;
  IF bid IS NULL THEN RETURN false; END IF;
  PERFORM public.brd_log_event(_ticket, bid, uid, CASE WHEN _unlocked THEN 'reopen' ELSE 'relock' END, NULL, jsonb_build_object('reason', left(trim(_reason), 300)));
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_brd_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.brd_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.brd_settings(),
    'documents', (SELECT count(*) FROM public.ticket_brds),
    'versions', (SELECT count(*) FROM public.ticket_brd_versions),
    'attached', (SELECT count(*) FROM public.ticket_documents WHERE doc_type = 'brd' AND unattached_at IS NULL),
    'ai_today', (SELECT count(*) FROM public.ticket_brd_ai_usage WHERE status <> 'refused' AND created_at > now() - interval '1 day'),
    'ai_refused_today', (SELECT count(*) FROM public.ticket_brd_ai_usage WHERE status = 'refused' AND created_at > now() - interval '1 day'),
    'tokens_30d', jsonb_build_object(
      'input', (SELECT COALESCE(sum(input_tokens), 0) FROM public.ticket_brd_ai_usage WHERE created_at > now() - interval '30 days'),
      'output', (SELECT COALESCE(sum(output_tokens), 0) FROM public.ticket_brd_ai_usage WHERE created_at > now() - interval '30 days')),
    'by_model_30d', COALESCE((SELECT jsonb_object_agg(model, n) FROM (
        SELECT model, count(*) AS n FROM public.ticket_brd_ai_usage WHERE status = 'ok' AND created_at > now() - interval '30 days' GROUP BY model) m), '{}'::jsonb)
  );
END
$$;

-- ------------------------------------------------------------------------------------------------ function grants
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'brd_default_settings()', 'brd_settings()', 'brd_is_admin(uuid)', 'brd_role_for(uuid, uuid)', 'brd_role(uuid)', 'brd_can_write_for(uuid, uuid)',
    'brd_version_attached(uuid, integer)', 'brd_doc_visible(uuid, timestamptz)', 'brd_ticket_of_path(text)', 'brd_file_readable(text)',
    'brd_storage_can_insert(text)', 'brd_mask_jsonb(jsonb)', 'brd_validate_content(jsonb)', 'brd_log_event(uuid, uuid, uuid, text, integer, jsonb)',
    'brd_ref(uuid)', 'brd_person_name(uuid, uuid, uuid)', 'brd_consultant_of(uuid)', 'brd_consultant_readers(uuid)', 'brd_store_draft(uuid, uuid, jsonb, integer)',
    'brd_get(uuid)', 'brd_get_version(uuid, integer)', 'brd_log_access(uuid, integer, text)', 'brd_save_draft(uuid, jsonb, integer)',
    'brd_save_version(uuid, jsonb, text, text, integer)', 'brd_restore_version(uuid, integer, text)', 'brd_archive_version(uuid, integer, text)',
    'brd_attach(uuid, integer, text, bigint, boolean)', 'brd_unattach(uuid, text)', 'brd_claim_notices(uuid, uuid)',
    'brd_add_comment(uuid, integer, text, text, uuid, text, text)', 'brd_set_comment_status(uuid, text)', 'brd_ai_claim(uuid, uuid, text)',
    'brd_ai_finish(uuid, text, integer, integer, text)', 'admin_brd_set_settings(jsonb)', 'admin_brd_unlock(uuid, boolean, text)', 'admin_brd_overview()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- Signed-in browser entry points (each checks the caller itself). Policy helpers must be callable by the
  -- roles whose queries evaluate them.
  FOREACH f IN ARRAY ARRAY[
    'brd_settings()', 'brd_role(uuid)', 'brd_doc_visible(uuid, timestamptz)', 'brd_file_readable(text)', 'brd_storage_can_insert(text)',
    'brd_get(uuid)', 'brd_get_version(uuid, integer)', 'brd_log_access(uuid, integer, text)', 'brd_save_draft(uuid, jsonb, integer)',
    'brd_save_version(uuid, jsonb, text, text, integer)', 'brd_restore_version(uuid, integer, text)', 'brd_archive_version(uuid, integer, text)',
    'brd_attach(uuid, integer, text, bigint, boolean)', 'brd_unattach(uuid, text)', 'brd_add_comment(uuid, integer, text, text, uuid, text, text)',
    'brd_set_comment_status(uuid, text)', 'admin_brd_set_settings(jsonb)', 'admin_brd_unlock(uuid, boolean, text)', 'admin_brd_overview()'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- brd_ticket_of_path is IMMUTABLE and harmless; anon evaluates the restrictive storage policy too.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_ticket_of_path(text) TO anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_file_readable(text) TO anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_storage_can_insert(text) TO anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_doc_visible(uuid, timestamptz) TO anon';
END $$;