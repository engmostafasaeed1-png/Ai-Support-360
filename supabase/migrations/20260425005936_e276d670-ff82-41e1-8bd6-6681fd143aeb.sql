ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_slot TEXT;
