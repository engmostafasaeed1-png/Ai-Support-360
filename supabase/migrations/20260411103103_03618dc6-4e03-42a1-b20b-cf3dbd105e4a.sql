
-- Business processes table
CREATE TABLE public.business_processes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id),
  client_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  sap_module TEXT,
  process_owner TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  consultant_visible BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.business_processes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can manage own business processes"
ON public.business_processes FOR ALL
TO authenticated
USING (client_id = auth.uid())
WITH CHECK (client_id = auth.uid());

CREATE POLICY "Consultants can view approved processes"
ON public.business_processes FOR SELECT
TO authenticated
USING (
  consultant_visible = true
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.client_id = business_processes.client_id
    AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can view all processes"
ON public.business_processes FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_business_processes_updated_at
BEFORE UPDATE ON public.business_processes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Business process documents
CREATE TABLE public.business_process_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_process_id UUID NOT NULL REFERENCES public.business_processes(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.business_process_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own process documents"
ON public.business_process_documents FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.business_processes bp WHERE bp.id = business_process_id AND bp.client_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.business_processes bp WHERE bp.id = business_process_id AND bp.client_id = auth.uid())
);

CREATE POLICY "Consultants can view approved process documents"
ON public.business_process_documents FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.business_processes bp
    WHERE bp.id = business_process_id
    AND bp.consultant_visible = true
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.consultants c ON c.id = t.consultant_id
      WHERE t.client_id = bp.client_id AND c.user_id = auth.uid()
    )
  )
);

-- Ticket to business process linking
CREATE TABLE public.ticket_business_processes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  business_process_id UUID NOT NULL REFERENCES public.business_processes(id) ON DELETE CASCADE,
  linked_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, business_process_id)
);

ALTER TABLE public.ticket_business_processes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage ticket-process links"
ON public.ticket_business_processes FOR ALL
TO authenticated
USING (linked_by = auth.uid())
WITH CHECK (linked_by = auth.uid());

CREATE POLICY "Users can view ticket-process links for their tickets"
ON public.ticket_business_processes FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND (t.client_id = auth.uid() OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = t.consultant_id AND c.user_id = auth.uid()))
  )
);

-- Storage bucket for business process files
INSERT INTO storage.buckets (id, name, public) VALUES ('business-process-docs', 'business-process-docs', false);

CREATE POLICY "Users can upload business process docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'business-process-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own business process docs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'business-process-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own business process docs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'business-process-docs' AND auth.uid()::text = (storage.foldername(name))[1]);
