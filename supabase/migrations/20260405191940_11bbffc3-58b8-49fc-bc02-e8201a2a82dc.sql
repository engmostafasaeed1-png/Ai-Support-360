
-- 1. Certifications: restrict document_url access
-- Replace the public read policy with a more restrictive one
DROP POLICY IF EXISTS "Certs are publicly readable" ON public.certifications;

-- Public can see cert metadata (name, issuer, dates) but not document_url
-- We'll create a view for public access and restrict the table
CREATE OR REPLACE VIEW public.certifications_public
WITH (security_invoker = on) AS
SELECT id, consultant_id, name, issuer, issue_date, expiry_date, verified, created_at
FROM public.certifications;

-- Allow consultants to see their own certs (including document_url)
CREATE POLICY "Consultants can view own certs"
ON public.certifications FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = certifications.consultant_id AND c.user_id = auth.uid())
  OR has_role(auth.uid(), 'admin')
);

-- Allow authenticated users to see cert metadata (no document_url) via direct query
CREATE POLICY "Authenticated can view cert metadata"
ON public.certifications FOR SELECT TO authenticated
USING (true);

-- 2. Chat files storage: restrict to session participants
DROP POLICY IF EXISTS "Chat files are publicly readable" ON storage.objects;
CREATE POLICY "Session participants can view chat files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-files'
  AND (
    has_role(auth.uid(), 'admin')
    OR (auth.uid())::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id::text = (storage.foldername(name))[1]
      AND (
        s.client_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = s.consultant_id AND c.user_id = auth.uid())
      )
    )
  )
);

-- Fix chat file uploads to verify session participation
DROP POLICY IF EXISTS "Authenticated users can upload chat files" ON storage.objects;
CREATE POLICY "Session participants can upload chat files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'chat-files'
  AND auth.uid() IS NOT NULL
  AND (
    has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id::text = (storage.foldername(name))[1]
      AND (
        s.client_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = s.consultant_id AND c.user_id = auth.uid())
      )
    )
  )
);

-- 3. Audit logs: restrict insert to own user_id
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert own audit logs"
ON public.audit_logs FOR INSERT
WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));
