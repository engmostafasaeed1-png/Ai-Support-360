
-- 1. VMWARE_SETTINGS — remove consultant SELECT (they must use get_vmware_settings_safe RPC, but that RPC currently only serves clients).
-- Replace with a safe view for consultants that excludes credential columns.
DROP POLICY IF EXISTS "Consultants can view assigned vmware settings" ON public.vmware_settings;

DROP VIEW IF EXISTS public.vmware_settings_safe;
CREATE VIEW public.vmware_settings_safe
WITH (security_invoker = on) AS
SELECT
  id, environment_id, hypervisor_type, cloud_vendor,
  vcenter_url, vcenter_username,
  datacenter, cluster, datastore, resource_pool, network_vlan,
  default_cpu, default_ram_gb, default_disk_gb, default_os_template,
  snapshot_enabled, auto_shutdown_hours, notes,
  cloud_region, cloud_api_endpoint, instance_type, availability_zone,
  security_group, subnet_id, storage_type,
  created_at, updated_at
FROM public.vmware_settings;

GRANT SELECT ON public.vmware_settings_safe TO authenticated;

-- 2. TICKET_DOCUMENTS DELETE — require user to still be a ticket participant or admin
DROP POLICY IF EXISTS "Uploaders can delete own docs" ON public.ticket_documents;

CREATE POLICY "Current ticket participants can delete docs"
ON public.ticket_documents FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    auth.uid() = uploaded_by
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      LEFT JOIN public.consultants c ON c.id = t.consultant_id
      WHERE t.id = ticket_documents.ticket_id
        AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
    )
  )
);

-- 3. STORAGE: ticket-documents DELETE — require participant + path[1] = ticket_id
DROP POLICY IF EXISTS "Ticket participants can delete docs" ON storage.objects;

CREATE POLICY "Ticket participants can delete docs"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'ticket-documents'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      LEFT JOIN public.consultants c ON c.id = t.consultant_id
      WHERE (t.id)::text = (storage.foldername(name))[1]
        AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
    )
  )
);

-- 4. REALTIME — strict prefix match, no substring bypass
DROP POLICY IF EXISTS "Users can subscribe to scoped channels" ON realtime.messages;
DROP POLICY IF EXISTS "Users can broadcast to scoped channels" ON realtime.messages;

CREATE POLICY "Users can subscribe to own channels (strict)"
ON realtime.messages FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR topic = auth.uid()::text
  OR topic LIKE auth.uid()::text || ':%'
  OR topic LIKE 'public:%'
);

CREATE POLICY "Users can broadcast to own channels (strict)"
ON realtime.messages FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR topic = auth.uid()::text
  OR topic LIKE auth.uid()::text || ':%'
);

-- 5. STORAGE: proposal-documents — switch from substring POSITION() to exact folder path match.
-- New convention: paths are 'proposals/<proposal_id>/<filename>' so foldername returns ['proposals','<proposal_id>'].
-- We accept either: legacy '<user_id>/...' OR 'proposals/<id>/...'.
DROP POLICY IF EXISTS "Proposal docs readable by participants or admin" ON storage.objects;
DROP POLICY IF EXISTS "Proposal docs uploads by proposal owner" ON storage.objects;
DROP POLICY IF EXISTS "Proposal docs updates by proposal owner" ON storage.objects;

CREATE POLICY "Proposal docs readable by participants or admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'proposal-documents'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
    OR (
      (storage.foldername(name))[1] = 'proposals'
      AND EXISTS (
        SELECT 1 FROM public.proposals p
        LEFT JOIN public.tickets t ON t.id = p.ticket_id
        LEFT JOIN public.consultants c ON c.id = p.consultant_id
        WHERE p.id::text = (storage.foldername(name))[2]
          AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
      )
    )
  )
);

CREATE POLICY "Proposal docs uploads by proposal owner"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'proposal-documents'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
    OR (
      (storage.foldername(name))[1] = 'proposals'
      AND EXISTS (
        SELECT 1 FROM public.proposals p
        JOIN public.consultants c ON c.id = p.consultant_id
        WHERE p.id::text = (storage.foldername(name))[2]
          AND c.user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Proposal docs updates by proposal owner"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'proposal-documents'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
    OR (
      (storage.foldername(name))[1] = 'proposals'
      AND EXISTS (
        SELECT 1 FROM public.proposals p
        JOIN public.consultants c ON c.id = p.consultant_id
        WHERE p.id::text = (storage.foldername(name))[2]
          AND c.user_id = auth.uid()
      )
    )
  )
)
WITH CHECK (
  bucket_id = 'proposal-documents'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
    OR (
      (storage.foldername(name))[1] = 'proposals'
      AND EXISTS (
        SELECT 1 FROM public.proposals p
        JOIN public.consultants c ON c.id = p.consultant_id
        WHERE p.id::text = (storage.foldername(name))[2]
          AND c.user_id = auth.uid()
      )
    )
  )
);
