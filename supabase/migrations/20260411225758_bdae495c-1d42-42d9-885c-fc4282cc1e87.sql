-- Add ticket_type column to tickets
ALTER TABLE public.tickets 
ADD COLUMN ticket_type text NOT NULL DEFAULT 'standard';

-- Create index for filtering
CREATE INDEX idx_tickets_ticket_type ON public.tickets (ticket_type);

-- Update comment
COMMENT ON COLUMN public.tickets.ticket_type IS 'Type of ticket: standard, major_incident, change_request, etc.';