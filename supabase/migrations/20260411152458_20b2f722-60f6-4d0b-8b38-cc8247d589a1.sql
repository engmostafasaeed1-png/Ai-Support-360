
-- Create satisfaction surveys table with 5 ITIL dimensions
CREATE TABLE public.satisfaction_surveys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rated_by UUID NOT NULL,
  rated_user UUID NOT NULL,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('client', 'consultant')),
  communication_score INTEGER CHECK (communication_score BETWEEN 1 AND 5),
  technical_quality_score INTEGER CHECK (technical_quality_score BETWEEN 1 AND 5),
  timeliness_score INTEGER CHECK (timeliness_score BETWEEN 1 AND 5),
  professionalism_score INTEGER CHECK (professionalism_score BETWEEN 1 AND 5),
  overall_score INTEGER CHECK (overall_score BETWEEN 1 AND 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  requested_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.satisfaction_surveys ENABLE ROW LEVEL SECURITY;

-- Users can view surveys they are involved in
CREATE POLICY "Users can view own surveys"
  ON public.satisfaction_surveys FOR SELECT
  TO authenticated
  USING (auth.uid() = rated_by OR auth.uid() = rated_user OR public.has_role(auth.uid(), 'admin'));

-- Users can create surveys as the rater
CREATE POLICY "Users can create surveys"
  ON public.satisfaction_surveys FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = rated_by OR auth.uid() = requested_by);

-- Users can update their own pending surveys
CREATE POLICY "Users can complete own surveys"
  ON public.satisfaction_surveys FOR UPDATE
  TO authenticated
  USING (auth.uid() = rated_by);

-- Timestamp trigger
CREATE TRIGGER update_satisfaction_surveys_updated_at
  BEFORE UPDATE ON public.satisfaction_surveys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Notification trigger when survey is requested
CREATE OR REPLACE FUNCTION public.notify_satisfaction_survey_requested()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (
    NEW.rated_by,
    'Satisfaction Survey Requested',
    'Please rate your recent experience. Your feedback helps us improve.',
    'survey',
    '/client/satisfaction'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_satisfaction_survey
  AFTER INSERT ON public.satisfaction_surveys
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_satisfaction_survey_requested();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.satisfaction_surveys;
