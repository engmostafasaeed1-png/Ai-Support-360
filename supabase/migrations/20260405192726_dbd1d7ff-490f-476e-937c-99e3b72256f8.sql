
-- 1. Extend client_profiles with new fields
ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS company_logo_url text,
  ADD COLUMN IF NOT EXISTS company_website text,
  ADD COLUMN IF NOT EXISTS company_description text,
  ADD COLUMN IF NOT EXISTS headquarters text,
  ADD COLUMN IF NOT EXISTS sap_system_ids text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sap_hosting_type text DEFAULT 'on-prem',
  ADD COLUMN IF NOT EXISTS sap_module_versions jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS key_contacts jsonb DEFAULT '[]';

-- 2. Create ticket_documents table
CREATE TABLE public.ticket_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  mime_type text,
  version integer NOT NULL DEFAULT 1,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_documents ENABLE ROW LEVEL SECURITY;

-- Clients can view docs for their own tickets
CREATE POLICY "Clients can view own ticket docs"
ON public.ticket_documents FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_documents.ticket_id AND t.client_id = auth.uid()
  )
);

-- Consultants can view docs for assigned tickets
CREATE POLICY "Consultants can view assigned ticket docs"
ON public.ticket_documents FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.id = ticket_documents.ticket_id AND c.user_id = auth.uid()
  )
);

-- Admins can manage all docs
CREATE POLICY "Admins can manage all ticket docs"
ON public.ticket_documents FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- Ticket participants can upload docs
CREATE POLICY "Participants can upload ticket docs"
ON public.ticket_documents FOR INSERT
WITH CHECK (
  auth.uid() = uploaded_by
  AND (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_documents.ticket_id AND t.client_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.consultants c ON c.id = t.consultant_id
      WHERE t.id = ticket_documents.ticket_id AND c.user_id = auth.uid()
    )
  )
);

-- Participants can delete their own uploads
CREATE POLICY "Uploaders can delete own docs"
ON public.ticket_documents FOR DELETE
USING (auth.uid() = uploaded_by);

-- 3. Create storage bucket for ticket documents
INSERT INTO storage.buckets (id, name, public) VALUES ('ticket-documents', 'ticket-documents', false);

-- Storage policies for ticket-documents
CREATE POLICY "Ticket participants can view docs"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'ticket-documents'
  AND (
    has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
      AND (
        t.client_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = t.consultant_id AND c.user_id = auth.uid())
      )
    )
  )
);

CREATE POLICY "Ticket participants can upload docs"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'ticket-documents'
  AND auth.uid() IS NOT NULL
  AND (
    has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
      AND (
        t.client_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = t.consultant_id AND c.user_id = auth.uid())
      )
    )
  )
);

CREATE POLICY "Ticket participants can delete docs"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'ticket-documents'
  AND (
    has_role(auth.uid(), 'admin')
    OR (auth.uid())::text = (storage.foldername(name))[2]
  )
);

-- Index for fast lookups
CREATE INDEX idx_ticket_documents_ticket_id ON public.ticket_documents(ticket_id);
CREATE INDEX idx_ticket_documents_file_name ON public.ticket_documents(ticket_id, file_name);
