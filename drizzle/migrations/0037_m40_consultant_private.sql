-- ===== M40: the private details of a consultant (CV path and nationality) get their own table (QA defect DEF-033, step 1 of 2) =====
-- Until now every signed-in user could read the whole row of a verified consultant, including the path of the CV file and the nationality.
-- Step 1 (this migration): the two values move to a table that only the consultant and the administrators can read. The values that exist
-- are copied, and a trigger keeps the new table in step with the two old columns until the screens read the new table.
-- Step 2 (a later migration, after the screens are published): the two old columns are dropped.

CREATE TABLE IF NOT EXISTS public.consultant_private (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  cv_url text,
  nationality text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT consultant_private_cv_url_len CHECK (cv_url IS NULL OR char_length(cv_url) <= 500),
  CONSTRAINT consultant_private_nationality_len CHECK (nationality IS NULL OR char_length(nationality) <= 100)
);
COMMENT ON TABLE public.consultant_private IS 'Details of a consultant that only the consultant and the administrators may read: the path of the CV file and the nationality.';

ALTER TABLE public.consultant_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consultant_private FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.consultant_private FROM authenticated;

CREATE POLICY "Consultants read own private details" ON public.consultant_private
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_private.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Consultants add own private details" ON public.consultant_private
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_private.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Consultants change own private details" ON public.consultant_private
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_private.consultant_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_private.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Administrators manage private details" ON public.consultant_private
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER update_consultant_private_updated_at
  BEFORE UPDATE ON public.consultant_private
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- the values that exist now
INSERT INTO public.consultant_private (consultant_id, cv_url, nationality)
SELECT c.id, c.cv_url, c.nationality
  FROM public.consultants c
 WHERE c.cv_url IS NOT NULL OR c.nationality IS NOT NULL
ON CONFLICT (consultant_id) DO NOTHING;

-- while the published screens still write the two old columns, every change of them is copied to the new table
-- (only the value that really changed, so a late write of an old browser tab cannot undo a newer value of the other one)
CREATE OR REPLACE FUNCTION public.sync_consultant_private()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.consultant_private (consultant_id, cv_url, nationality)
    VALUES (NEW.id, NEW.cv_url, NEW.nationality)
    ON CONFLICT (consultant_id) DO UPDATE
      SET cv_url = EXCLUDED.cv_url, nationality = EXCLUDED.nationality;
  ELSE
    INSERT INTO public.consultant_private (consultant_id, cv_url, nationality)
    VALUES (NEW.id, NEW.cv_url, NEW.nationality)
    ON CONFLICT (consultant_id) DO UPDATE
      SET cv_url = CASE WHEN OLD.cv_url IS DISTINCT FROM NEW.cv_url THEN EXCLUDED.cv_url ELSE public.consultant_private.cv_url END,
          nationality = CASE WHEN OLD.nationality IS DISTINCT FROM NEW.nationality THEN EXCLUDED.nationality ELSE public.consultant_private.nationality END;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_consultant_private_ins ON public.consultants;
CREATE TRIGGER trg_sync_consultant_private_ins
  AFTER INSERT ON public.consultants
  FOR EACH ROW
  WHEN (NEW.cv_url IS NOT NULL OR NEW.nationality IS NOT NULL)
  EXECUTE FUNCTION public.sync_consultant_private();

DROP TRIGGER IF EXISTS trg_sync_consultant_private_upd ON public.consultants;
CREATE TRIGGER trg_sync_consultant_private_upd
  AFTER UPDATE OF cv_url, nationality ON public.consultants
  FOR EACH ROW
  WHEN (OLD.cv_url IS DISTINCT FROM NEW.cv_url OR OLD.nationality IS DISTINCT FROM NEW.nationality)
  EXECUTE FUNCTION public.sync_consultant_private();

REVOKE EXECUTE ON FUNCTION public.sync_consultant_private() FROM PUBLIC, anon, authenticated;