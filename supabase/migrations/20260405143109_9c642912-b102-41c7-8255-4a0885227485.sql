
-- Drop the overly permissive policy
DROP POLICY "Service can insert sync logs" ON public.integration_sync_log;

-- Replace with authenticated-only insert
CREATE POLICY "Authenticated can insert sync logs"
  ON public.integration_sync_log FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM integrations i WHERE i.id = integration_sync_log.integration_id AND i.client_id = auth.uid()
    )
    OR has_role(auth.uid(), 'admin'::app_role)
  );
