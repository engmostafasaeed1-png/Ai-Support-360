ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS meeting_format TEXT;

DROP FUNCTION IF EXISTS public.get_demo_request_by_token(text);

CREATE OR REPLACE FUNCTION public.get_demo_request_by_token(_token text)
 RETURNS TABLE(id uuid, demo_type text, scheduling_preference text, scheduled_date date, scheduled_slot text, timezone text, meeting_format text, full_name text, email text, company text, notes text, status text, status_note text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, demo_type, scheduling_preference, scheduled_date, scheduled_slot,
         timezone, meeting_format,
         full_name, email, company, notes, status, status_note,
         created_at, updated_at
  FROM public.demo_requests
  WHERE request_token = _token
  LIMIT 1;
$function$;