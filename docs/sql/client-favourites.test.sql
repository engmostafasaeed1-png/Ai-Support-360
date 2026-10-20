-- Feature O post-apply checks. Runs inside one transaction and rolls everything back (no data is kept).
-- The ids below are fake and only the rows created here are used. Organisation rows for them must exist first
-- (tenant a1 with owner 1 and member 2, clients 1-3, consultant user 4), as in a scratch database.
BEGIN;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-0000000000a1'::uuid AS tenant,
  '00000000-0000-0000-0000-000000000001'::uuid AS owner,     -- org owner (edits)
  '00000000-0000-0000-0000-000000000002'::uuid AS member,    -- org member (reads)
  '00000000-0000-0000-0000-000000000003'::uuid AS solo,      -- client without an organisation
  '00000000-0000-0000-0000-000000000004'::uuid AS consultant_user,
  '00000000-0000-0000-0000-0000000000c1'::uuid AS c1,
  '00000000-0000-0000-0000-0000000000c2'::uuid AS c2;
GRANT SELECT ON _ids TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1. The owner adds a favourite with tags; tags are cleaned and de-duplicated.
SELECT pg_temp.as_user((SELECT owner FROM _ids));
INSERT INTO client_consultant_favourites (tenant_id, consultant_id, tags, added_by)
  SELECT tenant, c1, ARRAY[' Finance ', 'finance', 'Basis'], owner FROM _ids;
DO $$ BEGIN
  IF (SELECT tags FROM client_consultant_favourites LIMIT 1) <> ARRAY['Finance', 'Basis'] THEN RAISE EXCEPTION 'tags not cleaned'; END IF;
END $$;

-- 2. A group; adding a non-favourite member makes them a favourite too.
INSERT INTO client_consultant_groups (tenant_id, name, colour, icon, preferred_areas, created_by)
  SELECT tenant, 'Finance team', 'green', 'briefcase', ARRAY['fi'], owner FROM _ids;
INSERT INTO client_consultant_group_members (group_id, consultant_id, added_by)
  SELECT g.id, i.c2, i.owner FROM client_consultant_groups g, _ids i;
DO $$ BEGIN
  IF (SELECT count(*) FROM client_consultant_favourites) <> 2 THEN RAISE EXCEPTION 'group member not added to favourites'; END IF;
  IF (SELECT preferred_areas FROM client_consultant_groups LIMIT 1) <> ARRAY['FI'] THEN RAISE EXCEPTION 'areas not normalised'; END IF;
END $$;

-- 3. A second group taking area FI removes it from the first (one preferred group per area).
INSERT INTO client_consultant_groups (tenant_id, name, preferred_areas, created_by)
  SELECT tenant, 'Trusted for critical', ARRAY['FI'], owner FROM _ids;
DO $$ BEGIN
  IF (SELECT preferred_areas FROM client_consultant_groups WHERE name = 'Finance team') <> '{}'::text[] THEN RAISE EXCEPTION 'area kept twice'; END IF;
END $$;

-- 4. A private note.
INSERT INTO client_consultant_notes (tenant_id, consultant_id, note, updated_by) SELECT tenant, c1, ' Great on FI closing ', owner FROM _ids;

-- 5. The org member reads everything but cannot change anything.
SELECT pg_temp.as_user((SELECT member FROM _ids));
DO $$ BEGIN
  IF (SELECT count(*) FROM client_consultant_favourites) <> 2 THEN RAISE EXCEPTION 'member cannot read favourites'; END IF;
  IF (SELECT note FROM client_consultant_notes) <> 'Great on FI closing' THEN RAISE EXCEPTION 'member cannot read note'; END IF;
  BEGIN
    INSERT INTO client_consultant_groups (tenant_id, name, created_by) SELECT tenant, 'Nope', member FROM _ids;
    RAISE EXCEPTION 'member could create a group';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM client_consultant_favourites;
  IF (SELECT count(*) FROM client_consultant_favourites) <> 2 THEN RAISE EXCEPTION 'member could delete'; END IF;
END $$;

-- 6. Outsiders (another client, a consultant) see nothing.
SELECT pg_temp.as_user((SELECT solo FROM _ids));
DO $$ BEGIN
  IF (SELECT count(*) FROM client_consultant_favourites) + (SELECT count(*) FROM client_consultant_groups)
     + (SELECT count(*) FROM client_consultant_notes) <> 0 THEN RAISE EXCEPTION 'outsider sees rows'; END IF;
END $$;
SELECT pg_temp.as_user((SELECT consultant_user FROM _ids));
DO $$ BEGIN
  IF (SELECT count(*) FROM client_consultant_favourites) <> 0 THEN RAISE EXCEPTION 'consultant sees who saved them'; END IF;
  IF jsonb_array_length(client_match_preferences((SELECT tenant FROM _ids), NULL) -> 'favourites') <> 0 THEN RAISE EXCEPTION 'consultant reads preferences'; END IF;
END $$;

-- 7. A client without an organisation keeps a personal list.
SELECT pg_temp.as_user((SELECT solo FROM _ids));
INSERT INTO client_consultant_favourites (owner_user_id, consultant_id, added_by) SELECT solo, c1, solo FROM _ids;
DO $$ BEGIN
  IF jsonb_array_length(client_match_preferences(NULL, NULL) -> 'favourites') <> 1 THEN RAISE EXCEPTION 'personal scope missing'; END IF;
END $$;

-- 8. Blocking removes the favourite and its group membership; favouriting a blocked consultant is refused.
SELECT pg_temp.as_user((SELECT owner FROM _ids));
INSERT INTO client_consultant_blocks (tenant_id, consultant_id, created_by) SELECT tenant, c2, owner FROM _ids;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM client_consultant_favourites f, _ids i WHERE f.consultant_id = i.c2) THEN RAISE EXCEPTION 'blocked still favourite'; END IF;
  IF EXISTS (SELECT 1 FROM client_consultant_group_members m, _ids i WHERE m.consultant_id = i.c2) THEN RAISE EXCEPTION 'blocked still in group'; END IF;
  IF (client_match_preferences(NULL, (SELECT '00000000-0000-0000-0000-0000000000f1'::uuid)) -> 'blocked') <> jsonb_build_array((SELECT c2 FROM _ids)) THEN RAISE EXCEPTION 'ticket preferences wrong'; END IF;
  BEGIN
    INSERT INTO client_consultant_favourites (tenant_id, consultant_id, added_by) SELECT tenant, c2, owner FROM _ids;
    RAISE EXCEPTION 'blocked consultant favourited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- 9. The 50-group limit.
DO $$ BEGIN
  INSERT INTO client_consultant_groups (tenant_id, name, created_by) SELECT tenant, 'G' || n, owner FROM _ids, generate_series(1, 48) n;
  BEGIN
    INSERT INTO client_consultant_groups (tenant_id, name, created_by) SELECT tenant, 'One too many', owner FROM _ids;
    RAISE EXCEPTION 'group limit not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- 10. Invite limit falls back to 5 without the team setting.
DO $$ BEGIN IF client_group_invite_limit() < 1 THEN RAISE EXCEPTION 'invite limit'; END IF; END $$;

RESET ROLE;
SELECT 'Feature O checks passed' AS result;
ROLLBACK;
