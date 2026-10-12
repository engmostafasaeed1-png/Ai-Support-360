-- M61: richer consultant profile and request context for the AI matching.
--  consultants: customer segments, vertical solutions, localization solutions, deployment experience, project scale (project_types, industries and localization_countries already exist),
--               work modes, on-site countries, working week, language levels
--  client_profiles: customer segment and country of the company
--  tickets: ticket_context (what the client says about the request: industry, segment, country, project type, vertical and localization solutions)
-- Values are the English labels of the ready lists (src/lib/profileTaxonomy.ts); "Other" entries are free text.

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS customer_segments text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS vertical_solutions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS localization_solutions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deployment_experience text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS project_scale text,
  ADD COLUMN IF NOT EXISTS work_modes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onsite_countries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS working_week text,
  ADD COLUMN IF NOT EXISTS language_levels jsonb NOT NULL DEFAULT '{}'::jsonb;

-- the table has column-level SELECT privileges since M60: the new columns are public profile data (no contact details)
GRANT SELECT (customer_segments, vertical_solutions, localization_solutions, deployment_experience, project_scale,
              work_modes, onsite_countries, working_week, language_levels)
  ON public.consultants TO anon, authenticated;

ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS customer_segment text,
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS ticket_context jsonb NOT NULL DEFAULT '{}'::jsonb;

-- a list of labels: at most 60 entries, each 1-120 characters, no contact details
CREATE OR REPLACE FUNCTION public.profile_list_is_valid(_list text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $function$
  SELECT _list IS NULL OR (
    cardinality(_list) <= 60
    AND NOT EXISTS (
      SELECT 1 FROM unnest(_list) v
       WHERE v IS NULL OR char_length(btrim(v)) = 0 OR char_length(v) > 120 OR public.contact_details_in_text(v)
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.guard_consultant_profile_lists()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE
  _lvl record;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF NOT (public.profile_list_is_valid(NEW.industries) AND public.profile_list_is_valid(NEW.localization_countries)
          AND public.profile_list_is_valid(NEW.customer_segments) AND public.profile_list_is_valid(NEW.vertical_solutions)
          AND public.profile_list_is_valid(NEW.localization_solutions) AND public.profile_list_is_valid(NEW.deployment_experience)
          AND public.profile_list_is_valid(NEW.work_modes)
          AND public.profile_list_is_valid(NEW.onsite_countries) AND public.profile_list_is_valid(NEW.project_types)) THEN
    RAISE EXCEPTION 'A profile list has too many entries, an entry that is too long, or contact details in it' USING ERRCODE = '22023';
  END IF;
  IF NEW.project_scale IS NOT NULL AND (char_length(NEW.project_scale) > 60 OR public.contact_details_in_text(NEW.project_scale)) THEN
    RAISE EXCEPTION 'The project scale is not valid' USING ERRCODE = '22023';
  END IF;
  IF NEW.working_week IS NOT NULL AND NEW.working_week NOT IN ('Sunday to Thursday', 'Monday to Friday', 'Flexible (both)') THEN
    RAISE EXCEPTION 'The working week is not valid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(NEW.language_levels) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW.language_levels)) > 20 THEN
    RAISE EXCEPTION 'The language levels are not valid' USING ERRCODE = '22023';
  END IF;
  FOR _lvl IN SELECT key, value FROM jsonb_each(NEW.language_levels) LOOP
    IF char_length(_lvl.key) > 20 OR _lvl.value NOT IN ('"Native"', '"Fluent (business)"', '"Good"', '"Basic"') THEN
      RAISE EXCEPTION 'The language levels are not valid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_consultant_profile_lists ON public.consultants;
CREATE TRIGGER trg_guard_consultant_profile_lists
  BEFORE INSERT OR UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_consultant_profile_lists();

-- the request context: a small object with known keys only
CREATE OR REPLACE FUNCTION public.guard_ticket_context()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE
  _k text;
  _v jsonb;
BEGIN
  IF NEW.ticket_context IS NOT DISTINCT FROM '{}'::jsonb OR NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.ticket_context) <> 'object' OR octet_length(NEW.ticket_context::text) > 4000 THEN
    RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
  END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(NEW.ticket_context) LOOP
    IF _k NOT IN ('industry', 'customer_segment', 'country', 'project_type', 'vertical_solutions', 'localization_solutions') THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_v) = 'string' THEN
      IF char_length(_v #>> '{}') > 160 OR public.contact_details_in_text(_v #>> '{}') THEN
        RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(_v) = 'array' THEN
      IF jsonb_array_length(_v) > 12 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(_v) e
         WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 160 OR public.contact_details_in_text(e #>> '{}')
      ) THEN
        RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(_v) <> 'null' THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_ticket_context ON public.tickets;
CREATE TRIGGER trg_guard_ticket_context
  BEFORE INSERT OR UPDATE OF ticket_context ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_context();

-- the company's own segment and country: short texts
CREATE OR REPLACE FUNCTION public.guard_client_profile_context()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF (NEW.customer_segment IS NOT NULL AND (char_length(NEW.customer_segment) > 160 OR public.contact_details_in_text(NEW.customer_segment)))
     OR (NEW.country IS NOT NULL AND (char_length(NEW.country) > 80 OR public.contact_details_in_text(NEW.country))) THEN
    RAISE EXCEPTION 'The company segment or country is not valid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_client_profile_context ON public.client_profiles;
CREATE TRIGGER trg_guard_client_profile_context
  BEFORE INSERT OR UPDATE OF customer_segment, country ON public.client_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_profile_context();

REVOKE ALL ON FUNCTION public.profile_list_is_valid(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_list_is_valid(text[]) TO authenticated;