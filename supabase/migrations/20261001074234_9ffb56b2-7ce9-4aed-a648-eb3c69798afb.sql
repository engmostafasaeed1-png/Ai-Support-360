CREATE TABLE public.interview_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sap_module text NOT NULL,
  seniority text NOT NULL DEFAULT 'any' CHECK (seniority IN ('any','junior','mid','senior','expert')),
  role_focus text NOT NULL DEFAULT 'any' CHECK (role_focus IN ('any','functional','technical','architect','manager')),
  title text NOT NULL,
  focus_areas text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  sample_questions text NOT NULL DEFAULT '',
  question_count integer NOT NULL DEFAULT 8 CHECK (question_count BETWEEN 3 AND 20),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_templates TO authenticated;
GRANT ALL ON public.interview_templates TO service_role;
ALTER TABLE public.interview_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage interview templates" ON public.interview_templates FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE INDEX idx_interview_templates_module ON public.interview_templates (sap_module, is_active);
CREATE TRIGGER update_interview_templates_updated_at BEFORE UPDATE ON public.interview_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();