-- Feature O: client favourite consultants, groups, tags, private notes and the "do not suggest" list.
-- PREPARED, NOT APPLIED. The owner applies this file; until then the app hides every favourite control (fails closed).
--
-- Ownership: every row belongs to exactly one scope:
--   * a client organisation (tenant_id): every member reads; owner/admin edit (existing org roles, tenant_members);
--   * or one client without an organisation (owner_user_id): only that person reads and edits.
-- Privacy: consultants have no policy on any of these tables (they never see who saved them or why); administrators
-- have no row access either, only an aggregate count through admin_consultant_favourite_count().
-- consultant_id is a plain uuid (no foreign key), so a removed consultant stays listed as "no longer available".
-- Limits per scope: 500 favourites, 50 groups, 500 blocked; 200 members per group; 10 tags of up to 30 characters.

-- ---------------------------------------------------------------- 1. access helpers

CREATE OR REPLACE FUNCTION public.client_list_can_read(_tenant_id uuid, _owner_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _tenant_id IS NOT NULL THEN public.is_tenant_member(auth.uid(), _tenant_id)
    ELSE _owner_user_id = auth.uid()
  END
$$;

CREATE OR REPLACE FUNCTION public.client_list_can_edit(_tenant_id uuid, _owner_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _tenant_id IS NOT NULL THEN public.has_org_role(auth.uid(), _tenant_id, 'owner'::org_role)
                                  OR public.has_org_role(auth.uid(), _tenant_id, 'admin'::org_role)
    ELSE _owner_user_id = auth.uid() AND public.has_role(auth.uid(), 'client'::app_role)
  END
$$;

REVOKE ALL ON FUNCTION public.client_list_can_read(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_list_can_edit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_list_can_read(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_list_can_edit(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 2. tables

CREATE TABLE IF NOT EXISTS public.client_consultant_favourites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid,
  consultant_id uuid NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  added_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_fav_one_scope CHECK (num_nonnulls(tenant_id, owner_user_id) = 1),
  CONSTRAINT client_fav_tags_max CHECK (cardinality(tags) <= 10)
);

CREATE TABLE IF NOT EXISTS public.client_consultant_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid,
  name text NOT NULL,
  description text,
  colour text NOT NULL DEFAULT 'blue',
  icon text NOT NULL DEFAULT 'users',
  position integer NOT NULL DEFAULT 0,
  preferred_areas text[] NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_group_one_scope CHECK (num_nonnulls(tenant_id, owner_user_id) = 1),
  CONSTRAINT client_group_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT client_group_desc_len CHECK (description IS NULL OR char_length(description) <= 300),
  CONSTRAINT client_group_colour CHECK (colour IN ('blue', 'green', 'amber', 'red', 'violet', 'teal', 'slate')),
  CONSTRAINT client_group_icon CHECK (icon IN ('users', 'star', 'shield', 'zap', 'flag', 'briefcase', 'globe', 'wrench')),
  CONSTRAINT client_group_areas_max CHECK (cardinality(preferred_areas) <= 10)
);

CREATE TABLE IF NOT EXISTS public.client_consultant_group_members (
  group_id uuid NOT NULL REFERENCES public.client_consultant_groups(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  added_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, consultant_id)
);

CREATE TABLE IF NOT EXISTS public.client_consultant_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid,
  consultant_id uuid NOT NULL,
  note text NOT NULL,
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_note_one_scope CHECK (num_nonnulls(tenant_id, owner_user_id) = 1),
  CONSTRAINT client_note_len CHECK (char_length(note) BETWEEN 1 AND 2000)
);

CREATE TABLE IF NOT EXISTS public.client_consultant_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid,
  consultant_id uuid NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_block_one_scope CHECK (num_nonnulls(tenant_id, owner_user_id) = 1)
);

-- One row per scope and consultant (partial unique indexes, one per scope kind).
CREATE UNIQUE INDEX IF NOT EXISTS client_fav_tenant_uq ON public.client_consultant_favourites (tenant_id, consultant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_fav_owner_uq ON public.client_consultant_favourites (owner_user_id, consultant_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_note_tenant_uq ON public.client_consultant_notes (tenant_id, consultant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_note_owner_uq ON public.client_consultant_notes (owner_user_id, consultant_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_block_tenant_uq ON public.client_consultant_blocks (tenant_id, consultant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_block_owner_uq ON public.client_consultant_blocks (owner_user_id, consultant_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_group_tenant_name_uq ON public.client_consultant_groups (tenant_id, lower(btrim(name))) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_group_owner_name_uq ON public.client_consultant_groups (owner_user_id, lower(btrim(name))) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_group_tenant_pos_idx ON public.client_consultant_groups (tenant_id, position) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_group_owner_pos_idx ON public.client_consultant_groups (owner_user_id, position) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_group_members_consultant_idx ON public.client_consultant_group_members (consultant_id);
CREATE INDEX IF NOT EXISTS client_fav_consultant_idx ON public.client_consultant_favourites (consultant_id);

-- ---------------------------------------------------------------- 3. grants (before RLS policies)

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_consultant_favourites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_consultant_groups TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.client_consultant_group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_consultant_notes TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.client_consultant_blocks TO authenticated;
GRANT ALL ON public.client_consultant_favourites, public.client_consultant_groups, public.client_consultant_group_members,
  public.client_consultant_notes, public.client_consultant_blocks TO service_role;

-- ---------------------------------------------------------------- 4. row level security

ALTER TABLE public.client_consultant_favourites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_consultant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_consultant_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_consultant_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_consultant_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Client scope reads favourites" ON public.client_consultant_favourites;
CREATE POLICY "Client scope reads favourites" ON public.client_consultant_favourites FOR SELECT TO authenticated
  USING (public.client_list_can_read(tenant_id, owner_user_id));
DROP POLICY IF EXISTS "Client editors add favourites" ON public.client_consultant_favourites;
CREATE POLICY "Client editors add favourites" ON public.client_consultant_favourites FOR INSERT TO authenticated
  WITH CHECK (public.client_list_can_edit(tenant_id, owner_user_id) AND added_by = auth.uid());
DROP POLICY IF EXISTS "Client editors change favourites" ON public.client_consultant_favourites;
CREATE POLICY "Client editors change favourites" ON public.client_consultant_favourites FOR UPDATE TO authenticated
  USING (public.client_list_can_edit(tenant_id, owner_user_id)) WITH CHECK (public.client_list_can_edit(tenant_id, owner_user_id));
DROP POLICY IF EXISTS "Client editors remove favourites" ON public.client_consultant_favourites;
CREATE POLICY "Client editors remove favourites" ON public.client_consultant_favourites FOR DELETE TO authenticated
  USING (public.client_list_can_edit(tenant_id, owner_user_id));

DROP POLICY IF EXISTS "Client scope reads groups" ON public.client_consultant_groups;
CREATE POLICY "Client scope reads groups" ON public.client_consultant_groups FOR SELECT TO authenticated
  USING (public.client_list_can_read(tenant_id, owner_user_id));
DROP POLICY IF EXISTS "Client editors add groups" ON public.client_consultant_groups;
CREATE POLICY "Client editors add groups" ON public.client_consultant_groups FOR INSERT TO authenticated
  WITH CHECK (public.client_list_can_edit(tenant_id, owner_user_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "Client editors change groups" ON public.client_consultant_groups;
CREATE POLICY "Client editors change groups" ON public.client_consultant_groups FOR UPDATE TO authenticated
  USING (public.client_list_can_edit(tenant_id, owner_user_id)) WITH CHECK (public.client_list_can_edit(tenant_id, owner_user_id));
DROP POLICY IF EXISTS "Client editors delete groups" ON public.client_consultant_groups;
CREATE POLICY "Client editors delete groups" ON public.client_consultant_groups FOR DELETE TO authenticated
  USING (public.client_list_can_edit(tenant_id, owner_user_id));

DROP POLICY IF EXISTS "Client scope reads group members" ON public.client_consultant_group_members;
CREATE POLICY "Client scope reads group members" ON public.client_consultant_group_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_consultant_groups g WHERE g.id = group_id AND public.client_list_can_read(g.tenant_id, g.owner_user_id)));
DROP POLICY IF EXISTS "Client editors add group members" ON public.client_consultant_group_members;
CREATE POLICY "Client editors add group members" ON public.client_consultant_group_members FOR INSERT TO authenticated
  WITH CHECK (added_by = auth.uid() AND EXISTS (SELECT 1 FROM public.client_consultant_groups g WHERE g.id = group_id AND public.client_list_can_edit(g.tenant_id, g.owner_user_id)));
DROP POLICY IF EXISTS "Client editors remove group members" ON public.client_consultant_group_members;
CREATE POLICY "Client editors remove group members" ON public.client_consultant_group_members FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_consultant_groups g WHERE g.id = group_id AND public.client_list_can_edit(g.tenant_id, g.owner_user_id)));

DROP POLICY IF EXISTS "Client scope reads notes" ON public.client_consultant_notes;
CREATE POLICY "Client scope reads notes" ON public.client_consultant_notes FOR SELECT TO authenticated
  USING (public.client_list_can_read(tenant_id, owner_user_id));
DROP POLICY IF EXISTS "Client editors write notes" ON public.client_consultant_notes;
CREATE POLICY "Client editors write notes" ON public.client_consultant_notes FOR INSERT TO authenticated
  WITH CHECK (public.client_list_can_edit(tenant_id, owner_user_id) AND updated_by = auth.uid());
DROP POLICY IF EXISTS "Client editors change notes" ON public.client_consultant_notes;
CREATE POLICY "Client editors change notes" ON public.client_consultant_notes FOR UPDATE TO authenticated
  USING (public.client_list_can_edit(tenant_id, owner_user_id)) WITH CHECK (public.client_list_can_edit(tenant_id, owner_user_id) AND updated_by = auth.uid());
DROP POLICY IF EXISTS "Client editors delete notes" ON public.client_consultant_notes;
CREATE POLICY "Client editors delete notes" ON public.client_consultant_notes FOR DELETE TO authenticated
  USING (public.client_list_can_edit(tenant_id, owner_user_id));

DROP POLICY IF EXISTS "Client scope reads blocks" ON public.client_consultant_blocks;
CREATE POLICY "Client scope reads blocks" ON public.client_consultant_blocks FOR SELECT TO authenticated
  USING (public.client_list_can_read(tenant_id, owner_user_id));
DROP POLICY IF EXISTS "Client editors add blocks" ON public.client_consultant_blocks;
CREATE POLICY "Client editors add blocks" ON public.client_consultant_blocks FOR INSERT TO authenticated
  WITH CHECK (public.client_list_can_edit(tenant_id, owner_user_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "Client editors remove blocks" ON public.client_consultant_blocks;
CREATE POLICY "Client editors remove blocks" ON public.client_consultant_blocks FOR DELETE TO authenticated
  USING (public.client_list_can_edit(tenant_id, owner_user_id));

-- ---------------------------------------------------------------- 5. limits and housekeeping triggers

CREATE OR REPLACE FUNCTION public.client_list_scope_lock(_tenant_id uuid, _owner_user_id uuid)
RETURNS void
LANGUAGE sql
AS $$ SELECT pg_advisory_xact_lock(hashtext('client-list:' || COALESCE(_tenant_id, _owner_user_id)::text)) $$;

CREATE OR REPLACE FUNCTION public.client_fav_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  clean text[] := '{}';
BEGIN
  -- tags: trimmed, 1..30 characters, no duplicates (case-insensitive), at most 10
  FOREACH t IN ARRAY COALESCE(NEW.tags, '{}') LOOP
    t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
    IF t = '' THEN CONTINUE; END IF;
    IF char_length(t) > 30 THEN RAISE EXCEPTION 'client_fav_tag_too_long' USING ERRCODE = 'check_violation'; END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(clean) x WHERE lower(x) = lower(t)) THEN clean := clean || t; END IF;
  END LOOP;
  IF cardinality(clean) > 10 THEN RAISE EXCEPTION 'client_fav_tags_limit' USING ERRCODE = 'check_violation'; END IF;
  NEW.tags := clean;
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
                           OR NEW.consultant_id <> OLD.consultant_id) THEN
    RAISE EXCEPTION 'client_fav_scope_fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.client_list_scope_lock(NEW.tenant_id, NEW.owner_user_id);
    IF EXISTS (SELECT 1 FROM public.client_consultant_blocks b
               WHERE b.consultant_id = NEW.consultant_id
                 AND b.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND b.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id) THEN
      RAISE EXCEPTION 'client_fav_blocked' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM public.client_consultant_favourites f
        WHERE f.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND f.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id) >= 500 THEN
      RAISE EXCEPTION 'client_fav_limit' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_fav_before_write ON public.client_consultant_favourites;
CREATE TRIGGER client_fav_before_write BEFORE INSERT OR UPDATE ON public.client_consultant_favourites
  FOR EACH ROW EXECUTE FUNCTION public.client_fav_before_write();

-- Removing a favourite also removes the consultant from that scope's groups (the consultant record is never touched).
CREATE OR REPLACE FUNCTION public.client_fav_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.client_consultant_group_members m
  USING public.client_consultant_groups g
  WHERE m.group_id = g.id AND m.consultant_id = OLD.consultant_id
    AND g.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND g.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS client_fav_after_delete ON public.client_consultant_favourites;
CREATE TRIGGER client_fav_after_delete AFTER DELETE ON public.client_consultant_favourites
  FOR EACH ROW EXECUTE FUNCTION public.client_fav_after_delete();

CREATE OR REPLACE FUNCTION public.client_group_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.name := btrim(regexp_replace(NEW.name, '\s+', ' ', 'g'));
  NEW.description := NULLIF(btrim(COALESCE(NEW.description, '')), '');
  NEW.preferred_areas := ARRAY(SELECT DISTINCT upper(btrim(a)) FROM unnest(COALESCE(NEW.preferred_areas, '{}')) a WHERE btrim(a) <> '');
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    PERFORM public.client_list_scope_lock(NEW.tenant_id, NEW.owner_user_id);
    IF (SELECT count(*) FROM public.client_consultant_groups g
        WHERE g.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND g.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id) >= 50 THEN
      RAISE EXCEPTION 'client_group_limit' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'client_group_scope_fixed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_group_before_write ON public.client_consultant_groups;
CREATE TRIGGER client_group_before_write BEFORE INSERT OR UPDATE ON public.client_consultant_groups
  FOR EACH ROW EXECUTE FUNCTION public.client_group_before_write();

-- One preferred group per SAP area in a scope: taking an area removes it from the scope's other groups.
CREATE OR REPLACE FUNCTION public.client_group_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF cardinality(NEW.preferred_areas) > 0 THEN
    UPDATE public.client_consultant_groups g
       SET preferred_areas = ARRAY(SELECT a FROM unnest(g.preferred_areas) a WHERE NOT a = ANY (NEW.preferred_areas))
     WHERE g.id <> NEW.id
       AND g.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND g.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id
       AND g.preferred_areas && NEW.preferred_areas;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS client_group_after_write ON public.client_consultant_groups;
CREATE TRIGGER client_group_after_write AFTER INSERT OR UPDATE OF preferred_areas ON public.client_consultant_groups
  FOR EACH ROW WHEN (pg_trigger_depth() < 1) EXECUTE FUNCTION public.client_group_after_write();

-- Group members: at most 200 per group; a member is always a favourite of the same scope (added when missing).
CREATE OR REPLACE FUNCTION public.client_group_member_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.client_consultant_groups%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.client_consultant_groups WHERE id = NEW.group_id;
  IF g.archived_at IS NOT NULL THEN RAISE EXCEPTION 'client_group_archived' USING ERRCODE = 'check_violation'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('client-group:' || NEW.group_id::text));
  IF (SELECT count(*) FROM public.client_consultant_group_members WHERE group_id = NEW.group_id) >= 200 THEN
    RAISE EXCEPTION 'client_group_members_limit' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_consultant_favourites f
                 WHERE f.consultant_id = NEW.consultant_id
                   AND f.tenant_id IS NOT DISTINCT FROM g.tenant_id AND f.owner_user_id IS NOT DISTINCT FROM g.owner_user_id) THEN
    INSERT INTO public.client_consultant_favourites (tenant_id, owner_user_id, consultant_id, added_by)
    VALUES (g.tenant_id, g.owner_user_id, NEW.consultant_id, NEW.added_by);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_group_member_before_insert ON public.client_consultant_group_members;
CREATE TRIGGER client_group_member_before_insert BEFORE INSERT ON public.client_consultant_group_members
  FOR EACH ROW EXECUTE FUNCTION public.client_group_member_before_insert();

CREATE OR REPLACE FUNCTION public.client_note_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.note := btrim(NEW.note);
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_note_before_write ON public.client_consultant_notes;
CREATE TRIGGER client_note_before_write BEFORE INSERT OR UPDATE ON public.client_consultant_notes
  FOR EACH ROW EXECUTE FUNCTION public.client_note_before_write();

-- Blocking ("do not suggest"): at most 500; it also removes the consultant from that scope's favourites and groups.
CREATE OR REPLACE FUNCTION public.client_block_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.client_list_scope_lock(NEW.tenant_id, NEW.owner_user_id);
  IF (SELECT count(*) FROM public.client_consultant_blocks b
      WHERE b.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND b.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id) >= 500 THEN
    RAISE EXCEPTION 'client_block_limit' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM public.client_consultant_favourites f
   WHERE f.consultant_id = NEW.consultant_id
     AND f.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND f.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_block_before_insert ON public.client_consultant_blocks;
CREATE TRIGGER client_block_before_insert BEFORE INSERT ON public.client_consultant_blocks
  FOR EACH ROW EXECUTE FUNCTION public.client_block_before_insert();

-- ---------------------------------------------------------------- 6. functions used by matching, invitations and admins

-- Favourites and blocked consultants of the scope that owns a ticket (or of the caller's company / the caller).
-- Returns ids only, and nothing to anyone outside that scope (administrators included), so rankings stay private.
CREATE OR REPLACE FUNCTION public.client_match_preferences(_tenant_id uuid DEFAULT NULL, _ticket_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_id uuid := _tenant_id;
  o_id uuid := NULL;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('favourites', '[]'::jsonb, 'blocked', '[]'::jsonb); END IF;
  IF _ticket_id IS NOT NULL THEN
    SELECT tk.tenant_id, CASE WHEN tk.tenant_id IS NULL THEN tk.client_id END INTO t_id, o_id FROM public.tickets tk WHERE tk.id = _ticket_id;
  ELSIF t_id IS NULL THEN
    o_id := auth.uid();
  END IF;
  IF NOT public.client_list_can_read(t_id, o_id) THEN
    RETURN jsonb_build_object('favourites', '[]'::jsonb, 'blocked', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'favourites', COALESCE((SELECT jsonb_agg(f.consultant_id) FROM public.client_consultant_favourites f
                            WHERE f.tenant_id IS NOT DISTINCT FROM t_id AND f.owner_user_id IS NOT DISTINCT FROM o_id), '[]'::jsonb),
    'blocked', COALESCE((SELECT jsonb_agg(b.consultant_id) FROM public.client_consultant_blocks b
                         WHERE b.tenant_id IS NOT DISTINCT FROM t_id AND b.owner_user_id IS NOT DISTINCT FROM o_id), '[]'::jsonb));
END $$;

-- Maximum people one "invite whole group" / "open bids to this group" may ask: the team-size setting (default 5).
CREATE OR REPLACE FUNCTION public.client_group_invite_limit()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LEAST(GREATEST(COALESCE((SELECT (value ->> 'max_team_size')::int FROM public.platform_settings WHERE key = 'team_engagement'), 5), 1), 20)
$$;

-- Administrators: how many client organisations / clients saved a consultant. A count only, never who.
CREATE OR REPLACE FUNCTION public.admin_consultant_favourite_count(_consultant_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*)::int FROM public.client_consultant_favourites WHERE consultant_id = _consultant_id);
END $$;

REVOKE ALL ON FUNCTION public.client_match_preferences(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_group_invite_limit() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_consultant_favourite_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_match_preferences(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_group_invite_limit() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_consultant_favourite_count(uuid) TO authenticated, service_role;
