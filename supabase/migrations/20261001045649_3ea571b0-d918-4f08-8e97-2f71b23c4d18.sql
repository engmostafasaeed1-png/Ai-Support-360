DROP POLICY IF EXISTS "Consultants can view shared configs" ON public.shared_remote_configs;
CREATE POLICY "Consultants can view shared configs" ON public.shared_remote_configs
FOR SELECT TO authenticated
USING (
  status IS DISTINCT FROM 'revoked'
  AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = shared_remote_configs.consultant_id AND c.user_id = auth.uid())
);
DROP POLICY IF EXISTS "Consultants can accept shared configs" ON public.shared_remote_configs;
CREATE POLICY "Consultants can accept shared configs" ON public.shared_remote_configs
FOR UPDATE TO authenticated
USING (
  status IS DISTINCT FROM 'revoked'
  AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = shared_remote_configs.consultant_id AND c.user_id = auth.uid())
);