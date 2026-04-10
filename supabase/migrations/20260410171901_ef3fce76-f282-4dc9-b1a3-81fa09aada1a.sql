
-- Create ticket_interviews table
CREATE TABLE public.ticket_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz,
  room_id text,
  started_at timestamptz,
  ended_at timestamptz,
  transcript text,
  ai_summary text,
  body_language_analysis jsonb DEFAULT '{}'::jsonb,
  facial_verification_result jsonb DEFAULT '{}'::jsonb,
  overall_recommendation text,
  recording_url text,
  client_notes text,
  consultant_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ticket_interviews ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_ticket_interviews_ticket ON public.ticket_interviews(ticket_id);
CREATE INDEX idx_ticket_interviews_consultant ON public.ticket_interviews(consultant_id);
CREATE INDEX idx_ticket_interviews_status ON public.ticket_interviews(status);

-- RLS Policies
CREATE POLICY "Clients can view own ticket interviews"
ON public.ticket_interviews FOR SELECT
USING (auth.uid() = client_id);

CREATE POLICY "Clients can create interviews for own tickets"
ON public.ticket_interviews FOR INSERT
WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Clients can update own interviews"
ON public.ticket_interviews FOR UPDATE
USING (auth.uid() = client_id);

CREATE POLICY "Consultants can view assigned interviews"
ON public.ticket_interviews FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.consultants c
  WHERE c.id = ticket_interviews.consultant_id AND c.user_id = auth.uid()
));

CREATE POLICY "Consultants can update assigned interviews"
ON public.ticket_interviews FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.consultants c
  WHERE c.id = ticket_interviews.consultant_id AND c.user_id = auth.uid()
));

CREATE POLICY "Admins can manage all interviews"
ON public.ticket_interviews FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_ticket_interviews_updated_at
BEFORE UPDATE ON public.ticket_interviews
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notification trigger when interview is requested
CREATE OR REPLACE FUNCTION public.notify_interview_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _consultant_user_id uuid;
  _ticket_title text;
BEGIN
  SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
  SELECT title INTO _ticket_title FROM public.tickets WHERE id = NEW.ticket_id;

  IF _consultant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      _consultant_user_id,
      'Interview Requested',
      'Client has requested a pre-work interview for ticket "' || COALESCE(_ticket_title, 'Untitled') || '".',
      'interview',
      '/consultant/cases/' || NEW.ticket_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_interview_requested
AFTER INSERT ON public.ticket_interviews
FOR EACH ROW EXECUTE FUNCTION public.notify_interview_requested();

-- Notification when interview is scheduled
CREATE OR REPLACE FUNCTION public.notify_interview_scheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'scheduled' AND OLD.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Interview Scheduled',
      'Your pre-work interview has been scheduled.',
      'interview',
      '/client/tickets/' || NEW.ticket_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_interview_scheduled
AFTER UPDATE ON public.ticket_interviews
FOR EACH ROW EXECUTE FUNCTION public.notify_interview_scheduled();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_interviews;
