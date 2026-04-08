-- Allow clients to insert match requests for their own tickets
CREATE POLICY "Clients can send match requests for own tickets"
ON public.ticket_match_requests
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_match_requests.ticket_id
    AND t.client_id = auth.uid()
  )
  AND auth.uid() = sent_by
);