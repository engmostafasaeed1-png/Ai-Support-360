
-- Create interview status enum
CREATE TYPE public.interview_status AS ENUM ('pending', 'in_progress', 'completed', 'reviewed');

-- Create interview_sessions table
CREATE TABLE public.interview_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  status public.interview_status NOT NULL DEFAULT 'pending',
  overall_score NUMERIC DEFAULT NULL,
  technical_score NUMERIC DEFAULT NULL,
  soft_skills_score NUMERIC DEFAULT NULL,
  skill_results JSONB DEFAULT '[]'::jsonb,
  ai_summary TEXT DEFAULT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create interview_answers table
CREATE TABLE public.interview_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  interview_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer_transcript TEXT DEFAULT NULL,
  category TEXT NOT NULL DEFAULT 'technical',
  score NUMERIC DEFAULT NULL,
  ai_feedback TEXT DEFAULT NULL,
  question_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_answers ENABLE ROW LEVEL SECURITY;

-- RLS policies for interview_sessions
CREATE POLICY "Consultants can view own interviews"
  ON public.interview_sessions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM consultants WHERE consultants.id = interview_sessions.consultant_id AND consultants.user_id = auth.uid()
  ));

CREATE POLICY "Consultants can create own interviews"
  ON public.interview_sessions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM consultants WHERE consultants.id = interview_sessions.consultant_id AND consultants.user_id = auth.uid()
  ));

CREATE POLICY "Consultants can update own interviews"
  ON public.interview_sessions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM consultants WHERE consultants.id = interview_sessions.consultant_id AND consultants.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage all interviews"
  ON public.interview_sessions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for interview_answers
CREATE POLICY "Consultants can view own answers"
  ON public.interview_answers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM interview_sessions s
    JOIN consultants c ON c.id = s.consultant_id
    WHERE s.id = interview_answers.interview_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Consultants can create own answers"
  ON public.interview_answers FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM interview_sessions s
    JOIN consultants c ON c.id = s.consultant_id
    WHERE s.id = interview_answers.interview_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage all answers"
  ON public.interview_answers FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Triggers for updated_at
CREATE TRIGGER update_interview_sessions_updated_at
  BEFORE UPDATE ON public.interview_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
