-- Client-cycle hardening M15 (remote access, VMware and the NDA before a connection; findings of the 2 Oct test round RV1-RV3):
-- A. The NDA record: a revoked NDA can be replaced (the uniqueness applies only to ACTIVE NDAs), and an NDA can no longer be saved empty, back-dated,
--    with a self-written IP address or an unknown signature type (the server sets signing time and IP).
-- B. No access without an active NDA: a consultant sees a shared remote access, an assigned environment, its connection links, its VM snapshots / actions,
--    and can open a session or queue a VM action, only while an NDA with THAT client exists and is not revoked (revoking cuts access at once).
--    Hold / cancelled / maintenance environments give no connection links and no sessions. Shares outside their start / end dates are invisible.
--    The consultant finds what waits for an NDA through my_nda_pending_access() (no host, IP or ID is shown before the NDA).
-- C. Shared access: a share starts as pending, only the consultant can accept, only the client can revoke, only a consultant who works with the client can receive one,
--    at most 20 per hour, small configuration, valid dates; client told on accept, consultant told on revoke.
-- D. Environments: only a ticket of the same client, only a consultant who works with the client (client route); the administrator assigns through
--    set_environment_consultants() (one transaction, notices); consultants listed there can really use the environment; the client may manage the connection links of
--    his own environment; the connection log is true (server time, server duration), the client sees it and is told when a session starts; status changes are announced.
-- E. VMware: link columns are validated, legacy plain-text secret columns are neutralised, only the known console actions are accepted, the owner can delete any snapshot of his VM,
--    the client is told when a consultant creates a snapshot or queues an action.

-- ===== 0. helpers =====
CREATE FUNCTION public.try_timestamptz(_t text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NULLIF(btrim(_t), '')::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.share_in_validity_period(_config jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT (public.try_timestamptz(_config ->> 'startDate') IS NULL OR public.try_timestamptz(_config ->> 'startDate') <= now())
     AND (public.try_timestamptz(_config ->> 'endDate') IS NULL OR public.try_timestamptz(_config ->> 'endDate') + interval '1 day' > now())
$function$;

-- true only for the consultant himself, the client of the NDA, or an administrator (so nobody can probe other pairs)
CREATE FUNCTION public.has_active_nda(_consultant_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.nda_agreements n
    JOIN public.consultants c ON c.id = n.consultant_id
    WHERE n.consultant_id = _consultant_id AND n.client_id = _client_id AND n.revoked_at IS NULL
      AND (c.user_id = auth.uid() OR n.client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
$function$;
REVOKE ALL ON FUNCTION public.has_active_nda(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_nda(uuid, uuid) TO authenticated;

-- may the signed-in consultant use this environment? (assigned as primary or in the list, verified, NDA with the client of the environment; optionally only while it is active)
CREATE FUNCTION public.my_consultant_env_access(_env uuid, _connectable boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.remote_environments re
    JOIN public.consultants c ON c.user_id = auth.uid() AND c.verification_status = 'verified'
    WHERE re.id = _env
      AND (re.consultant_id = c.id
           OR EXISTS (SELECT 1 FROM public.environment_consultants ec WHERE ec.environment_id = re.id AND ec.consultant_id = c.id))
      AND EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = c.id AND n.client_id = re.client_id AND n.revoked_at IS NULL)
      AND (NOT _connectable OR re.status::text = 'active')
  )
$function$;
REVOKE ALL ON FUNCTION public.my_consultant_env_access(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_consultant_env_access(uuid, boolean) TO authenticated;

-- a consultant put on an environment by the administrator must be able to sign the NDA of that client (only for the signing policy; other relations stay as they are)
CREATE FUNCTION public.consultant_has_environment_for_client(_consultant_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _consultant_id AND c.user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.remote_environments re
                 WHERE re.client_id = _client_id
                   AND (re.consultant_id = _consultant_id
                        OR EXISTS (SELECT 1 FROM public.environment_consultants ec WHERE ec.environment_id = re.id AND ec.consultant_id = _consultant_id)))
$function$;
REVOKE ALL ON FUNCTION public.consultant_has_environment_for_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_has_environment_for_client(uuid, uuid) TO authenticated;

-- 20 shares per hour per person (the bucket is the caller's own, so nobody can use up another person's quota)
CREATE FUNCTION public.consume_remote_share_quota()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.check_rate_limit('remote-share:' || auth.uid()::text, 20, 3600)
$function$;
REVOKE ALL ON FUNCTION public.consume_remote_share_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_remote_share_quota() TO authenticated;

-- ===== A. the NDA record =====
ALTER TABLE public.nda_agreements DROP CONSTRAINT nda_agreements_consultant_id_client_id_key;
CREATE UNIQUE INDEX nda_agreements_one_active_per_pair ON public.nda_agreements (consultant_id, client_id) WHERE revoked_at IS NULL;

DROP POLICY "Verified consultants can sign NDAs for clients they work with" ON public.nda_agreements;
CREATE POLICY "Verified consultants can sign NDAs for clients they work with" ON public.nda_agreements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = nda_agreements.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified')
    AND (public.consultant_related_to_client(consultant_id, client_id, true) OR public.consultant_has_environment_for_client(consultant_id, client_id))
  );

CREATE FUNCTION public.guard_nda_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _ip text;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF NEW.signature_data IS NULL OR length(btrim(NEW.signature_data)) < 2 OR length(NEW.signature_data) > 400000 THEN
    RAISE EXCEPTION 'A signature is required (and must be smaller than 400 KB)' USING ERRCODE = '22023';
  END IF;
  IF NEW.signature_type IS NULL OR NEW.signature_type NOT IN ('type', 'draw') THEN
    RAISE EXCEPTION 'Unknown signature type' USING ERRCODE = '22023';
  END IF;
  IF NEW.nda_content IS NULL OR length(btrim(NEW.nda_content)) < 20 OR length(NEW.nda_content) > 200000 THEN
    RAISE EXCEPTION 'The NDA text is missing or too long' USING ERRCODE = '22023';
  END IF;
  NEW.signed_at := now();
  NEW.created_at := now();
  NEW.revoked_at := NULL;
  NEW.revoked_by := NULL;
  BEGIN
    _ip := NULLIF(btrim(split_part(COALESCE(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  EXCEPTION WHEN others THEN
    _ip := NULL;
  END;
  NEW.ip_address := _ip;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_nda_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_nda_insert BEFORE INSERT ON public.nda_agreements
  FOR EACH ROW EXECUTE FUNCTION public.guard_nda_insert();

-- ===== B + C. shared remote access =====
DROP POLICY "Consultants can view shared configs" ON public.shared_remote_configs;
CREATE POLICY "Consultants can view shared configs after the NDA" ON public.shared_remote_configs
  FOR SELECT TO authenticated
  USING (
    status IS DISTINCT FROM 'revoked'
    AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = shared_remote_configs.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified')
    AND public.has_active_nda(consultant_id, client_id)
    AND public.share_in_validity_period(config)
  );
DROP POLICY "Consultants can accept shared configs" ON public.shared_remote_configs;
CREATE POLICY "Consultants can accept shared configs after the NDA" ON public.shared_remote_configs
  FOR UPDATE TO authenticated
  USING (
    status IS DISTINCT FROM 'revoked'
    AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = shared_remote_configs.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified')
    AND public.has_active_nda(consultant_id, client_id)
    AND public.share_in_validity_period(config)
  );

CREATE FUNCTION public.guard_shared_remote_config_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _start timestamptz;
  _end timestamptz;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' OR NEW.accepted_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'A new share starts as pending' USING ERRCODE = '42501';
    END IF;
    NEW.shared_at := now();
  END IF;

  IF TG_OP = 'INSERT' OR NEW.config IS DISTINCT FROM OLD.config THEN
    IF length(NEW.config::text) > 4000 THEN
      RAISE EXCEPTION 'The configuration is too large' USING ERRCODE = '22023';
    END IF;
    _start := public.try_timestamptz(NEW.config ->> 'startDate');
    _end := public.try_timestamptz(NEW.config ->> 'endDate');
    IF (COALESCE(NEW.config ->> 'startDate', '') <> '' AND _start IS NULL)
       OR (COALESCE(NEW.config ->> 'endDate', '') <> '' AND _end IS NULL) THEN
      RAISE EXCEPTION 'Invalid start or end date' USING ERRCODE = '22023';
    END IF;
    IF _end IS NOT NULL AND (_end + interval '1 day' <= now() OR (_start IS NOT NULL AND _end < _start)) THEN
      RAISE EXCEPTION 'The end date is in the past or before the start date' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.consultant_related_to_client(NEW.consultant_id, NEW.client_id, true) THEN
      RAISE EXCEPTION 'You can only share remote access with a consultant who works with you' USING ERRCODE = '42501';
    END IF;
    IF NOT public.consume_remote_share_quota() THEN
      RAISE EXCEPTION 'Too many shares in the last hour; please try again later' USING ERRCODE = '54000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.uid() = OLD.client_id THEN
      IF NOT (NEW.status = 'revoked' AND OLD.status <> 'revoked') THEN
        RAISE EXCEPTION 'A client can only revoke a share' USING ERRCODE = '42501';
      END IF;
      NEW.revoked_at := now();
      NEW.accepted_at := OLD.accepted_at;
    ELSE
      IF NOT (OLD.status = 'pending' AND NEW.status = 'accepted') THEN
        RAISE EXCEPTION 'A consultant can only accept a pending share' USING ERRCODE = '42501';
      END IF;
      NEW.accepted_at := now();
    END IF;
  ELSE
    NEW.accepted_at := OLD.accepted_at;
    NEW.revoked_at := OLD.revoked_at;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_shared_remote_config_rules() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_shared_remote_config_rules BEFORE INSERT OR UPDATE ON public.shared_remote_configs
  FOR EACH ROW EXECUTE FUNCTION public.guard_shared_remote_config_rules();

CREATE FUNCTION public.notify_shared_remote_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cu uuid;
  _name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT p.display_name INTO _name
    FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id
    WHERE c.id = NEW.consultant_id;
    PERFORM public.safe_insert_notification(NEW.client_id, 'Remote access accepted',
      COALESCE(_name, 'The consultant') || ' accepted the ' || NEW.tool_type || ' remote access you shared.', 'remote_access', '/client/remote-access');
  ELSIF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    SELECT c.user_id INTO _cu FROM public.consultants c WHERE c.id = NEW.consultant_id;
    IF _cu IS NOT NULL AND EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = NEW.consultant_id AND n.client_id = NEW.client_id AND n.revoked_at IS NULL) THEN
      SELECT p.display_name INTO _name FROM public.profiles p WHERE p.user_id = NEW.client_id;
      PERFORM public.safe_insert_notification(_cu, 'Remote access revoked',
        COALESCE(_name, 'A client') || ' revoked the ' || NEW.tool_type || ' remote access.', 'remote_access', '/consultant/remote-access');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_shared_remote_config_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_shared_remote_config_change AFTER UPDATE OF status ON public.shared_remote_configs
  FOR EACH ROW EXECUTE FUNCTION public.notify_shared_remote_config_change();

-- ===== B + D. environments, connections, sessions =====
DROP POLICY "Consultants can view assigned environments" ON public.remote_environments;
CREATE POLICY "Consultants can view assigned environments after the NDA" ON public.remote_environments
  FOR SELECT TO authenticated
  USING (public.my_consultant_env_access(id));

DROP POLICY "Consultants can view assigned env connections" ON public.environment_connections;
CREATE POLICY "Consultants can view connections of active environments after the NDA" ON public.environment_connections
  FOR SELECT TO authenticated
  USING (public.my_consultant_env_access(environment_id, true));
DROP POLICY "Clients can view own env connections" ON public.environment_connections;
CREATE POLICY "Clients can manage own env connections" ON public.environment_connections
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = environment_connections.environment_id AND re.client_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = environment_connections.environment_id AND re.client_id = auth.uid()));

DROP POLICY "Users log sessions on environments they can see" ON public.environment_sessions;
CREATE POLICY "Users log sessions on environments they may use" ON public.environment_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = environment_sessions.environment_id AND re.client_id = auth.uid())
         OR public.my_consultant_env_access(environment_id, true))
  );
CREATE POLICY "Clients can view sessions on own environments" ON public.environment_sessions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = environment_sessions.environment_id AND re.client_id = auth.uid()));

CREATE FUNCTION public.guard_environment_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.connected_at := now();
    NEW.disconnected_at := NULL;
    NEW.duration_minutes := NULL;
    RETURN NEW;
  END IF;
  IF ROW(NEW.environment_id, NEW.user_id, NEW.connected_at) IS DISTINCT FROM ROW(OLD.environment_id, OLD.user_id, OLD.connected_at) THEN
    RAISE EXCEPTION 'A session row can only be closed' USING ERRCODE = '42501';
  END IF;
  IF OLD.disconnected_at IS NOT NULL THEN
    NEW.disconnected_at := OLD.disconnected_at;
    NEW.duration_minutes := OLD.duration_minutes;
  ELSE
    NEW.disconnected_at := now();
    NEW.duration_minutes := GREATEST(0, round(extract(epoch FROM (now() - OLD.connected_at)) / 60))::int;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_environment_session() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_environment_session BEFORE INSERT OR UPDATE ON public.environment_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_environment_session();

CREATE FUNCTION public.notify_environment_session_started()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _env text;
  _who text;
BEGIN
  SELECT re.client_id, re.name INTO _client, _env FROM public.remote_environments re WHERE re.id = NEW.environment_id;
  IF _client IS NOT NULL AND _client IS DISTINCT FROM NEW.user_id THEN
    SELECT p.display_name INTO _who FROM public.profiles p WHERE p.user_id = NEW.user_id;
    PERFORM public.safe_insert_notification(_client, 'Remote session started',
      COALESCE(_who, 'A consultant') || ' connected to "' || _env || '".', 'remote_access', '/client/remote-access');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_environment_session_started() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_environment_session_started AFTER INSERT ON public.environment_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_environment_session_started();

CREATE FUNCTION public.guard_remote_environment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF NEW.ticket_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id)
     AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = NEW.ticket_id AND t.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'The ticket does not belong to this client' USING ERRCODE = '42501';
  END IF;
  IF NEW.consultant_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.consultant_id IS DISTINCT FROM OLD.consultant_id)
     AND NOT public.consultant_related_to_client(NEW.consultant_id, NEW.client_id, true) THEN
    RAISE EXCEPTION 'Only a consultant who works with you can be put on an environment' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_remote_environment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_remote_environment_rules BEFORE INSERT OR UPDATE ON public.remote_environments
  FOR EACH ROW EXECUTE FUNCTION public.guard_remote_environment();

CREATE FUNCTION public.notify_environment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _u uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    FOR _u IN
      SELECT DISTINCT c.user_id
      FROM public.consultants c
      WHERE (c.id = NEW.consultant_id OR c.id IN (SELECT ec.consultant_id FROM public.environment_consultants ec WHERE ec.environment_id = NEW.id))
        AND EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = c.id AND n.client_id = NEW.client_id AND n.revoked_at IS NULL)
    LOOP
      PERFORM public.safe_insert_notification(_u, 'Environment status changed',
        'A client environment you work on is now ' || NEW.status::text || '.', 'remote_access', '/consultant/remote-access');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_environment_status_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_environment_status_change AFTER UPDATE OF status ON public.remote_environments
  FOR EACH ROW EXECUTE FUNCTION public.notify_environment_status_change();

-- the administrator assigns consultants in ONE call: only the differences are written, the primary consultant stays consistent, the people concerned are told
CREATE FUNCTION public.set_environment_consultants(_environment_id uuid, _consultant_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _env record;
  _new uuid[];
  _id uuid;
  _user uuid;
  _name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an administrator can assign consultants' USING ERRCODE = '42501';
  END IF;
  SELECT re.id, re.name, re.client_id, re.consultant_id INTO _env FROM public.remote_environments re WHERE re.id = _environment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Environment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(x.id ORDER BY x.ord), ARRAY[]::uuid[]) INTO _new
  FROM (SELECT DISTINCT ON (u.id) u.id, u.ord
        FROM unnest(COALESCE(_consultant_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS u(id, ord)
        ORDER BY u.id, u.ord) AS x;
  IF EXISTS (SELECT 1 FROM unnest(_new) AS u(id) WHERE NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = u.id AND c.verification_status = 'verified')) THEN
    RAISE EXCEPTION 'Only verified consultants can be assigned' USING ERRCODE = '42501';
  END IF;

  FOR _id IN SELECT ec.consultant_id FROM public.environment_consultants ec WHERE ec.environment_id = _environment_id AND NOT (ec.consultant_id = ANY (_new)) LOOP
    DELETE FROM public.environment_consultants WHERE environment_id = _environment_id AND consultant_id = _id;
    SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = _id;
    IF _user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_user, 'Environment access removed',
        'You no longer have access to a client environment.', 'remote_access', '/consultant/remote-access');
    END IF;
  END LOOP;

  FOR _id IN SELECT u.id FROM unnest(_new) AS u(id) WHERE NOT EXISTS (SELECT 1 FROM public.environment_consultants ec WHERE ec.environment_id = _environment_id AND ec.consultant_id = u.id) LOOP
    INSERT INTO public.environment_consultants (environment_id, consultant_id, assigned_by) VALUES (_environment_id, _id, auth.uid());
    SELECT c.user_id, p.display_name INTO _user, _name FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = _id;
    IF _user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_user, 'Client environment assigned',
        'A client environment was assigned to you. Sign the client''s NDA in Remote Access to see it.', 'remote_access', '/consultant/remote-access');
    END IF;
    PERFORM public.safe_insert_notification(_env.client_id, 'Consultant assigned to your environment',
      COALESCE(_name, 'A consultant') || ' was assigned to "' || _env.name || '". They can connect only after signing your NDA.', 'remote_access', '/client/remote-access');
  END LOOP;

  UPDATE public.remote_environments
  SET consultant_id = CASE WHEN _env.consultant_id = ANY (_new) THEN _env.consultant_id ELSE _new[1] END
  WHERE id = _environment_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_environment_consultants(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_environment_consultants(uuid, uuid[]) TO authenticated;

-- what waits for the signed-in consultant's NDA (no host, IP, ID or environment name is shown before the NDA)
CREATE FUNCTION public.my_nda_pending_access()
RETURNS TABLE(kind text, ref_id uuid, client_id uuid, client_name text, detail text, since timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT c.id FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified'
  )
  SELECT 'share'::text, s.id, s.client_id, COALESCE(p.display_name, 'A client'), s.tool_type, s.shared_at
  FROM public.shared_remote_configs s
  JOIN me ON me.id = s.consultant_id
  LEFT JOIN public.profiles p ON p.user_id = s.client_id
  WHERE s.status IS DISTINCT FROM 'revoked'
    AND public.share_in_validity_period(s.config)
    AND NOT EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = s.consultant_id AND n.client_id = s.client_id AND n.revoked_at IS NULL)
  UNION ALL
  SELECT 'environment'::text, re.id, re.client_id, COALESCE(p.display_name, 'A client'), re.status::text, re.created_at
  FROM public.remote_environments re
  JOIN me ON (re.consultant_id = me.id OR EXISTS (SELECT 1 FROM public.environment_consultants ec WHERE ec.environment_id = re.id AND ec.consultant_id = me.id))
  LEFT JOIN public.profiles p ON p.user_id = re.client_id
  WHERE re.status::text <> 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = me.id AND n.client_id = re.client_id AND n.revoked_at IS NULL)
$function$;
REVOKE ALL ON FUNCTION public.my_nda_pending_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_nda_pending_access() TO authenticated;

-- ===== E. VMware =====
DROP POLICY "Snapshots visible to env owner, assigned consultant, or admin" ON public.vmware_snapshots;
CREATE POLICY "Snapshots visible to env owner, consultant with NDA, or admin" ON public.vmware_snapshots
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = vmware_snapshots.environment_id AND re.client_id = auth.uid())
    OR public.my_consultant_env_access(environment_id)
  );
DROP POLICY "Users create snapshots on environments they can see" ON public.vmware_snapshots;
CREATE POLICY "Owner or consultant with NDA creates snapshots" ON public.vmware_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = vmware_snapshots.environment_id AND re.client_id = auth.uid())
         OR public.my_consultant_env_access(environment_id, true))
  );
DROP POLICY "Users can delete own snapshots" ON public.vmware_snapshots;
CREATE POLICY "Creator or environment owner deletes snapshots" ON public.vmware_snapshots
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = vmware_snapshots.environment_id AND re.client_id = auth.uid())
  );

DROP POLICY "VM actions visible to env owner, assigned consultant, or admin" ON public.vmware_vm_actions;
CREATE POLICY "VM actions visible to env owner, consultant with NDA, or admin" ON public.vmware_vm_actions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = vmware_vm_actions.environment_id AND re.client_id = auth.uid())
    OR public.my_consultant_env_access(environment_id)
  );
DROP POLICY "Users queue actions on environments they can see" ON public.vmware_vm_actions;
CREATE POLICY "Owner or consultant with NDA queues actions" ON public.vmware_vm_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    initiated_by = auth.uid()
    AND (EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = vmware_vm_actions.environment_id AND re.client_id = auth.uid())
         OR public.my_consultant_env_access(environment_id, true))
  );

CREATE FUNCTION public.guard_vmware_vm_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF NEW.action IS NULL OR NEW.action NOT IN ('start', 'stop', 'restart', 'suspend', 'restore_snapshot') THEN
    RAISE EXCEPTION 'Unknown VM action' USING ERRCODE = '22023';
  END IF;
  IF NEW.status IS NULL OR NEW.status NOT IN ('pending', 'completed') THEN
    RAISE EXCEPTION 'Invalid action status' USING ERRCODE = '22023';
  END IF;
  NEW.error_message := NULL;
  NEW.created_at := now();
  NEW.completed_at := CASE WHEN NEW.status = 'completed' THEN now() ELSE NULL END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_vmware_vm_action() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_vmware_vm_action BEFORE INSERT ON public.vmware_vm_actions
  FOR EACH ROW EXECUTE FUNCTION public.guard_vmware_vm_action();

CREATE FUNCTION public.guard_vmware_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NULL OR NEW.status NOT IN ('creating', 'active') THEN
    RAISE EXCEPTION 'Invalid snapshot status' USING ERRCODE = '22023';
  END IF;
  NEW.size_gb := NULL;
  NEW.created_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_vmware_snapshot() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_vmware_snapshot BEFORE INSERT ON public.vmware_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.guard_vmware_snapshot();

CREATE FUNCTION public.notify_vmware_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _env text;
  _actor uuid;
  _who text;
  _what text;
BEGIN
  _actor := COALESCE(to_jsonb(NEW) ->> 'initiated_by', to_jsonb(NEW) ->> 'created_by')::uuid;
  SELECT re.client_id, re.name INTO _client, _env FROM public.remote_environments re WHERE re.id = NEW.environment_id;
  IF _client IS NOT NULL AND _actor IS NOT NULL AND _client IS DISTINCT FROM _actor THEN
    SELECT p.display_name INTO _who FROM public.profiles p WHERE p.user_id = _actor;
    _what := CASE TG_TABLE_NAME
               WHEN 'vmware_snapshots' THEN 'created the snapshot "' || left(COALESCE(to_jsonb(NEW) ->> 'name', ''), 80) || '"'
               ELSE 'ran the action "' || left(COALESCE(to_jsonb(NEW) ->> 'action', ''), 40) || '"'
             END;
    PERFORM public.safe_insert_notification(_client, 'VMware change by a consultant',
      COALESCE(_who, 'A consultant') || ' ' || _what || ' on "' || _env || '".', 'remote_access', '/client/vmware-console');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_vmware_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_vmware_snapshot AFTER INSERT ON public.vmware_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.notify_vmware_change();
CREATE TRIGGER trg_notify_vmware_action AFTER INSERT ON public.vmware_vm_actions
  FOR EACH ROW EXECUTE FUNCTION public.notify_vmware_change();

CREATE FUNCTION public.neutralise_legacy_vmware_secrets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.vcenter_password_encrypted IS NOT NULL THEN
    NEW.vcenter_password_encrypted := 'ENCRYPTED';
  END IF;
  IF NEW.cloud_api_key_encrypted IS NOT NULL THEN
    NEW.cloud_api_key_encrypted := 'ENCRYPTED';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.neutralise_legacy_vmware_secrets() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_neutralise_legacy_vmware_secrets BEFORE INSERT OR UPDATE ON public.vmware_settings
  FOR EACH ROW EXECUTE FUNCTION public.neutralise_legacy_vmware_secrets();
CREATE TRIGGER trg_guard_url_columns_vmware BEFORE INSERT OR UPDATE ON public.vmware_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_url_columns('vcenter_url', 'cloud_api_endpoint');