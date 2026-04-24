
-- 1) Make nda-documents bucket private
UPDATE storage.buckets SET public = false WHERE id = 'nda-documents';

-- 2) Safe view of integrations without credentials
CREATE OR REPLACE VIEW public.integrations_safe
WITH (security_invoker = true) AS
SELECT
  id,
  client_id,
  tenant_id,
  platform,
  platform_url,
  external_project_id,
  sync_enabled,
  status,
  last_synced_at,
  settings,
  created_at,
  updated_at
FROM public.integrations;

GRANT SELECT ON public.integrations_safe TO authenticated;

-- 3) Secure RPC to read credentials only for owner or admin
CREATE OR REPLACE FUNCTION public.get_integration_credentials(_integration_id uuid)
RETURNS TABLE(api_key_encrypted text, webhook_secret text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.id = _integration_id
      AND (i.client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT i.api_key_encrypted, i.webhook_secret
  FROM public.integrations i
  WHERE i.id = _integration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_integration_credentials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_integration_credentials(uuid) TO authenticated;

-- 4) Restrict direct SELECT on integrations table to admins only
-- (Clients should use integrations_safe view for non-sensitive data)
DROP POLICY IF EXISTS "Clients can view own integrations" ON public.integrations;

CREATE POLICY "Admins can view all integrations rows"
  ON public.integrations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
