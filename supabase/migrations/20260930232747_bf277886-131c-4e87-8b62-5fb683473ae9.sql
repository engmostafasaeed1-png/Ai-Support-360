DROP POLICY IF EXISTS "Consultants upload own documents" ON storage.objects;
CREATE POLICY "Consultants upload own documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'consultant-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Consultant documents readable by owner or admin" ON storage.objects;
CREATE POLICY "Consultant documents readable by owner or admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'consultant-documents'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Consultants update own documents" ON storage.objects;
CREATE POLICY "Consultants update own documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'consultant-documents' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'consultant-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Consultants delete own documents" ON storage.objects;
CREATE POLICY "Consultants delete own documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'consultant-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);