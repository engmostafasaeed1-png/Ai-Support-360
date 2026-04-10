
DROP POLICY IF EXISTS "System can insert predictions" ON public.prediction_logs;
CREATE POLICY "Authenticated can insert predictions" ON public.prediction_logs FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM tickets t WHERE t.id = prediction_logs.ticket_id AND (t.client_id = auth.uid() OR EXISTS (SELECT 1 FROM consultants c WHERE c.id = t.consultant_id AND c.user_id = auth.uid())))
  OR has_role(auth.uid(), 'admin'::app_role)
);
