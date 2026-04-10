-- Add parent_ticket_id for hierarchical tickets
ALTER TABLE public.tickets
ADD COLUMN parent_ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE DEFAULT NULL;

-- Index for fast child lookup
CREATE INDEX idx_tickets_parent_ticket_id ON public.tickets(parent_ticket_id) WHERE parent_ticket_id IS NOT NULL;