-- ===== M41: server-side rules for business processes (QA defect DEF-061) =====
-- The screen already checks a process before it is saved, but the database accepted anything: the same name twice under the same parent,
-- an empty or very long name, a category or SAP module that is not in the lists of the screen. The rules now live in the database too.
-- Rows that exist already are not touched, and a change of another column of such a row is not blocked by them.

CREATE OR REPLACE FUNCTION public.guard_business_process()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _categories constant text[] := ARRAY['General','Finance','HR','Supply Chain','Manufacturing','Sales','Procurement','Warehouse','Quality','Plant Maintenance'];
  _modules constant text[] := ARRAY['SAP FI','SAP CO','SAP MM','SAP SD','SAP PP','SAP QM','SAP PM','SAP HR','SAP WM','SAP PS','SAP ABAP','SAP Basis','SAP BW','SAP HANA','S/4HANA','SAP SuccessFactors'];
  _found text;
BEGIN
  -- the name: spaces are tidied, it must not be empty or longer than 200 characters
  IF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name THEN
    NEW.name := btrim(regexp_replace(coalesce(NEW.name, ''), '\s+', ' ', 'g'));
    IF NEW.name = '' THEN
      RAISE EXCEPTION 'The process name is required' USING ERRCODE = '23514';
    END IF;
    IF char_length(NEW.name) > 200 THEN
      RAISE EXCEPTION 'The process name is longer than 200 characters' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- the same name (any capitals) must not exist twice under the same parent of the same client
  IF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    IF EXISTS (
      SELECT 1 FROM public.business_processes b
       WHERE b.client_id = NEW.client_id
         AND b.parent_id IS NOT DISTINCT FROM NEW.parent_id
         AND lower(b.name) = lower(NEW.name)
         AND b.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'A process with this name already exists here' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- the category: one of the categories of the screen (written with the capitals of the list); empty means General
  IF TG_OP = 'INSERT' OR NEW.category IS DISTINCT FROM OLD.category THEN
    IF NEW.category IS NULL OR btrim(NEW.category) = '' THEN
      NEW.category := 'General';
    ELSE
      SELECT c INTO _found FROM unnest(_categories) AS c WHERE lower(c) = lower(btrim(NEW.category)) LIMIT 1;
      IF _found IS NULL THEN
        RAISE EXCEPTION 'Unknown category "%"', left(NEW.category, 60) USING ERRCODE = '23514';
      END IF;
      NEW.category := _found;
    END IF;
  END IF;

  -- the SAP module: empty or one of the modules of the screen
  IF TG_OP = 'INSERT' OR NEW.sap_module IS DISTINCT FROM OLD.sap_module THEN
    IF NEW.sap_module IS NULL OR btrim(NEW.sap_module) = '' THEN
      NEW.sap_module := NULL;
    ELSE
      SELECT m INTO _found FROM unnest(_modules) AS m WHERE lower(m) = lower(btrim(NEW.sap_module)) LIMIT 1;
      IF _found IS NULL THEN
        RAISE EXCEPTION 'Unknown SAP module "%"', left(NEW.sap_module, 60) USING ERRCODE = '23514';
      END IF;
      NEW.sap_module := _found;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_business_process ON public.business_processes;
CREATE TRIGGER trg_guard_business_process
  BEFORE INSERT OR UPDATE ON public.business_processes
  FOR EACH ROW EXECUTE FUNCTION public.guard_business_process();

REVOKE EXECUTE ON FUNCTION public.guard_business_process() FROM PUBLIC, anon, authenticated;