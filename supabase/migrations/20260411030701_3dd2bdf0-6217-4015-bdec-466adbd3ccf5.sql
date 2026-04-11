
-- Add versioning columns to proposals
ALTER TABLE public.proposals
ADD COLUMN version integer NOT NULL DEFAULT 1,
ADD COLUMN parent_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL;

-- Create proposal attachments table
CREATE TABLE public.proposal_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  mime_type text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_attachments ENABLE ROW LEVEL SECURITY;

-- Consultants can manage their own proposal attachments
CREATE POLICY "Consultants can view own proposal attachments"
ON public.proposal_attachments FOR SELECT
TO authenticated
USING (
  uploaded_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.proposals p
    JOIN public.tickets t ON t.id = p.ticket_id
    WHERE p.id = proposal_id AND t.client_id = auth.uid()
  )
);

CREATE POLICY "Users can insert own proposal attachments"
ON public.proposal_attachments FOR INSERT
TO authenticated
WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can delete own proposal attachments"
ON public.proposal_attachments FOR DELETE
TO authenticated
USING (uploaded_by = auth.uid());

-- Storage bucket for proposal documents
INSERT INTO storage.buckets (id, name, public) VALUES ('proposal-documents', 'proposal-documents', false);

CREATE POLICY "Auth users can upload proposal docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'proposal-documents');

CREATE POLICY "Auth users can read proposal docs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'proposal-documents');
