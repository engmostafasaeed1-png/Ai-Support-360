CREATE TABLE public.interview_question_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sap_module text NOT NULL DEFAULT 'general',
  difficulty text NOT NULL DEFAULT 'medium',
  category text,
  question text NOT NULL,
  best_answer text NOT NULL DEFAULT '',
  key_points text,
  tags text[] NOT NULL DEFAULT '{}',
  author_name text,
  source text NOT NULL DEFAULT 'manual',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_question_library TO authenticated;
GRANT ALL ON public.interview_question_library TO service_role;
ALTER TABLE public.interview_question_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage question library" ON public.interview_question_library
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_iql_module ON public.interview_question_library (sap_module, is_active);
CREATE TRIGGER update_iql_updated_at BEFORE UPDATE ON public.interview_question_library
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();