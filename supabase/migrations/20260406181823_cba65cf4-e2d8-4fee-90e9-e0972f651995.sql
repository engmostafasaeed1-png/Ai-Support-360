
-- Session feedback / evaluations
CREATE TABLE public.session_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL,
  recipient_role text NOT NULL DEFAULT 'client',
  communication_score numeric,
  technical_score numeric,
  professionalism_score numeric,
  overall_score numeric,
  ai_feedback text,
  mom_content text,
  action_items text[] DEFAULT '{}',
  strengths text[] DEFAULT '{}',
  improvements text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feedback" ON public.session_feedback
  FOR SELECT USING (auth.uid() = recipient_id);

CREATE POLICY "Admins can manage all feedback" ON public.session_feedback
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_session_feedback_updated_at
  BEFORE UPDATE ON public.session_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Session surveys
CREATE TABLE public.session_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  generated_for uuid NOT NULL,
  generated_for_role text NOT NULL DEFAULT 'client',
  questions jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own surveys" ON public.session_surveys
  FOR SELECT USING (auth.uid() = generated_for);

CREATE POLICY "Users can update own surveys" ON public.session_surveys
  FOR UPDATE USING (auth.uid() = generated_for);

CREATE POLICY "Admins can manage all surveys" ON public.session_surveys
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_session_surveys_updated_at
  BEFORE UPDATE ON public.session_surveys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Survey responses
CREATE TABLE public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.session_surveys(id) ON DELETE CASCADE,
  respondent_id uuid NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create own responses" ON public.survey_responses
  FOR INSERT WITH CHECK (auth.uid() = respondent_id);

CREATE POLICY "Users can view own responses" ON public.survey_responses
  FOR SELECT USING (auth.uid() = respondent_id);

CREATE POLICY "Admins can manage all responses" ON public.survey_responses
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Knowledge solutions (anonymized from resolved tickets)
CREATE TABLE public.knowledge_solutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  problem_description text,
  solution text,
  sap_module text,
  tags text[] DEFAULT '{}',
  source_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  created_by uuid,
  views_count integer DEFAULT 0,
  helpful_count integer DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_solutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published solutions readable by authenticated" ON public.knowledge_solutions
  FOR SELECT TO authenticated USING (status = 'published');

CREATE POLICY "Authors can manage own solutions" ON public.knowledge_solutions
  FOR ALL USING (auth.uid() = created_by);

CREATE POLICY "Admins can manage all solutions" ON public.knowledge_solutions
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_knowledge_solutions_updated_at
  BEFORE UPDATE ON public.knowledge_solutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
