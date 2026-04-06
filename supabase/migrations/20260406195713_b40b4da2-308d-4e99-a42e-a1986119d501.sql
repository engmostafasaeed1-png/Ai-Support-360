
-- Create proposal status enum
CREATE TYPE public.proposal_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');

-- Create escrow status enum
CREATE TYPE public.escrow_status AS ENUM ('unfunded', 'funded', 'in_progress', 'submitted', 'approved', 'released', 'disputed');

-- ============ PROPOSALS ============
CREATE TABLE public.proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  cover_letter text,
  proposed_rate numeric NOT NULL DEFAULT 0,
  estimated_hours numeric,
  timeline_days integer,
  status proposal_status NOT NULL DEFAULT 'pending',
  client_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, consultant_id)
);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants can create own proposals"
ON public.proposals FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM consultants c WHERE c.id = proposals.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Consultants can view own proposals"
ON public.proposals FOR SELECT
USING (EXISTS (SELECT 1 FROM consultants c WHERE c.id = proposals.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Consultants can update own proposals"
ON public.proposals FOR UPDATE
USING (EXISTS (SELECT 1 FROM consultants c WHERE c.id = proposals.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Clients can view proposals on their tickets"
ON public.proposals FOR SELECT
USING (EXISTS (SELECT 1 FROM tickets t WHERE t.id = proposals.ticket_id AND t.client_id = auth.uid()));

CREATE POLICY "Clients can update proposals on their tickets"
ON public.proposals FOR UPDATE
USING (EXISTS (SELECT 1 FROM tickets t WHERE t.id = proposals.ticket_id AND t.client_id = auth.uid()));

CREATE POLICY "Admins can manage all proposals"
ON public.proposals FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_proposals_updated_at
BEFORE UPDATE ON public.proposals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ MILESTONES ============
CREATE TABLE public.milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  position integer NOT NULL DEFAULT 0,
  escrow_status escrow_status NOT NULL DEFAULT 'unfunded',
  due_date date,
  funded_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can manage milestones on own projects"
ON public.milestones FOR ALL
USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = milestones.project_id AND p.client_id = auth.uid()));

CREATE POLICY "Consultants can view milestones on assigned projects"
ON public.milestones FOR SELECT
USING (EXISTS (SELECT 1 FROM projects p JOIN consultants c ON c.id = p.consultant_id WHERE p.id = milestones.project_id AND c.user_id = auth.uid()));

CREATE POLICY "Consultants can update milestones on assigned projects"
ON public.milestones FOR UPDATE
USING (EXISTS (SELECT 1 FROM projects p JOIN consultants c ON c.id = p.consultant_id WHERE p.id = milestones.project_id AND c.user_id = auth.uid()));

CREATE POLICY "Admins can manage all milestones"
ON public.milestones FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_milestones_updated_at
BEFORE UPDATE ON public.milestones
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ WORK DIARY ENTRIES ============
CREATE TABLE public.work_diary_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  memo text,
  activity_level integer DEFAULT 0,
  screenshot_url text,
  is_manual boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_diary_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants can manage own diary entries"
ON public.work_diary_entries FOR ALL
USING (EXISTS (SELECT 1 FROM consultants c WHERE c.id = work_diary_entries.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Clients can view diary entries on their sessions"
ON public.work_diary_entries FOR SELECT
USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = work_diary_entries.session_id AND s.client_id = auth.uid()));

CREATE POLICY "Admins can manage all diary entries"
ON public.work_diary_entries FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_work_diary_updated_at
BEFORE UPDATE ON public.work_diary_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
