ALTER TABLE public.demo_requests DROP CONSTRAINT IF EXISTS demo_requests_status_check;
ALTER TABLE public.demo_requests ADD CONSTRAINT demo_requests_status_check
  CHECK (status = ANY (ARRAY['received','contacted','scheduled','rescheduling','completed','cancelled']));

ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS proposed_slots jsonb,
  ADD COLUMN IF NOT EXISTS reschedule_reason text,
  ADD COLUMN IF NOT EXISTS reschedule_requested_at timestamptz;

DROP FUNCTION IF EXISTS public.get_demo_request_by_token(text);

CREATE OR REPLACE FUNCTION public.get_demo_request_by_token(_token text)
RETURNS TABLE (
  id uuid, demo_type text, scheduling_preference text, scheduled_date date, scheduled_slot text,
  timezone text, meeting_format text, full_name text, email text, company text, notes text,
  status text, status_note text, proposed_slots jsonb, reschedule_reason text,
  reschedule_requested_at timestamptz, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, demo_type, scheduling_preference, scheduled_date, scheduled_slot,
         timezone, meeting_format, full_name, email, company, notes,
         status, status_note, proposed_slots, reschedule_reason, reschedule_requested_at,
         created_at, updated_at
  FROM public.demo_requests
  WHERE request_token = _token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.request_demo_reschedule(
  _token text,
  _proposed_slots jsonb,
  _reason text DEFAULT NULL
) RETURNS public.demo_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.demo_requests;
BEGIN
  IF _proposed_slots IS NULL OR jsonb_typeof(_proposed_slots) <> 'array' OR jsonb_array_length(_proposed_slots) = 0 THEN
    RAISE EXCEPTION 'At least one proposed slot is required';
  END IF;
  IF jsonb_array_length(_proposed_slots) > 5 THEN
    RAISE EXCEPTION 'Please propose at most 5 slots';
  END IF;

  UPDATE public.demo_requests
  SET status = 'rescheduling',
      proposed_slots = _proposed_slots,
      reschedule_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
      reschedule_requested_at = now(),
      status_note = 'Requester proposed new time slots — awaiting confirmation.',
      updated_at = now()
  WHERE request_token = _token
    AND status IN ('received','contacted','scheduled','rescheduling')
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Demo request not found or cannot be rescheduled in its current status';
  END IF;
  RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_demo_reschedule(text, jsonb, text) TO anon, authenticated;