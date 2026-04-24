-- Invoice disputes table
CREATE TABLE public.invoice_disputes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL,
  client_id UUID NOT NULL,
  consultant_id UUID,
  reason_category TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_notes TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own disputes"
ON public.invoice_disputes FOR SELECT TO authenticated
USING (auth.uid() = client_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients create own disputes"
ON public.invoice_disputes FOR INSERT TO authenticated
WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Clients update own open disputes"
ON public.invoice_disputes FOR UPDATE TO authenticated
USING ((auth.uid() = client_id AND status = 'open') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete disputes"
ON public.invoice_disputes FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_invoice_disputes_payment ON public.invoice_disputes(payment_id);
CREATE INDEX idx_invoice_disputes_client ON public.invoice_disputes(client_id);

CREATE TRIGGER update_invoice_disputes_updated_at
BEFORE UPDATE ON public.invoice_disputes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for evidence
INSERT INTO storage.buckets (id, name, public) VALUES ('dispute-evidence', 'dispute-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users upload own dispute evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'dispute-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users view own dispute evidence"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'dispute-evidence' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Users delete own dispute evidence"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'dispute-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);