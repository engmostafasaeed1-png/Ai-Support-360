ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS reminder_minutes integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS reminder_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS calendar_event_id text;