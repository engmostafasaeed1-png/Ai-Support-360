
-- Create match request status enum
CREATE TYPE public.match_request_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');

-- Create ticket match requests table
CREATE TABLE public.ticket_match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  sent_by uuid NOT NULL,
  status public.match_request_status NOT NULL DEFAULT 'pending',
  message text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, consultant_id)
);

-- Enable RLS
ALTER TABLE public.ticket_match_requests ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage all match requests"
  ON public.ticket_match_requests FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Consultants can view their own requests
CREATE POLICY "Consultants can view own match requests"
  ON public.ticket_match_requests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = ticket_match_requests.consultant_id AND c.user_id = auth.uid()
  ));

-- Consultants can update (accept/reject) their own requests
CREATE POLICY "Consultants can respond to match requests"
  ON public.ticket_match_requests FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = ticket_match_requests.consultant_id AND c.user_id = auth.uid()
  ));

-- Clients can view match requests for their tickets
CREATE POLICY "Clients can view match requests for own tickets"
  ON public.ticket_match_requests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_match_requests.ticket_id AND t.client_id = auth.uid()
  ));

-- Timestamp trigger
CREATE TRIGGER update_ticket_match_requests_updated_at
  BEFORE UPDATE ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notification trigger: notify consultant when match request is created
CREATE OR REPLACE FUNCTION public.notify_match_request()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
      'New Ticket Match Request',
      'You have been matched to ticket "' || COALESCE(_ticket_title, 'Untitled') || '". Review and respond.',
      'match_request',
      '/consultant/requests'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_match_request_created
  AFTER INSERT ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_match_request();

-- Notification trigger: notify client when consultant accepts
CREATE OR REPLACE FUNCTION public.notify_match_accepted()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _client_id uuid;
  _ticket_title text;
  _consultant_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT t.client_id, t.title INTO _client_id, _ticket_title FROM public.tickets t WHERE t.id = NEW.ticket_id;
    SELECT p.display_name INTO _consultant_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = NEW.consultant_id;

    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      _client_id,
      'Consultant Accepted Match',
      'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" accepted the match for "' || COALESCE(_ticket_title, 'your ticket') || '". You can now choose them.',
      'match_request',
      '/client/tickets'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_match_request_accepted
  AFTER UPDATE ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_match_accepted();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_match_requests;
