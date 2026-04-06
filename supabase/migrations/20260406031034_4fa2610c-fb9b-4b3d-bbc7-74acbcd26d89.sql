-- Create interview mode enum
CREATE TYPE public.interview_mode AS ENUM ('ai', 'physical', 'online');

-- Add interview type and requested_by to interview_sessions
ALTER TABLE public.interview_sessions
  ADD COLUMN interview_type public.interview_mode DEFAULT 'ai',
  ADD COLUMN requested_by uuid REFERENCES auth.users(id);
