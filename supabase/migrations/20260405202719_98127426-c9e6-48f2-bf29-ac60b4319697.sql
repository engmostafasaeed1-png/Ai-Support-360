
-- Create NDA agreements table
CREATE TABLE public.nda_agreements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  signature_data text NOT NULL,
  signature_type text NOT NULL DEFAULT 'type',
  nda_content text NOT NULL,
  ip_address text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, client_id)
);

-- Enable RLS
ALTER TABLE public.nda_agreements ENABLE ROW LEVEL SECURITY;

-- Consultants can view their own NDAs
CREATE POLICY "Consultants can view own NDAs"
  ON public.nda_agreements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = nda_agreements.consultant_id AND c.user_id = auth.uid()
  ));

-- Consultants can create NDAs
CREATE POLICY "Consultants can create NDAs"
  ON public.nda_agreements FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = nda_agreements.consultant_id AND c.user_id = auth.uid()
  ));

-- Clients can view NDAs signed for them
CREATE POLICY "Clients can view NDAs for them"
  ON public.nda_agreements FOR SELECT
  USING (auth.uid() = client_id);

-- Admins can view all NDAs
CREATE POLICY "Admins can view all NDAs"
  ON public.nda_agreements FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Admins can manage all NDAs
CREATE POLICY "Admins can manage all NDAs"
  ON public.nda_agreements FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed default NDA template
INSERT INTO public.platform_settings (key, value)
VALUES ('nda_template', '"This Non-Disclosure Agreement (\"Agreement\") is entered into between the Consultant and the Client through the Qurtuba Talks platform.\n\n1. CONFIDENTIAL INFORMATION\nThe Consultant agrees to keep confidential all information, data, documents, and materials shared by the Client during the course of the engagement, including but not limited to: SAP system configurations, business processes, financial data, customer information, and proprietary methodologies.\n\n2. OBLIGATIONS\nThe Consultant shall:\n- Not disclose any confidential information to third parties\n- Use confidential information solely for the purpose of providing the agreed services\n- Take reasonable measures to protect the confidentiality of the information\n- Return or destroy all confidential materials upon completion of the engagement\n\n3. DURATION\nThis agreement shall remain in effect for the duration of the engagement and for a period of two (2) years following its termination.\n\n4. EXCEPTIONS\nThis agreement does not apply to information that:\n- Is or becomes publicly available through no fault of the Consultant\n- Was already known to the Consultant prior to disclosure\n- Is independently developed by the Consultant without use of confidential information\n\n5. GOVERNING LAW\nThis Agreement shall be governed by the laws applicable in the jurisdiction of the Client."'::jsonb)
ON CONFLICT (key) DO NOTHING;
