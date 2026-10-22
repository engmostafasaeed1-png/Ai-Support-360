-- Referral terms: visitors and signed-in users can read only versions that are already published (future or unpublished versions stay hidden).
DROP POLICY IF EXISTS "Referral terms are public" ON public.referral_terms_versions;
DROP POLICY IF EXISTS "Published referral terms are public" ON public.referral_terms_versions;
CREATE POLICY "Published referral terms are public" ON public.referral_terms_versions FOR SELECT TO anon, authenticated
  USING (published_at IS NOT NULL AND published_at <= now());
