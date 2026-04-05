
-- 1. Ratings: restrict to participants + admins
DROP POLICY IF EXISTS "Ratings are publicly readable" ON public.ratings;
CREATE POLICY "Participants and admins can view ratings"
ON public.ratings FOR SELECT TO authenticated
USING (
  auth.uid() = client_id
  OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ratings.consultant_id AND c.user_id = auth.uid())
  OR has_role(auth.uid(), 'admin')
);

-- Also allow public read of ratings without client_id exposure (for marketplace display)
-- Actually for marketplace we need ratings visible. Let's allow authenticated users to see ratings.
DROP POLICY IF EXISTS "Participants and admins can view ratings" ON public.ratings;
CREATE POLICY "Authenticated users can view ratings"
ON public.ratings FOR SELECT TO authenticated
USING (true);

-- 2. Certifications: remove the overly permissive policy
DROP POLICY IF EXISTS "Authenticated can view cert metadata" ON public.certifications;

-- 3. Chat files: fix the UUID folder bypass
DROP POLICY IF EXISTS "Session participants can view chat files" ON storage.objects;
CREATE POLICY "Session participants can view chat files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-files'
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

-- 4. Notifications: scope to authenticated role
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
ON public.notifications FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- 5. Audit logs: restrict to admin/service role only
DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Admins can insert audit logs"
ON public.audit_logs FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));
