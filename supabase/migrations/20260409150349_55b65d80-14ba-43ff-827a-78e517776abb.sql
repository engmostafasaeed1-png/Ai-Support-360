
CREATE TABLE public.interview_training_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sap_module text NOT NULL DEFAULT 'general',
  custom_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  training_instructions text,
  difficulty_level text NOT NULL DEFAULT 'medium',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.interview_training_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage training configs"
  ON public.interview_training_config FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can view active configs"
  ON public.interview_training_config FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE TRIGGER update_interview_training_config_updated_at
  BEFORE UPDATE ON public.interview_training_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
