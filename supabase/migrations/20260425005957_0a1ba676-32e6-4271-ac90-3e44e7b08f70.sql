DROP FUNCTION IF EXISTS public.get_demo_request_by_token(TEXT);

CREATE OR REPLACE FUNCTION public.get_demo_request_by_token(_token TEXT)
RETURNS TABLE (
  id UUID,
  demo_type TEXT,
  scheduling_preference TEXT,
  scheduled_date DATE,
  scheduled_slot TEXT,
  full_name TEXT,
  email TEXT,
  company TEXT,
  notes TEXT,
  status TEXT,
  status_note TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, demo_type, scheduling_preference, scheduled_date, scheduled_slot,
         full_name, email, company, notes, status, status_note,
         created_at, updated_at
  FROM public.demo_requests
  WHERE request_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_demo_request_by_token(TEXT) TO anon, authenticated;
