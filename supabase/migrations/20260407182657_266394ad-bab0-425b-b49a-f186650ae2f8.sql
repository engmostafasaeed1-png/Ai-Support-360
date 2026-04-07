CREATE POLICY "Consultants can view open tickets for bidding"
ON public.tickets FOR SELECT
TO authenticated
USING (
  consultant_id IS NULL
  AND status IN ('new', 'under_review')
  AND has_role(auth.uid(), 'consultant'::app_role)
);