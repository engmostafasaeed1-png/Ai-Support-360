DROP POLICY IF EXISTS "Consultants manage own CV profile" ON public.consultant_cv_profiles;
CREATE POLICY "Consultants manage own CV profile" ON public.consultant_cv_profiles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_cv_profiles.consultant_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_cv_profiles.consultant_id AND c.user_id = auth.uid()));