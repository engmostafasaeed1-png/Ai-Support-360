-- ===== M42b: the old copies of the private details of a consultant are emptied (QA defect DEF-033, step 2 of 2) =====
-- Step 1 (M40) moved the path of the CV file and the nationality of a consultant into the table consultant_private, which only the
-- consultant and the administrators can read, and kept the old columns of the table consultants in step until the screens were switched.
-- The screens read and write only consultant_private since the publish of 2026-10-10 (the published bundle has no access to the old columns).
-- This step empties the old columns, so that no signed-in user can read anything from them (every signed-in user can read the whole row
-- of a verified consultant, and the live Realtime feed ignores column rights). The two empty columns stay in the table and can be dropped later.

-- 1. nothing may get lost: a value that exists only in an old column is first copied into consultant_private
INSERT INTO public.consultant_private (consultant_id, cv_url, nationality)
SELECT c.id, c.cv_url, c.nationality
  FROM public.consultants c
 WHERE c.cv_url IS NOT NULL OR c.nationality IS NOT NULL
ON CONFLICT (consultant_id) DO UPDATE
  SET cv_url = COALESCE(public.consultant_private.cv_url, EXCLUDED.cv_url),
      nationality = COALESCE(public.consultant_private.nationality, EXCLUDED.nationality);

-- 2. the temporary copy triggers of M40 go
DROP TRIGGER IF EXISTS trg_sync_consultant_private_ins ON public.consultants;
DROP TRIGGER IF EXISTS trg_sync_consultant_private_upd ON public.consultants;
DROP FUNCTION IF EXISTS public.sync_consultant_private();

-- 3. the old columns are emptied
UPDATE public.consultants
   SET cv_url = NULL, nationality = NULL
 WHERE cv_url IS NOT NULL OR nationality IS NOT NULL;

-- 4. a screen of an older version of the app that still writes into an old column: the value moves into consultant_private
--    and the old column stays empty (nothing is lost and nothing is readable)
CREATE OR REPLACE FUNCTION public.move_consultant_private_details()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.consultant_private (consultant_id, cv_url, nationality)
  VALUES (NEW.id, NEW.cv_url, NEW.nationality)
  ON CONFLICT (consultant_id) DO UPDATE
    SET cv_url = COALESCE(EXCLUDED.cv_url, public.consultant_private.cv_url),
        nationality = COALESCE(EXCLUDED.nationality, public.consultant_private.nationality);
  UPDATE public.consultants SET cv_url = NULL, nationality = NULL WHERE id = NEW.id;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.move_consultant_private_details() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_move_consultant_private_ins ON public.consultants;
CREATE TRIGGER trg_move_consultant_private_ins
  AFTER INSERT ON public.consultants
  FOR EACH ROW
  WHEN (NEW.cv_url IS NOT NULL OR NEW.nationality IS NOT NULL)
  EXECUTE FUNCTION public.move_consultant_private_details();

DROP TRIGGER IF EXISTS trg_move_consultant_private_upd ON public.consultants;
CREATE TRIGGER trg_move_consultant_private_upd
  AFTER UPDATE OF cv_url, nationality ON public.consultants
  FOR EACH ROW
  WHEN (NEW.cv_url IS NOT NULL OR NEW.nationality IS NOT NULL)
  EXECUTE FUNCTION public.move_consultant_private_details();

COMMENT ON COLUMN public.consultants.cv_url IS 'No longer used and always empty: the path of the CV file is kept in consultant_private. The column can be dropped.';
COMMENT ON COLUMN public.consultants.nationality IS 'No longer used and always empty: the nationality is kept in consultant_private. The column can be dropped.';