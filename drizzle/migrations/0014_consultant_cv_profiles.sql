CREATE TABLE public.consultant_cv_profiles (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  cv_text text,
  matching_summary text,
  expertise_keywords text[] NOT NULL DEFAULT '{}',
  source_path text,
  parsed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_cv_profiles TO authenticated;
GRANT ALL ON public.consultant_cv_profiles TO service_role;
ALTER TABLE public.consultant_cv_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Consultants manage own CV profile" ON public.consultant_cv_profiles FOR ALL TO authenticated
  USING (consultant_id = auth.uid()) WITH CHECK (consultant_id = auth.uid());
CREATE POLICY "Admins read CV profiles" ON public.consultant_cv_profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));