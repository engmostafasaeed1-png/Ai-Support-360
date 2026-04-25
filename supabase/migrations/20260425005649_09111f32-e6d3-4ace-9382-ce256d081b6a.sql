DROP POLICY IF EXISTS "Anyone can submit a demo request" ON public.demo_requests;

CREATE POLICY "Anyone can submit a demo request"
ON public.demo_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (
  length(btrim(full_name)) >= 2
  AND length(btrim(email)) >= 5
  AND email LIKE '%@%.%'
  AND status = 'received'
);
