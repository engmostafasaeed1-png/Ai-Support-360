
-- Create enum for assignment role
CREATE TYPE public.assignment_role AS ENUM ('lead', 'support', 'observer');

-- Create enum for work mode
CREATE TYPE public.assignment_work_mode AS ENUM ('collaborative', 'individual');

-- Create enum for assignment status
CREATE TYPE public.assignment_status AS ENUM ('active', 'completed', 'removed');

-- Create ticket_assignments table
CREATE TABLE public.ticket_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  role assignment_role NOT NULL DEFAULT 'support',
  work_mode assignment_work_mode NOT NULL DEFAULT 'collaborative',
  status assignment_status NOT NULL DEFAULT 'active',
  assigned_by UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, consultant_id)
);

-- Enable RLS
ALTER TABLE public.ticket_assignments ENABLE ROW LEVEL SECURITY;

-- Index for fast lookups
CREATE INDEX idx_ticket_assignments_ticket ON public.ticket_assignments(ticket_id);
CREATE INDEX idx_ticket_assignments_consultant ON public.ticket_assignments(consultant_id);

-- RLS Policies
CREATE POLICY "Admins can manage all assignments"
  ON public.ticket_assignments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients can view assignments on own tickets"
  ON public.ticket_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.id = ticket_assignments.ticket_id AND t.client_id = auth.uid()
  ));

CREATE POLICY "Clients can create assignments on own tickets"
  ON public.ticket_assignments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.id = ticket_assignments.ticket_id AND t.client_id = auth.uid()
  ));

CREATE POLICY "Clients can update assignments on own tickets"
  ON public.ticket_assignments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.id = ticket_assignments.ticket_id AND t.client_id = auth.uid()
  ));

CREATE POLICY "Clients can delete assignments on own tickets"
  ON public.ticket_assignments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.id = ticket_assignments.ticket_id AND t.client_id = auth.uid()
  ));

CREATE POLICY "Consultants can view own assignments"
  ON public.ticket_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.consultants c WHERE c.id = ticket_assignments.consultant_id AND c.user_id = auth.uid()
  ));

-- Timestamp trigger
CREATE TRIGGER update_ticket_assignments_updated_at
  BEFORE UPDATE ON public.ticket_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
