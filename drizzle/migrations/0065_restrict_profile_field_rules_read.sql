DROP POLICY IF EXISTS "Signed-in users read the profile field rules" ON public.profile_field_rules;
CREATE POLICY "Consultants and admins read the profile field rules" ON public.profile_field_rules
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'consultant') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Signed-in users read the rules switch" ON public.profile_rules_config;
CREATE POLICY "Consultants and admins read the rules switch" ON public.profile_rules_config
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'consultant') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));