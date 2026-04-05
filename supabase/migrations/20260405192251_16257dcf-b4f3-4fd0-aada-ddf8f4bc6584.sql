
-- Fix chat file DELETE to use session-based ownership
DROP POLICY IF EXISTS "Users can delete own chat files" ON storage.objects;
CREATE POLICY "Session participants can delete chat files"
ON storage.objects FOR DELETE
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
