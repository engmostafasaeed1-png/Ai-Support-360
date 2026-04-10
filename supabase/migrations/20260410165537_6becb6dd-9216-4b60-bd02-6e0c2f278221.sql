
-- Work log entries per consultant per ticket
CREATE TABLE public.ticket_work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'support',
  billable BOOLEAN NOT NULL DEFAULT true,
  hourly_rate NUMERIC DEFAULT 0,
  total_cost NUMERIC GENERATED ALWAYS AS (hours * hourly_rate) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_work_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_work_logs_ticket ON public.ticket_work_logs(ticket_id);
CREATE INDEX idx_work_logs_consultant ON public.ticket_work_logs(consultant_id);

-- RLS
CREATE POLICY "Admins can manage all work logs"
  ON public.ticket_work_logs FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Consultants can manage own work logs"
  ON public.ticket_work_logs FOR ALL
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_work_logs.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Clients can view work logs on own tickets"
  ON public.ticket_work_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_work_logs.ticket_id AND t.client_id = auth.uid()));

-- Timestamp trigger
CREATE TRIGGER update_work_logs_updated_at
  BEFORE UPDATE ON public.ticket_work_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Timesheet submission/signing tracking
CREATE TABLE public.ticket_timesheet_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_hours NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  cost_currency TEXT DEFAULT 'USD',
  pdf_url TEXT,
  signature_method TEXT,
  sent_to_email TEXT,
  signed_at TIMESTAMPTZ,
  signed_by_name TEXT,
  signature_data TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_timesheet_submissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_timesheet_sub_ticket ON public.ticket_timesheet_submissions(ticket_id);

CREATE POLICY "Admins can manage all timesheet submissions"
  ON public.ticket_timesheet_submissions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Submitters can manage own submissions"
  ON public.ticket_timesheet_submissions FOR ALL
  USING (auth.uid() = submitted_by);

CREATE POLICY "Clients can view submissions on own tickets"
  ON public.ticket_timesheet_submissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_timesheet_submissions.ticket_id AND t.client_id = auth.uid()));

CREATE TRIGGER update_timesheet_sub_updated_at
  BEFORE UPDATE ON public.ticket_timesheet_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
