-- ------------------------------------------------------------------------------------------------ reads
CREATE OR REPLACE FUNCTION public.sa_month_hours(_id uuid, _month date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(l.hours), 0) FROM public.ticket_work_logs l
    JOIN public.sa_tickets st ON st.ticket_id = l.ticket_id AND st.agreement_id = _id
    JOIN public.ticket_timesheet_submissions s ON s.id = l.submission_id AND s.status = 'approved'
   WHERE COALESCE(l.billable, true) AND date_trunc('month', COALESCE(l.work_date, l.created_at::date)) = date_trunc('month', _month)
$$;

CREATE OR REPLACE FUNCTION public.sa_usage(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; m date := date_trunc('month', current_date)::date; last public.sa_months; sla jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  SELECT * INTO last FROM public.sa_months WHERE agreement_id = _id ORDER BY month DESC LIMIT 1;
  IF to_regclass('public.sla_ticket_clocks') IS NOT NULL THEN
    EXECUTE $q$SELECT jsonb_build_object('measured', count(*), 'met', count(*) FILTER (WHERE c.breached_at IS NULL),
               'pct', round(100.0 * count(*) FILTER (WHERE c.breached_at IS NULL) / NULLIF(count(*), 0), 1))
          FROM public.sla_ticket_clocks c JOIN public.sa_tickets st ON st.ticket_id = c.ticket_id WHERE st.agreement_id = $1 AND c.met_at IS NOT NULL$q$
      INTO sla USING _id;
  END IF;
  RETURN jsonb_build_object(
    'month', m, 'used_hours', public.sa_month_hours(_id, m),
    'committed', CASE WHEN a.terms ->> 'model' = 'hours_bank' THEN (a.terms -> 'bank' ->> 'hours_per_month')::numeric END,
    'capacity_hours_per_week', CASE WHEN a.terms ->> 'model' = 'availability' THEN (a.terms ->> 'capacity_hours_per_week')::numeric END,
    'rollover_balance', COALESCE((SELECT sum((e ->> 'hours')::numeric) FROM jsonb_array_elements(last.carried_out) e), 0),
    'sla', sla, 'end_date', a.end_date, 'termination_end', a.termination_end,
    'tickets', (SELECT count(*) FROM public.sa_tickets st WHERE st.agreement_id = _id),
    'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', left(t.title, 120), 'status', t.status, 'created_at', t.created_at) ORDER BY t.created_at DESC)
                 FROM (SELECT tk.* FROM public.tickets tk JOIN public.sa_tickets st ON st.ticket_id = tk.id WHERE st.agreement_id = _id ORDER BY tk.created_at DESC LIMIT 10) t), '[]'::jsonb),
    'spend', COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.status::text = 'completed'
                        AND (p.ticket_id IN (SELECT st.ticket_id FROM public.sa_tickets st WHERE st.agreement_id = _id) OR p.reference LIKE 'agreement:' || _id || ':%')), 0),
    'months', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'agreement_id' ORDER BY x.month DESC) FROM (SELECT * FROM public.sa_months WHERE agreement_id = _id ORDER BY month DESC LIMIT 12) x), '[]'::jsonb));
END $$;

-- Full view of one agreement for the viewer's role. Rates and acceptances only for the parties and admins;
-- applicants see the request and their own application only; other applicants' rates are never returned.
CREATE OR REPLACE FUNCTION public.sa_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role(_id, uid); a public.sa_agreements; cid uuid := public.sa_consultant_of(uid); party boolean; base jsonb; s jsonb := public.sa_settings();
  dr text := public.sa_doc_access_role(_id, uid);
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  party := r IN ('admin', 'client', 'client_member', 'lead', 'team');
  base := jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'status', a.status, 'role', r, 'request', a.request - CASE WHEN party OR COALESCE((a.request ->> 'show_budget')::boolean, false) THEN '' ELSE 'budget' END,
    'modules', to_jsonb(public.sa_modules(a)), 'deadline', a.deadline, 'invite_only', a.invite_only, 'legal_draft', COALESCE((s ->> 'draft_legal_flag')::boolean, true),
    'created_at', a.created_at,
    'terms_public', jsonb_build_object('model', a.terms ->> 'model', 'term', a.terms -> 'term', 'sla', a.terms -> 'sla', 'scope', a.terms -> 'scope', 'bank', a.terms -> 'bank',
                                       'capacity_hours_per_week', a.terms -> 'capacity_hours_per_week', 'nda_required', a.terms -> 'nda_required'));
  IF NOT party THEN
    RETURN base || jsonb_build_object('my_application', (SELECT to_jsonb(p) - 'user_id' FROM public.sa_applications p WHERE p.agreement_id = _id AND p.consultant_id = cid),
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', m.sender_role, 'body', m.body, 'at', m.created_at) ORDER BY m.created_at)
                    FROM public.sa_messages m WHERE m.agreement_id = _id AND m.consultant_id = cid), '[]'::jsonb));
  END IF;
  RETURN base || jsonb_build_object(
    'terms', a.terms, 'version', a.version, 'content_hash', (SELECT v.content_hash FROM public.sa_versions v WHERE v.agreement_id = _id AND v.version = a.version),
    'client_id', a.client_id,   -- crew members need it for the NDA signing dialog (same as on ticket requests)
    'consultant_id', a.consultant_id, 'consultant_name', CASE WHEN a.consultant_id IS NOT NULL THEN public.consultant_public_name(a.consultant_id) END, 'admin_review', a.admin_review, 'agreed_at', a.agreed_at, 'started_at', a.started_at, 'start_date', a.start_date, 'end_date', a.end_date,
    'auto_renew', jsonb_build_object('client', a.auto_renew_client_at IS NOT NULL, 'consultant', a.auto_renew_consultant_at IS NOT NULL),
    'termination', CASE WHEN a.termination_end IS NOT NULL THEN jsonb_build_object('by', a.termination_requested_by, 'reason', a.termination_reason, 'end', a.termination_end,
                     'handover_until', a.handover_until, 'handover_note', a.handover_note) END,
    'suspended_until', a.suspended_until, 'nda_ok', CASE WHEN a.consultant_id IS NOT NULL THEN public.sa_nda_ok(a) END,
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'hash', v.content_hash, 'note', v.note, 'at', v.created_at) ORDER BY v.version DESC) FROM public.sa_versions v WHERE v.agreement_id = _id), '[]'::jsonb),
    'acceptances', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', x.version, 'party', x.party, 'name', x.typed_name, 'at', x.accepted_at, 'hash', x.content_hash, 'legal_draft', x.legal_draft) ORDER BY x.accepted_at) FROM public.sa_acceptances x WHERE x.agreement_id = _id), '[]'::jsonb),
    'member_acceptances', COALESCE((SELECT jsonb_agg(jsonb_build_object('consultant_id', x.consultant_id, 'name', public.consultant_public_name(x.consultant_id), 'role', x.member_role,
                     'typed_name', x.typed_name, 'sla_version', x.sla_version, 'sla_hash', x.sla_hash, 'terms_version', x.terms_version, 'at', x.accepted_at) ORDER BY x.accepted_at)
                   FROM public.sa_member_acceptances x WHERE x.agreement_id = _id), '[]'::jsonb),
    'rates', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'agreement_id' - 'proposed_by' - 'accepted_by' ORDER BY x.seq) FROM public.sa_rate_records x WHERE x.agreement_id = _id), '[]'::jsonb),
    'rate_in_force', (SELECT to_jsonb(x) - 'agreement_id' - 'proposed_by' - 'accepted_by' FROM public.sa_rate_on(_id, current_date) x WHERE x.id IS NOT NULL),
    'rate_changes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'by', c.proposed_role, 'hourly_rate', c.hourly_rate, 's1_multiplier', c.s1_multiplier, 'overage_rate', c.overage_rate,
                     'effective_from', c.effective_from, 'reason', c.reason, 'status', c.status, 'at', c.created_at) ORDER BY c.created_at DESC) FROM public.sa_rate_changes c WHERE c.agreement_id = _id), '[]'::jsonb),
    'offers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'by', o.by_role, 'patch', o.patch, 'note', o.note, 'status', o.status, 'at', o.created_at) ORDER BY o.created_at DESC) FROM public.sa_offers o WHERE o.agreement_id = _id), '[]'::jsonb),
    'applications', CASE WHEN r IN ('admin', 'client', 'client_member') THEN COALESCE((SELECT jsonb_agg((to_jsonb(p) - 'user_id') || jsonb_build_object('name', public.consultant_public_name(p.consultant_id)) ORDER BY p.created_at) FROM public.sa_applications p WHERE p.agreement_id = _id), '[]'::jsonb) END,
    'confirmation', public.sa_confirmation(_id),
    'members', COALESCE(public.sa_confirmation(_id) -> 'members', '[]'::jsonb),
    'my_member', (SELECT jsonb_build_object('consultant_id', m.consultant_id, 'role', m.member_role, 'status', m.status, 'required', m.required, 'capacity_hours_per_week', m.capacity_hours_per_week,
                    'working_hours', m.working_hours, 'backup_for', m.backup_for, 'sla_accepted_at', m.sla_accepted_at)
                  FROM public.sa_members m WHERE m.agreement_id = _id AND m.consultant_id = cid AND m.status IN ('invited', 'active') LIMIT 1),
    'replacement', (SELECT jsonb_build_object('id', x.id, 'status', x.status, 'to', x.to_consultant, 'reason', x.reason) FROM public.sa_replacements x WHERE x.agreement_id = _id AND x.status IN ('pending_admin', 'pending_consultant') LIMIT 1),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'role', e.actor_role, 'data', e.data, 'at', e.created_at) ORDER BY e.created_at DESC) FROM (SELECT * FROM public.sa_events WHERE agreement_id = _id ORDER BY created_at DESC LIMIT 100) e), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('consultant_id', m.consultant_id, 'role', m.sender_role, 'body', m.body, 'at', m.created_at) ORDER BY m.created_at)
                  FROM public.sa_messages m WHERE m.agreement_id = _id AND (r IN ('admin', 'client', 'client_member') OR m.consultant_id = cid)), '[]'::jsonb),
    'usage', CASE WHEN a.status IN ('active', 'suspended', 'renewal_due', 'expired', 'terminated', 'archived') THEN public.sa_usage(_id) END,
    -- Agreement documents: same NDA gate as ticket documents; consultants without an active place + NDA see only that they are locked.
    'documents_locked', dr IS NULL,
    'can_upload', dr IN ('client', 'lead', 'team') AND a.status <> 'archived',
    'documents', CASE WHEN dr IS NOT NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'current_version', d.current_version,
                     'archived_at', d.archived_at, 'created_at', d.created_at,
                     'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'file_name', v.file_name, 'mime_type', v.mime_type, 'size_bytes', v.size_bytes,
                                   'note', v.note, 'by_role', v.uploaded_role, 'by', public.sa_user_label(v.uploaded_by), 'at', v.uploaded_at) ORDER BY v.version DESC)
                                 FROM public.sa_document_versions v WHERE v.document_id = d.id), '[]'::jsonb)) ORDER BY d.created_at)
                   FROM public.sa_documents d WHERE d.agreement_id = _id), '[]'::jsonb) END,
    'downloads', CASE WHEN dr IN ('admin', 'client', 'lead') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('document_id', l.document_id, 'version', l.version, 'role', l.actor_role,
                     'by', public.sa_user_label(l.user_id), 'at', l.created_at) ORDER BY l.created_at DESC)
                   FROM (SELECT * FROM public.sa_document_access x WHERE x.agreement_id = _id ORDER BY x.created_at DESC LIMIT 100) l), '[]'::jsonb) END,
    'fees', jsonb_build_object('service_fee_percent', public.sa_service_fee_percent(), 'processing_fee_percent', public.payment_processing_fee_percent(), 'vat_percent', public.payment_vat_percent()));
END $$;

-- ------------------------------------------------------------------------------------------------ agreement documents
-- Private bucket 'agreement-documents', names <agreement>/<upload>/<file>. Allowed: PDF, DOCX, XLSX, PNG, JPEG, WebP up
-- to doc_max_mb (default 20 MB). Readers: the client company, admins, and crew members with an ACTIVE place and the NDA
-- signed by both sides (when the agreement requires an NDA) - the same NDA gate as ticket documents. Uploads: client,
-- lead and active crew. Files are never replaced or deleted (new versions only); every download is logged first and the
-- storage read policy only lets a file be opened right after its logged request (sa_document_open).
CREATE OR REPLACE FUNCTION public.sa_doc_access_role(_agreement uuid, _uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r text := public.sa_role(_agreement, _uid); a public.sa_agreements; cid uuid;
BEGIN
  IF r IN ('admin', 'client', 'client_member') THEN RETURN r; END IF;
  IF r IS NULL OR r NOT IN ('lead', 'team') THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _agreement;
  cid := public.sa_consultant_of(_uid);
  IF NOT EXISTS (SELECT 1 FROM public.sa_members m WHERE m.agreement_id = _agreement AND m.consultant_id = cid AND m.status = 'active') THEN RETURN NULL; END IF;
  IF COALESCE((a.terms ->> 'nda_required')::boolean, true) AND NOT public.sa_member_nda_ok(a.client_id, cid) THEN RETURN NULL; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.sa_doc_type_ok(_file text, _mime text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(COALESCE(substring(_file from '\.([A-Za-z0-9]+)$'), ''))
    WHEN 'pdf' THEN lower(COALESCE(_mime, '')) = 'application/pdf'
    WHEN 'docx' THEN lower(COALESCE(_mime, '')) = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'xlsx' THEN lower(COALESCE(_mime, '')) = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN 'png' THEN lower(COALESCE(_mime, '')) = 'image/png'
    WHEN 'jpg' THEN lower(COALESCE(_mime, '')) = 'image/jpeg'
    WHEN 'jpeg' THEN lower(COALESCE(_mime, '')) = 'image/jpeg'
    WHEN 'webp' THEN lower(COALESCE(_mime, '')) = 'image/webp'
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.sa_doc_path_agreement(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN split_part(COALESCE(_name, ''), '/', 1)::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- Storage checks (called by the storage.objects policies below).
CREATE OR REPLACE FUNCTION public.sa_doc_storage_insert_ok(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.sa_document_uploads u WHERE u.storage_path = _name AND u.user_id = auth.uid()
                                              AND u.finished_at IS NULL AND u.expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.sa_doc_storage_read_ok(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.sa_document_access l WHERE l.storage_path = _name AND l.user_id = auth.uid() AND l.created_at > now() - interval '2 minutes')
     AND public.sa_doc_access_role(public.sa_doc_path_agreement(_name), auth.uid()) IS NOT NULL
$$;

-- Step 1 of an upload: checks (role, type, size, title/note filters, "contains no passwords" confirmation) and a
-- one-time storage name valid for 15 minutes.
CREATE OR REPLACE FUNCTION public.sa_document_begin_upload(_agreement uuid, _document uuid, _kind text, _title text, _file_name text, _mime text, _size bigint, _note text, _no_secrets boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_doc_access_role(_agreement, uid); a public.sa_agreements; d public.sa_documents; s jsonb := public.sa_settings();
  up uuid := gen_random_uuid(); path text; k text := _kind; ti text := btrim(COALESCE(_title, '')); txt text;
BEGIN
  IF NOT public.sa_enabled() THEN RAISE EXCEPTION 'sa_disabled' USING ERRCODE = '55000'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _agreement;
  IF a.id IS NULL OR r IS NULL OR r NOT IN ('client', 'lead', 'team') OR a.status = 'archived' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _no_secrets IS NOT TRUE THEN RAISE EXCEPTION 'sa_no_secrets_confirm' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_rate_ok('sa_doc:' || uid, 30, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF NOT public.sa_doc_type_ok(_file_name, _mime) THEN RAISE EXCEPTION 'sa_doc_type' USING ERRCODE = '22023'; END IF;
  IF _size IS NULL OR _size <= 0 OR _size > COALESCE((s ->> 'doc_max_mb')::numeric, 20) * 1048576 THEN RAISE EXCEPTION 'sa_doc_size' USING ERRCODE = '22023'; END IF;
  IF _document IS NOT NULL THEN
    SELECT * INTO d FROM public.sa_documents x WHERE x.id = _document AND x.agreement_id = _agreement AND x.archived_at IS NULL;
    IF d.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
    k := d.kind; ti := d.title;
  ELSE
    IF COALESCE(k, '') NOT IN ('sow', 'scope_annex', 'access_plan', 'escalation_matrix', 'other') THEN RAISE EXCEPTION 'sa_doc_kind' USING ERRCODE = '22023'; END IF;
    IF char_length(ti) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'sa_doc_title' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM public.sa_documents x WHERE x.agreement_id = _agreement) >= COALESCE((s ->> 'docs_per_agreement')::int, 50) THEN RAISE EXCEPTION 'sa_doc_limit' USING ERRCODE = '55000'; END IF;
  END IF;
  txt := concat_ws(' ', ti, _note, _file_name);
  IF NOT public.sa_text_ok(txt) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_secret_ok(txt) THEN RAISE EXCEPTION 'sa_secret_details' USING ERRCODE = '22023'; END IF;
  path := _agreement || '/' || up || '/' || left(regexp_replace(_file_name, '[^A-Za-z0-9._-]+', '_', 'g'), 100);
  INSERT INTO public.sa_document_uploads (id, agreement_id, document_id, kind, title, storage_path, file_name, mime_type, size_bytes, note, user_id, expires_at)
  VALUES (up, _agreement, _document, k, ti, path, left(_file_name, 200), lower(_mime), _size, left(COALESCE(_note, ''), 500), uid, now() + interval '15 minutes');
  RETURN jsonb_build_object('upload_id', up, 'bucket', 'agreement-documents', 'path', path);
END $$;

-- Step 2: the file is in storage (checked with its stored size and type) -> new document or new version, timeline, notice.
CREATE OR REPLACE FUNCTION public.sa_document_finish_upload(_upload uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); u public.sa_document_uploads; r text; did uuid; v int; found_obj boolean := true; sz bigint; mt text; s jsonb := public.sa_settings(); a public.sa_agreements;
BEGIN
  SELECT * INTO u FROM public.sa_document_uploads x WHERE x.id = _upload AND x.user_id = uid FOR UPDATE;
  IF u.id IS NULL OR u.finished_at IS NOT NULL OR u.expires_at < now() THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  r := public.sa_doc_access_role(u.agreement_id, uid);
  IF r IS NULL OR r NOT IN ('client', 'lead', 'team') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'SELECT true, (o.metadata ->> ''size'')::bigint, o.metadata ->> ''mimetype'' FROM storage.objects o WHERE o.bucket_id = ''agreement-documents'' AND o.name = $1'
      INTO found_obj, sz, mt USING u.storage_path;
    IF found_obj IS NOT TRUE THEN RAISE EXCEPTION 'sa_doc_missing' USING ERRCODE = 'P0002'; END IF;
    IF sz IS NOT NULL AND sz > COALESCE((s ->> 'doc_max_mb')::numeric, 20) * 1048576 THEN RAISE EXCEPTION 'sa_doc_size' USING ERRCODE = '22023'; END IF;
    IF mt IS NOT NULL AND NOT public.sa_doc_type_ok(u.file_name, mt) THEN RAISE EXCEPTION 'sa_doc_type' USING ERRCODE = '22023'; END IF;
  END IF;
  IF u.document_id IS NULL THEN
    INSERT INTO public.sa_documents (agreement_id, kind, title, current_version, created_by) VALUES (u.agreement_id, u.kind, u.title, 1, uid) RETURNING id INTO did;
    v := 1;
  ELSE
    UPDATE public.sa_documents SET current_version = current_version + 1 WHERE id = u.document_id AND archived_at IS NULL RETURNING id, current_version INTO did, v;
    IF did IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  INSERT INTO public.sa_document_versions (document_id, version, agreement_id, storage_path, file_name, mime_type, size_bytes, note, uploaded_by, uploaded_role)
  VALUES (did, v, u.agreement_id, u.storage_path, u.file_name, u.mime_type, COALESCE(sz, u.size_bytes), u.note, uid, r);
  UPDATE public.sa_document_uploads SET finished_at = now() WHERE id = u.id;
  PERFORM public.sa_event(u.agreement_id, 'document_uploaded', uid, jsonb_build_object('document', did, 'version', v, 'kind', u.kind, 'title', u.title));
  PERFORM public.sa_audit_log(uid, 'document_uploaded', u.agreement_id, jsonb_build_object('document', did, 'version', v));
  SELECT * INTO a FROM public.sa_agreements WHERE id = u.agreement_id;
  PERFORM public.sa_notify_parties(u.agreement_id, 'New agreement document: ' || a.name, 'مستند جديد للاتفاقية: ' || a.name,
    u.title || ' (version ' || v || ') was added to the agreement documents.', 'أُضيف ' || u.title || ' (الإصدار ' || v || ') إلى مستندات الاتفاقية.', false, 'doc:' || did || ':' || v);
  RETURN jsonb_build_object('document_id', did, 'version', v);
END $$;

-- Open one version: access checked, the download logged, then the browser asks storage for a short-lived link.
CREATE OR REPLACE FUNCTION public.sa_document_open(_document uuid, _version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); d public.sa_documents; r text; v public.sa_document_versions;
BEGIN
  SELECT * INTO d FROM public.sa_documents WHERE id = _document;
  IF d.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  r := public.sa_doc_access_role(d.agreement_id, uid);
  IF r IS NULL THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_rate_ok('sa_doc_open:' || uid, 200, 3600) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  SELECT * INTO v FROM public.sa_document_versions x WHERE x.document_id = _document AND x.version = COALESCE(_version, d.current_version);
  IF v.document_id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.sa_document_access (agreement_id, document_id, version, storage_path, user_id, actor_role) VALUES (d.agreement_id, _document, v.version, v.storage_path, uid, r);
  RETURN jsonb_build_object('bucket', 'agreement-documents', 'path', v.storage_path, 'file_name', v.file_name, 'mime_type', v.mime_type, 'version', v.version);
END $$;

-- Archive (hide from the active list; versions and the download log stay). Client or the person who added it.
CREATE OR REPLACE FUNCTION public.sa_document_archive(_document uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); d public.sa_documents;
BEGIN
  SELECT * INTO d FROM public.sa_documents WHERE id = _document FOR UPDATE;
  IF d.id IS NULL OR d.archived_at IS NOT NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.sa_doc_access_role(d.agreement_id, uid) = 'client' OR (d.created_by = uid AND public.sa_doc_access_role(d.agreement_id, uid) IS NOT NULL)) THEN
    RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sa_documents SET archived_at = now(), archived_by = uid WHERE id = _document;
  PERFORM public.sa_event(d.agreement_id, 'document_archived', uid, jsonb_build_object('document', _document, 'title', d.title));
END $$;

-- storage.objects rules for the bucket (restrictive = they also narrow any older broad policy).
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  EXECUTE 'DROP POLICY IF EXISTS "Agreement files: logged readers only" ON storage.objects';
  EXECUTE $p$CREATE POLICY "Agreement files: logged readers only" ON storage.objects AS RESTRICTIVE FOR SELECT TO public
    USING (bucket_id <> 'agreement-documents' OR public.sa_doc_storage_read_ok(name))$p$;
  EXECUTE 'DROP POLICY IF EXISTS "Agreement files: prepared uploads only" ON storage.objects';
  EXECUTE $p$CREATE POLICY "Agreement files: prepared uploads only" ON storage.objects AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (bucket_id <> 'agreement-documents' OR public.sa_doc_storage_insert_ok(name))$p$;
  EXECUTE 'DROP POLICY IF EXISTS "Agreement files: never replaced" ON storage.objects';
  EXECUTE $p$CREATE POLICY "Agreement files: never replaced" ON storage.objects AS RESTRICTIVE FOR UPDATE TO public
    USING (bucket_id <> 'agreement-documents') WITH CHECK (bucket_id <> 'agreement-documents')$p$;
  EXECUTE 'DROP POLICY IF EXISTS "Agreement files: never deleted" ON storage.objects';
  EXECUTE $p$CREATE POLICY "Agreement files: never deleted" ON storage.objects AS RESTRICTIVE FOR DELETE TO public
    USING (bucket_id <> 'agreement-documents')$p$;
  EXECUTE 'DROP POLICY IF EXISTS "Agreement files: parties can open" ON storage.objects';
  EXECUTE $p$CREATE POLICY "Agreement files: parties can open" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'agreement-documents' AND public.sa_doc_storage_read_ok(name))$p$;
  EXECUTE 'DROP POLICY IF EXISTS "Agreement files: parties can upload" ON storage.objects';
  EXECUTE $p$CREATE POLICY "Agreement files: parties can upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'agreement-documents' AND public.sa_doc_storage_insert_ok(name))$p$;
END $$;

CREATE OR REPLACE FUNCTION public.sa_list_mine(_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cid uuid := public.sa_consultant_of(uid);
BEGIN
  RETURN jsonb_build_object('enabled', public.sa_enabled(), 'settings', public.sa_settings() - 'rate_caps',
    'agreements', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'status', a.status, 'role', public.sa_role(a.id, uid), 'modules', to_jsonb(public.sa_modules(a)),
        'crew', (SELECT jsonb_build_object('members', count(*), 'confirmed', count(*) FILTER (WHERE m.status = 'active' AND m.sla_accepted_at IS NOT NULL)) FROM public.sa_members m WHERE m.agreement_id = a.id AND m.status IN ('invited', 'active', 'declined')),
        'model', a.terms ->> 'model', 'start_date', COALESCE(a.start_date, NULLIF(a.terms -> 'term' ->> 'start_date', '')::date), 'end_date', COALESCE(a.end_date, NULLIF(a.terms -> 'term' ->> 'end_date', '')::date),
        'applications', CASE WHEN public.sa_role(a.id, uid) IN ('client', 'client_member', 'admin') THEN (SELECT count(*) FROM public.sa_applications p WHERE p.agreement_id = a.id AND p.status IN ('pending', 'shortlisted', 'selected')) END,
        'updated_at', a.updated_at) ORDER BY a.updated_at DESC)
      FROM public.sa_agreements a
     WHERE (_tenant IS NOT NULL AND a.tenant_id = _tenant AND public.sa_role(a.id, uid) IN ('client', 'client_member'))
        OR (_tenant IS NULL AND a.client_id = uid)
        OR (cid IS NOT NULL AND (a.consultant_id = cid AND a.status NOT IN ('draft', 'open')
             OR EXISTS (SELECT 1 FROM public.sa_members m WHERE m.agreement_id = a.id AND m.consultant_id = cid AND m.status IN ('invited', 'active'))
             OR EXISTS (SELECT 1 FROM public.sa_applications p WHERE p.agreement_id = a.id AND p.consultant_id = cid)))), '[]'::jsonb),
    'replacements', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'agreement_id', x.agreement_id, 'name', a.name, 'reference', a.reference)) FROM public.sa_replacements x JOIN public.sa_agreements a ON a.id = x.agreement_id
                      WHERE x.status = 'pending_consultant' AND x.to_consultant = cid), '[]'::jsonb));
END $$;

-- ------------------------------------------------------------------------------------------------ admin
CREATE OR REPLACE FUNCTION public.sa_admin_set_settings(_value jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v jsonb := '{}'::jsonb; k text; before jsonb := public.sa_settings();
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  FOR k IN SELECT jsonb_object_keys(COALESCE(_value, '{}'::jsonb)) LOOP
    IF k IN ('enabled', 'needs_admin_review', 'draft_legal_flag', 'models_enabled', 'rate_min', 'rate_max', 'rate_caps', 'service_fee_percent', 'max_multiplier',
             'renewal_reminder_days', 'inactivity_weeks', 'min_term_months', 'max_notice_days', 'handover_days', 'allow_prepayment', 'allow_forfeit', 'application_limit_per_day',
             'crew_max', 'contacts_max', 'doc_max_mb', 'docs_per_agreement') THEN
      v := v || jsonb_build_object(k, _value -> k);
    END IF;
  END LOOP;
  IF v ? 'service_fee_percent' AND jsonb_typeof(v -> 'service_fee_percent') = 'number' AND (v ->> 'service_fee_percent')::numeric NOT BETWEEN 0 AND 50 THEN
    RAISE EXCEPTION 'sa_bad_settings: fee 0-50 %%' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v ->> 'rate_min')::numeric, (before ->> 'rate_min')::numeric) > COALESCE((v ->> 'rate_max')::numeric, (before ->> 'rate_max')::numeric) THEN
    RAISE EXCEPTION 'sa_bad_settings: min above max' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('support_agreements', v)
  ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || EXCLUDED.value, updated_at = now();
  -- Boolean mirror for the menu switch (src/lib/pageVisibility.ts reads boolean rows only).
  INSERT INTO public.platform_settings (key, value) VALUES ('support_agreements_visible', to_jsonb(public.sa_enabled()))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  PERFORM public.sa_audit_log(uid, 'settings', NULL, jsonb_build_object('before', before, 'after', public.sa_settings(), 'reason', left(_reason, 300)));
  RETURN public.sa_settings();
END $$;

-- Full settings (incl. per-module rate caps) and today's fee percentages for the administrator screen.
CREATE OR REPLACE FUNCTION public.sa_admin_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.sa_is_admin(auth.uid()) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('settings', public.sa_settings(), 'fees', jsonb_build_object('service_fee_percent', public.payment_service_fee_percent(),
    'processing_fee_percent', public.payment_processing_fee_percent(), 'vat_percent', public.payment_vat_percent(), 'agreement_fee_percent', public.sa_service_fee_percent()));
END $$;

CREATE OR REPLACE FUNCTION public.sa_admin_list(_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'status', a.status, 'admin_review', a.admin_review,
      'company', COALESCE((SELECT t.name FROM public.tenants t WHERE t.id = a.tenant_id), (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = a.client_id LIMIT 1)),
      'consultant', (SELECT p.display_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = a.consultant_id LIMIT 1),
      'rate', (SELECT jsonb_build_object('hourly_rate', x.hourly_rate, 'currency', x.currency) FROM public.sa_rate_on(a.id, current_date) x WHERE x.id IS NOT NULL),
      'model', a.terms ->> 'model', 'end_date', a.end_date, 'last_activity_at', a.last_activity_at,
      'inactive', a.status IN ('active', 'renewal_due') AND GREATEST(a.last_activity_at, a.started_at) < now() - make_interval(weeks => COALESCE((public.sa_settings() ->> 'inactivity_weeks')::int, 6)),
      'replacement', (SELECT jsonb_build_object('id', x.id, 'status', x.status, 'reason', x.reason) FROM public.sa_replacements x WHERE x.agreement_id = a.id AND x.status = 'pending_admin' LIMIT 1),
      'updated_at', a.updated_at) ORDER BY a.updated_at DESC)
    FROM public.sa_agreements a WHERE _status IS NULL OR a.status = _status OR (_status = 'review' AND a.admin_review = 'pending')), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.sa_admin_review(_id uuid, _approve boolean, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements;
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id AND admin_review = 'pending' FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.sa_agreements SET admin_review = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, admin_note = left(_note, 500) WHERE id = _id;
  PERFORM public.sa_event(_id, CASE WHEN _approve THEN 'admin_approved' ELSE 'admin_rejected' END, uid);
  PERFORM public.sa_audit_log(uid, 'admin_review', _id, jsonb_build_object('approve', _approve, 'note', left(_note, 300)));
  IF _approve THEN PERFORM public.sa_try_activate(_id);
  ELSE
    UPDATE public.sa_agreements SET termination_reason = 'Not approved by the platform team: ' || left(COALESCE(_note, ''), 300), termination_end = current_date WHERE id = _id;
    PERFORM public.sa_set_status(_id, 'terminated', uid, jsonb_build_object('admin_rejected', true));
  END IF;
  PERFORM public.sa_notify_parties(_id, CASE WHEN _approve THEN 'Support agreement approved' ELSE 'Support agreement not approved' END,
    CASE WHEN _approve THEN 'تمت الموافقة على اتفاقية الدعم' ELSE 'لم تتم الموافقة على اتفاقية الدعم' END,
    COALESCE(NULLIF(_note, ''), a.name), COALESCE(NULLIF(_note, ''), a.name), true, 'review_done:' || _id);
END $$;

-- ------------------------------------------------------------------------------------------------ daily sweep
CREATE OR REPLACE FUNCTION public.sa_settle_month(_id uuid, _month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.sa_agreements; prev public.sa_months; res jsonb; used numeric; committed numeric; days int; active_days int; rr public.sa_rate_records;
  base numeric; br jsonb; pid uuid; m0 date := date_trunc('month', _month)::date; m1 date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  svc numeric; sf numeric; pf numeric; vat numeric; sub numeric;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.terms ->> 'model' <> 'hours_bank' OR a.started_at IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.sa_months x WHERE x.agreement_id = _id AND x.month = m0) THEN RETURN NULL; END IF;
  days := m1 - m0 + 1;
  active_days := GREATEST(0, LEAST(m1, COALESCE(a.termination_end, a.end_date, m1)) - GREATEST(m0, COALESCE(a.start_date, m0)) + 1);
  IF active_days <= 0 THEN RETURN NULL; END IF;
  committed := round((a.terms -> 'bank' ->> 'hours_per_month')::numeric * active_days / days, 2);  -- first/last month prorated by days
  SELECT * INTO prev FROM public.sa_months WHERE agreement_id = _id AND month < m0 ORDER BY month DESC LIMIT 1;
  used := public.sa_month_hours(_id, m0);
  res := public.sa_bank_month(to_char(m0, 'YYYY-MM'), COALESCE(prev.carried_out, '[]'::jsonb), used, a.terms -> 'bank', committed);
  rr := public.sa_rate_on(_id, m1);
  base := round((res ->> 'charge_hours')::numeric * rr.hourly_rate
          + (res ->> 'overage_hours')::numeric * GREATEST(0, COALESCE(rr.overage_rate, NULLIF(a.terms -> 'bank' ->> 'overage_rate', '')::numeric, rr.hourly_rate) - rr.hourly_rate), 2);
  IF base > 0 THEN
    -- pricing v2 with the agreement portal fee (same rounding order as pricing_breakdown).
    svc := public.sa_service_fee_percent();
    sf := round(base * svc / 100, 2); pf := round(base * public.payment_processing_fee_percent() / 100, 2);
    sub := base + sf + pf; vat := round(sub * public.payment_vat_percent() / 100, 2);
    INSERT INTO public.payments (client_id, consultant_id, tenant_id, amount, currency, vat_amount, status, kind, reference, description, due_date, pricing_model,
                                 base_amount, service_fee_percent, service_fee_amount, processing_fee_percent, processing_fee_amount, vat_percent)
    VALUES (a.client_id, a.consultant_id, a.tenant_id, sub + vat, rr.currency, vat, 'pending', 'invoice', 'agreement:' || _id || ':' || to_char(m0, 'YYYY-MM'),
            left('Support agreement "' || a.name || '" (' || a.reference || ') ' || to_char(m0, 'YYYY-MM') || ': ' || (res ->> 'charge_hours') || ' committed hours not used'
                 || CASE WHEN (res ->> 'overage_hours')::numeric > 0 THEN ', overage difference for ' || (res ->> 'overage_hours') || ' h' ELSE '' END, 500),
            now() + interval '14 days', 'v2', base, svc, sf, public.payment_processing_fee_percent(), pf, public.payment_vat_percent())
    RETURNING id INTO pid;
  END IF;
  INSERT INTO public.sa_months (agreement_id, month, committed, carried_in, used_hours, carried_out, expired_hours, charge_hours, overage_hours, base_amount, payment_id)
  VALUES (_id, m0, committed, COALESCE(prev.carried_out, '[]'::jsonb), used, res -> 'carried_out', (res ->> 'expired_hours')::numeric, (res ->> 'charge_hours')::numeric,
          (res ->> 'overage_hours')::numeric, base, pid);
  PERFORM public.sa_event(_id, 'month_settled', NULL, jsonb_build_object('month', to_char(m0, 'YYYY-MM'), 'used', used, 'charge_hours', res -> 'charge_hours', 'base', base));
  PERFORM public.sa_notify_parties(_id, 'Monthly statement ' || to_char(m0, 'YYYY-MM') || ': ' || a.name, 'كشف شهري ' || to_char(m0, 'YYYY-MM') || ': ' || a.name,
    'Hours used ' || used || ' of ' || committed || ' committed.' || CASE WHEN base > 0 THEN ' An invoice for the unused committed hours was created.' ELSE '' END,
    'الساعات المستخدمة ' || used || ' من ' || committed || ' ملتزم بها.' || CASE WHEN base > 0 THEN ' أُنشئت فاتورة للساعات الملتزم بها غير المستخدمة.' ELSE '' END,
    true, 'statement:' || _id || ':' || to_char(m0, 'YYYY-MM'));
  PERFORM public.sa_notify_statement(_id, m0);
  RETURN res || jsonb_build_object('base', base, 'payment_id', pid);
END $$;

-- Monthly statement e-mails to the recipients the client chose inside the company (terms.statement_recipients,
-- only while terms.statement_email is on). Recipients outside the company never receive anything.
CREATE OR REPLACE FUNCTION public.sa_notify_statement(_id uuid, _month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; x text; u uuid; m text := to_char(_month, 'YYYY-MM');
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF a.id IS NULL OR NOT COALESCE((a.terms ->> 'statement_email')::boolean, false) THEN RETURN; END IF;
  FOR x IN SELECT jsonb_array_elements_text(COALESCE(a.terms -> 'statement_recipients', '[]'::jsonb)) LOOP
    u := public.sa_company_user(a.tenant_id, a.client_id, x);
    CONTINUE WHEN u IS NULL;
    PERFORM public.sa_notify(_id, u, 'Monthly statement ' || m || ': ' || a.name, 'الكشف الشهري ' || m || ': ' || a.name,
      'The monthly statement of the support agreement is ready in the portal (hours, SLA compliance, spend).',
      'الكشف الشهري لاتفاقية الدعم جاهز في البوابة (الساعات والالتزام باتفاقية مستوى الخدمة والإنفاق).', 'client', true, 'statement_r:' || _id || ':' || m || ':' || u);
  END LOOP;
END $$;

-- Statement notice for pay-as-you-go and capacity agreements (hours bank statements come with the settlement).
CREATE OR REPLACE FUNCTION public.sa_statement_notice(_id uuid, _month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; n int; m text := to_char(_month, 'YYYY-MM'); used numeric;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  INSERT INTO public.sa_notices (dedupe_key) VALUES ('stmt_event:' || _id || ':' || m) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN; END IF;
  used := public.sa_month_hours(_id, _month);
  PERFORM public.sa_event(_id, 'month_statement', NULL, jsonb_build_object('month', m, 'used', used));
  PERFORM public.sa_notify_parties(_id, 'Monthly statement ' || m || ': ' || a.name, 'الكشف الشهري ' || m || ': ' || a.name,
    'Approved hours in ' || m || ': ' || used || '. The statement is ready in the agreement documents.',
    'الساعات المعتمدة في ' || m || ': ' || used || '. الكشف جاهز في مستندات الاتفاقية.', true, 'statement:' || _id || ':' || m);
  PERFORM public.sa_notify_statement(_id, _month);
END $$;

CREATE OR REPLACE FUNCTION public.sa_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); a public.sa_agreements; d int; first_d int; n_act int := 0; n_ren int := 0; n_set int := 0; rr public.sa_rate_records; tk uuid;
BEGIN
  IF NOT public.sa_enabled() THEN RETURN jsonb_build_object('skipped', true); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('sa_sweep')) THEN RETURN jsonb_build_object('busy', true); END IF;
  first_d := COALESCE((SELECT max(x::int) FROM jsonb_array_elements_text(s -> 'renewal_reminder_days') x), 60);
  FOR a IN SELECT * FROM public.sa_agreements WHERE status IN ('agreed', 'active', 'suspended', 'renewal_due', 'expired', 'terminated') ORDER BY updated_at LIMIT 2000 LOOP
    BEGIN
      IF a.status = 'agreed' THEN
        IF public.sa_try_activate(a.id) THEN n_act := n_act + 1; END IF;
        CONTINUE;
      END IF;
      -- monthly settlement of the previous month (hours bank); the other models get the monthly statement notice
      IF a.terms ->> 'model' = 'hours_bank' AND a.started_at IS NOT NULL THEN
        IF public.sa_settle_month(a.id, (date_trunc('month', current_date) - interval '1 month')::date) IS NOT NULL THEN n_set := n_set + 1; END IF;
      ELSIF a.started_at IS NOT NULL AND a.started_at < date_trunc('month', current_date) THEN
        PERFORM public.sa_statement_notice(a.id, (date_trunc('month', current_date) - interval '1 month')::date);
      END IF;
      IF a.status = 'suspended' AND a.suspended_until IS NOT NULL AND a.suspended_until <= current_date THEN
        UPDATE public.sa_agreements SET suspended_until = NULL WHERE id = a.id;
        PERFORM public.sa_set_status(a.id, 'active', NULL, jsonb_build_object('auto_resume', true));
        a.status := 'active';
      END IF;
      -- notice period over -> terminated; long after the end -> archived
      IF a.termination_end IS NOT NULL AND current_date > a.termination_end AND a.status IN ('active', 'suspended', 'renewal_due') THEN
        PERFORM public.sa_set_status(a.id, 'terminated', NULL, jsonb_build_object('notice_end', a.termination_end));
        CONTINUE;
      END IF;
      IF a.status IN ('expired', 'terminated') AND current_date > COALESCE(a.handover_until, a.termination_end, a.end_date, current_date) + 30 THEN
        PERFORM public.sa_set_status(a.id, 'archived', NULL);
        CONTINUE;
      END IF;
      IF a.status IN ('active', 'renewal_due') AND a.end_date IS NOT NULL THEN
        FOR d IN SELECT x::int FROM jsonb_array_elements_text(s -> 'renewal_reminder_days') x LOOP
          IF a.end_date - d = current_date THEN
            PERFORM public.sa_notify_parties(a.id, 'Support agreement ends in ' || d || ' days: ' || a.name, 'تنتهي اتفاقية الدعم خلال ' || d || ' يوماً: ' || a.name,
              CASE WHEN a.auto_renew_client_at IS NOT NULL AND a.auto_renew_consultant_at IS NOT NULL THEN 'It renews automatically on ' || (a.end_date + 1) || ' unless one of you switches auto-renew off.'
                   ELSE 'Renew it, or let it end on ' || a.end_date || '.' END,
              CASE WHEN a.auto_renew_client_at IS NOT NULL AND a.auto_renew_consultant_at IS NOT NULL THEN 'تتجدد تلقائياً في ' || (a.end_date + 1) || ' ما لم يوقف أحدكما التجديد التلقائي.'
                   ELSE 'جدّدها أو اتركها تنتهي في ' || a.end_date || '.' END, true, 'renewal:' || a.id || ':' || a.end_date || ':' || d);
          END IF;
        END LOOP;
        IF current_date > a.end_date THEN
          IF a.auto_renew_client_at IS NOT NULL AND a.auto_renew_consultant_at IS NOT NULL AND COALESCE((a.terms -> 'term' ->> 'renew_months')::int, 0) > 0 AND a.termination_end IS NULL THEN
            UPDATE public.sa_agreements SET end_date = (end_date + make_interval(months => (terms -> 'term' ->> 'renew_months')::int))::date WHERE id = a.id;
            IF a.status = 'renewal_due' THEN PERFORM public.sa_set_status(a.id, 'active', NULL, jsonb_build_object('renewed', true)); END IF;
            PERFORM public.sa_event(a.id, 'renewed', NULL, jsonb_build_object('until', (a.end_date + make_interval(months => (a.terms -> 'term' ->> 'renew_months')::int))::date));
            n_ren := n_ren + 1;
          ELSE
            PERFORM public.sa_set_status(a.id, 'expired', NULL);
          END IF;
        ELSIF a.status = 'active' AND a.end_date - first_d <= current_date THEN
          PERFORM public.sa_set_status(a.id, 'renewal_due', NULL);
        END IF;
      END IF;
      -- a rate change takes effect today: open agreement tickets get the new approved rate (earlier work keeps its rate)
      SELECT * INTO rr FROM public.sa_rate_records x WHERE x.agreement_id = a.id AND x.effective_from = current_date AND x.source = 'rate_change' ORDER BY x.seq DESC LIMIT 1;
      IF rr.id IS NOT NULL AND a.current_rate_id IS DISTINCT FROM rr.id THEN
        UPDATE public.sa_agreements SET current_rate_id = rr.id WHERE id = a.id;
        FOR tk IN SELECT st.ticket_id FROM public.sa_tickets st JOIN public.tickets t ON t.id = st.ticket_id WHERE st.agreement_id = a.id AND t.status::text NOT IN ('resolved', 'closed') LOOP
          UPDATE public.ticket_rates SET status = 'replaced' WHERE ticket_id = tk AND consultant_id = a.consultant_id AND status = 'approved';
          INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, decided_at, decision_note)
          VALUES (tk, a.consultant_id, rr.hourly_rate, rr.currency, 'approved', 'agreement', now(), 'Support agreement ' || a.reference || ' rate change from ' || rr.effective_from);
        END LOOP;
        PERFORM public.sa_event(a.id, 'rate_in_force', NULL, jsonb_build_object('seq', rr.seq, 'effective_from', rr.effective_from));
      END IF;
      -- bypass check: an active agreement without ticket or timesheet activity for N weeks
      IF a.status IN ('active', 'renewal_due') AND GREATEST(a.last_activity_at, a.started_at) < now() - make_interval(weeks => COALESCE((s ->> 'inactivity_weeks')::int, 6))
         AND (a.inactivity_alerted_at IS NULL OR a.inactivity_alerted_at < GREATEST(a.last_activity_at, a.started_at)) THEN
        UPDATE public.sa_agreements SET inactivity_alerted_at = now() WHERE id = a.id;
        PERFORM public.sa_event(a.id, 'inactivity_alert', NULL);
        PERFORM public.sa_notify_admins(a.id, 'Support agreement without activity', a.name || ': no tickets or timesheets for ' || COALESCE(s ->> 'inactivity_weeks', '6') || ' weeks.', 'inactive:' || a.id || ':' || current_date);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Support agreement sweep skipped %: %', a.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('activated', n_act, 'renewed', n_ren, 'settled', n_set);
END $$;

-- ------------------------------------------------------------------------------------------------ matching + e-mail worker
-- Share of a consultant's week reserved by availability commitments (ai-ticket lowers the availability fit with it).
CREATE OR REPLACE FUNCTION public.sa_reserved_shares(_consultant_ids uuid[])
RETURNS TABLE (consultant_id uuid, share numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.consultant_id, LEAST(1, sum((a.terms ->> 'capacity_hours_per_week')::numeric) / 40)
    FROM public.sa_agreements a
   WHERE public.sa_enabled() AND a.status IN ('active', 'renewal_due') AND a.terms ->> 'model' = 'availability' AND a.consultant_id = ANY (_consultant_ids)
   GROUP BY a.consultant_id
$$;

CREATE OR REPLACE FUNCTION public.sa_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sa_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/agreement-run';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Agreement e-mail wake-up skipped: %', SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION public.sa_wake_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM public.sa_wake(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS sa_wake ON public.sa_email_queue;
CREATE TRIGGER sa_wake AFTER INSERT ON public.sa_email_queue FOR EACH STATEMENT EXECUTE FUNCTION public.sa_wake_trigger();

CREATE OR REPLACE FUNCTION public.sa_claim_emails(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, agreement_id uuid, kind text, payload jsonb, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.sa_email_queue q SET failed_at = now(), last_error = 'not_applicable'
   WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND (NOT public.sa_enabled()
      OR (to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL AND public.notifications_paused(q.user_id, 'activity', 'email')));
  RETURN QUERY
  WITH c AS (
    UPDATE public.sa_email_queue q SET attempts = q.attempts + 1, lease_until = now() + interval '10 minutes'
     WHERE q.id IN (SELECT q2.id FROM public.sa_email_queue q2 WHERE q2.sent_at IS NULL AND q2.failed_at IS NULL AND q2.attempts < 5
                      AND (q2.lease_until IS NULL OR q2.lease_until < now()) ORDER BY q2.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) FOR UPDATE SKIP LOCKED)
    RETURNING q.id, q.user_id, q.agreement_id, q.kind, q.payload)
  SELECT c.id, c.user_id, c.agreement_id, c.kind, c.payload, u.email::text FROM c LEFT JOIN auth.users u ON u.id = c.user_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_finish_email(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sa_email_queue SET sent_at = CASE WHEN _ok THEN now() END,
    failed_at = CASE WHEN NOT _ok AND (attempts >= 5 OR _error IN ('no_address', 'recipient_suppressed')) THEN now() END,
    last_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'failed'), 200) END, lease_until = NULL
   WHERE id = _id
$$;

-- ------------------------------------------------------------------------------------------------ schedule (daily, 02:17 UTC)
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'support-agreements-daily') THEN
      PERFORM cron.schedule('support-agreements-daily', '17 2 * * *', 'SELECT public.sa_sweep()');
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Daily support agreement job not scheduled: %', SQLERRM;
END $$;

-- ------------------------------------------------------------------------------------------------ grants
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'sa\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  public.sa_create(uuid, jsonb, jsonb), public.sa_save_draft(uuid, jsonb, jsonb), public.sa_publish(uuid, timestamptz, boolean, uuid[]),
  public.sa_opportunities(), public.sa_apply(uuid, numeric, text, text, numeric, text, boolean, text), public.sa_withdraw_application(uuid),
  public.sa_select_application(uuid), public.sa_reopen(uuid, text), public.sa_offer(uuid, jsonb, text), public.sa_respond_offer(uuid, boolean),
  public.sa_accept_terms(uuid, integer, text, text), public.sa_propose_rate_change(uuid, numeric, numeric, numeric, numeric, date, text),
  public.sa_decide_rate_change(uuid, boolean), public.sa_request_termination(uuid, text), public.sa_handover_note(uuid, text),
  public.sa_suspend(uuid, date, text), public.sa_resume(uuid), public.sa_set_auto_renew(uuid, boolean),
  public.sa_invite_member(uuid, uuid, text, numeric, jsonb, uuid, boolean), public.sa_update_member(uuid, uuid, text, numeric, jsonb, uuid, boolean),
  public.sa_remove_member(uuid, uuid, text), public.sa_member_respond(uuid, boolean, boolean, text),
  public.sa_request_replacement(uuid, uuid, text), public.sa_admin_decide_replacement(uuid, boolean, text),
  public.sa_replacement_accept(uuid, boolean), public.sa_post_message(uuid, uuid, text), public.sa_usable(uuid), public.sa_attach_ticket(uuid, uuid), public.sa_ticket_tags(uuid[]),
  public.sa_get(uuid), public.sa_list_mine(uuid), public.sa_admin_set_settings(jsonb, text), public.sa_admin_settings(), public.sa_admin_list(text), public.sa_admin_review(uuid, boolean, text),
  public.sa_document_begin_upload(uuid, uuid, text, text, text, text, bigint, text, boolean), public.sa_document_finish_upload(uuid),
  public.sa_document_open(uuid, integer), public.sa_document_archive(uuid)
TO authenticated;
-- Every storage request evaluates the restrictive bucket policies (anon included), so the two path checks are callable
-- by both roles; they only answer true for the signed-in owner of a prepared upload / a just-logged download.
GRANT EXECUTE ON FUNCTION public.sa_doc_storage_read_ok(text), public.sa_doc_storage_insert_ok(text) TO anon, authenticated;
-- The SLA hook must stay callable from the SLA functions (they run as the owner; no browser grant needed).

-- ------------------------------------------------------------------------------------------------ OPTIONAL (owner decision, commented out)
-- Ticket timesheets keep the platform portal fee. If the owner later sets a lower agreement fee AND wants it on the
-- ticket timesheets too (not only on the month-end settlements above), the timesheet pricing must read
-- sa_service_fee_percent() for agreement tickets. That needs a reviewed change of the timesheet approval function and of
-- the browser price preview (src/lib/pricing.ts) so the shown figure stays the invoiced figure. Not done here.
