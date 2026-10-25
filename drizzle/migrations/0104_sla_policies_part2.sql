-- ------------------------------------------------------------------------------------------------ triggers
CREATE OR REPLACE FUNCTION public.sla_on_ticket_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.sla_enabled() THEN
    BEGIN
      PERFORM public.sla_apply_snapshot(NEW.id, 'created', NULL, 'fresh');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'SLA snapshot skipped for ticket %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sla_ticket_insert ON public.tickets;
CREATE TRIGGER sla_ticket_insert AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.sla_on_ticket_insert();

-- Urgency change = re-classification (targets recomputed from the change time, logged with the reason the RPC set);
-- other changes only reconcile.
CREATE OR REPLACE FUNCTION public.sla_on_ticket_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur text; nxt text;
BEGIN
  IF NOT public.sla_enabled() THEN RETURN NULL; END IF;
  BEGIN
    SELECT s.severity INTO cur FROM public.sla_ticket_snapshots s WHERE s.ticket_id = NEW.id AND s.superseded_at IS NULL;
    IF cur IS NULL THEN RETURN NULL; END IF;
    nxt := public.sla_severity_for(NEW.urgency::text);
    IF NEW.urgency IS DISTINCT FROM OLD.urgency AND nxt <> cur THEN
      PERFORM public.sla_apply_snapshot(NEW.id, 'reclassified', auth.uid(), 'fresh', nxt, NULLIF(current_setting('sla.reason', true), ''));
    ELSE
      PERFORM public.sla_reconcile(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'SLA update skipped for ticket %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sla_ticket_update ON public.tickets;
CREATE TRIGGER sla_ticket_update AFTER UPDATE OF status, urgency, consultant_id, critical_first_reply_at, resolved_at ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.sla_on_ticket_update();

-- Messages, team changes, working status and NDA signatures can start, meet, pause or resume a clock.
CREATE OR REPLACE FUNCTION public.sla_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid;
BEGIN
  IF NOT public.sla_enabled() THEN RETURN NULL; END IF;
  BEGIN
    IF TG_TABLE_NAME = 'messages' THEN
      SELECT s.ticket_id INTO tid FROM public.sessions s WHERE s.id = NEW.session_id;
    ELSIF TG_TABLE_NAME = 'nda_agreements' THEN
      FOR tid IN SELECT DISTINCT tk.id FROM public.tickets tk JOIN public.sla_ticket_snapshots sn ON sn.ticket_id = tk.id AND sn.superseded_at IS NULL
                  WHERE tk.consultant_id = NEW.consultant_id AND tk.client_id = NEW.client_id LIMIT 50 LOOP
        PERFORM public.sla_reconcile(tid);
      END LOOP;
      RETURN NULL;
    ELSE
      tid := NEW.ticket_id;
    END IF;
    IF tid IS NOT NULL AND EXISTS (SELECT 1 FROM public.sla_ticket_clocks c WHERE c.ticket_id = tid AND c.met_at IS NULL) THEN
      PERFORM public.sla_reconcile(tid);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'SLA touch skipped: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS sla_touch ON public.messages;
  CREATE TRIGGER sla_touch AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.ticket_team_messages;
  CREATE TRIGGER sla_touch AFTER INSERT ON public.ticket_team_messages FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.ticket_team_members;
  CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF status, accepted_at, ready_at ON public.ticket_team_members FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.ticket_assignments;
  CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF status ON public.ticket_assignments FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.nda_agreements;
  CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF signed_at, client_signed_at, revoked_at ON public.nda_agreements FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  IF to_regclass('public.ticket_working_status') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS sla_touch ON public.ticket_working_status;
    CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF status_key ON public.ticket_working_status FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------ delivery worker (sla-run)
CREATE OR REPLACE FUNCTION public.sla_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sla_delivery_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/sla-run';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'SLA delivery wake-up skipped: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.sla_wake_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM public.sla_wake(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS sla_wake ON public.sla_delivery_queue;
CREATE TRIGGER sla_wake AFTER INSERT ON public.sla_delivery_queue FOR EACH STATEMENT EXECUTE FUNCTION public.sla_wake_trigger();

-- Rows whose clock is already met, whose ticket closed, or while the feature is off are dropped (never sent late).
-- Notification pauses (Feature Q) are applied here for pausable steps; S1 "cannot be paused" steps skip that check.
CREATE OR REPLACE FUNCTION public.sla_claim_deliveries(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, ticket_id uuid, channel text, kind text, payload jsonb, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.sla_delivery_queue q SET failed_at = now(), last_error = 'not_applicable'
   WHERE q.sent_at IS NULL AND q.failed_at IS NULL
     AND (NOT public.sla_enabled()
       OR EXISTS (SELECT 1 FROM public.sla_ticket_clocks c WHERE c.ticket_id = q.ticket_id AND c.kind = q.clock AND c.met_at IS NOT NULL)
       OR (NOT COALESCE((q.payload ->> 'unpausable')::boolean, false) AND to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL
           AND public.notifications_paused(q.user_id, 'reminders', CASE WHEN q.channel = 'email' THEN 'email' ELSE 'in_app' END)));
  RETURN QUERY
  WITH c AS (
    UPDATE public.sla_delivery_queue q SET attempts = q.attempts + 1, lease_until = now() + interval '10 minutes'
     WHERE q.id IN (SELECT q2.id FROM public.sla_delivery_queue q2
                     WHERE q2.sent_at IS NULL AND q2.failed_at IS NULL AND q2.attempts < 5
                       AND (q2.lease_until IS NULL OR q2.lease_until < now())
                     ORDER BY q2.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
                     FOR UPDATE SKIP LOCKED)
    RETURNING q.id, q.user_id, q.ticket_id, q.channel, q.kind, q.payload)
  SELECT c.id, c.user_id, c.ticket_id, c.channel, c.kind, c.payload, u.email::text FROM c LEFT JOIN auth.users u ON u.id = c.user_id;
END $$;

CREATE OR REPLACE FUNCTION public.sla_finish_delivery(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sla_delivery_queue SET
    sent_at = CASE WHEN _ok THEN now() END,
    failed_at = CASE WHEN NOT _ok AND (attempts >= 5 OR _error IN ('not_connected', 'no_address', 'recipient_suppressed')) THEN now() END,
    last_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'failed'), 200) END,
    lease_until = NULL
   WHERE id = _id
$$;

-- ------------------------------------------------------------------------------------------------ consultant acceptance gate
-- When ON and the admin requires it, a consultant must accept the ticket's SLA snapshot (sla_accept) before a bid,
-- an assignment acceptance or a team acceptance. Tickets without a snapshot (feature off / older tickets) are not gated.
CREATE OR REPLACE FUNCTION public.sla_acceptance_missing(_ticket uuid, _consultant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sla_enabled() AND COALESCE((public.sla_settings() ->> 'require_acceptance')::boolean, true)
     AND EXISTS (SELECT 1 FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM public.sla_acceptances a WHERE a.ticket_id = _ticket AND a.consultant_id = _consultant AND a.snapshot_id = s.id))
$$;

CREATE OR REPLACE FUNCTION public.sla_guard_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.sla_is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'proposals' THEN
    IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'ticket_match_requests' THEN
    IF NOT (NEW.status::text = 'accepted' AND OLD.status::text IS DISTINCT FROM 'accepted') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'ticket_team_members' THEN
    IF NOT (NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL) THEN RETURN NEW; END IF;
  END IF;
  IF public.sla_acceptance_missing(NEW.ticket_id, NEW.consultant_id) THEN
    RAISE EXCEPTION 'sla_acceptance_required: please review and accept the SLA of this ticket first' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sla_acceptance ON public.proposals;
CREATE TRIGGER trg_sla_acceptance BEFORE INSERT ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.sla_guard_acceptance();
DROP TRIGGER IF EXISTS trg_sla_acceptance ON public.ticket_match_requests;
CREATE TRIGGER trg_sla_acceptance BEFORE UPDATE OF status ON public.ticket_match_requests FOR EACH ROW EXECUTE FUNCTION public.sla_guard_acceptance();
DROP TRIGGER IF EXISTS trg_sla_acceptance ON public.ticket_team_members;
CREATE TRIGGER trg_sla_acceptance BEFORE UPDATE OF accepted_at ON public.ticket_team_members FOR EACH ROW EXECUTE FUNCTION public.sla_guard_acceptance();

-- ------------------------------------------------------------------------------------------------ settings RPCs
CREATE OR REPLACE FUNCTION public.sla_public_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE
    (SELECT s - 'quiet_hours' FROM (SELECT public.sla_settings() AS s) q)
    || jsonb_build_object(
      'templates', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'key', p.template_key, 'name', p.name, 'description', p.description) ORDER BY p.created_at)
                               FROM public.sla_policies p WHERE p.scope = 'template' AND p.status = 'active'), '[]'::jsonb),
      'holiday_lists', COALESCE((SELECT jsonb_agg(DISTINCT h.list_key) FROM public.sla_holidays h), '[]'::jsonb),
      'disclaimer_version', 'draft-1')
  END
$$;

-- Admin: whole settings object (validated keys only). Turning the feature on/off is audited.
CREATE OR REPLACE FUNCTION public.sla_admin_set_settings(_value jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); before jsonb := public.sla_settings(); v jsonb; k text;
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'sla_bad_settings' USING ERRCODE = '22023'; END IF;
  v := '{}'::jsonb;
  FOR k IN SELECT jsonb_object_keys(_value) LOOP
    IF k IN ('enabled', 'severities', 'urgency_map', 'bounds', 'at_risk_pct', 'quiet_hours', 'unpausable_allowed', 'require_acceptance',
             'compliance_alert_pct', 'channels_enabled') THEN
      v := v || jsonb_build_object(k, _value -> k);
    END IF;
  END LOOP;
  IF v ? 'enabled' AND jsonb_typeof(v -> 'enabled') <> 'boolean' THEN RAISE EXCEPTION 'sla_bad_settings: enabled' USING ERRCODE = '22023'; END IF;
  IF v ? 'urgency_map' AND EXISTS (SELECT 1 FROM jsonb_each_text(v -> 'urgency_map') e WHERE e.key NOT IN ('critical', 'high', 'medium', 'low') OR e.value NOT IN ('S1', 'S2', 'S3', 'S4')) THEN
    RAISE EXCEPTION 'sla_bad_settings: urgency_map' USING ERRCODE = '22023';
  END IF;
  IF v -> 'bounds' ? 'min_repeat_min' AND (v -> 'bounds' ->> 'min_repeat_min')::numeric < 30 THEN
    RAISE EXCEPTION 'sla_bad_settings: repeats must be at least 30 minutes apart' USING ERRCODE = '22023';
  END IF;
  IF v -> 'channels_enabled' ? 'sms' THEN RAISE EXCEPTION 'sla_bad_settings: SMS is not permitted' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('sla_policies', v)
  ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || EXCLUDED.value, updated_at = now();
  INSERT INTO public.sla_audit (actor_id, action, detail) VALUES (uid, 'settings', jsonb_build_object('before', before, 'after', public.sla_settings(), 'reason', left(_reason, 300)));
  RETURN public.sla_settings();
END $$;

CREATE OR REPLACE FUNCTION public.sla_holidays_list()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object('list', h.list_key, 'day', h.day, 'label_en', h.label_en, 'label_ar', h.label_ar) ORDER BY h.list_key, h.day)
      FROM public.sla_holidays h WHERE h.day >= (now() - interval '400 days')::date), '[]'::jsonb) END
$$;

CREATE OR REPLACE FUNCTION public.sla_admin_set_holiday(_list text, _day date, _label_en text DEFAULT '', _label_ar text DEFAULT '', _remove boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF _list !~ '^[A-Za-z0-9_-]{1,24}$' OR _day IS NULL THEN RAISE EXCEPTION 'sla_bad_holiday' USING ERRCODE = '22023'; END IF;
  IF _remove THEN
    DELETE FROM public.sla_holidays WHERE list_key = _list AND day = _day;
  ELSE
    INSERT INTO public.sla_holidays (list_key, day, label_en, label_ar, created_by)
    VALUES (upper(_list), _day, left(COALESCE(_label_en, ''), 120), left(COALESCE(_label_ar, ''), 120), uid)
    ON CONFLICT (list_key, day) DO UPDATE SET label_en = EXCLUDED.label_en, label_ar = EXCLUDED.label_ar;
  END IF;
  INSERT INTO public.sla_audit (actor_id, action, detail) VALUES (uid, CASE WHEN _remove THEN 'holiday_removed' ELSE 'holiday_saved' END,
    jsonb_build_object('list', _list, 'day', _day));
END $$;

-- ------------------------------------------------------------------------------------------------ policy RPCs
CREATE OR REPLACE FUNCTION public.sla_policy_json(_p public.sla_policies, _uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _p.id, 'scope', _p.scope, 'tenant_id', _p.tenant_id, 'template_key', _p.template_key, 'is_default', _p.is_default,
    'name', _p.name, 'description', _p.description, 'applies_to', _p.applies_to, 'status', _p.status, 'current_version', _p.current_version,
    'active_version', _p.active_version, 'effective_from', _p.effective_from, 'lock_version', _p.lock_version, 'updated_at', _p.updated_at,
    'archived_at', _p.archived_at,
    'can_manage', CASE WHEN _p.scope = 'client' THEN public.sla_can_manage(_uid, _p.tenant_id, _p.client_id) ELSE public.sla_is_admin(_uid) END,
    'owner_name', CASE WHEN public.sla_is_admin(_uid) THEN COALESCE((SELECT t.name FROM public.tenants t WHERE t.id = _p.tenant_id),
                         (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = _p.client_id LIMIT 1)) END)
$$;

CREATE OR REPLACE FUNCTION public.sla_can_read_policy(_p public.sla_policies, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.sla_is_admin(_uid)
    OR (_p.scope IN ('template', 'platform') AND _p.status = 'active' AND public.has_role(_uid, 'client'::app_role))
    OR (_p.scope = 'client' AND public.sla_can_read_owner(_uid, _p.tenant_id, _p.client_id)))
$$;

-- Client: policies of one company (or of the client himself when _tenant is NULL), plus the platform default.
CREATE OR REPLACE FUNCTION public.sla_my_policies(_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.sla_can_read_owner(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) THEN
    RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.sla_enabled(),
    'can_manage', public.sla_can_manage(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END),
    'policies', COALESCE((SELECT jsonb_agg(public.sla_policy_json(p, uid) ORDER BY p.status, p.updated_at DESC) FROM public.sla_policies p
                           WHERE p.scope = 'client' AND ((_tenant IS NOT NULL AND p.tenant_id = _tenant) OR (_tenant IS NULL AND p.tenant_id IS NULL AND p.client_id = uid))), '[]'::jsonb),
    'platform_default', (SELECT public.sla_policy_json(p, uid) || jsonb_build_object('body', v.body) FROM public.sla_policies p
                           JOIN public.sla_policy_versions v ON v.policy_id = p.id AND v.version = p.active_version WHERE p.is_default LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; cur public.sla_policy_versions; manage boolean;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  IF p.id IS NULL OR NOT public.sla_can_read_policy(p, uid) THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cur FROM public.sla_policy_versions WHERE policy_id = _id AND version = p.current_version;
  manage := (public.sla_policy_json(p, uid) ->> 'can_manage')::boolean;
  RETURN public.sla_policy_json(p, uid) || jsonb_build_object(
    'body', cur.body, 'meta', cur.meta,
    'problems', public.sla_policy_problems(cur.body, cur.meta, p.tenant_id),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'created_at', v.created_at, 'change_note', v.change_note,
                              'by_admin', public.sla_is_admin(v.created_by)) ORDER BY v.version DESC) FROM public.sla_policy_versions v WHERE v.policy_id = _id), '[]'::jsonb),
    'company_domain', CASE WHEN manage THEN (SELECT t.domain FROM public.tenants t WHERE t.id = p.tenant_id) END,
    'member_emails', CASE WHEN manage AND p.tenant_id IS NOT NULL THEN COALESCE((SELECT jsonb_agg(DISTINCT lower(u.email)) FROM public.tenant_members m
                       JOIN auth.users u ON u.id = m.user_id WHERE m.tenant_id = p.tenant_id AND m.accepted_at IS NOT NULL), '[]'::jsonb) END);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_version(_id uuid, _version integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; v public.sla_policy_versions;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  IF p.id IS NULL OR NOT public.sla_can_read_policy(p, uid) THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = _version;
  IF v.policy_id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('version', v.version, 'body', v.body, 'meta', v.meta, 'change_note', v.change_note, 'created_at', v.created_at);
END $$;

-- Create (no _id) or add a version. Drafts always save (problems are returned); a malformed body is refused.
CREATE OR REPLACE FUNCTION public.sla_policy_save(_id uuid, _tenant uuid, _meta jsonb, _body jsonb, _note text DEFAULT '', _expected_lock integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); p public.sla_policies; probs jsonb; h text; ver integer; meta jsonb; admin_override boolean := false; m uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_save:' || uid, 60, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  meta := jsonb_build_object('name', left(btrim(COALESCE(_meta ->> 'name', '')), 120), 'description', left(COALESCE(_meta ->> 'description', ''), 1000),
                             'applies_to', COALESCE(_meta -> 'applies_to', '{"kind":"all","values":[]}'::jsonb));
  IF _id IS NULL THEN
    IF NOT public.sla_can_manage(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) OR (_tenant IS NULL AND NOT public.has_role(uid, 'client'::app_role) AND NOT public.sla_is_admin(uid)) THEN
      RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM public.sla_policies x WHERE x.scope = 'client' AND x.status <> 'archived'
          AND ((_tenant IS NOT NULL AND x.tenant_id = _tenant) OR (_tenant IS NULL AND x.client_id = uid))) >= 20 THEN
      RAISE EXCEPTION 'sla_too_many_policies' USING ERRCODE = '54000';
    END IF;
  ELSE
    SELECT * INTO p FROM public.sla_policies WHERE id = _id FOR UPDATE;
    IF p.id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
    IF p.scope = 'client' THEN
      IF NOT public.sla_can_manage(uid, p.tenant_id, p.client_id) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
      admin_override := public.sla_is_admin(uid) AND NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = p.tenant_id AND tm.user_id = uid)
                        AND p.client_id IS DISTINCT FROM uid;
    ELSIF NOT public.sla_is_admin(uid) THEN
      RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
    END IF;
    IF p.status = 'archived' THEN RAISE EXCEPTION 'sla_archived' USING ERRCODE = '55000'; END IF;
    IF _expected_lock IS NOT NULL AND _expected_lock <> p.lock_version THEN RAISE EXCEPTION 'sla_conflict: saved by someone else, reload' USING ERRCODE = '40001'; END IF;
  END IF;
  probs := public.sla_policy_problems(_body, meta, COALESCE(p.tenant_id, _tenant));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(probs) x WHERE x ->> 'code' IN ('bad_shape', 'bad_step')) THEN
    RAISE EXCEPTION 'sla_bad_policy' USING ERRCODE = '22023';
  END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  h := public.sla_hash(_body, meta);

  IF _id IS NULL THEN
    INSERT INTO public.sla_policies (scope, tenant_id, client_id, name, description, applies_to, created_by, updated_by)
    VALUES ('client', _tenant, CASE WHEN _tenant IS NULL THEN uid END, meta ->> 'name', meta ->> 'description', meta -> 'applies_to', uid, uid)
    RETURNING * INTO p;
  ELSIF EXISTS (SELECT 1 FROM public.sla_policy_versions v WHERE v.policy_id = p.id AND v.version = p.current_version AND v.content_hash = h) THEN
    RETURN jsonb_build_object('id', p.id, 'version', p.current_version, 'unchanged', true, 'problems', probs, 'lock_version', p.lock_version);
  END IF;
  ver := p.current_version + 1;
  INSERT INTO public.sla_policy_versions (policy_id, version, body, meta, change_note, content_hash, created_by)
  VALUES (p.id, ver, _body, meta, left(COALESCE(_note, ''), 500), h, uid);
  UPDATE public.sla_policies SET current_version = ver, name = meta ->> 'name', description = meta ->> 'description', applies_to = meta -> 'applies_to',
         lock_version = lock_version + 1, updated_by = uid, updated_at = now()
   WHERE id = p.id RETURNING * INTO p;
  INSERT INTO public.sla_audit (actor_id, action, policy_id, detail)
  VALUES (uid, CASE WHEN ver = 1 THEN 'create' WHEN admin_override THEN 'override' ELSE 'version' END, p.id,
          jsonb_build_object('version', ver, 'note', left(_note, 300)));
  IF admin_override THEN
    FOR m IN SELECT tm.user_id FROM public.tenant_members tm WHERE tm.tenant_id = p.tenant_id AND tm.org_role IN ('owner'::org_role, 'admin'::org_role) AND tm.accepted_at IS NOT NULL
             UNION SELECT p.client_id WHERE p.client_id IS NOT NULL LOOP
      PERFORM public.safe_insert_notification(m, 'SLA policy updated by the platform team', 'A new version (v' || ver || ') of "' || p.name || '" was saved. Review it before activating.', 'sla', '/client/sla');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', p.id, 'version', ver, 'problems', probs, 'lock_version', p.lock_version);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_activate(_id uuid, _version integer, _effective_from timestamptz DEFAULT NULL, _apply_to_open boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; v public.sla_policy_versions; probs jsonb; eff timestamptz := COALESCE(_effective_from, now()); n int := 0; tk record; e record; u uuid;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT (CASE WHEN p.scope = 'client' THEN public.sla_can_manage(uid, p.tenant_id, p.client_id) ELSE public.sla_is_admin(uid) END) THEN
    RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p.status = 'archived' THEN RAISE EXCEPTION 'sla_archived' USING ERRCODE = '55000'; END IF;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = _version;
  IF v.policy_id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  probs := public.sla_policy_problems(v.body, v.meta, p.tenant_id);
  IF public.sla_has_errors(probs) THEN RAISE EXCEPTION 'sla_outside_bounds: fix the listed problems first' USING ERRCODE = '22023'; END IF;
  IF eff < now() - interval '5 minutes' THEN RAISE EXCEPTION 'sla_not_retroactive: effective date cannot be in the past' USING ERRCODE = '22023'; END IF;
  IF _apply_to_open AND eff > now() + interval '5 minutes' THEN RAISE EXCEPTION 'sla_apply_open_needs_now' USING ERRCODE = '22023'; END IF;
  UPDATE public.sla_policies SET status = 'active', active_version = _version, effective_from = eff, lock_version = lock_version + 1, updated_by = uid, updated_at = now()
   WHERE id = _id;
  INSERT INTO public.sla_audit (actor_id, action, policy_id, detail) VALUES (uid, 'activate', _id, jsonb_build_object('version', _version, 'effective_from', eff, 'apply_to_open', _apply_to_open));
  -- Open tickets keep their snapshot unless the client explicitly ticked "apply to open tickets".
  IF _apply_to_open AND p.scope = 'client' AND public.sla_enabled() THEN
    FOR tk IN SELECT t.id FROM public.tickets t JOIN public.sla_ticket_snapshots s ON s.ticket_id = t.id AND s.superseded_at IS NULL
               WHERE t.status::text NOT IN ('resolved', 'closed')
                 AND ((p.tenant_id IS NOT NULL AND t.tenant_id = p.tenant_id) OR (p.tenant_id IS NULL AND t.client_id = p.client_id))
               LIMIT 500 LOOP
      SELECT * INTO e FROM public.sla_effective_policy(tk.id);
      IF e.policy_id = _id THEN
        PERFORM public.sla_apply_snapshot(tk.id, 'new_policy', uid, 'carry', NULL, 'Policy activated for open tickets');
        FOR u IN SELECT a.user_id FROM public.sla_assigned(tk.id) a LOOP
          PERFORM public.safe_insert_notification(u, 'SLA policy changed on a ticket', 'The client applied "' || p.name || '" v' || _version || ' to this ticket.', 'sla', '/consultant/cases/' || tk.id);
        END LOOP;
        n := n + 1;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', _id, 'active_version', _version, 'effective_from', eff, 'tickets_updated', n);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_archive(_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p.is_default THEN RAISE EXCEPTION 'sla_default_required: the platform default cannot be archived' USING ERRCODE = '55000'; END IF;
  IF NOT (CASE WHEN p.scope = 'client' THEN public.sla_can_manage(uid, p.tenant_id, p.client_id) ELSE public.sla_is_admin(uid) END) THEN
    RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sla_text_ok(_reason) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sla_policies SET status = 'archived', archived_at = now(), archive_reason = left(_reason, 300), lock_version = lock_version + 1, updated_by = uid, updated_at = now()
   WHERE id = _id;
  INSERT INTO public.sla_audit (actor_id, action, policy_id, detail) VALUES (uid, 'archive', _id, jsonb_build_object('reason', left(_reason, 300)));
END $$;

-- Copy of an own policy, a template or the platform default as a new draft of the caller's company (or own account).
CREATE OR REPLACE FUNCTION public.sla_policy_duplicate(_id uuid, _tenant uuid, _name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; v public.sla_policy_versions; meta jsonb;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  IF p.id IS NULL OR NOT public.sla_can_read_policy(p, uid) THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = COALESCE(CASE WHEN p.scope = 'client' THEN p.current_version END, p.active_version, p.current_version);
  meta := v.meta || jsonb_build_object('name', left(COALESCE(NULLIF(btrim(_name), ''), p.name || ' (copy)'), 120));
  -- Copied extra contacts would belong to another company: they are dropped.
  RETURN public.sla_policy_save(NULL, _tenant, meta, v.body || jsonb_build_object('extra_contacts', CASE WHEN p.scope = 'client' AND p.tenant_id IS NOT DISTINCT FROM _tenant THEN COALESCE(v.body -> 'extra_contacts', '[]'::jsonb) ELSE '[]'::jsonb END),
    'Copied from ' || p.name || ' v' || v.version, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_restore(_id uuid, _version integer, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.sla_policy_versions; p public.sla_policies;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = _version;
  IF v.policy_id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public.sla_policy_save(_id, p.tenant_id, v.meta, v.body, COALESCE(NULLIF(_note, ''), 'Restored from v' || _version), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.sla_admin_policies(_search text DEFAULT NULL, _status text DEFAULT NULL, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(public.sla_policy_json(p, uid) ORDER BY p.is_default DESC, p.scope, p.updated_at DESC) FROM (
    SELECT * FROM public.sla_policies p
     WHERE (_status IS NULL OR p.status = _status)
       AND (_search IS NULL OR p.name ILIKE '%' || _search || '%'
            OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p.tenant_id AND t.name ILIKE '%' || _search || '%'))
     ORDER BY p.is_default DESC, p.scope, p.updated_at DESC
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(_offset, 0), 0)) p), '[]'::jsonb);
END $$;

-- ------------------------------------------------------------------------------------------------ ticket RPCs
CREATE OR REPLACE FUNCTION public.sla_clock_json(_c public.sla_ticket_clocks, _cal jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('kind', _c.kind, 'target_min', _c.target_min, 'extended_min', _c.extended_min, 'started_at', _c.started_at,
    'running_since', _c.running_since, 'consumed_min', round(_c.consumed_min, 2), 'paused_since', _c.paused_since, 'pause_reason', _c.pause_reason,
    'due_at', _c.due_at, 'met_at', _c.met_at, 'breached_at', _c.breached_at, 'stopped_at', _c.stopped_at,
    'consumed_now', round(_c.consumed_min + CASE WHEN _c.running_since IS NOT NULL THEN public.sla_business_minutes(_c.running_since, now(), _cal) ELSE 0 END, 2))
$$;

CREATE OR REPLACE FUNCTION public.sla_ticket_view(_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); role text := public.sla_ticket_role(_ticket, uid); sn public.sla_ticket_snapshots; t record; cid uuid; e_pid uuid; e_ver integer; e_name text; data jsonb;
BEGIN
  IF role IS NULL THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT tk.sla_response_deadline, tk.sla_deadline, tk.first_response_at, tk.sla_breached, tk.urgency::text AS urgency INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  SELECT * INTO sn FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL;
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  IF sn.id IS NULL THEN
    RETURN jsonb_build_object('enabled', public.sla_enabled(), 'role', role, 'snapshot', NULL,
      'legacy', jsonb_build_object('response_due', t.sla_response_deadline, 'resolution_due', t.sla_deadline, 'first_response_at', t.first_response_at, 'breached', t.sla_breached));
  END IF;
  data := sn.data;
  IF role NOT IN ('admin', 'client', 'client_manager') THEN data := data - 'extra_contacts'; END IF;
  IF role IN ('client', 'client_manager', 'admin') THEN
    SELECT x.policy_id, x.version, x.name INTO e_pid, e_ver, e_name FROM public.sla_effective_policy(_ticket) x;
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.sla_enabled(), 'role', role,
    'snapshot', jsonb_build_object('id', sn.id, 'policy_name', sn.policy_name, 'version', sn.policy_version, 'severity', sn.severity, 'data', data,
                                   'reason', sn.reason, 'created_at', sn.created_at),
    'clocks', CASE WHEN role = 'candidate' THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(public.sla_clock_json(c, sn.data -> 'calendar') ORDER BY array_position(ARRAY['response', 'workaround', 'resolution'], c.kind))
                 FROM public.sla_ticket_clocks c WHERE c.ticket_id = _ticket), '[]'::jsonb) END,
    'events', CASE WHEN role = 'candidate' THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'role', x.actor_role, 'data', x.data, 'at', x.created_at) ORDER BY x.created_at DESC)
                 FROM (SELECT * FROM public.sla_ticket_events ev WHERE ev.ticket_id = _ticket ORDER BY ev.created_at DESC LIMIT 100) x), '[]'::jsonb) END,
    'accepted', CASE WHEN cid IS NOT NULL THEN EXISTS (SELECT 1 FROM public.sla_acceptances a WHERE a.ticket_id = _ticket AND a.consultant_id = cid AND a.snapshot_id = sn.id) END,
    'acceptances', CASE WHEN role IN ('client', 'client_manager', 'admin') THEN (SELECT count(*) FROM public.sla_acceptances a WHERE a.ticket_id = _ticket AND a.snapshot_id = sn.id) END,
    'require_acceptance', COALESCE((public.sla_settings() ->> 'require_acceptance')::boolean, true),
    'counters', CASE WHEN role IN ('client', 'client_manager', 'admin') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'consultant_id', k.consultant_id, 'targets', k.targets, 'note', k.note, 'created_at', k.created_at))
                   FROM public.sla_counter_proposals k WHERE k.ticket_id = _ticket AND k.status = 'pending'), '[]'::jsonb)
                     WHEN cid IS NOT NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'targets', k.targets, 'note', k.note, 'status', k.status, 'created_at', k.created_at))
                   FROM public.sla_counter_proposals k WHERE k.ticket_id = _ticket AND k.consultant_id = cid), '[]'::jsonb) END,
    'reclass', (SELECT jsonb_build_object('id', r.id, 'from', r.from_severity, 'to', r.to_severity, 'reason', r.reason, 'created_at', r.created_at)
                  FROM public.sla_reclass_requests r WHERE r.ticket_id = _ticket AND r.status = 'pending' AND role <> 'candidate'),
    'newer_policy', CASE WHEN e_pid IS NOT NULL AND (e_pid IS DISTINCT FROM sn.policy_id OR e_ver IS DISTINCT FROM sn.policy_version)
                         THEN jsonb_build_object('policy_id', e_pid, 'version', e_ver, 'name', e_name) END,
    'can', jsonb_build_object(
      'acknowledge', role = 'consultant', 'workaround', role = 'consultant', 'propose_reclass', role = 'consultant',
      'accept', role IN ('candidate', 'consultant') AND cid IS NOT NULL, 'counter', role = 'candidate',
      'decide', role IN ('client', 'client_manager', 'admin'), 'reclassify', role = 'admin',
      'apply_policy', role IN ('client', 'client_manager', 'admin'), 'breach_choice', role IN ('client', 'client_manager', 'admin')));
END $$;

-- SLA columns for ticket lists (only tickets the viewer may see; at most 200 ids).
CREATE OR REPLACE FUNCTION public.sla_list_states(_tickets uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ticket_id', s.ticket_id, 'severity', s.severity, 'calendar', s.data -> 'calendar',
           'clocks', (SELECT jsonb_agg(public.sla_clock_json(c, s.data -> 'calendar')) FROM public.sla_ticket_clocks c WHERE c.ticket_id = s.ticket_id))), '[]'::jsonb)
    FROM public.sla_ticket_snapshots s
   WHERE s.superseded_at IS NULL AND s.ticket_id = ANY (_tickets[1:200])
     AND public.sla_ticket_role(s.ticket_id, auth.uid()) IN ('admin', 'client', 'client_manager', 'company', 'consultant')
$$;

CREATE OR REPLACE FUNCTION public.sla_accept(_ticket uuid, _context text DEFAULT 'assignment')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); role text := public.sla_ticket_role(_ticket, uid); cid uuid; sn public.sla_ticket_snapshots; summary text;
BEGIN
  IF role NOT IN ('candidate', 'consultant') THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF _context NOT IN ('assignment', 'bid', 'team') THEN RAISE EXCEPTION 'sla_bad_context' USING ERRCODE = '22023'; END IF;
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  SELECT * INTO sn FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL;
  IF sn.id IS NULL THEN RETURN jsonb_build_object('accepted', false, 'reason', 'no_sla'); END IF;
  summary := sn.severity || ' response ' || public.sla_fmt_minutes((sn.data ->> 'response_min')::numeric) || ', resolution '
    || public.sla_fmt_minutes((sn.data ->> 'resolution_min')::numeric) || CASE WHEN sn.data -> 'calendar' ->> 'mode' = 'business' THEN ' (business hours)' ELSE ' (24x7)' END
    || ' - ' || sn.policy_name || ' v' || sn.policy_version;
  INSERT INTO public.sla_acceptances (ticket_id, consultant_id, user_id, snapshot_id, policy_id, policy_version, summary, context)
  VALUES (_ticket, cid, uid, sn.id, sn.policy_id, sn.policy_version, summary, _context)
  ON CONFLICT (ticket_id, consultant_id, snapshot_id) DO NOTHING;
  PERFORM public.sla_event(_ticket, 'accepted', uid, jsonb_build_object('version', sn.policy_version, 'severity', sn.severity));
  RETURN jsonb_build_object('accepted', true, 'snapshot_id', sn.id, 'summary', summary);
END $$;

CREATE OR REPLACE FUNCTION public.sla_counter_propose(_ticket uuid, _targets jsonb, _note text DEFAULT '', _proposal uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cid uuid; sn public.sla_ticket_snapshots; b jsonb := public.sla_settings() -> 'bounds'; r int; res int; w int; id uuid; t record;
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'candidate' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_counter:' || uid, 10, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  SELECT * INTO sn FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL;
  IF sn.id IS NULL THEN RAISE EXCEPTION 'sla_no_policy' USING ERRCODE = 'P0002'; END IF;
  r := (_targets ->> 'response_min')::int; res := (_targets ->> 'resolution_min')::int;
  w := CASE WHEN jsonb_typeof(_targets -> 'workaround_min') = 'number' THEN (_targets ->> 'workaround_min')::int END;
  IF r IS NULL OR res IS NULL OR r < COALESCE((b -> 'min_response' ->> sn.severity)::int, 1) OR res < COALESCE((b -> 'min_resolution' ->> sn.severity)::int, 1)
     OR res <= r OR r > 525600 OR res > 525600 OR (w IS NOT NULL AND (w < r OR w > res)) THEN
    RAISE EXCEPTION 'sla_outside_bounds' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sla_counter_proposals (ticket_id, consultant_id, user_id, snapshot_id, proposal_id, targets, note)
  VALUES (_ticket, cid, uid, sn.id, _proposal, jsonb_strip_nulls(jsonb_build_object('response_min', r, 'resolution_min', res, 'workaround_min', w)), left(COALESCE(_note, ''), 500))
  ON CONFLICT (ticket_id, consultant_id) WHERE status = 'pending' DO UPDATE SET targets = EXCLUDED.targets, note = EXCLUDED.note, snapshot_id = EXCLUDED.snapshot_id, created_at = now()
  RETURNING sla_counter_proposals.id INTO id;
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  PERFORM public.safe_insert_notification(t.client_id, 'SLA counter-proposal', 'A consultant proposed different SLA targets for "' || t.title || '".', 'sla', '/client/tickets/' || _ticket);
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION public.sla_decide_counter(_id uuid, _accept boolean, _note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); k public.sla_counter_proposals;
BEGIN
  SELECT * INTO k FROM public.sla_counter_proposals WHERE id = _id FOR UPDATE;
  IF k.id IS NULL OR k.status <> 'pending' THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.sla_client_can_act(k.ticket_id, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sla_counter_proposals SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, decided_by = uid, decided_at = now() WHERE id = _id;
  IF _accept THEN
    UPDATE public.sla_counter_proposals SET status = 'withdrawn', decided_at = now() WHERE ticket_id = k.ticket_id AND status = 'pending' AND id <> _id;
    PERFORM public.sla_apply_snapshot(k.ticket_id, 'counter_accepted', uid, 'carry', NULL, NULLIF(_note, ''), NULL, NULL, k.targets);
    -- The proposing consultant's acceptance carries over to the new snapshot (these are his own targets).
    INSERT INTO public.sla_acceptances (ticket_id, consultant_id, user_id, snapshot_id, policy_id, policy_version, summary, context)
    SELECT k.ticket_id, k.consultant_id, k.user_id, s.id, s.policy_id, s.policy_version, 'Counter-proposal accepted by the client', 'bid'
      FROM public.sla_ticket_snapshots s WHERE s.ticket_id = k.ticket_id AND s.superseded_at IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
  PERFORM public.safe_insert_notification(k.user_id, CASE WHEN _accept THEN 'SLA counter-proposal accepted' ELSE 'SLA counter-proposal declined' END,
    CASE WHEN _accept THEN 'The client accepted your SLA targets.' ELSE 'The client kept the original SLA targets.' END, 'sla', '/consultant/cases/' || k.ticket_id);
END $$;

CREATE OR REPLACE FUNCTION public.sla_acknowledge(_ticket uuid, _note text DEFAULT '', _eta timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'consultant' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_ack:' || uid, 30, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  IF _eta IS NOT NULL AND (_eta < now() - interval '1 hour' OR _eta > now() + interval '180 days') THEN RAISE EXCEPTION 'sla_bad_eta' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sla_acknowledgements (ticket_id, user_id, note, eta) VALUES (_ticket, uid, left(COALESCE(_note, ''), 500), _eta);
  PERFORM public.sla_event(_ticket, 'acknowledged', uid, jsonb_strip_nulls(jsonb_build_object('note', NULLIF(left(_note, 500), ''), 'eta', _eta)));
END $$;

CREATE OR REPLACE FUNCTION public.sla_mark_workaround(_ticket uuid, _note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.sla_ticket_clocks; sn public.sla_ticket_snapshots; used numeric;
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'consultant' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.sla_ticket_clocks WHERE ticket_id = _ticket AND kind = 'workaround' FOR UPDATE;
  IF c.ticket_id IS NULL OR c.met_at IS NOT NULL OR c.started_at IS NULL THEN RAISE EXCEPTION 'sla_no_open_workaround' USING ERRCODE = '55000'; END IF;
  SELECT * INTO sn FROM public.sla_ticket_snapshots WHERE id = c.snapshot_id;
  used := c.consumed_min + CASE WHEN c.running_since IS NOT NULL THEN public.sla_business_minutes(c.running_since, now(), sn.data -> 'calendar') ELSE 0 END;
  UPDATE public.sla_ticket_clocks SET consumed_min = used, met_at = now(), stopped_at = now(), running_since = NULL, paused_since = NULL, due_at = NULL,
         breached_at = COALESCE(breached_at, CASE WHEN used > target_min + extended_min THEN now() END), updated_at = now()
   WHERE ticket_id = _ticket AND kind = 'workaround';
  UPDATE public.sla_ticket_pauses SET ended_at = now() WHERE ticket_id = _ticket AND clock = 'workaround' AND ended_at IS NULL;
  PERFORM public.sla_event(_ticket, 'workaround_met', uid, jsonb_strip_nulls(jsonb_build_object('note', NULLIF(left(_note, 300), ''))));
END $$;

-- Internal: change severity (urgency) with a logged reason; the urgency trigger recomputes the targets from now.
CREATE OR REPLACE FUNCTION public.sla_set_severity(_ticket uuid, _severity text, _reason text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE urg text; cur text;
BEGIN
  SELECT e.key INTO urg FROM jsonb_each_text(public.sla_settings() -> 'urgency_map') e WHERE e.value = _severity
   ORDER BY array_position(ARRAY['critical', 'high', 'medium', 'low'], e.key) LIMIT 1;
  IF urg IS NULL THEN RAISE EXCEPTION 'sla_bad_severity' USING ERRCODE = '22023'; END IF;
  SELECT tk.urgency::text INTO cur FROM public.tickets tk WHERE tk.id = _ticket;
  PERFORM set_config('sla.reason', left(COALESCE(_reason, ''), 300), true);
  IF cur IS DISTINCT FROM urg THEN
    UPDATE public.tickets SET urgency = urg::urgency_level WHERE id = _ticket;
  ELSE
    PERFORM public.sla_apply_snapshot(_ticket, 'reclassified', _actor, 'fresh', _severity, _reason);
  END IF;
  PERFORM set_config('sla.reason', '', true);
  INSERT INTO public.sla_audit (actor_id, action, ticket_id, detail) VALUES (_actor, 'reclassify', _ticket, jsonb_build_object('to', _severity, 'reason', left(_reason, 300)));
END $$;

CREATE OR REPLACE FUNCTION public.sla_reclassify(_ticket uuid, _severity text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); u uuid; t record;
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'sla_reason_required' USING ERRCODE = '22023'; END IF;
  IF NOT public.sla_text_ok(_reason) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  PERFORM public.sla_set_severity(_ticket, _severity, _reason, uid);
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  FOR u IN SELECT t.client_id UNION SELECT a.user_id FROM public.sla_assigned(_ticket) a LOOP
    PERFORM public.safe_insert_notification(u, 'Ticket severity changed to ' || _severity, '"' || t.title || '": ' || left(_reason, 300), 'sla',
      CASE WHEN u = t.client_id THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sla_propose_reclass(_ticket uuid, _severity text, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sn public.sla_ticket_snapshots; id uuid; t record;
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'consultant' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_reclass:' || uid, 5, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 3 OR NOT public.sla_text_ok(_reason) THEN RAISE EXCEPTION 'sla_reason_required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO sn FROM public.sla_ticket_snapshots WHERE ticket_id = _ticket AND superseded_at IS NULL;
  IF sn.id IS NULL OR sn.severity = _severity THEN RAISE EXCEPTION 'sla_bad_severity' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sla_reclass_requests (ticket_id, from_severity, to_severity, reason, proposed_by)
  VALUES (_ticket, sn.severity, _severity, left(_reason, 500), uid) RETURNING sla_reclass_requests.id INTO id;
  PERFORM public.sla_event(_ticket, 'reclass_proposed', uid, jsonb_build_object('from', sn.severity, 'to', _severity, 'reason', left(_reason, 300)));
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  PERFORM public.safe_insert_notification(t.client_id, 'Severity change proposed', 'The consultant proposes ' || _severity || ' for "' || t.title || '". Please accept or decline.', 'sla', '/client/tickets/' || _ticket);
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION public.sla_decide_reclass(_id uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r public.sla_reclass_requests;
BEGIN
  SELECT * INTO r FROM public.sla_reclass_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'pending' THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.sla_client_can_act(r.ticket_id, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sla_reclass_requests SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, decided_by = uid, decided_at = now() WHERE id = _id;
  IF _accept THEN PERFORM public.sla_set_severity(r.ticket_id, r.to_severity, r.reason, uid);
  ELSE PERFORM public.sla_event(r.ticket_id, 'reclass_declined', uid, jsonb_build_object('to', r.to_severity));
  END IF;
  PERFORM public.safe_insert_notification(r.proposed_by, CASE WHEN _accept THEN 'Severity change accepted' ELSE 'Severity change declined' END,
    'Your proposal ' || r.from_severity || ' → ' || r.to_severity || ' was ' || CASE WHEN _accept THEN 'accepted.' ELSE 'declined.' END, 'sla', '/consultant/cases/' || r.ticket_id);
END $$;

-- "Apply new policy to this ticket": both parties informed; counted minutes are kept.
CREATE OR REPLACE FUNCTION public.sla_apply_new_policy(_ticket uuid, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); e record; sn public.sla_ticket_snapshots; sid uuid; u uuid; t record;
BEGIN
  IF NOT public.sla_client_can_act(_ticket, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  SELECT * INTO sn FROM public.sla_ticket_snapshots WHERE ticket_id = _ticket AND superseded_at IS NULL;
  SELECT * INTO e FROM public.sla_effective_policy(_ticket);
  IF sn.id IS NULL OR e.policy_id IS NULL OR (e.policy_id = sn.policy_id AND e.version = sn.policy_version) THEN
    RETURN jsonb_build_object('changed', false);
  END IF;
  sid := public.sla_apply_snapshot(_ticket, 'new_policy', uid, 'carry', sn.severity, NULLIF(_note, ''), e.policy_id, e.version);
  INSERT INTO public.sla_audit (actor_id, action, ticket_id, policy_id, detail) VALUES (uid, 'apply_to_ticket', _ticket, e.policy_id, jsonb_build_object('version', e.version));
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  FOR u IN SELECT a.user_id FROM public.sla_assigned(_ticket) a UNION SELECT t.client_id LOOP
    PERFORM public.safe_insert_notification(u, 'SLA policy changed on a ticket', '"' || t.title || '" now follows ' || e.name || ' v' || e.version || '.', 'sla',
      CASE WHEN u = t.client_id THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket);
  END LOOP;
  RETURN jsonb_build_object('changed', true, 'snapshot_id', sid);
END $$;

-- Client choice after a breach: extend (adds counted minutes, up to the original target again), ask for another
-- consultant (admin uses the existing replace flow) or request admin help.
CREATE OR REPLACE FUNCTION public.sla_breach_choice(_ticket uuid, _clock text, _choice text, _extend_min integer DEFAULT NULL, _note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.sla_ticket_clocks; a uuid; t record;
BEGIN
  IF NOT public.sla_client_can_act(_ticket, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF _choice NOT IN ('extend', 'reassign', 'admin_help') THEN RAISE EXCEPTION 'sla_bad_choice' USING ERRCODE = '22023'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sla_rate_ok('sla_choice:' || uid, 20, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  SELECT * INTO c FROM public.sla_ticket_clocks WHERE ticket_id = _ticket AND kind = _clock FOR UPDATE;
  IF c.ticket_id IS NULL OR c.breached_at IS NULL OR c.met_at IS NOT NULL THEN RAISE EXCEPTION 'sla_not_breached' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.sla_breach_choices (ticket_id, clock, choice, extend_min, note, chosen_by) VALUES (_ticket, _clock, _choice, _extend_min, left(COALESCE(_note, ''), 500), uid);
  IF _choice = 'extend' THEN
    IF _extend_min IS NULL OR _extend_min < 15 OR c.extended_min + _extend_min > c.target_min * 3 THEN RAISE EXCEPTION 'sla_bad_extension' USING ERRCODE = '22023'; END IF;
    UPDATE public.sla_ticket_clocks SET extended_min = extended_min + _extend_min, breached_at = NULL, updated_at = now() WHERE ticket_id = _ticket AND kind = _clock;
    -- The next steps of the ladder may fire again for the extended target.
    DELETE FROM public.sla_reminders_sent WHERE ticket_id = _ticket AND snapshot_id = c.snapshot_id AND (step_key LIKE _clock || ':%' OR step_key = 'breach_actions:' || _clock);
    PERFORM public.sla_reconcile(_ticket);
  ELSE
    SELECT left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
      PERFORM public.safe_insert_notification(a, CASE WHEN _choice = 'reassign' THEN 'Client asks for another consultant (SLA)' ELSE 'Client asks for admin help (SLA)' END,
        '"' || t.title || '"' || CASE WHEN NULLIF(_note, '') IS NOT NULL THEN ': ' || left(_note, 300) ELSE '' END, 'sla', '/admin/tickets');
    END LOOP;
  END IF;
  PERFORM public.sla_event(_ticket, 'breach_choice', uid, jsonb_strip_nulls(jsonb_build_object('clock', _clock, 'choice', _choice, 'extend_min', _extend_min)));
END $$;

-- ------------------------------------------------------------------------------------------------ reports
CREATE OR REPLACE FUNCTION public.sla_report_rows(_since timestamptz)
RETURNS TABLE (ticket_id uuid, title text, tenant_id uuid, client_id uuid, consultant_id uuid, severity text, kind text, target numeric,
               used numeric, met_at timestamptz, breached_at timestamptz, due_at timestamptz, paused boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, left(t.title, 120), t.tenant_id, t.client_id, t.consultant_id, s.severity, c.kind, c.target_min + c.extended_min,
         c.consumed_min + CASE WHEN c.running_since IS NOT NULL THEN public.sla_business_minutes(c.running_since, now(), s.data -> 'calendar') ELSE 0 END,
         c.met_at, c.breached_at, c.due_at, c.paused_since IS NOT NULL, t.created_at
    FROM public.sla_ticket_clocks c
    JOIN public.sla_ticket_snapshots s ON s.id = c.snapshot_id
    JOIN public.tickets t ON t.id = c.ticket_id
   WHERE c.started_at IS NOT NULL AND (c.met_at IS NULL OR c.met_at >= _since)
$$;

CREATE OR REPLACE FUNCTION public.sla_summarise(_rows jsonb, _at_risk numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH r AS (SELECT x FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) x)
  SELECT jsonb_build_object(
    'by_severity', COALESCE((SELECT jsonb_object_agg(sev, v) FROM (
        SELECT x ->> 'severity' AS sev, jsonb_build_object(
          'measured', count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL),
          'met', count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL),
          'pct', round(100.0 * count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL) / NULLIF(count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL), 0), 1),
          'avg_response_min', round(avg((x ->> 'used')::numeric) FILTER (WHERE x ->> 'kind' = 'response' AND x ->> 'met_at' IS NOT NULL)),
          'avg_resolution_min', round(avg((x ->> 'used')::numeric) FILTER (WHERE x ->> 'kind' = 'resolution' AND x ->> 'met_at' IS NOT NULL))) AS v
          FROM r GROUP BY x ->> 'severity') q), '{}'::jsonb),
    'pct', (SELECT round(100.0 * count(*) FILTER (WHERE x ->> 'breached_at' IS NULL) / NULLIF(count(*), 0), 1) FROM r WHERE x ->> 'met_at' IS NOT NULL),
    'breached_open', (SELECT count(DISTINCT x ->> 'ticket_id') FROM r WHERE x ->> 'met_at' IS NULL AND x ->> 'breached_at' IS NOT NULL),
    'at_risk', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'due_at')) FROM (SELECT x FROM r WHERE x ->> 'met_at' IS NULL
          AND (x ->> 'breached_at' IS NOT NULL OR (x ->> 'used')::numeric >= (x ->> 'target')::numeric * _at_risk / 100) LIMIT 50) q), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.sla_client_report(_tenant uuid DEFAULT NULL, _days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); rows jsonb;
BEGIN
  IF NOT public.sla_can_read_owner(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tenant_id' - 'client_id' - 'consultant_id'), '[]'::jsonb) INTO rows
    FROM public.sla_report_rows(now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 30), 1), 365))) r
   WHERE (_tenant IS NOT NULL AND r.tenant_id = _tenant) OR (_tenant IS NULL AND r.client_id = uid);
  RETURN public.sla_summarise(rows, COALESCE((public.sla_settings() ->> 'at_risk_pct')::numeric, 75)) || jsonb_build_object('enabled', public.sla_enabled(), 'days', _days);
END $$;

CREATE OR REPLACE FUNCTION public.sla_consultant_report(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cid uuid; rows jsonb;
BEGIN
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  IF cid IS NULL THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tenant_id' - 'client_id' - 'consultant_id'), '[]'::jsonb) INTO rows
    FROM public.sla_report_rows(now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 30), 1), 365))) r
   WHERE EXISTS (SELECT 1 FROM public.sla_assigned(r.ticket_id) a WHERE a.consultant_id = cid);
  RETURN public.sla_summarise(rows, COALESCE((public.sla_settings() ->> 'at_risk_pct')::numeric, 75)) || jsonb_build_object('enabled', public.sla_enabled(), 'days', _days);
END $$;

CREATE OR REPLACE FUNCTION public.sla_admin_report(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); rows jsonb; base jsonb;
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'company', COALESCE((SELECT t.name FROM public.tenants t WHERE t.id = r.tenant_id), (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = r.client_id LIMIT 1)),
           'consultant', (SELECT p.display_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = r.consultant_id LIMIT 1),
           'reason', CASE WHEN r.breached_at IS NULL THEN NULL WHEN r.kind = 'response' THEN 'response_breach' WHEN r.kind = 'workaround' THEN 'workaround_breach' ELSE 'resolution_breach' END,
           'acknowledged', EXISTS (SELECT 1 FROM public.sla_acknowledgements a WHERE a.ticket_id = r.ticket_id),
           'had_pauses', EXISTS (SELECT 1 FROM public.sla_ticket_pauses p WHERE p.ticket_id = r.ticket_id AND p.clock = r.kind))), '[]'::jsonb) INTO rows
    FROM public.sla_report_rows(now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 30), 1), 365))) r;
  base := public.sla_summarise(rows, COALESCE((public.sla_settings() ->> 'at_risk_pct')::numeric, 75));
  RETURN base || jsonb_build_object('enabled', public.sla_enabled(), 'days', _days,
    'by_company', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', k, 'measured', m, 'pct', p) ORDER BY p NULLS LAST) FROM (
        SELECT x ->> 'company' AS k, count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL) AS m,
               round(100.0 * count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL) / NULLIF(count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL), 0), 1) AS p
          FROM jsonb_array_elements(rows) x GROUP BY 1) q), '[]'::jsonb),
    'by_consultant', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', k, 'measured', m, 'pct', p) ORDER BY p NULLS LAST) FROM (
        SELECT x ->> 'consultant' AS k, count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL) AS m,
               round(100.0 * count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL) / NULLIF(count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL), 0), 1) AS p
          FROM jsonb_array_elements(rows) x WHERE x ->> 'consultant' IS NOT NULL GROUP BY 1) q), '[]'::jsonb),
    'breaches', COALESCE((SELECT jsonb_agg(x ORDER BY x ->> 'breached_at' DESC) FROM (SELECT x FROM jsonb_array_elements(rows) x WHERE x ->> 'breached_at' IS NOT NULL LIMIT 500) q), '[]'::jsonb),
    'alert_pct', (public.sla_settings() ->> 'compliance_alert_pct')::numeric);
END $$;

-- Admin dry run: what a ticket would get under a policy version and when each step would fire (nothing is written).
CREATE OR REPLACE FUNCTION public.sla_admin_simulate(_ticket uuid, _policy uuid DEFAULT NULL, _version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); pid uuid := _policy; ver integer := _version; data jsonb; sev text; st jsonb; plan jsonb := '[]'::jsonb; tgt numeric; th numeric; start timestamptz := now();
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF pid IS NULL THEN SELECT e.policy_id, e.version INTO pid, ver FROM public.sla_effective_policy(_ticket) e; END IF;
  IF ver IS NULL THEN SELECT p.active_version INTO ver FROM public.sla_policies p WHERE p.id = pid; END IF;
  SELECT public.sla_severity_for(tk.urgency::text) INTO sev FROM public.tickets tk WHERE tk.id = _ticket;
  data := public.sla_snapshot_data(pid, ver, sev, _ticket);
  IF data IS NULL THEN RETURN NULL; END IF;
  FOR st IN SELECT x FROM jsonb_array_elements(COALESCE(data -> 'escalations', '[]'::jsonb)) x LOOP
    tgt := (data ->> ((st ->> 'clock') || '_min'))::numeric;
    IF tgt IS NULL THEN CONTINUE; END IF;
    th := CASE WHEN st ->> 'kind' = 'percent' THEN ceil(tgt * (st ->> 'value')::numeric / 100) ELSE tgt + (st ->> 'value')::numeric END;
    plan := plan || jsonb_build_object('step', st, 'at', public.sla_add_business_minutes(start, th, data -> 'calendar'),
      'recipients', (SELECT count(*) FROM public.sla_step_recipients(_ticket, st -> 'who', data -> 'extra_contacts')));
  END LOOP;
  RETURN jsonb_build_object('policy_id', pid, 'version', ver, 'severity', sev, 'data', data, 'plan', plan,
    'response_due', public.sla_add_business_minutes(start, (data ->> 'response_min')::numeric, data -> 'calendar'),
    'resolution_due', public.sla_add_business_minutes(start, (data ->> 'resolution_min')::numeric, data -> 'calendar'));
END $$;

-- ------------------------------------------------------------------------------------------------ seed: platform default + templates
-- Platform default v1 = today's live system rows of ticket_sla_policies (falls back to 60/480, 240/1440, 480/4320,
-- 1440/10080), 24x7, measured from submission, no pauses, breach notice in-app to the consultant and administrators.
DO $$
DECLARE
  pid uuid; body jsonb; sev jsonb := '{}'::jsonb; k text; u text; r int; res int; breach jsonb;
  m jsonb := '{"critical":"S1","high":"S2","medium":"S3","low":"S4"}'::jsonb;
  dflt jsonb := '{"S1":[60,480],"S2":[240,1440],"S3":[480,4320],"S4":[1440,10080]}'::jsonb;
  biz jsonb := '{"mode":"business","tz":null,"days":[0,1,2,3,4],"start":"09:00","end":"17:00","holidays":[],"holiday_lists":[]}'::jsonb;
  all_pause jsonb := '["waiting_client_info","waiting_third_party","on_hold","waiting_for_client","awaiting_nda","awaiting_brd_approval"]'::jsonb;
  tpl record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sla_policies WHERE is_default) THEN
    FOR u, k IN SELECT key, value FROM jsonb_each_text(m) LOOP
      SELECT p.response_time_minutes, p.resolution_time_minutes INTO r, res FROM public.ticket_sla_policies p
       WHERE p.client_id IS NULL AND p.is_active AND p.urgency::text = u AND p.sap_module IS NULL ORDER BY p.created_at LIMIT 1;
      r := COALESCE(r, (dflt -> k ->> 0)::int); res := COALESCE(res, (dflt -> k ->> 1)::int);
      breach := jsonb_build_array(
        jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 100, 'who', '["lead","admin"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
        jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 100, 'who', '["lead","admin"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false));
      sev := sev || jsonb_build_object(k, jsonb_build_object('response_min', r, 'workaround_min', NULL, 'resolution_min', GREATEST(res, r + 1), 'escalations', breach));
    END LOOP;
    body := jsonb_build_object('severities', sev,
      'coverage', '{"mode":"24x7","tz":null,"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59","holidays":[],"holiday_lists":[]}'::jsonb,
      'clock', '{"start":"submitted","pause":[],"stop":"resolved"}'::jsonb,
      'breach', '{"notify":true,"flag":true,"ask_client":false,"offer_replacement":false}'::jsonb, 'extra_contacts', '[]'::jsonb);
    INSERT INTO public.sla_policies (scope, is_default, name, description, status, current_version, active_version, effective_from)
    VALUES ('platform', true, 'Platform default policy', 'Today''s SLA: measured 24x7 from submission; used until a client defines its own policy.', 'active', 1, 1, now())
    RETURNING id INTO pid;
    INSERT INTO public.sla_policy_versions (policy_id, version, body, meta, change_note, content_hash)
    VALUES (pid, 1, body, jsonb_build_object('name', 'Platform default policy', 'description', '', 'applies_to', '{"kind":"all","values":[]}'::jsonb),
            'Seeded from the existing SLA rules', public.sla_hash(body, '{}'::jsonb));
  END IF;

  FOR tpl IN SELECT * FROM (VALUES
      ('standard', 'Standard', 'Business hours Sunday–Thursday 09:00–17:00, clock from assignment, full reminder ladder.', biz,
       '{"S1":[60,240,960,"full"],"S2":[120,null,960,"full"],"S3":[480,null,2400,"full"],"S4":[960,null,4800,"light"]}'::jsonb,
       '{"notify":true,"flag":true,"ask_client":true,"offer_replacement":false}'::jsonb),
      ('enterprise_24x7', 'Enterprise 24x7', 'Round-the-clock coverage with workaround target for S1 and escalation to managers.',
       '{"mode":"24x7","tz":null,"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59","holidays":[],"holiday_lists":[]}'::jsonb,
       '{"S1":[60,240,480,"full"],"S2":[120,null,1440,"full"],"S3":[480,null,2880,"full"],"S4":[1440,null,7200,"light"]}'::jsonb,
       '{"notify":true,"flag":true,"ask_client":true,"offer_replacement":true}'::jsonb),
      ('business_light', 'Business hours light', 'Business hours, relaxed targets and a short reminder ladder.', biz,
       '{"S1":[120,null,1920,"light"],"S2":[240,null,2880,"light"],"S3":[960,null,4800,"light"],"S4":[1920,null,9600,"light"]}'::jsonb,
       '{"notify":true,"flag":true,"ask_client":false,"offer_replacement":false}'::jsonb)
    ) AS x(key, name, descr, cov, targets, breach) LOOP
    IF EXISTS (SELECT 1 FROM public.sla_policies WHERE template_key = tpl.key) THEN CONTINUE; END IF;
    sev := '{}'::jsonb;
    FOREACH k IN ARRAY ARRAY['S1', 'S2', 'S3', 'S4'] LOOP
      sev := sev || jsonb_build_object(k, jsonb_build_object(
        'response_min', (tpl.targets -> k ->> 0)::int,
        'workaround_min', CASE WHEN tpl.targets -> k -> 1 = 'null'::jsonb THEN NULL ELSE (tpl.targets -> k ->> 1)::int END,
        'resolution_min', (tpl.targets -> k ->> 2)::int,
        'escalations', CASE WHEN tpl.targets -> k ->> 3 = 'full' THEN jsonb_build_array(
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 50, 'who', '["lead"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 75, 'who', '["all_assigned"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 90, 'who', '["all_assigned","client_manager"]'::jsonb, 'channels', '["in_app","email","push"]'::jsonb, 'template', 'escalation', 'repeat_min', NULL, 'until_ack', false, 'unpausable', k = 'S1'),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 100, 'who', '["lead","client_contact","admin"]'::jsonb, 'channels', '["in_app","email","push","telegram"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', k = 'S1'),
            jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 90, 'who', '["all_assigned"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'resolution', 'kind', 'after_breach', 'value', 60, 'who', '["admin","client_manager"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'after_breach', 'repeat_min', 120, 'until_ack', true, 'unpausable', false))
          ELSE jsonb_build_array(
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 75, 'who', '["lead"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 100, 'who', '["lead","client_contact"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 90, 'who', '["all_assigned"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 100, 'who', '["all_assigned","client_contact"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false))
          END));
    END LOOP;
    body := jsonb_build_object('severities', sev, 'coverage', tpl.cov,
      'clock', jsonb_build_object('start', 'assigned', 'pause', all_pause, 'stop', 'resolved'), 'breach', tpl.breach, 'extra_contacts', '[]'::jsonb);
    INSERT INTO public.sla_policies (scope, template_key, name, description, status, current_version, active_version, effective_from)
    VALUES ('template', tpl.key, tpl.name, tpl.descr, 'active', 1, 1, now()) RETURNING id INTO pid;
    INSERT INTO public.sla_policy_versions (policy_id, version, body, meta, change_note, content_hash)
    VALUES (pid, 1, body, jsonb_build_object('name', tpl.name, 'description', tpl.descr, 'applies_to', '{"kind":"all","values":[]}'::jsonb),
            'Seeded template', public.sla_hash(body, '{}'::jsonb));
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------ grants
-- Default deny for every sla_* function, then only the browser RPCs for signed-in users and worker RPCs for the server.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'sla\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  public.sla_public_settings(), public.sla_admin_set_settings(jsonb, text), public.sla_holidays_list(),
  public.sla_admin_set_holiday(text, date, text, text, boolean),
  public.sla_my_policies(uuid), public.sla_policy_get(uuid), public.sla_policy_version(uuid, integer),
  public.sla_policy_save(uuid, uuid, jsonb, jsonb, text, integer), public.sla_policy_activate(uuid, integer, timestamptz, boolean),
  public.sla_policy_archive(uuid, text), public.sla_policy_duplicate(uuid, uuid, text), public.sla_policy_restore(uuid, integer, text),
  public.sla_admin_policies(text, text, integer, integer),
  public.sla_ticket_view(uuid), public.sla_list_states(uuid[]), public.sla_accept(uuid, text),
  public.sla_counter_propose(uuid, jsonb, text, uuid), public.sla_decide_counter(uuid, boolean, text),
  public.sla_acknowledge(uuid, text, timestamptz), public.sla_mark_workaround(uuid, text),
  public.sla_reclassify(uuid, text, text), public.sla_propose_reclass(uuid, text, text), public.sla_decide_reclass(uuid, boolean),
  public.sla_apply_new_policy(uuid, text), public.sla_breach_choice(uuid, text, text, integer, text),
  public.sla_client_report(uuid, integer), public.sla_consultant_report(integer), public.sla_admin_report(integer),
  public.sla_admin_simulate(uuid, uuid, integer)
TO authenticated;