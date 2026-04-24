
DROP POLICY IF EXISTS "Clients can view own integrations" ON public.integrations;
DROP POLICY IF EXISTS "Admins can view all integrations" ON public.integrations;

CREATE POLICY "Clients can view own integrations"
ON public.integrations FOR SELECT
TO authenticated
USING (auth.uid() = client_id);

CREATE POLICY "Admins can view all integrations"
ON public.integrations FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
