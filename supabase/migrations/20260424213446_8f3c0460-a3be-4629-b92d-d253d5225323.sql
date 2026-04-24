
-- 1. MESSAGES: drop overly broad realtime policies (rely on session-participant policies)
DROP POLICY IF EXISTS "authenticated_can_read_realtime" ON public.messages;
DROP POLICY IF EXISTS "authenticated_can_send_realtime" ON public.messages;

-- 2. STORAGE: NDA documents -- restrict to owner (folder = auth.uid()) and admins
DROP POLICY IF EXISTS "NDA documents are readable by authenticated users" ON storage.objects;

CREATE POLICY "NDA docs readable by owner or admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'nda-documents'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
  )
);

-- 3. STORAGE: proposal documents -- restrict reads to participants
DROP POLICY IF EXISTS "Auth users can read proposal docs" ON storage.objects;

CREATE POLICY "Proposal docs readable by participants or admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'proposal-documents'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.proposals p
      LEFT JOIN public.tickets t ON t.id = p.ticket_id
      LEFT JOIN public.consultants c ON c.id = p.consultant_id
      WHERE position(p.id::text in name) > 0
        AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
    )
  )
);

-- 4. STORAGE: proposal docs uploads -- restrict to consultant who owns the proposal
DROP POLICY IF EXISTS "Auth users can upload proposal docs" ON storage.objects;

CREATE POLICY "Proposal docs uploads by proposal owner"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'proposal-documents'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.consultants c ON c.id = p.consultant_id
      WHERE position(p.id::text in name) > 0
        AND c.user_id = auth.uid()
    )
  )
);

-- 5. ENVIRONMENT CREDENTIALS: remove consultant SELECT policy (they should not read encrypted passwords).
-- Expose a safe metadata view for consultants instead.
DROP POLICY IF EXISTS "Consultants can view assigned env credentials" ON public.environment_credentials;

DROP VIEW IF EXISTS public.environment_credentials_safe;
CREATE VIEW public.environment_credentials_safe
WITH (security_invoker = on) AS
SELECT
  ec.id,
  ec.environment_id,
  ec.credential_label,
  ec.hostname,
  ec.port,
  ec.domain,
  ec.username,
  ec.entered_by,
  ec.created_at,
  ec.updated_at
FROM public.environment_credentials ec;

GRANT SELECT ON public.environment_credentials_safe TO authenticated;

-- 6. REALTIME: scope channel subscriptions per user
DROP POLICY IF EXISTS "authenticated_can_read_realtime" ON realtime.messages;
DROP POLICY IF EXISTS "authenticated_can_send_realtime" ON realtime.messages;

CREATE POLICY "Users can subscribe to their own channels"
ON realtime.messages FOR SELECT
TO authenticated
USING (
  extension = 'postgres_changes'
  OR topic LIKE '%' || auth.uid()::text || '%'
);

CREATE POLICY "Users can broadcast to their own channels"
ON realtime.messages FOR INSERT
TO authenticated
WITH CHECK (
  extension = 'postgres_changes'
  OR topic LIKE '%' || auth.uid()::text || '%'
);
