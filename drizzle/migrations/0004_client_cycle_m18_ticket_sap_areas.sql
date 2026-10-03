-- M18 (several SAP areas per ticket): a client can choose many SAP modules / areas, name an "Other" area and write more details.
-- tickets.sap_module stays the MAIN area (the first one chosen), because assignment, SLA, notices, the AI functions and many screens read it.
-- New: sap_modules (all chosen areas, in the order chosen), sap_module_other (the name typed for "Other"), area_details (more details).
-- A trigger keeps the three views of the same choice consistent, whichever screen (new or old) writes the ticket, and checks the sizes.

ALTER TABLE public.tickets
  ADD COLUMN sap_modules text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN sap_module_other text,
  ADD COLUMN area_details text;

CREATE FUNCTION public.tickets_normalize_areas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _item text;
  _clean text[] := '{}'::text[];
BEGIN
  -- an old screen that writes only sap_module: the list follows it
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(cardinality(NEW.sap_modules), 0) = 0 AND NEW.sap_module IS NOT NULL AND btrim(NEW.sap_module) <> '' THEN
      NEW.sap_modules := ARRAY[NEW.sap_module];
    END IF;
  ELSIF NEW.sap_modules IS NOT DISTINCT FROM OLD.sap_modules AND NEW.sap_module IS DISTINCT FROM OLD.sap_module THEN
    NEW.sap_modules := CASE WHEN NEW.sap_module IS NULL OR btrim(NEW.sap_module) = '' THEN '{}'::text[] ELSE ARRAY[NEW.sap_module] END;
  END IF;

  -- clean the list: trimmed, no blanks, no duplicates (any capitals), order kept
  FOREACH _item IN ARRAY COALESCE(NEW.sap_modules, '{}'::text[]) LOOP
    _item := btrim(regexp_replace(COALESCE(_item, ''), '\s+', ' ', 'g'));
    IF _item = '' THEN
      CONTINUE;
    END IF;
    IF char_length(_item) > 80 THEN
      RAISE EXCEPTION 'An SAP area name can have 80 characters at most' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(_clean) c WHERE lower(c) = lower(_item)) THEN
      _clean := _clean || _item;
    END IF;
  END LOOP;
  IF cardinality(_clean) > 12 THEN
    RAISE EXCEPTION 'Choose 12 SAP areas at most' USING ERRCODE = '22023';
  END IF;
  NEW.sap_modules := _clean;
  IF cardinality(_clean) > 0 THEN
    NEW.sap_module := _clean[1];
  END IF;

  NEW.sap_module_other := NULLIF(btrim(COALESCE(NEW.sap_module_other, '')), '');
  NEW.area_details := NULLIF(btrim(COALESCE(NEW.area_details, '')), '');
  IF char_length(COALESCE(NEW.sap_module_other, '')) > 160 THEN
    RAISE EXCEPTION 'The name of the other area can have 160 characters at most' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(NEW.area_details, '')) > 2000 THEN
    RAISE EXCEPTION 'The details of the areas can have 2000 characters at most' USING ERRCODE = '22023';
  END IF;
  IF 'other' = ANY (SELECT lower(c) FROM unnest(_clean) c) THEN
    IF NEW.sap_module_other IS NULL THEN
      RAISE EXCEPTION 'Name the other SAP area' USING ERRCODE = '22023';
    END IF;
  ELSE
    NEW.sap_module_other := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tickets_normalize_areas() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tickets_normalize_areas
  BEFORE INSERT OR UPDATE OF sap_module, sap_modules, sap_module_other, area_details ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_normalize_areas();