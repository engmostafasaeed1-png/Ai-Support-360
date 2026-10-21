-- Security fix (prepared, NOT applied): Consultant Service Policy versions were readable with USING (true).
-- The published policy stays public on purpose (/consultant-policy works without signing in), but only versions
-- that have taken effect. A version scheduled for later is visible to administrators only until its date.
-- No app change is needed: the site already asks for the newest version with effective_at <= now().
BEGIN;

DROP POLICY IF EXISTS "Anyone can read the consultant policy" ON public.consultant_policy_versions;
DROP POLICY IF EXISTS "Anyone can read published consultant policy versions" ON public.consultant_policy_versions;
CREATE POLICY "Anyone can read published consultant policy versions" ON public.consultant_policy_versions
  FOR SELECT TO anon, authenticated
  USING (effective_at <= now());

DROP POLICY IF EXISTS "Admins read every consultant policy version" ON public.consultant_policy_versions;
CREATE POLICY "Admins read every consultant policy version" ON public.consultant_policy_versions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Who published a version is an internal detail; visitors only need the text and dates.
REVOKE SELECT ON public.consultant_policy_versions FROM anon;
GRANT SELECT (id, version, title_en, title_ar, summary_en, summary_ar, body_en, body_ar, effective_at, created_at)
  ON public.consultant_policy_versions TO anon;

COMMIT;
