DROP POLICY IF EXISTS "Consultants are readable by authenticated users" ON public.consultants;
CREATE POLICY "Verified consultants readable; owner and admins see all" ON public.consultants
FOR SELECT TO authenticated
USING (verification_status = 'verified' OR auth.uid() = user_id
  OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.consultant_profile_visible(_consultant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _consultant_id
    AND (c.verification_status = 'verified' OR c.user_id = auth.uid()))
  OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
$$;
REVOKE EXECUTE ON FUNCTION public.consultant_profile_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_profile_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS "Education readable by authenticated" ON public.consultant_education;
CREATE POLICY "Education readable for visible consultants" ON public.consultant_education
FOR SELECT TO authenticated USING (public.consultant_profile_visible(consultant_id));

DROP POLICY IF EXISTS "Skills are readable by authenticated users" ON public.consultant_skills;
CREATE POLICY "Skills readable for visible consultants" ON public.consultant_skills
FOR SELECT TO authenticated USING (public.consultant_profile_visible(consultant_id));

DROP POLICY IF EXISTS "Work history readable by authenticated" ON public.consultant_work_history;
CREATE POLICY "Work history readable for visible consultants" ON public.consultant_work_history
FOR SELECT TO authenticated USING (public.consultant_profile_visible(consultant_id));

DROP POLICY IF EXISTS "Projects readable by authenticated" ON public.consultant_projects;
CREATE POLICY "Projects readable for visible consultants" ON public.consultant_projects
FOR SELECT TO authenticated USING (public.consultant_profile_visible(consultant_id));

DROP POLICY IF EXISTS "Slots are readable by authenticated users" ON public.availability_slots;
CREATE POLICY "Slots readable for visible consultants" ON public.availability_slots
FOR SELECT TO authenticated USING (public.consultant_profile_visible(consultant_id));