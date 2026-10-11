-- M48: a bid can only be accepted through accept_proposal().
-- The UPDATE policy of the client on proposals let the client set status = 'accepted' with a plain table update. That skips every
-- check of accept_proposal() (consultant verified, ticket not finished, consultant assigned, the other bids settled in the same step).
-- accept_proposal() is SECURITY DEFINER (owner postgres) and keeps working; for a client every other way to accept is now refused.
-- Rejecting a bid and writing notes on a pending bid stay possible.
ALTER POLICY "Clients can update proposals on their tickets" ON public.proposals
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = proposals.ticket_id AND t.client_id = auth.uid())
    AND status <> 'accepted'::public.proposal_status
  );