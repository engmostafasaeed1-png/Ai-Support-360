ALTER TABLE public.interview_participants
  ADD COLUMN IF NOT EXISTS rsvp_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rsvp_at timestamptz,
  ADD COLUMN IF NOT EXISTS rsvp_note text,
  ADD COLUMN IF NOT EXISTS proposed_slots jsonb;

ALTER TABLE public.interview_participants
  ADD CONSTRAINT interview_participants_rsvp_status_check
    CHECK (rsvp_status IN ('pending', 'accepted', 'declined', 'reschedule_requested')),
  ADD CONSTRAINT interview_participants_rsvp_note_check
    CHECK (rsvp_note IS NULL OR length(rsvp_note) <= 1000),
  ADD CONSTRAINT interview_participants_proposed_slots_check
    CHECK (proposed_slots IS NULL OR (jsonb_typeof(proposed_slots) = 'array' AND jsonb_array_length(proposed_slots) <= 3));

-- One row per invited person. Only the SHA-256 hash of the secret in the e-mail link is stored, so nobody who can read this table can answer for someone else.
CREATE TABLE IF NOT EXISTS public.interview_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);

ALTER TABLE public.interview_invitations ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the e-mail functions (service role) read or write this table.
REVOKE ALL ON public.interview_invitations FROM anon, authenticated;