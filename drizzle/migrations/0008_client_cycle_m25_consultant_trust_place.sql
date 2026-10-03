-- M25 (consultant trust and place): (1) an approximate place on the map for every consultant, (2) the LinkedIn address and the Credly name are checked
-- for their form and every new or changed one starts "not checked by the platform", (3) administrators can verify certificates.
-- Nothing is deleted or rewritten. A consultant can not set any "checked" mark: only the platform (an administrator or the server) can.

-- ===== A. the new columns =====
ALTER TABLE public.consultants
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN linkedin_checked_at timestamptz,
  ADD COLUMN credly_checked_at timestamptz;

-- both numbers or none, and on the globe
ALTER TABLE public.consultants
  ADD CONSTRAINT consultants_place_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );

-- ===== B. the form of a LinkedIn address and of a Credly name =====
-- "linkedin.com/in/jane-doe", "https://www.linkedin.com/in/jane-doe/" or "https://eg.linkedin.com/in/jane-doe?utm=1" all become https://www.linkedin.com/in/jane-doe.
-- Anything that is not the profile of a person on linkedin.com gives NULL.
CREATE FUNCTION public.normalize_linkedin_url(_v text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _s text := btrim(coalesce(_v, ''));
  _slug text;
BEGIN
  IF _s = '' THEN
    RETURN NULL;
  END IF;
  _slug := substring(_s from '(?i)^(?:https?://)?(?:www\.|m\.|[a-z]{2,3}\.)?linkedin\.com/in/([A-Za-z0-9_%-]{3,100})(?:/[^?#]*)?(?:[?#].*)?$');
  IF _slug IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN 'https://www.linkedin.com/in/' || _slug;
END;
$function$;

-- "jane-doe.1a2b3c4d" or "https://www.credly.com/users/jane-doe.1a2b3c4d/badges" both become jane-doe.1a2b3c4d. Anything else gives NULL.
CREATE FUNCTION public.normalize_credly_username(_v text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _s text := btrim(coalesce(_v, ''));
  _u text;
BEGIN
  IF _s = '' THEN
    RETURN NULL;
  END IF;
  _u := substring(_s from '(?i)^(?:https?://)?(?:www\.)?credly\.com/users/([A-Za-z0-9._-]{1,100})(?:/[^?#]*)?(?:[?#].*)?$');
  IF _u IS NULL AND _s ~ '^[A-Za-z0-9._-]{1,100}$' THEN
    _u := _s;
  END IF;
  RETURN _u;
END;
$function$;

-- ===== C. the guards on the consultant row =====
-- C1. the LinkedIn address: a valid profile address or nothing; a new or changed address is "not checked" again (for everybody but the platform)
CREATE FUNCTION public.guard_linkedin_url()
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
  IF public.is_untrusted_writer() AND (TG_OP = 'INSERT' OR NEW.linkedin_url IS DISTINCT FROM OLD.linkedin_url) THEN
    NEW.linkedin_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- C2. the Credly name: a valid name or nothing; a new or changed name is "not checked" again (for everybody but the platform)
CREATE FUNCTION public.guard_credly_username()
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
  IF public.is_untrusted_writer() AND (TG_OP = 'INSERT' OR NEW.credly_username IS DISTINCT FROM OLD.credly_username) THEN
    NEW.credly_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- C3. the place: no city and no country means no point on the map; a consultant's point is rounded to about 1 km (the map shows the area, never an address)
CREATE FUNCTION public.guard_consultant_geo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NULLIF(btrim(coalesce(NEW.city, '')), '') IS NULL AND NULLIF(btrim(coalesce(NEW.country, '')), '') IS NULL THEN
    NEW.latitude := NULL;
    NEW.longitude := NULL;
  END IF;
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL AND public.is_untrusted_writer() THEN
    NEW.latitude := round(NEW.latitude::numeric, 2)::double precision;
    NEW.longitude := round(NEW.longitude::numeric, 2)::double precision;
  END IF;
  RETURN NEW;
END;
$function$;

-- C4. the existing guard of the trust columns also keeps the two "checked" marks to the platform.
-- (It runs before the two guards above because of the trigger names, so it sees what the consultant sent, not what the guards clear afterwards.)
CREATE OR REPLACE FUNCTION public.guard_consultant_trust_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status         := 'pending';
    NEW.rating                      := 0;
    NEW.total_reviews               := 0;
    NEW.response_time_minutes       := 0;
    NEW.credibility_credits         := 0;
    NEW.ai_skills_score             := NULL;
    NEW.ai_interview_badge          := NULL;
    NEW.ai_interview_completed_at   := NULL;
    NEW.linkedin_checked_at         := NULL;
    NEW.credly_checked_at           := NULL;
    RETURN NEW;
  END IF;

  IF ROW(NEW.user_id, NEW.verification_status, NEW.rating, NEW.total_reviews, NEW.response_time_minutes,
         NEW.credibility_credits, NEW.ai_skills_score, NEW.ai_interview_badge, NEW.ai_interview_completed_at,
         NEW.linkedin_checked_at, NEW.credly_checked_at)
     IS DISTINCT FROM
     ROW(OLD.user_id, OLD.verification_status, OLD.rating, OLD.total_reviews, OLD.response_time_minutes,
         OLD.credibility_credits, OLD.ai_skills_score, OLD.ai_interview_badge, OLD.ai_interview_completed_at,
         OLD.linkedin_checked_at, OLD.credly_checked_at) THEN
    RAISE EXCEPTION 'Verification status, ratings, scores, credits and the checks of the LinkedIn and Credly links are managed by the platform'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_guard_linkedin_url
  BEFORE INSERT OR UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_linkedin_url();

CREATE TRIGGER trg_guard_credly_username
  BEFORE INSERT OR UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_credly_username();

CREATE TRIGGER trg_guard_consultant_geo
  BEFORE INSERT OR UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_consultant_geo();

-- ===== D. administrators verify certificates =====
-- The guard trigger already says "Certification verification is managed by the platform" but no policy let an administrator change a certificate.
CREATE POLICY "Admins can manage certifications" ON public.certifications
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));