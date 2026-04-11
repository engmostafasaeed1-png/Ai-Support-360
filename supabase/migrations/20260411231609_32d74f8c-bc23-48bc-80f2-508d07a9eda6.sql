
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS due_date timestamptz;
CREATE INDEX IF NOT EXISTS idx_payments_ticket ON public.payments(ticket_id);
