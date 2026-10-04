-- M27 (a changed link is "not checked" again, for everybody): until now only a write by the consultant cleared the "checked" mark of a LinkedIn address or a Credly name when the link changed.
-- A write by an administrator (also on their own profile) or by the server kept the old mark, so a mark that was given to one address could stay on another one.
-- Now a new, changed or removed link always loses its mark, unless the same write sets the mark itself (a deliberate decision of the platform).
-- No data is rewritten: a mark that is already on a link stays until somebody removes it. Only the two guard functions change; the triggers stay as they are.

CREATE OR REPLACE FUNCTION public.guard_linkedin_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _n text;
BEGIN
  IF NEW.linkedin_url IS NULL OR btrim(NEW.linkedin_url) = '' THEN
    NEW.linkedin_url := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.linkedin_url IS DISTINCT FROM OLD.linkedin_url THEN
    _n := public.normalize_linkedin_url(NEW.linkedin_url);
    IF _n IS NULL THEN
      RAISE EXCEPTION 'Enter the address of your LinkedIn profile, for example https://www.linkedin.com/in/your-name' USING ERRCODE = '22023';
    END IF;
    NEW.linkedin_url := _n;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF public.is_untrusted_writer() THEN
      NEW.linkedin_checked_at := NULL;
    END IF;
  ELSIF NEW.linkedin_url IS DISTINCT FROM OLD.linkedin_url
    AND (public.is_untrusted_writer() OR NEW.linkedin_checked_at IS NOT DISTINCT FROM OLD.linkedin_checked_at) THEN
    NEW.linkedin_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_credly_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _n text;
BEGIN
  IF NEW.credly_username IS NULL OR btrim(NEW.credly_username) = '' THEN
    NEW.credly_username := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.credly_username IS DISTINCT FROM OLD.credly_username THEN
    _n := public.normalize_credly_username(NEW.credly_username);
    IF _n IS NULL THEN
      RAISE EXCEPTION 'Enter your Credly username or the address of your Credly profile' USING ERRCODE = '22023';
    END IF;
    NEW.credly_username := _n;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF public.is_untrusted_writer() THEN
      NEW.credly_checked_at := NULL;
    END IF;
  ELSIF NEW.credly_username IS DISTINCT FROM OLD.credly_username
    AND (public.is_untrusted_writer() OR NEW.credly_checked_at IS NOT DISTINCT FROM OLD.credly_checked_at) THEN
    NEW.credly_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
