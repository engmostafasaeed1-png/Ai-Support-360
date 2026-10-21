-- Feature P — modern user management console. PREPARED ONLY: the owner applies this file; the assistant never does.
-- One file for all phases (A list/discovery, B user detail, C actions, D bulk, E permissions/access review,
-- F security/monitoring) so they cannot be applied out of order. Safe to apply more than once.
--
-- Uses live objects: user_roles, has_role, check_rate_limit, platform_flag, safe_insert_notification, audit_logs,
-- profiles, consultants, client_profiles, tenants, tenant_members, tickets, proposals, payments,
-- consultant_payout_details, suppressed_emails, email_send_log, notifications, consultant_missing_fields,
-- profile_rules_config, consultant_completion, admin_incomplete_consultants.
-- Optional (probed with to_regclass / to_regprocedure, never required): founding_consultants,
-- consultant_policy_versions / consultant_policy_acknowledgements, consultant_location_blocked, consultant_policy_blocked_ids.
--
-- Security model
--   * Every admin function is SECURITY DEFINER with a fixed search_path, checks the caller's permission through
--     admin_can() and is rate limited per admin through check_rate_limit(); EXECUTE is revoked from PUBLIC and anon.
--   * Granular admin permissions apply to this Users console. Admins who belong to no admin group keep full admin
--     permissions (today's behaviour); putting an admin in a group limits them to that group's permissions.
--     Super admins always have every permission. Other admin pages keep using the admin role.
--   * Only super admins grant or remove admin / super admin; nobody changes their own roles; the last super admin
--     can never be removed, suspended or deleted. Optional 4-eyes approval for granting super admin (default OFF).
--   * Suspended or deleted accounts are signed out, cannot sign in, and their consultant profile leaves the
--     directory, map and matching (hidden_consultant_ids + matching_inactive_consultants below).
--   * Every admin action writes an audit_logs row (entity_type 'admin_user') with actor, target, before, after, reason.

-- ====================================================================================================================
-- 1. Tables
-- ====================================================================================================================
CREATE TABLE IF NOT EXISTS public.admin_permission_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  permissions text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(permissions) <= 40),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_permission_groups_name_key ON public.admin_permission_groups (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.admin_group_members (
  group_id uuid NOT NULL REFERENCES public.admin_permission_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  added_by uuid,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS admin_group_members_user_idx ON public.admin_group_members (user_id);

CREATE TABLE IF NOT EXISTS public.user_admin_state (
  user_id uuid PRIMARY KEY,
  tags text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(tags) <= 20),
  suspended_at timestamptz,
  suspended_until timestamptz,
  suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 500),
  suspended_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text CHECK (delete_reason IS NULL OR char_length(delete_reason) <= 500),
  anonymise_after timestamptz,
  anonymised_at timestamptz,
  merged_into uuid,
  merged_at timestamptz,
  merged_by uuid,
  merge_added_roles text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_admin_state_tags_idx ON public.user_admin_state USING gin (tags);

CREATE TABLE IF NOT EXISTS public.user_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_admin_notes_user_idx ON public.user_admin_notes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object' AND pg_column_size(params) < 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_saved_views_name_key ON public.admin_saved_views (admin_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.admin_role_grant_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL CHECK (role = 'super_admin'),
  requested_by uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_role_grant_requests_open_key
  ON public.admin_role_grant_requests (target_user_id, role) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.admin_bulk_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (char_length(action) <= 40),
  target_ids uuid[] NOT NULL CHECK (cardinality(target_ids) BETWEEN 1 AND 200),
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  undo_until timestamptz,
  undone_at timestamptz
);
CREATE INDEX IF NOT EXISTS admin_bulk_runs_actor_idx ON public.admin_bulk_runs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_action_idx ON public.audit_logs (user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs (entity_id, created_at DESC);

-- 1b. Grants (writes go through the functions below; only saved views are written directly, own rows only)
GRANT SELECT ON public.admin_permission_groups, public.admin_group_members, public.user_admin_state,
  public.user_admin_notes, public.admin_role_grant_requests, public.admin_bulk_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_saved_views TO authenticated;
GRANT ALL ON public.admin_permission_groups, public.admin_group_members, public.user_admin_state, public.user_admin_notes,
  public.admin_saved_views, public.admin_role_grant_requests, public.admin_bulk_runs TO service_role;

ALTER TABLE public.admin_permission_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_admin_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_grant_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_bulk_runs ENABLE ROW LEVEL SECURITY;

-- ====================================================================================================================
-- 2. Permissions (phase E core, needed by every other phase)
-- ====================================================================================================================
-- Grantable through admin groups. Super-admin-only permissions are never in this list:
-- admins.manage, users.merge, users.mfa_reset, users.anonymise, users.hard_delete.
CREATE OR REPLACE FUNCTION public.admin_permission_catalog()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['users.read', 'users.edit', 'users.roles', 'users.suspend', 'users.delete', 'users.invite', 'users.export',
               'users.notes', 'users.message', 'users.sessions', 'consultants.verify', 'finance.view',
               'finance.approve_payout', 'content.edit', 'settings.edit', 'audit.read', 'messages.send']::text[]
$$;

CREATE OR REPLACE FUNCTION public.admin_can(_uid uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _uid IS NULL OR _perm IS NULL THEN false
    WHEN public.has_role(_uid, 'super_admin') THEN true
    WHEN NOT public.has_role(_uid, 'admin') THEN false
    WHEN NOT (_perm = ANY (public.admin_permission_catalog())) THEN false
    -- messages.send (Feature R bulk messages) is never implied: super admins, or admins in a group that grants it.
    WHEN NOT EXISTS (SELECT 1 FROM public.admin_group_members m WHERE m.user_id = _uid) THEN _perm <> 'messages.send'
    ELSE EXISTS (SELECT 1 FROM public.admin_group_members m JOIN public.admin_permission_groups g ON g.id = m.group_id
                  WHERE m.user_id = _uid AND _perm = ANY (g.permissions))
  END
$$;

-- The signed-in user's own check (used by policies and the console).
CREATE OR REPLACE FUNCTION public.um_can(_perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.admin_can(auth.uid(), _perm)
$$;

-- Permission + per-admin hourly rate limit. Raises 42501 / P0429.
CREATE OR REPLACE FUNCTION public.um_guard(_perm text, _bucket text, _limit integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL OR NOT public.admin_can(_me, _perm) THEN
    RAISE EXCEPTION 'You do not have permission for this action' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('um:' || _bucket || ':' || _me::text, _limit, 3600) THEN
    RAISE EXCEPTION 'Too many admin actions in the last hour. Please try again later.' USING ERRCODE = 'P0429';
  END IF;
  RETURN _me;
END
$$;

CREATE OR REPLACE FUNCTION public.um_audit(_actor uuid, _action text, _target uuid, _before jsonb, _after jsonb,
  _reason text, _extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_actor, 'admin_user.' || left(_action, 40), 'admin_user', _target,
          jsonb_strip_nulls(jsonb_build_object('before', _before, 'after', _after, 'reason', left(NULLIF(btrim(_reason), ''), 500)))
          || COALESCE(_extra, '{}'::jsonb))
$$;

-- Admin actions are always recorded, even when general audit logging is switched off.
CREATE OR REPLACE FUNCTION public.guard_audit_logging()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.platform_flag('audit_logging', true)
     AND COALESCE(NEW.entity_type, '') NOT IN ('platform_settings','user_roles','admin_user')
     AND NEW.action NOT ILIKE '%role%' AND NEW.action NOT ILIKE '%setting%' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.um_is_last_super_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'super_admin')
     AND (SELECT count(*) FROM public.user_roles WHERE role = 'super_admin') <= 1
$$;

CREATE OR REPLACE FUNCTION public.my_admin_permissions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'installed', true,
    'is_super', public.has_role(auth.uid(), 'super_admin'),
    'is_admin', public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'),
    'scoped', EXISTS (SELECT 1 FROM public.admin_group_members WHERE user_id = auth.uid())
              AND NOT public.has_role(auth.uid(), 'super_admin'),
    'permissions', to_jsonb(ARRAY(
      SELECT p FROM unnest(public.admin_permission_catalog()
        || ARRAY['admins.manage','users.merge','users.mfa_reset','users.anonymise','users.hard_delete']) p
       WHERE public.admin_can(auth.uid(), p))),
    'four_eyes', public.platform_flag('super_admin_four_eyes', false),
    'security_alerts', public.platform_flag('admin_security_alerts', true))
$$;

-- 2b. Policies (read for admins with users.read; saved views own rows only)
DROP POLICY IF EXISTS "Admins read permission groups" ON public.admin_permission_groups;
CREATE POLICY "Admins read permission groups" ON public.admin_permission_groups FOR SELECT TO authenticated
  USING (public.um_can('users.read'));
DROP POLICY IF EXISTS "Admins read group members" ON public.admin_group_members;
CREATE POLICY "Admins read group members" ON public.admin_group_members FOR SELECT TO authenticated
  USING (public.um_can('users.read'));
DROP POLICY IF EXISTS "Admins read user admin state" ON public.user_admin_state;
CREATE POLICY "Admins read user admin state" ON public.user_admin_state FOR SELECT TO authenticated
  USING (public.um_can('users.read'));
DROP POLICY IF EXISTS "Admins read internal notes" ON public.user_admin_notes;
CREATE POLICY "Admins read internal notes" ON public.user_admin_notes FOR SELECT TO authenticated
  USING (public.um_can('users.notes'));
DROP POLICY IF EXISTS "Admins read grant requests" ON public.admin_role_grant_requests;
CREATE POLICY "Admins read grant requests" ON public.admin_role_grant_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Admins read own bulk runs" ON public.admin_bulk_runs;
CREATE POLICY "Admins read own bulk runs" ON public.admin_bulk_runs FOR SELECT TO authenticated
  USING (actor_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Admins manage own saved views" ON public.admin_saved_views;
CREATE POLICY "Admins manage own saved views" ON public.admin_saved_views FOR ALL TO authenticated
  USING (admin_id = auth.uid() AND public.um_can('users.read'))
  WITH CHECK (admin_id = auth.uid() AND public.um_can('users.read'));

CREATE OR REPLACE FUNCTION public.um_saved_views_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.admin_saved_views WHERE admin_id = NEW.admin_id) >= 30 THEN
    RAISE EXCEPTION 'You can keep up to 30 saved views' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_um_saved_views_limit ON public.admin_saved_views;
CREATE TRIGGER trg_um_saved_views_limit BEFORE INSERT ON public.admin_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.um_saved_views_limit();

-- ====================================================================================================================
-- 3. Small helpers
-- ====================================================================================================================
CREATE OR REPLACE FUNCTION public.um_jarr(_j jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN jsonb_typeof(_j) = 'array'
              THEN NULLIF(ARRAY(SELECT left(x, 80) FROM jsonb_array_elements_text(_j) AS x LIMIT 50), '{}'::text[]) END
$$;
CREATE OR REPLACE FUNCTION public.um_bool(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(COALESCE(_t, '')) WHEN 'true' THEN true WHEN 'false' THEN false END
$$;
CREATE OR REPLACE FUNCTION public.um_ts(_t text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _t IS NULL OR btrim(_t) = '' THEN RETURN NULL; END IF;
  RETURN _t::timestamptz;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$$;
CREATE OR REPLACE FUNCTION public.um_int(_t text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _t ~ '^\d{1,6}$' THEN _t::integer END
$$;
CREATE OR REPLACE FUNCTION public.um_mask_ip(_ip inet)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _ip IS NULL THEN NULL
              WHEN family(_ip) = 4 THEN host(network(set_masklen(_ip, 24))) || '/24'
              ELSE host(network(set_masklen(_ip, 48))) || '/48' END
$$;
CREATE OR REPLACE FUNCTION public.um_disposable_domain(_email text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(split_part(COALESCE(_email, ''), '@', 2)) = ANY (ARRAY['mailinator.com', 'guerrillamail.com', '10minutemail.com',
    'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com',
    'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'emailondeck.com', 'mohmal.com', 'tempail.com'])
$$;
CREATE OR REPLACE FUNCTION public.um_completion(_cid uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (public.consultant_completion(_cid) ->> 'percent')::integer;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$$;
CREATE OR REPLACE FUNCTION public.um_founding_ids()
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r uuid[];
BEGIN
  IF to_regclass('public.founding_consultants') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT COALESCE(array_agg(consultant_id), ARRAY[]::uuid[]) FROM public.founding_consultants WHERE revoked_at IS NULL' INTO _r;
  RETURN _r;
END
$$;
CREATE OR REPLACE FUNCTION public.um_policy_ok_ids()
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r uuid[];
BEGIN
  IF to_regclass('public.consultant_policy_acknowledgements') IS NULL OR to_regclass('public.consultant_policy_versions') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT COALESCE(array_agg(DISTINCT a.consultant_id), ARRAY[]::uuid[]) FROM public.consultant_policy_acknowledgements a
            WHERE a.version = (SELECT max(v.version) FROM public.consultant_policy_versions v)' INTO _r;
  RETURN _r;
END
$$;

-- ====================================================================================================================
-- 4. Phase A — list and discovery
-- ====================================================================================================================
-- One row per account with everything the list can filter or sort on. Internal only (no grants).
CREATE OR REPLACE FUNCTION public.um_user_base()
RETURNS TABLE (user_id uuid, email text, name text, phone text, avatar_url text, roles text[], status text,
  providers text[], email_verified boolean, mfa_enabled boolean, created_at timestamptz, last_sign_in_at timestamptz,
  last_active_at timestamptz, country text, company text, tenant_ids uuid[], tenant_names text[], consultant_id uuid,
  verification_status text, badge text, founding boolean, policy_ok boolean, open_tickets integer, payout_ready boolean,
  client_approval text, tags text[], suspended_reason text, suspended_until timestamptz, deleted_at timestamptz,
  anonymise_after timestamptz, merged_into uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH f AS (SELECT public.um_founding_ids() AS ids), p AS (SELECT public.um_policy_ok_ids() AS ids)
  SELECT u.id,
    u.email::text,
    COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), ''),
    pr.phone,
    pr.avatar_url,
    COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = u.id), ARRAY[]::text[]),
    CASE WHEN s.deleted_at IS NOT NULL THEN 'deleted'
         WHEN u.banned_until IS NOT NULL AND u.banned_until > now() THEN 'suspended'
         WHEN u.email_confirmed_at IS NULL AND u.invited_at IS NOT NULL THEN 'invited'
         WHEN u.email_confirmed_at IS NULL THEN 'pending'
         ELSE 'active' END,
    COALESCE((SELECT array_agg(DISTINCT i.provider) FROM auth.identities i WHERE i.user_id = u.id), ARRAY[]::text[]),
    u.email_confirmed_at IS NOT NULL,
    EXISTS (SELECT 1 FROM auth.mfa_factors m WHERE m.user_id = u.id AND m.status::text = 'verified'),
    u.created_at,
    u.last_sign_in_at,
    GREATEST(u.last_sign_in_at,
      (SELECT max(GREATEST(se.updated_at, se.refreshed_at AT TIME ZONE 'UTC')) FROM auth.sessions se WHERE se.user_id = u.id)),
    COALESCE(NULLIF(c.country, ''), NULLIF(cp.country, '')),
    COALESCE(NULLIF(cp.company_name, ''),
      (SELECT min(t.name) FROM public.tenant_members tm JOIN public.tenants t ON t.id = tm.tenant_id WHERE tm.user_id = u.id)),
    COALESCE((SELECT array_agg(tm.tenant_id) FROM public.tenant_members tm WHERE tm.user_id = u.id), ARRAY[]::uuid[]),
    COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM public.tenant_members tm JOIN public.tenants t ON t.id = tm.tenant_id
               WHERE tm.user_id = u.id), ARRAY[]::text[]),
    c.id,
    c.verification_status::text,
    c.ai_interview_badge,
    CASE WHEN c.id IS NULL OR f.ids IS NULL THEN NULL ELSE c.id = ANY (f.ids) END,
    CASE WHEN c.id IS NULL OR p.ids IS NULL THEN NULL ELSE c.id = ANY (p.ids) END,
    (SELECT count(*)::integer FROM public.tickets t
      WHERE (t.client_id = u.id OR (c.id IS NOT NULL AND t.consultant_id = c.id))
        AND t.status::text NOT IN ('resolved', 'closed')),
    CASE WHEN c.id IS NULL THEN NULL ELSE EXISTS (
      SELECT 1 FROM public.consultant_payout_details pd
       WHERE pd.consultant_id = c.id AND pd.acknowledged_at IS NOT NULL AND pd.acknowledged_version = 'v1') END,
    cp.approval_status,
    COALESCE(s.tags, ARRAY[]::text[]),
    s.suspended_reason,
    s.suspended_until,
    s.deleted_at,
    s.anonymise_after,
    s.merged_into
  FROM auth.users u
  CROSS JOIN f
  CROSS JOIN p
  LEFT JOIN public.profiles pr ON pr.user_id = u.id
  LEFT JOIN LATERAL (SELECT c0.* FROM public.consultants c0 WHERE c0.user_id = u.id ORDER BY c0.created_at LIMIT 1) c ON true
  LEFT JOIN LATERAL (SELECT cp0.* FROM public.client_profiles cp0 WHERE cp0.user_id = u.id ORDER BY cp0.created_at LIMIT 1) cp ON true
  LEFT JOIN public.user_admin_state s ON s.user_id = u.id
  WHERE u.is_anonymous IS NOT TRUE
$$;

-- Server-side search, filters, sorting and paging. _p keys (all optional):
--   q, roles[] ('none' = no role), status[] (active|suspended|pending|invited|deleted; deleted hidden unless asked),
--   provider (email|google), email_verified, mfa, country, org (tenant id), verification[], badge[] ('none'),
--   founding, policy, completion_min, completion_max, active_from, active_to, created_from, created_to,
--   inactive_days, open_tickets, payout_ready, tags[], sort, dir, page, page_size (10..100), ids_only.
CREATE OR REPLACE FUNCTION public.admin_users_search(_p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('users.read', 'search', 1500);
  _q text := NULLIF(left(btrim(COALESCE(_p ->> 'q', '')), 100), '');
  _like text;
  _roles text[] := public.um_jarr(_p -> 'roles');
  _status text[] := public.um_jarr(_p -> 'status');
  _provider text := NULLIF(lower(_p ->> 'provider'), '');
  _verified boolean := public.um_bool(_p ->> 'email_verified');
  _mfa boolean := public.um_bool(_p ->> 'mfa');
  _country text := NULLIF(lower(btrim(COALESCE(_p ->> 'country', ''))), '');
  _org uuid;
  _verif text[] := public.um_jarr(_p -> 'verification');
  _badges text[] := public.um_jarr(_p -> 'badge');
  _founding boolean := public.um_bool(_p ->> 'founding');
  _policy boolean := public.um_bool(_p ->> 'policy');
  _cmin integer := public.um_int(_p ->> 'completion_min');
  _cmax integer := public.um_int(_p ->> 'completion_max');
  _afrom timestamptz := public.um_ts(_p ->> 'active_from');
  _ato timestamptz := public.um_ts(_p ->> 'active_to');
  _cfrom timestamptz := public.um_ts(_p ->> 'created_from');
  _cto timestamptz := public.um_ts(_p ->> 'created_to');
  _inactive integer := public.um_int(_p ->> 'inactive_days');
  _open boolean := public.um_bool(_p ->> 'open_tickets');
  _payout boolean := public.um_bool(_p ->> 'payout_ready');
  _tags text[] := public.um_jarr(_p -> 'tags');
  _sort text := COALESCE(NULLIF(_p ->> 'sort', ''), 'created_at');
  _dir text := CASE WHEN lower(COALESCE(_p ->> 'dir', '')) = 'asc' THEN 'asc' ELSE 'desc' END;
  _page integer := GREATEST(COALESCE(public.um_int(_p ->> 'page'), 1), 1);
  _size integer := LEAST(GREATEST(COALESCE(public.um_int(_p ->> 'page_size'), 25), 10), 100);
  _ids_only boolean := COALESCE(public.um_bool(_p ->> 'ids_only'), false);
  _need_comp boolean;
  _out jsonb;
BEGIN
  IF _sort NOT IN ('created_at', 'last_active_at', 'last_sign_in_at', 'name', 'email', 'completion', 'open_tickets', 'status') THEN
    _sort := 'created_at';
  END IF;
  BEGIN _org := NULLIF(_p ->> 'org', '')::uuid; EXCEPTION WHEN OTHERS THEN _org := NULL; END;
  IF _q IS NOT NULL THEN
    _like := '%' || replace(replace(replace(lower(_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  _need_comp := _cmin IS NOT NULL OR _cmax IS NOT NULL OR _sort = 'completion';

  WITH b AS (SELECT * FROM public.um_user_base()),
  c AS (
    SELECT b.*, CASE WHEN _need_comp AND b.consultant_id IS NOT NULL THEN public.um_completion(b.consultant_id) END AS completion
      FROM b),
  f AS (
    SELECT c.* FROM c
     WHERE (_like IS NULL OR lower(c.name) LIKE _like OR lower(c.email) LIKE _like OR lower(COALESCE(c.company, '')) LIKE _like
            OR lower(COALESCE(c.phone, '')) LIKE _like OR c.user_id::text LIKE _like
            OR EXISTS (SELECT 1 FROM unnest(c.tenant_names) tn WHERE lower(tn) LIKE _like))
       AND (_roles IS NULL OR c.roles && _roles OR ('none' = ANY (_roles) AND cardinality(c.roles) = 0))
       AND (CASE WHEN _status IS NULL THEN c.status <> 'deleted' ELSE c.status = ANY (_status) END)
       AND (_provider IS NULL OR _provider = ANY (c.providers))
       AND (_verified IS NULL OR c.email_verified = _verified)
       AND (_mfa IS NULL OR c.mfa_enabled = _mfa)
       AND (_country IS NULL OR lower(COALESCE(c.country, '')) = _country)
       AND (_org IS NULL OR _org = ANY (c.tenant_ids))
       AND (_verif IS NULL OR c.verification_status = ANY (_verif))
       AND (_badges IS NULL OR c.badge = ANY (_badges) OR ('none' = ANY (_badges) AND c.consultant_id IS NOT NULL AND c.badge IS NULL))
       AND (_founding IS NULL OR c.founding IS NOT DISTINCT FROM _founding OR (_founding = false AND c.consultant_id IS NOT NULL AND c.founding IS NULL))
       AND (_policy IS NULL OR c.policy_ok IS NOT DISTINCT FROM _policy)
       AND (_cmin IS NULL OR c.completion >= _cmin)
       AND (_cmax IS NULL OR c.completion <= _cmax)
       AND (_afrom IS NULL OR c.last_active_at >= _afrom)
       AND (_ato IS NULL OR c.last_active_at <= _ato)
       AND (_cfrom IS NULL OR c.created_at >= _cfrom)
       AND (_cto IS NULL OR c.created_at <= _cto)
       AND (_inactive IS NULL OR (COALESCE(c.last_active_at, c.created_at) < now() - make_interval(days => _inactive)))
       AND (_open IS NULL OR (c.open_tickets > 0) = _open)
       AND (_payout IS NULL OR c.payout_ready IS NOT DISTINCT FROM _payout)
       AND (_tags IS NULL OR c.tags && _tags)),
  o AS (
    SELECT f.*, row_number() OVER (ORDER BY
      CASE WHEN _dir = 'asc' THEN CASE _sort WHEN 'name' THEN lower(COALESCE(NULLIF(f.name, ''), f.email)) WHEN 'email' THEN lower(f.email) WHEN 'status' THEN f.status END END ASC NULLS LAST,
      CASE WHEN _dir = 'desc' THEN CASE _sort WHEN 'name' THEN lower(COALESCE(NULLIF(f.name, ''), f.email)) WHEN 'email' THEN lower(f.email) WHEN 'status' THEN f.status END END DESC NULLS LAST,
      CASE WHEN _dir = 'asc' THEN CASE _sort WHEN 'created_at' THEN f.created_at WHEN 'last_active_at' THEN f.last_active_at WHEN 'last_sign_in_at' THEN f.last_sign_in_at END END ASC NULLS LAST,
      CASE WHEN _dir = 'desc' THEN CASE _sort WHEN 'created_at' THEN f.created_at WHEN 'last_active_at' THEN f.last_active_at WHEN 'last_sign_in_at' THEN f.last_sign_in_at END END DESC NULLS LAST,
      CASE WHEN _dir = 'asc' THEN CASE _sort WHEN 'completion' THEN f.completion WHEN 'open_tickets' THEN f.open_tickets END END ASC NULLS LAST,
      CASE WHEN _dir = 'desc' THEN CASE _sort WHEN 'completion' THEN f.completion WHEN 'open_tickets' THEN f.open_tickets END END DESC NULLS LAST,
      f.user_id) AS rn
      FROM f)
  SELECT CASE WHEN _ids_only THEN
      jsonb_build_object('total', (SELECT count(*) FROM o),
                         'ids', COALESCE((SELECT jsonb_agg(o.user_id ORDER BY o.rn) FROM o WHERE o.rn <= 200), '[]'::jsonb))
    ELSE jsonb_build_object('total', (SELECT count(*) FROM o), 'page', _page, 'page_size', _size,
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', o.user_id, 'email', o.email, 'name', o.name, 'phone', o.phone, 'avatar_url', o.avatar_url, 'roles', o.roles,
          'status', o.status, 'providers', o.providers, 'email_verified', o.email_verified, 'mfa_enabled', o.mfa_enabled,
          'created_at', o.created_at, 'last_sign_in_at', o.last_sign_in_at, 'last_active_at', o.last_active_at,
          'country', o.country, 'company', o.company, 'organisations', o.tenant_names, 'consultant_id', o.consultant_id,
          'verification_status', o.verification_status, 'badge', o.badge, 'founding', o.founding, 'policy_ok', o.policy_ok,
          'completion', COALESCE(o.completion, CASE WHEN o.consultant_id IS NOT NULL THEN public.um_completion(o.consultant_id) END),
          'open_tickets', o.open_tickets, 'payout_ready', o.payout_ready, 'client_approval', o.client_approval,
          'tags', o.tags, 'suspended_reason', o.suspended_reason, 'suspended_until', o.suspended_until,
          'deleted_at', o.deleted_at, 'anonymise_after', o.anonymise_after, 'merged_into', o.merged_into,
          'is_self', o.user_id = _me) ORDER BY o.rn)
        FROM o WHERE o.rn > (_page - 1) * _size AND o.rn <= _page * _size), '[]'::jsonb))
    END INTO _out;
  RETURN _out;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_users_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  PERFORM public.um_guard('users.read', 'stats', 600);
  WITH b AS (SELECT * FROM public.um_user_base())
  SELECT jsonb_build_object(
    'total', count(*) FILTER (WHERE status <> 'deleted'),
    'active_30d', count(*) FILTER (WHERE status = 'active' AND last_active_at >= now() - interval '30 days'),
    'new_week', count(*) FILTER (WHERE status <> 'deleted' AND created_at >= now() - interval '7 days'),
    'suspended', count(*) FILTER (WHERE status = 'suspended'),
    'unverified_email', count(*) FILTER (WHERE status IN ('pending', 'invited')),
    'deleted', count(*) FILTER (WHERE status = 'deleted'),
    'pending_approvals', count(*) FILTER (WHERE status <> 'deleted' AND (client_approval = 'awaiting_confirmation'
                                           OR verification_status IN ('pending', 'under_review'))),
    'inactive_90d', count(*) FILTER (WHERE status = 'active' AND COALESCE(last_active_at, created_at) < now() - interval '90 days'),
    'incomplete_profiles', (SELECT count(*) FROM public.consultants c WHERE cardinality(public.consultant_missing_fields(c.id)) > 0))
    INTO _out FROM b;
  RETURN _out;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_log_export(_kind text, _count integer, _filters jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := public.um_guard(CASE WHEN _kind = 'audit' THEN 'audit.read' ELSE 'users.export' END, 'export', 60);
BEGIN
  IF _kind NOT IN ('users', 'audit') THEN RAISE EXCEPTION 'Unknown export' USING ERRCODE = '22023'; END IF;
  PERFORM public.um_audit(_me, 'export_' || _kind, NULL, NULL, NULL, NULL,
    jsonb_build_object('count', GREATEST(COALESCE(_count, 0), 0), 'filters', left(COALESCE(_filters, '{}'::jsonb)::text, 1500)));
END
$$;

-- ====================================================================================================================
-- 5. Phase B — user detail
-- ====================================================================================================================
CREATE OR REPLACE FUNCTION public.admin_user_detail(_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('users.read', 'detail', 900);
  _u auth.users%ROWTYPE;
  _row jsonb;
  _cid uuid;
  _email text;
  _out jsonb;
BEGIN
  SELECT * INTO _u FROM auth.users WHERE id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'; END IF;
  _email := lower(_u.email);
  SELECT to_jsonb(b) INTO _row FROM public.um_user_base() b WHERE b.user_id = _uid;
  _cid := NULLIF(_row ->> 'consultant_id', '')::uuid;

  -- One "viewed" row per admin and person every 10 minutes keeps the history readable.
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.user_id = _me AND a.action = 'admin_user.viewed'
                  AND a.entity_id = _uid AND a.created_at > now() - interval '10 minutes') THEN
    PERFORM public.um_audit(_me, 'viewed', _uid, NULL, NULL, NULL);
  END IF;

  _out := jsonb_build_object(
    'user', _row || jsonb_build_object('completion', CASE WHEN _cid IS NOT NULL THEN public.um_completion(_cid) END,
                                       'is_self', _uid = _me,
                                       'invited_at', _u.invited_at, 'email_confirmed_at', _u.email_confirmed_at,
                                       'banned_until', _u.banned_until),
    'identities', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', i.provider, 'created_at', i.created_at,
                     'last_sign_in_at', i.last_sign_in_at) ORDER BY i.created_at) FROM auth.identities i WHERE i.user_id = _uid), '[]'::jsonb),
    'mfa', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', m.factor_type::text, 'status', m.status::text, 'created_at', m.created_at,
                     'name', m.friendly_name)) FROM auth.mfa_factors m WHERE m.user_id = _uid), '[]'::jsonb),
    'state', (SELECT to_jsonb(s) - 'merge_added_roles' FROM public.user_admin_state s WHERE s.user_id = _uid),
    'organisations', COALESCE((SELECT jsonb_agg(jsonb_build_object('tenant_id', t.id, 'name', t.name, 'org_role', tm.org_role::text,
                     'joined_at', COALESCE(tm.accepted_at, tm.joined_at, tm.created_at)) ORDER BY t.name)
                     FROM public.tenant_members tm JOIN public.tenants t ON t.id = tm.tenant_id WHERE tm.user_id = _uid), '[]'::jsonb),
    'counts', jsonb_build_object(
      'tickets_as_client', (SELECT count(*) FROM public.tickets t WHERE t.client_id = _uid),
      'tickets_as_consultant', CASE WHEN _cid IS NULL THEN 0 ELSE (SELECT count(*) FROM public.tickets t WHERE t.consultant_id = _cid) END,
      'bids', CASE WHEN _cid IS NULL THEN 0 ELSE (SELECT count(*) FROM public.proposals pp WHERE pp.consultant_id = _cid) END,
      'payments', (SELECT count(*) FROM public.payments py WHERE py.client_id = _uid OR (_cid IS NOT NULL AND py.consultant_id = _cid))),
    'recent_tickets', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT t.id, t.title, t.status::text AS status, t.created_at FROM public.tickets t
         WHERE t.client_id = _uid OR (_cid IS NOT NULL AND t.consultant_id = _cid) ORDER BY t.created_at DESC LIMIT 10) x), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object('created_at', se.created_at,
                     'last_seen_at', GREATEST(se.updated_at, se.refreshed_at AT TIME ZONE 'UTC'),
                     'user_agent', left(se.user_agent, 200), 'network', public.um_mask_ip(se.ip), 'aal', se.aal::text)
                     ORDER BY se.created_at DESC) FROM auth.sessions se WHERE se.user_id = _uid), '[]'::jsonb),
    'sign_ins', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT a.action, a.created_at, left(a.metadata ->> 'userAgent', 200) AS user_agent FROM public.audit_logs a
         WHERE a.user_id = _uid AND a.action IN ('login', 'logout', 'login_failed', 'login_preflight_failed')
         ORDER BY a.created_at DESC LIMIT 50) x), '[]'::jsonb),
    'flags', jsonb_strip_nulls(jsonb_build_object(
      'disposable_email', CASE WHEN public.um_disposable_domain(_email) THEN true END,
      'suppressed_email', CASE WHEN EXISTS (SELECT 1 FROM public.suppressed_emails se WHERE lower(se.email) = _email) THEN true END,
      'many_networks', CASE WHEN (SELECT count(DISTINCT public.um_mask_ip(se.ip)) FROM auth.sessions se
                                   WHERE se.user_id = _uid AND se.created_at > now() - interval '7 days') >= 3 THEN true END,
      'failed_sign_ins', CASE WHEN (SELECT count(*) FROM public.audit_logs a WHERE a.user_id = _uid
                                     AND a.action IN ('login_failed', 'login_preflight_failed')
                                     AND a.created_at > now() - interval '24 hours') >= 5 THEN true END,
      'admin_without_mfa', CASE WHEN (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'super_admin'))
                                 AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors m WHERE m.user_id = _uid AND m.status::text = 'verified') THEN true END,
      'never_signed_in', CASE WHEN _u.last_sign_in_at IS NULL THEN true END)),
    'suppression', (SELECT jsonb_build_object('reason', se.reason, 'created_at', se.created_at)
                      FROM public.suppressed_emails se WHERE lower(se.email) = _email ORDER BY se.created_at DESC LIMIT 1),
    'emails', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT el.template_name, el.status, el.created_at, left(el.error_message, 200) AS error FROM public.email_send_log el
         WHERE lower(el.recipient_email) = _email ORDER BY el.created_at DESC LIMIT 30) x), '[]'::jsonb),
    'notifications', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT n.title, n.type, n.is_read, n.created_at FROM public.notifications n
         WHERE n.user_id = _uid ORDER BY n.created_at DESC LIMIT 30) x), '[]'::jsonb),
    'timeline', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT a.id, a.action, a.entity_type, a.created_at, a.user_id AS actor_id,
               CASE WHEN a.user_id = _uid THEN 'self' ELSE 'other' END AS by,
               (SELECT COALESCE(NULLIF(p2.display_name, ''), 'Admin') FROM public.profiles p2 WHERE p2.user_id = a.user_id) AS actor_name,
               a.metadata - 'userAgent' - 'path' AS metadata
          FROM public.audit_logs a
         WHERE a.user_id = _uid OR a.entity_id = _uid OR (_cid IS NOT NULL AND a.entity_id = _cid)
         ORDER BY a.created_at DESC LIMIT 100) x), '[]'::jsonb),
    'notes', CASE WHEN public.admin_can(_me, 'users.notes') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body,
                     'created_at', n.created_at, 'author_id', n.author_id,
                     'author_name', (SELECT COALESCE(NULLIF(p3.display_name, ''), 'Admin') FROM public.profiles p3 WHERE p3.user_id = n.author_id))
                     ORDER BY n.created_at DESC) FROM public.user_admin_notes n WHERE n.user_id = _uid), '[]'::jsonb) END,
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name)) FROM public.admin_group_members m
                     JOIN public.admin_permission_groups g ON g.id = m.group_id WHERE m.user_id = _uid), '[]'::jsonb),
    'is_last_super_admin', public.um_is_last_super_admin(_uid));
  RETURN _out;
END
$$;

-- Export one person's data (GDPR access request). Bank and payout numbers are never included.
CREATE OR REPLACE FUNCTION public.admin_user_export(_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('users.export', 'gdpr', 30);
  _cid uuid;
  _out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _uid) THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'; END IF;
  SELECT id INTO _cid FROM public.consultants WHERE user_id = _uid ORDER BY created_at LIMIT 1;
  _out := jsonb_build_object(
    'exported_at', now(),
    'account', (SELECT jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
                  'email_confirmed_at', u.email_confirmed_at) FROM auth.users u WHERE u.id = _uid),
    'sign_in_methods', COALESCE((SELECT jsonb_agg(i.provider) FROM auth.identities i WHERE i.user_id = _uid), '[]'::jsonb),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.user_id = _uid),
    'roles', COALESCE((SELECT jsonb_agg(r.role::text) FROM public.user_roles r WHERE r.user_id = _uid), '[]'::jsonb),
    'client_profile', (SELECT to_jsonb(cp) FROM public.client_profiles cp WHERE cp.user_id = _uid LIMIT 1),
    'consultant_profile', (SELECT to_jsonb(c) - 'location' FROM public.consultants c WHERE c.id = _cid),
    'payout_details_on_file', CASE WHEN _cid IS NULL THEN false ELSE EXISTS (SELECT 1 FROM public.consultant_payout_details pd WHERE pd.consultant_id = _cid) END,
    'organisations', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', t.name, 'org_role', tm.org_role::text))
                     FROM public.tenant_members tm JOIN public.tenants t ON t.id = tm.tenant_id WHERE tm.user_id = _uid), '[]'::jsonb),
    'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status::text, 'created_at', t.created_at))
                     FROM public.tickets t WHERE t.client_id = _uid OR (_cid IS NOT NULL AND t.consultant_id = _cid)), '[]'::jsonb),
    'bids', CASE WHEN _cid IS NULL THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('ticket_id', pp.ticket_id,
                     'status', pp.status::text, 'proposed_rate', pp.proposed_rate, 'created_at', pp.created_at))
                     FROM public.proposals pp WHERE pp.consultant_id = _cid), '[]'::jsonb) END,
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('invoice_number', py.invoice_number, 'amount', py.amount, 'currency', py.currency,
                     'status', py.status::text, 'created_at', py.created_at))
                     FROM public.payments py WHERE py.client_id = _uid OR (_cid IS NOT NULL AND py.consultant_id = _cid)), '[]'::jsonb),
    'notifications', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', n.title, 'created_at', n.created_at))
                     FROM (SELECT * FROM public.notifications WHERE user_id = _uid ORDER BY created_at DESC LIMIT 500) n), '[]'::jsonb),
    'activity', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at))
                     FROM (SELECT * FROM public.audit_logs WHERE user_id = _uid ORDER BY created_at DESC LIMIT 1000) a), '[]'::jsonb),
    'deletion', (SELECT jsonb_build_object('deleted_at', s.deleted_at, 'anonymise_after', s.anonymise_after, 'anonymised_at', s.anonymised_at)
                   FROM public.user_admin_state s WHERE s.user_id = _uid));
  PERFORM public.um_audit(_me, 'gdpr_export', _uid, NULL, NULL, NULL);
  RETURN _out;
END
$$;

-- ====================================================================================================================
-- 6. Phase C — actions
-- ====================================================================================================================
-- Single role rule used by the console, bulk tools and 4-eyes approvals.
CREATE OR REPLACE FUNCTION public.um_apply_roles(_actor uuid, _target uuid, _next text[], _reason text, _from_request boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cur text[];
  _add text[];
  _rem text[];
  _after text[];
  _actor_super boolean := public.has_role(_actor, 'super_admin');
  _admin_level boolean;
  _pending uuid;
BEGIN
  IF _actor IS NULL OR _actor = _target THEN
    RAISE EXCEPTION 'You cannot change your own roles' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _target) THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'; END IF;
  _next := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(_next, ARRAY[]::text[])) AS x ORDER BY 1);
  IF EXISTS (SELECT 1 FROM unnest(_next) AS x WHERE x NOT IN ('client', 'consultant', 'admin', 'super_admin')) THEN
    RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(r.role::text ORDER BY r.role::text), ARRAY[]::text[]) INTO _cur FROM public.user_roles r WHERE r.user_id = _target;
  _add := ARRAY(SELECT x FROM unnest(_next) AS x WHERE NOT (x = ANY (_cur)));
  _rem := ARRAY(SELECT x FROM unnest(_cur) AS x WHERE NOT (x = ANY (_next)));
  IF cardinality(_add) = 0 AND cardinality(_rem) = 0 THEN
    RETURN jsonb_build_object('changed', false, 'roles', to_jsonb(_cur));
  END IF;
  _admin_level := (_add || _rem) && ARRAY['admin', 'super_admin'];
  IF (_admin_level OR 'super_admin' = ANY (_cur)) AND NOT _actor_super THEN
    RAISE EXCEPTION 'Only a super admin can grant or remove admin and super admin roles' USING ERRCODE = '42501';
  END IF;
  IF _admin_level AND char_length(btrim(COALESCE(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Please give a reason (at least 5 characters) for an admin role change' USING ERRCODE = '22023';
  END IF;
  IF 'super_admin' = ANY (_rem) AND (SELECT count(*) FROM public.user_roles WHERE role = 'super_admin') <= 1 THEN
    RAISE EXCEPTION 'The last super admin cannot be removed' USING ERRCODE = '42501';
  END IF;
  IF 'super_admin' = ANY (_add) AND NOT _from_request AND public.platform_flag('super_admin_four_eyes', false) THEN
    INSERT INTO public.admin_role_grant_requests (target_user_id, role, requested_by, reason)
    VALUES (_target, 'super_admin', _actor, left(btrim(_reason), 500))
    ON CONFLICT (target_user_id, role) WHERE status = 'pending' DO NOTHING
    RETURNING id INTO _pending;
    _add := array_remove(_add, 'super_admin');
  END IF;
  IF cardinality(_rem) > 0 THEN
    DELETE FROM public.user_roles WHERE user_id = _target AND role::text = ANY (_rem);
  END IF;
  IF cardinality(_add) > 0 THEN
    INSERT INTO public.user_roles (user_id, role) SELECT _target, x::public.app_role FROM unnest(_add) AS x ON CONFLICT DO NOTHING;
  END IF;
  SELECT COALESCE(array_agg(r.role::text ORDER BY r.role::text), ARRAY[]::text[]) INTO _after FROM public.user_roles r WHERE r.user_id = _target;
  PERFORM public.um_audit(_actor, 'set_roles', _target, jsonb_build_object('roles', _cur), jsonb_build_object('roles', _after), _reason,
    jsonb_strip_nulls(jsonb_build_object('pending_super_admin_request', _pending, 'via_approval', CASE WHEN _from_request THEN true END)));
  RETURN jsonb_build_object('changed', true, 'roles', to_jsonb(_after), 'pending_request', _pending);
END
$$;

CREATE OR REPLACE FUNCTION public.um_clean_tags(_tags text[])
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(ARRAY(SELECT DISTINCT t FROM (
    SELECT lower(btrim(x)) AS t FROM unnest(COALESCE(_tags, ARRAY[]::text[])) AS x) s
     WHERE t ~ '^[a-z0-9][a-z0-9 _-]{0,29}$' ORDER BY t LIMIT 20), ARRAY[]::text[])
$$;

-- Database-side actions for one person. Auth actions (suspend, sign-out, MFA, e-mails, delete) go through the
-- admin-manage-user server function, which records them with um_record_state below.
CREATE OR REPLACE FUNCTION public.admin_user_action(_uid uuid, _action text, _payload jsonb DEFAULT '{}'::jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid;
  _before jsonb;
  _after jsonb;
  _tags text[];
  _name text;
  _phone text;
  _lang text;
  _title text;
  _body text;
  _link text;
  _id uuid;
BEGIN
  _payload := COALESCE(_payload, '{}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _uid) THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'; END IF;
  CASE _action
  WHEN 'set_roles' THEN
    _me := public.um_guard('users.roles', 'roles', 60);
    RETURN public.um_apply_roles(_me, _uid, public.um_jarr(_payload -> 'roles'), _reason);
  WHEN 'update_profile' THEN
    _me := public.um_guard('users.edit', 'edit', 120);
    _name := NULLIF(btrim(COALESCE(_payload ->> 'display_name', '')), '');
    _phone := NULLIF(btrim(COALESCE(_payload ->> 'phone', '')), '');
    _lang := NULLIF(_payload ->> 'preferred_language', '');
    IF _name IS NULL OR char_length(_name) > 80 THEN RAISE EXCEPTION 'Name must be 1 to 80 characters' USING ERRCODE = '22023'; END IF;
    IF _phone IS NOT NULL AND (char_length(_phone) > 30 OR _phone !~ '^[+0-9 ()-]+$') THEN
      RAISE EXCEPTION 'Phone may only contain digits, spaces, +, ( ) and -' USING ERRCODE = '22023';
    END IF;
    IF _lang IS NOT NULL AND _lang NOT IN ('en', 'ar') THEN RAISE EXCEPTION 'Language must be en or ar' USING ERRCODE = '22023'; END IF;
    SELECT jsonb_build_object('display_name', p.display_name, 'phone', p.phone, 'preferred_language', p.preferred_language)
      INTO _before FROM public.profiles p WHERE p.user_id = _uid;
    IF _before IS NULL THEN
      INSERT INTO public.profiles (user_id, display_name, phone, preferred_language) VALUES (_uid, _name, _phone, COALESCE(_lang, 'en'));
    ELSE
      UPDATE public.profiles SET display_name = _name, phone = _phone, preferred_language = COALESCE(_lang, preferred_language)
       WHERE user_id = _uid;
    END IF;
    _after := jsonb_build_object('display_name', _name, 'phone', _phone, 'preferred_language', _lang);
    PERFORM public.um_audit(_me, 'update_profile', _uid, _before, _after, _reason);
    RETURN jsonb_build_object('ok', true);
  WHEN 'set_tags' THEN
    _me := public.um_guard('users.edit', 'edit', 120);
    _tags := public.um_clean_tags(public.um_jarr(_payload -> 'tags'));
    SELECT to_jsonb(s.tags) INTO _before FROM public.user_admin_state s WHERE s.user_id = _uid;
    INSERT INTO public.user_admin_state (user_id, tags) VALUES (_uid, _tags)
    ON CONFLICT (user_id) DO UPDATE SET tags = EXCLUDED.tags, updated_at = now();
    PERFORM public.um_audit(_me, 'set_tags', _uid, jsonb_build_object('tags', COALESCE(_before, '[]'::jsonb)), jsonb_build_object('tags', _tags), _reason);
    RETURN jsonb_build_object('ok', true, 'tags', to_jsonb(_tags));
  WHEN 'add_note' THEN
    _me := public.um_guard('users.notes', 'notes', 120);
    _body := btrim(COALESCE(_payload ->> 'body', ''));
    IF char_length(_body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'A note must be 1 to 2000 characters' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.user_admin_notes (user_id, author_id, body) VALUES (_uid, _me, _body) RETURNING id INTO _id;
    PERFORM public.um_audit(_me, 'add_note', _uid, NULL, NULL, NULL, jsonb_build_object('note_id', _id));
    RETURN jsonb_build_object('ok', true, 'id', _id);
  WHEN 'delete_note' THEN
    _me := public.um_guard('users.notes', 'notes', 120);
    BEGIN _id := (_payload ->> 'note_id')::uuid; EXCEPTION WHEN OTHERS THEN _id := NULL; END;
    DELETE FROM public.user_admin_notes n WHERE n.id = _id AND n.user_id = _uid
       AND (n.author_id = _me OR public.has_role(_me, 'super_admin'));
    IF NOT FOUND THEN RAISE EXCEPTION 'Only the author or a super admin can delete this note' USING ERRCODE = '42501'; END IF;
    PERFORM public.um_audit(_me, 'delete_note', _uid, NULL, NULL, _reason, jsonb_build_object('note_id', _id));
    RETURN jsonb_build_object('ok', true);
  WHEN 'notify' THEN
    _me := public.um_guard('users.message', 'message', 60);
    _title := btrim(COALESCE(_payload ->> 'title', ''));
    _body := btrim(COALESCE(_payload ->> 'body', ''));
    _link := NULLIF(btrim(COALESCE(_payload ->> 'link', '')), '');
    IF char_length(_title) NOT BETWEEN 1 AND 120 OR char_length(_body) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'Title (1-120) and message (1-1000) are required' USING ERRCODE = '22023';
    END IF;
    IF _link IS NOT NULL AND (_link !~ '^/[A-Za-z0-9/_?=&.-]*$' OR char_length(_link) > 200) THEN
      RAISE EXCEPTION 'The link must be a page on this site, starting with /' USING ERRCODE = '22023';
    END IF;
    _id := public.safe_insert_notification(_uid, _title, _body, 'admin_message', _link);
    PERFORM public.um_audit(_me, 'notify', _uid, NULL, jsonb_build_object('title', _title), _reason, jsonb_build_object('notification_id', _id));
    RETURN jsonb_build_object('ok', true, 'id', _id);
  ELSE
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023';
  END CASE;
END
$$;

-- Records what the server function did through the sign-in service (service role only).
CREATE OR REPLACE FUNCTION public.um_record_state(_actor uuid, _target uuid, _action text, _payload jsonb DEFAULT '{}'::jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _before jsonb;
  _after jsonb;
  _into uuid;
  _added text[];
BEGIN
  _payload := COALESCE(_payload, '{}'::jsonb);
  SELECT to_jsonb(s) - 'updated_at' INTO _before FROM public.user_admin_state s WHERE s.user_id = _target;
  INSERT INTO public.user_admin_state (user_id) VALUES (_target) ON CONFLICT (user_id) DO NOTHING;
  CASE _action
  WHEN 'suspend' THEN
    UPDATE public.user_admin_state SET suspended_at = now(), suspended_until = public.um_ts(_payload ->> 'until'),
      suspended_reason = left(btrim(_reason), 500), suspended_by = _actor, updated_at = now() WHERE user_id = _target;
  WHEN 'reactivate' THEN
    UPDATE public.user_admin_state SET suspended_at = NULL, suspended_until = NULL, suspended_reason = NULL, suspended_by = NULL,
      updated_at = now() WHERE user_id = _target;
  WHEN 'soft_delete' THEN
    UPDATE public.user_admin_state SET deleted_at = now(), deleted_by = _actor, delete_reason = left(btrim(_reason), 500),
      anonymise_after = now() + interval '30 days', updated_at = now() WHERE user_id = _target;
  WHEN 'restore' THEN
    IF EXISTS (SELECT 1 FROM public.user_admin_state WHERE user_id = _target AND anonymised_at IS NOT NULL) THEN
      RAISE EXCEPTION 'This account was anonymised and cannot be restored' USING ERRCODE = '42501';
    END IF;
    UPDATE public.user_admin_state SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, anonymise_after = NULL,
      updated_at = now() WHERE user_id = _target;
  WHEN 'anonymised' THEN
    UPDATE public.user_admin_state SET anonymised_at = now(), tags = ARRAY[]::text[], updated_at = now() WHERE user_id = _target;
    UPDATE public.profiles SET display_name = 'Deleted user', phone = NULL, avatar_url = NULL WHERE user_id = _target;
    DELETE FROM public.user_admin_notes WHERE user_id = _target;
  WHEN 'merge' THEN
    _into := (_payload ->> 'into')::uuid;
    IF _into IS NULL OR _into = _target OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _into) THEN
      RAISE EXCEPTION 'Choose a different account to keep' USING ERRCODE = '22023';
    END IF;
    _added := ARRAY(SELECT r.role::text FROM public.user_roles r WHERE r.user_id = _target AND r.role IN ('client', 'consultant')
                     AND NOT EXISTS (SELECT 1 FROM public.user_roles r2 WHERE r2.user_id = _into AND r2.role = r.role));
    INSERT INTO public.user_roles (user_id, role) SELECT _into, x::public.app_role FROM unnest(_added) AS x ON CONFLICT DO NOTHING;
    UPDATE public.user_admin_state SET merged_into = _into, merged_at = now(), merged_by = _actor, merge_added_roles = _added,
      updated_at = now() WHERE user_id = _target;
  WHEN 'unmerge' THEN
    SELECT merged_into, merge_added_roles INTO _into, _added FROM public.user_admin_state WHERE user_id = _target;
    IF _into IS NULL THEN RAISE EXCEPTION 'This account is not merged' USING ERRCODE = '22023'; END IF;
    DELETE FROM public.user_roles WHERE user_id = _into AND role::text = ANY (_added);
    UPDATE public.user_admin_state SET merged_into = NULL, merged_at = NULL, merged_by = NULL, merge_added_roles = ARRAY[]::text[],
      updated_at = now() WHERE user_id = _target;
  WHEN 'force_sign_out', 'password_reset', 'resend_verification', 'mfa_reset', 'hard_delete', 'invite' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023';
  END CASE;
  SELECT to_jsonb(s) - 'updated_at' INTO _after FROM public.user_admin_state s WHERE s.user_id = _target;
  PERFORM public.um_audit(_actor, _action, _target, _before, _after, _reason, COALESCE(_payload - 'until', '{}'::jsonb));
  RETURN jsonb_build_object('ok', true);
END
$$;

-- Signs the person out everywhere (refresh tokens are removed with their sessions). Service role only.
CREATE OR REPLACE FUNCTION public.um_revoke_sessions(_uid uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  DELETE FROM auth.sessions WHERE user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END
$$;

CREATE OR REPLACE FUNCTION public.um_emails_with_accounts(_emails text[])
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT lower(u.email)), ARRAY[]::text[]) FROM auth.users u
   WHERE lower(u.email) = ANY (ARRAY(SELECT lower(x) FROM unnest(COALESCE(_emails, ARRAY[]::text[])) AS x LIMIT 200))
$$;

CREATE OR REPLACE FUNCTION public.admin_merge_preview(_keep uuid, _merge uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  PERFORM public.um_guard('users.merge', 'merge', 60);
  IF _keep = _merge THEN RAISE EXCEPTION 'Choose two different accounts' USING ERRCODE = '22023'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id', b.user_id, 'email', b.email, 'name', b.name, 'roles', b.roles, 'status', b.status,
           'created_at', b.created_at, 'last_active_at', b.last_active_at, 'keep', b.user_id = _keep,
           'tickets', (SELECT count(*) FROM public.tickets t WHERE t.client_id = b.user_id OR t.consultant_id = b.consultant_id),
           'payments', (SELECT count(*) FROM public.payments py WHERE py.client_id = b.user_id OR py.consultant_id = b.consultant_id),
           'notifications', (SELECT count(*) FROM public.notifications n WHERE n.user_id = b.user_id)))
    INTO _out FROM public.um_user_base() b WHERE b.user_id IN (_keep, _merge);
  IF jsonb_array_length(COALESCE(_out, '[]'::jsonb)) <> 2 THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('accounts', _out,
    'effect', 'The second account is suspended and linked to the first. Its client/consultant roles are added to the first account. '
           || 'Tickets, payments and history stay where they are. Undo with Unmerge.');
END
$$;

-- ====================================================================================================================
-- 7. Phase D — bulk actions (max 200 per run, dry run first, 10-minute undo for reversible runs)
-- ====================================================================================================================
CREATE OR REPLACE FUNCTION public.admin_users_bulk(_action text, _ids uuid[], _payload jsonb DEFAULT '{}'::jsonb, _dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid;
  _ok uuid[] := ARRAY[]::uuid[];
  _skipped jsonb := '[]'::jsonb;
  _tags text[];
  _kind text;
  _before jsonb := '{}'::jsonb;
  _run uuid;
  _id uuid;
  _cid uuid;
  _title text;
  _body text;
  _link text;
BEGIN
  _payload := COALESCE(_payload, '{}'::jsonb);
  _ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(_ids, ARRAY[]::uuid[])) AS x);
  IF cardinality(_ids) = 0 THEN RAISE EXCEPTION 'Select at least one person' USING ERRCODE = '22023'; END IF;
  IF cardinality(_ids) > 200 THEN RAISE EXCEPTION 'A bulk action can include at most 200 people' USING ERRCODE = '22023'; END IF;
  _me := public.um_guard(CASE _action WHEN 'remind' THEN 'users.message' WHEN 'export' THEN 'users.export' ELSE 'users.edit' END,
                         'bulk' || CASE WHEN _dry_run THEN '_preview' ELSE '' END, CASE WHEN _dry_run THEN 300 ELSE 30 END);
  IF _action IN ('tag_add', 'tag_remove', 'archive') THEN
    _tags := CASE WHEN _action = 'archive' THEN ARRAY['archived'] ELSE public.um_clean_tags(public.um_jarr(_payload -> 'tags')) END;
    IF cardinality(_tags) = 0 THEN RAISE EXCEPTION 'Enter at least one valid tag' USING ERRCODE = '22023'; END IF;
  ELSIF _action = 'remind' THEN
    _kind := _payload ->> 'kind';
    IF _kind NOT IN ('profile', 'policy', 'interview') THEN RAISE EXCEPTION 'Choose profile, policy or interview' USING ERRCODE = '22023'; END IF;
  ELSIF _action <> 'export' THEN
    RAISE EXCEPTION 'Unknown bulk action' USING ERRCODE = '22023';
  END IF;

  FOREACH _id IN ARRAY _ids LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _id) THEN
      _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'not_found');
      CONTINUE;
    END IF;
    IF _action = 'remind' THEN
      SELECT c.id INTO _cid FROM public.consultants c WHERE c.user_id = _id ORDER BY c.created_at LIMIT 1;
      IF _cid IS NULL THEN _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'not_consultant'); CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.user_admin_state s JOIN auth.users u ON u.id = s.user_id WHERE s.user_id = _id AND s.deleted_at IS NOT NULL)
         OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _id AND u.banned_until > now()) THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'suspended'); CONTINUE;
      END IF;
      IF _kind = 'profile' AND COALESCE(public.um_completion(_cid), 0) >= 100 THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'already_done'); CONTINUE;
      END IF;
      IF _kind = 'interview' AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cid
                                          AND (c.ai_interview_completed_at IS NOT NULL OR c.ai_interview_badge IS NOT NULL)) THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'already_done'); CONTINUE;
      END IF;
      IF _kind = 'policy' AND (public.um_policy_ok_ids() IS NULL) THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'policy_not_installed'); CONTINUE;
      END IF;
      IF _kind = 'policy' AND _cid = ANY (public.um_policy_ok_ids()) THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'already_done'); CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = _id AND n.type = 'admin_reminder_' || _kind
                  AND n.created_at > now() - interval '24 hours') THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'reminded_recently'); CONTINUE;
      END IF;
    END IF;
    _ok := _ok || _id;
  END LOOP;

  IF _dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'eligible', to_jsonb(_ok), 'skipped', _skipped);
  END IF;
  IF cardinality(_ok) = 0 THEN
    RETURN jsonb_build_object('dry_run', false, 'done', 0, 'skipped', _skipped);
  END IF;

  IF _action IN ('tag_add', 'tag_remove', 'archive') THEN
    SELECT COALESCE(jsonb_object_agg(x, COALESCE((SELECT to_jsonb(s.tags) FROM public.user_admin_state s WHERE s.user_id = x), '[]'::jsonb)), '{}'::jsonb)
      INTO _before FROM unnest(_ok) AS x;
    INSERT INTO public.user_admin_state (user_id) SELECT x FROM unnest(_ok) AS x ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.user_admin_state s SET
      tags = CASE WHEN _action = 'tag_remove' THEN ARRAY(SELECT t FROM unnest(s.tags) AS t WHERE NOT (t = ANY (_tags)))
                  ELSE public.um_clean_tags(s.tags || _tags) END,
      updated_at = now()
     WHERE s.user_id = ANY (_ok);
  ELSIF _action = 'remind' THEN
    _title := CASE _kind WHEN 'profile' THEN 'Please complete your profile'
                         WHEN 'policy' THEN 'Please confirm the consultant service policy'
                         ELSE 'Your AI interview is waiting' END;
    _body := CASE _kind WHEN 'profile' THEN 'A complete profile helps clients find you and is needed for matching. It only takes a few minutes.'
                        WHEN 'policy' THEN 'Please read and confirm the current consultant service policy so you can keep receiving requests.'
                        ELSE 'Completing the AI interview adds to your profile completion and credibility.' END;
    _link := CASE _kind WHEN 'interview' THEN '/consultant/interviews' ELSE '/consultant/profile' END;
    FOREACH _id IN ARRAY _ok LOOP
      PERFORM public.safe_insert_notification(_id, _title, _body, 'admin_reminder_' || _kind, _link);
    END LOOP;
  END IF;

  INSERT INTO public.admin_bulk_runs (actor_id, action, target_ids, before, payload, undo_until)
  VALUES (_me, _action, _ok, _before, _payload,
          CASE WHEN _action IN ('tag_add', 'tag_remove', 'archive') THEN now() + interval '10 minutes' END)
  RETURNING id INTO _run;
  PERFORM public.um_audit(_me, 'bulk_' || _action, NULL, NULL, NULL, _payload ->> 'reason',
    jsonb_build_object('run_id', _run, 'count', cardinality(_ok), 'skipped', jsonb_array_length(_skipped), 'kind', _kind, 'tags', _tags));
  RETURN jsonb_build_object('dry_run', false, 'done', cardinality(_ok), 'skipped', _skipped, 'run_id', _run,
                            'undo_until', (SELECT undo_until FROM public.admin_bulk_runs WHERE id = _run));
END
$$;

-- Undo a tag run within its window (suspend runs are undone by the server function).
CREATE OR REPLACE FUNCTION public.admin_bulk_undo(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('users.edit', 'bulk', 30);
  _r public.admin_bulk_runs%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.admin_bulk_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR (_r.actor_id <> _me AND NOT public.has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'Run not found' USING ERRCODE = 'P0002';
  END IF;
  IF _r.undone_at IS NOT NULL OR _r.undo_until IS NULL OR _r.undo_until < now() THEN
    RAISE EXCEPTION 'The undo window for this run has passed' USING ERRCODE = '22023';
  END IF;
  IF _r.action NOT IN ('tag_add', 'tag_remove', 'archive') THEN
    RAISE EXCEPTION 'Use the server function to undo this run' USING ERRCODE = '22023';
  END IF;
  UPDATE public.user_admin_state s SET tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(_r.before -> s.user_id::text, '[]'::jsonb))),
         updated_at = now()
   WHERE s.user_id = ANY (_r.target_ids);
  UPDATE public.admin_bulk_runs SET undone_at = now() WHERE id = _run_id;
  PERFORM public.um_audit(_me, 'bulk_undo', NULL, NULL, NULL, NULL, jsonb_build_object('run_id', _run_id, 'count', cardinality(_r.target_ids)));
  RETURN jsonb_build_object('ok', true, 'count', cardinality(_r.target_ids));
END
$$;

-- ====================================================================================================================
-- 8. Phase E — admin groups, access review and 4-eyes approval
-- ====================================================================================================================
CREATE OR REPLACE FUNCTION public.admin_access_review()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := public.um_guard('users.roles', 'review', 300);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', b.user_id, 'email', b.email, 'name', b.name, 'roles', b.roles, 'status', b.status,
      'last_sign_in_at', b.last_sign_in_at, 'last_active_at', b.last_active_at, 'mfa_enabled', b.mfa_enabled,
      'is_self', b.user_id = _me,
      'groups', COALESCE((SELECT jsonb_agg(g.name ORDER BY g.name) FROM public.admin_group_members m
                           JOIN public.admin_permission_groups g ON g.id = m.group_id WHERE m.user_id = b.user_id), '[]'::jsonb),
      'scoped', EXISTS (SELECT 1 FROM public.admin_group_members m WHERE m.user_id = b.user_id) AND NOT ('super_admin' = ANY (b.roles)),
      'permissions', to_jsonb(ARRAY(SELECT p FROM unnest(public.admin_permission_catalog()) AS p WHERE public.admin_can(b.user_id, p))))
      ORDER BY ('super_admin' = ANY (b.roles)) DESC, b.last_active_at DESC NULLS LAST)
    FROM public.um_user_base() b WHERE b.roles && ARRAY['admin', 'super_admin']), '[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION public.admin_permission_groups_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.um_guard('users.read', 'groups', 300);
  RETURN jsonb_build_object('catalog', to_jsonb(public.admin_permission_catalog()),
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description,
      'permissions', to_jsonb(g.permissions), 'updated_at', g.updated_at,
      'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.user_id,
          'name', COALESCE(NULLIF((SELECT p.display_name FROM public.profiles p WHERE p.user_id = m.user_id), ''),
                           (SELECT u.email::text FROM auth.users u WHERE u.id = m.user_id))))
        FROM public.admin_group_members m WHERE m.group_id = g.id), '[]'::jsonb)) ORDER BY g.name)
      FROM public.admin_permission_groups g), '[]'::jsonb));
END
$$;

CREATE OR REPLACE FUNCTION public.admin_save_permission_group(_id uuid, _name text, _description text, _permissions text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('admins.manage', 'groups', 60);
  _perms text[];
  _before jsonb;
BEGIN
  _perms := ARRAY(SELECT DISTINCT p FROM unnest(COALESCE(_permissions, ARRAY[]::text[])) AS p ORDER BY 1);
  IF EXISTS (SELECT 1 FROM unnest(_perms) AS p WHERE NOT (p = ANY (public.admin_permission_catalog()))) THEN
    RAISE EXCEPTION 'Unknown permission' USING ERRCODE = '22023';
  END IF;
  IF NOT ('users.read' = ANY (_perms)) AND cardinality(_perms) > 0 THEN
    _perms := array_prepend('users.read', _perms);
  END IF;
  IF _id IS NULL THEN
    IF (SELECT count(*) FROM public.admin_permission_groups) >= 20 THEN
      RAISE EXCEPTION 'You can have up to 20 admin groups' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.admin_permission_groups (name, description, permissions, created_by)
    VALUES (btrim(_name), NULLIF(btrim(COALESCE(_description, '')), ''), _perms, _me) RETURNING id INTO _id;
  ELSE
    SELECT to_jsonb(g) INTO _before FROM public.admin_permission_groups g WHERE g.id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002'; END IF;
    UPDATE public.admin_permission_groups SET name = btrim(_name), description = NULLIF(btrim(COALESCE(_description, '')), ''),
      permissions = _perms, updated_at = now() WHERE id = _id;
  END IF;
  PERFORM public.um_audit(_me, 'save_admin_group', NULL, _before, jsonb_build_object('id', _id, 'name', btrim(_name), 'permissions', _perms), NULL);
  RETURN _id;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_permission_group(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('admins.manage', 'groups', 60);
  _before jsonb;
BEGIN
  SELECT to_jsonb(g) INTO _before FROM public.admin_permission_groups g WHERE g.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM public.admin_permission_groups WHERE id = _id;
  PERFORM public.um_audit(_me, 'delete_admin_group', NULL, _before, NULL, NULL);
END
$$;

CREATE OR REPLACE FUNCTION public.admin_set_group_member(_group uuid, _user uuid, _member boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('admins.manage', 'groups', 120);
  _gname text;
BEGIN
  SELECT name INTO _gname FROM public.admin_permission_groups WHERE id = _group;
  IF _gname IS NULL THEN RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002'; END IF;
  IF _member THEN
    IF NOT public.has_role(_user, 'admin') OR public.has_role(_user, 'super_admin') THEN
      RAISE EXCEPTION 'Only admins (not super admins) can be put in an admin group' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.admin_group_members (group_id, user_id, added_by) VALUES (_group, _user, _me) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.admin_group_members WHERE group_id = _group AND user_id = _user;
  END IF;
  PERFORM public.um_audit(_me, CASE WHEN _member THEN 'add_to_admin_group' ELSE 'remove_from_admin_group' END, _user, NULL,
    jsonb_build_object('group', _gname), NULL);
  PERFORM public.um_notify_super_admins('Security: admin permissions changed',
    format('%s was %s the admin group "%s".', public.um_display(_user), CASE WHEN _member THEN 'added to' ELSE 'removed from' END, _gname),
    '/admin/users?tab=access');
END
$$;

CREATE OR REPLACE FUNCTION public.admin_set_security_setting(_key text, _value boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('admins.manage', 'settings', 60);
  _before boolean;
BEGIN
  IF _key NOT IN ('super_admin_four_eyes', 'admin_security_alerts') THEN RAISE EXCEPTION 'Unknown setting' USING ERRCODE = '22023'; END IF;
  _before := public.platform_flag(_key, _key = 'admin_security_alerts');
  INSERT INTO public.platform_settings (key, value) VALUES (_key, to_jsonb(_value))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  PERFORM public.um_audit(_me, 'security_setting', NULL, jsonb_build_object(_key, _before), jsonb_build_object(_key, _value), NULL);
END
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_requests()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.um_guard('admins.manage', 'review', 300);
  UPDATE public.admin_role_grant_requests SET status = 'cancelled', decision_note = 'Expired after 7 days'
   WHERE status = 'pending' AND expires_at < now();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'target_id', r.target_user_id, 'target', public.um_display(r.target_user_id),
      'requested_by', public.um_display(r.requested_by), 'requested_by_id', r.requested_by, 'reason', r.reason, 'status', r.status,
      'created_at', r.created_at, 'expires_at', r.expires_at, 'decided_by', public.um_display(r.decided_by), 'decided_at', r.decided_at,
      'mine', r.requested_by = auth.uid()) ORDER BY r.created_at DESC)
    FROM (SELECT * FROM public.admin_role_grant_requests ORDER BY created_at DESC LIMIT 50) r), '[]'::jsonb);
END
$$;

-- A second super admin (never the requester) approves or rejects a super admin grant.
CREATE OR REPLACE FUNCTION public.admin_decide_grant_request(_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('admins.manage', 'roles', 60);
  _r public.admin_role_grant_requests%ROWTYPE;
  _roles text[];
BEGIN
  SELECT * INTO _r FROM public.admin_role_grant_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _r.status <> 'pending' THEN RAISE EXCEPTION 'This request is no longer open' USING ERRCODE = '22023'; END IF;
  IF _r.expires_at < now() THEN
    UPDATE public.admin_role_grant_requests SET status = 'cancelled', decision_note = 'Expired after 7 days' WHERE id = _id;
    RAISE EXCEPTION 'This request has expired' USING ERRCODE = '22023';
  END IF;
  IF _r.requested_by = _me AND _approve THEN
    RAISE EXCEPTION 'A different super admin must approve this request' USING ERRCODE = '42501';
  END IF;
  UPDATE public.admin_role_grant_requests SET status = CASE WHEN _approve THEN 'approved' WHEN _r.requested_by = _me THEN 'cancelled' ELSE 'rejected' END,
    decided_by = _me, decided_at = now(), decision_note = left(NULLIF(btrim(COALESCE(_note, '')), ''), 500) WHERE id = _id;
  IF _approve THEN
    SELECT COALESCE(array_agg(role::text), ARRAY[]::text[]) INTO _roles FROM public.user_roles WHERE user_id = _r.target_user_id;
    RETURN public.um_apply_roles(_me, _r.target_user_id, _roles || ARRAY['super_admin'], _r.reason || ' (approved request)', true);
  END IF;
  PERFORM public.um_audit(_me, 'reject_super_admin_request', _r.target_user_id, NULL, NULL, _note, jsonb_build_object('request_id', _id));
  RETURN jsonb_build_object('ok', true);
END
$$;

-- ====================================================================================================================
-- 9. Phase F — security and monitoring
-- ====================================================================================================================
CREATE OR REPLACE FUNCTION public.um_display(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _uid IS NULL THEN NULL ELSE COALESCE(
    NULLIF(btrim((SELECT p.display_name FROM public.profiles p WHERE p.user_id = _uid)), ''),
    (SELECT u.email::text FROM auth.users u WHERE u.id = _uid), 'Unknown account') END
$$;

-- In-app notification (and, through the existing administrator e-mail switches, an e-mail) to every super admin.
CREATE OR REPLACE FUNCTION public.um_notify_super_admins(_title text, _body text, _link text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record;
BEGIN
  IF NOT public.platform_flag('admin_security_alerts', true) THEN RETURN; END IF;
  FOR _r IN SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'super_admin' LOOP
    PERFORM public.safe_insert_notification(_r.user_id, left(_title, 120), left(_body, 1000), 'security_alert', _link);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'um_notify_super_admins failed: %', SQLERRM;
END
$$;

CREATE OR REPLACE FUNCTION public.um_role_change_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _role text := CASE WHEN TG_OP = 'DELETE' THEN OLD.role::text ELSE NEW.role::text END;
  _uid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
BEGIN
  IF _role NOT IN ('admin', 'super_admin') THEN RETURN NULL; END IF;
  PERFORM public.um_notify_super_admins('Security: admin role changed',
    format('The %s role was %s %s%s.', replace(_role, '_', ' '), CASE WHEN TG_OP = 'DELETE' THEN 'removed from' ELSE 'granted to' END,
           public.um_display(_uid), CASE WHEN auth.uid() IS NOT NULL THEN ' by ' || public.um_display(auth.uid()) ELSE '' END),
    '/admin/users?user=' || _uid::text);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_um_role_change_alert ON public.user_roles;
CREATE TRIGGER trg_um_role_change_alert AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.um_role_change_alert();

-- An admin or super admin signs in from a browser/device not seen in the last 90 days.
CREATE OR REPLACE FUNCTION public.um_admin_login_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ua text := left(NEW.metadata ->> 'userAgent', 200);
BEGIN
  IF NEW.user_id IS NULL OR _ua IS NULL OR NOT (public.has_role(NEW.user_id, 'admin') OR public.has_role(NEW.user_id, 'super_admin')) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.user_id = NEW.user_id AND a.action = 'login' AND a.id <> NEW.id
                  AND a.created_at > now() - interval '90 days') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.user_id = NEW.user_id AND a.action = 'login' AND a.id <> NEW.id
              AND a.created_at > now() - interval '90 days' AND left(a.metadata ->> 'userAgent', 200) = _ua) THEN
    RETURN NULL;
  END IF;
  PERFORM public.um_notify_super_admins('Security: admin signed in from a new device',
    format('%s signed in from a browser or device not seen in the last 90 days.', public.um_display(NEW.user_id)),
    '/admin/users?user=' || NEW.user_id::text);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_um_admin_login_alert ON public.audit_logs;
CREATE TRIGGER trg_um_admin_login_alert AFTER INSERT ON public.audit_logs
  FOR EACH ROW WHEN (NEW.action = 'login') EXECUTE FUNCTION public.um_admin_login_alert();

-- Admin-action audit viewer. _p: actor, target, action (contains), admin_only, from, to, page, page_size (max 200),
-- export (true = up to 1000 rows, recorded).
CREATE OR REPLACE FUNCTION public.admin_audit_search(_p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := public.um_guard('audit.read', 'audit', 600);
  _actor uuid;
  _target uuid;
  _action text := NULLIF(left(btrim(COALESCE(_p ->> 'action', '')), 60), '');
  _admin_only boolean := COALESCE(public.um_bool(_p ->> 'admin_only'), true);
  _from timestamptz := public.um_ts(_p ->> 'from');
  _to timestamptz := public.um_ts(_p ->> 'to');
  _export boolean := COALESCE(public.um_bool(_p ->> 'export'), false);
  _page integer := GREATEST(COALESCE(public.um_int(_p ->> 'page'), 1), 1);
  _size integer;
  _out jsonb;
BEGIN
  BEGIN _actor := NULLIF(_p ->> 'actor', '')::uuid; EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  BEGIN _target := NULLIF(_p ->> 'target', '')::uuid; EXCEPTION WHEN OTHERS THEN _target := NULL; END;
  _size := CASE WHEN _export THEN 1000 ELSE LEAST(GREATEST(COALESCE(public.um_int(_p ->> 'page_size'), 50), 10), 200) END;
  IF _export THEN _page := 1; END IF;
  WITH f AS (
    SELECT a.* FROM public.audit_logs a
     WHERE (_actor IS NULL OR a.user_id = _actor)
       AND (_target IS NULL OR a.entity_id = _target)
       AND (_action IS NULL OR a.action ILIKE '%' || replace(replace(_action, '%', '\%'), '_', '\_') || '%')
       AND (NOT _admin_only OR a.entity_type = 'admin_user' OR a.action LIKE 'admin\_%' OR a.entity_type = 'user_roles')
       AND (_from IS NULL OR a.created_at >= _from)
       AND (_to IS NULL OR a.created_at <= _to))
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f), 'page', _page, 'page_size', _size,
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'created_at', x.created_at, 'action', x.action,
        'entity_type', x.entity_type, 'target_id', x.entity_id, 'actor_id', x.user_id,
        'actor', public.um_display(x.user_id),
        'target', CASE WHEN x.entity_type IN ('admin_user', 'user') THEN public.um_display(x.entity_id) END,
        'reason', x.metadata ->> 'reason', 'before', x.metadata -> 'before', 'after', x.metadata -> 'after',
        'details', x.metadata - 'before' - 'after' - 'reason' - 'userAgent') ORDER BY x.created_at DESC)
      FROM (SELECT * FROM f ORDER BY f.created_at DESC OFFSET (_page - 1) * _size LIMIT _size) x), '[]'::jsonb))
    INTO _out;
  IF _export THEN
    PERFORM public.um_audit(_me, 'export_audit', NULL, NULL, NULL, NULL, jsonb_build_object('count', jsonb_array_length(_out -> 'rows')));
  END IF;
  RETURN _out;
END
$$;

-- 9b. Suspended or deleted accounts leave the directory, map and matching.
CREATE OR REPLACE FUNCTION public.um_suspended_consultant_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[])
    FROM public.consultants c
    JOIN auth.users u ON u.id = c.user_id
    LEFT JOIN public.user_admin_state s ON s.user_id = c.user_id
   WHERE (u.banned_until IS NOT NULL AND u.banned_until > now()) OR s.deleted_at IS NOT NULL
$$;

-- Same definition as docs/sql/matching.sql (either file may be applied last).
CREATE OR REPLACE FUNCTION public.matching_inactive_consultants()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.consultants c JOIN auth.users u ON u.id = c.user_id
   WHERE u.banned_until IS NOT NULL AND u.banned_until > now()
      OR c.verification_status IN ('suspended', 'rejected');
$$;
REVOKE ALL ON FUNCTION public.matching_inactive_consultants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.matching_inactive_consultants() TO service_role;

-- Combined rule, kept identical in consultant-location.sql, consultant-policy.sql and user-management.sql (any may be applied last):
-- profile-rule enforcement, missing location after its grace period, unconfirmed service policy after its grace period,
-- suspended or deleted accounts.
CREATE OR REPLACE FUNCTION public.hidden_consultant_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ids uuid[];
  _more uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN ARRAY[]::uuid[]; END IF;
  -- Missing weekly availability has its own grace rule (consultant_availability_blocked_ids), so it never hides on its own here.
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO _ids
    FROM public.consultants c
   WHERE COALESCE((SELECT enforce FROM public.profile_rules_config WHERE id), false)
     AND cardinality(array_remove(public.consultant_missing_fields(c.id), 'availability')) > 0;
  IF to_regprocedure('public.consultant_location_blocked(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) FROM public.consultants c WHERE public.consultant_location_blocked(c.id)' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_policy_blocked_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_policy_blocked_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.um_suspended_consultant_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.um_suspended_consultant_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_availability_blocked_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_availability_blocked_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  IF to_regprocedure('public.consultant_hold_hidden_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT public.consultant_hold_hidden_ids()' INTO _more;
    _ids := _ids || COALESCE(_more, ARRAY[]::uuid[]);
  END IF;
  RETURN ARRAY(SELECT DISTINCT x FROM unnest(_ids) AS x);
END
$function$;

-- ====================================================================================================================
-- 10. Function privileges
-- ====================================================================================================================
DO $grants$
DECLARE
  _f text;
BEGIN
  -- Callable by signed-in users; each checks the caller's admin permission itself.
  FOREACH _f IN ARRAY ARRAY[
    'public.um_can(text)', 'public.my_admin_permissions()', 'public.admin_users_search(jsonb)', 'public.admin_users_stats()',
    'public.admin_log_export(text, integer, jsonb)', 'public.admin_user_detail(uuid)', 'public.admin_user_export(uuid)',
    'public.admin_user_action(uuid, text, jsonb, text)', 'public.admin_merge_preview(uuid, uuid)',
    'public.admin_users_bulk(text, uuid[], jsonb, boolean)', 'public.admin_bulk_undo(uuid)', 'public.admin_access_review()',
    'public.admin_permission_groups_list()', 'public.admin_save_permission_group(uuid, text, text, text[])',
    'public.admin_delete_permission_group(uuid)', 'public.admin_set_group_member(uuid, uuid, boolean)',
    'public.admin_set_security_setting(text, boolean)', 'public.admin_grant_requests()',
    'public.admin_decide_grant_request(uuid, boolean, text)', 'public.admin_audit_search(jsonb)', 'public.hidden_consultant_ids()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f);
  END LOOP;
  -- Internal or server-function only.
  FOREACH _f IN ARRAY ARRAY[
    'public.admin_can(uuid, text)', 'public.um_guard(text, text, integer)',
    'public.um_audit(uuid, text, uuid, jsonb, jsonb, text, jsonb)', 'public.um_is_last_super_admin(uuid)',
    'public.um_completion(uuid)', 'public.um_founding_ids()', 'public.um_policy_ok_ids()', 'public.um_user_base()',
    'public.um_apply_roles(uuid, uuid, text[], text, boolean)', 'public.um_record_state(uuid, uuid, text, jsonb, text)',
    'public.um_revoke_sessions(uuid)', 'public.um_emails_with_accounts(text[])', 'public.um_display(uuid)',
    'public.um_notify_super_admins(text, text, text)', 'public.um_suspended_consultant_ids()',
    'public.um_saved_views_limit()', 'public.um_role_change_alert()', 'public.um_admin_login_alert()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _f);
  END LOOP;
  FOREACH _f IN ARRAY ARRAY['public.admin_permission_catalog()', 'public.um_jarr(jsonb)', 'public.um_bool(text)', 'public.um_ts(text)',
    'public.um_int(text)', 'public.um_mask_ip(inet)', 'public.um_disposable_domain(text)', 'public.um_clean_tags(text[])']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f);
  END LOOP;
END
$grants$;

-- Settings (defaults; existing values are kept)
INSERT INTO public.platform_settings (key, value) VALUES ('super_admin_four_eyes', 'false'::jsonb), ('admin_security_alerts', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Checks after applying:
--   SELECT public.my_admin_permissions();
--   SELECT public.admin_users_stats();
--   SELECT public.admin_users_search('{"page_size": 10}');
--   Full rule checks (rolled back): docs/sql/user-management.test.sql
