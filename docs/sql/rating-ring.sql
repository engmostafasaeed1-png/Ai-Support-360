-- Feature W: performance ring around consultant photos.
-- Prepared for the owner to apply; NOT applied by the app. Safe to run more than once.
--
-- The ring needs one setting the browser cannot read today: `rating_min_reviews` (default 3).
-- Below that number of client reviews the rating arc is drawn dashed and lighter with "based on N reviews".
-- Ratings themselves keep coming from consultants.rating / consultants.total_reviews, and responsiveness
-- from responsiveness_public_summary(), so no new data is exposed.
-- Until this file is applied the app uses the default 3.

-- 1) Default value (admins can change it: platform_settings key `rating_min_reviews`, a whole number 1-50).
INSERT INTO public.platform_settings (key, value)
SELECT 'rating_min_reviews', '3'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'rating_min_reviews');

-- 2) Public-safe read of that one number (nothing else from platform_settings).
CREATE OR REPLACE FUNCTION public.rating_public_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'min_reviews',
    LEAST(50, GREATEST(1, COALESCE(
      (SELECT CASE WHEN jsonb_typeof(s.value) = 'number' THEN (s.value #>> '{}')::numeric
                   WHEN jsonb_typeof(s.value) = 'string' AND (s.value #>> '{}') ~ '^\d{1,3}$' THEN (s.value #>> '{}')::numeric END
         FROM public.platform_settings s WHERE s.key = 'rating_min_reviews' LIMIT 1),
      3)::int)))
$$;

REVOKE ALL ON FUNCTION public.rating_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rating_public_config() TO anon, authenticated, service_role;

-- Check after applying:
--   SELECT public.rating_public_config();   -- {"min_reviews": 3}
