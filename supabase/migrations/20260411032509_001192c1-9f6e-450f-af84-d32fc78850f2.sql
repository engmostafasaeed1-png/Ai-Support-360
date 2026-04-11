
-- Add custom NDA columns to client_profiles
ALTER TABLE public.client_profiles
ADD COLUMN IF NOT EXISTS custom_nda_url text,
ADD COLUMN IF NOT EXISTS custom_nda_filename text;

-- Create storage bucket for NDA documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('nda-documents', 'nda-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to read NDA documents
CREATE POLICY "NDA documents are readable by authenticated users"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'nda-documents');

-- Allow clients to upload their own NDA documents (folder = their user_id)
CREATE POLICY "Clients can upload their own NDA documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'nda-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow clients to update their own NDA documents
CREATE POLICY "Clients can update their own NDA documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'nda-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow clients to delete their own NDA documents
CREATE POLICY "Clients can delete their own NDA documents"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'nda-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
