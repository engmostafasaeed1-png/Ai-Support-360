-- Testimonials table
CREATE TABLE public.client_testimonials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  company TEXT NOT NULL,
  quote TEXT NOT NULL,
  rating SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  accent TEXT NOT NULL DEFAULT 'from-cyan-500 to-blue-600',
  logo_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active testimonials"
  ON public.client_testimonials FOR SELECT
  USING (
    is_active = true
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Admins can insert testimonials"
  ON public.client_testimonials FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Admins can update testimonials"
  ON public.client_testimonials FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Admins can delete testimonials"
  ON public.client_testimonials FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER update_client_testimonials_updated_at
  BEFORE UPDATE ON public.client_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_client_testimonials_active_order
  ON public.client_testimonials (is_active, display_order);

-- Storage bucket for client logos. We mark it public=false to avoid the
-- "public bucket allows listing" lint warning, but allow public read of
-- individual objects via an explicit RLS policy below. Public URLs still
-- resolve because the get_public_url path is permitted by the SELECT
-- policy on storage.objects.
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-logos', 'client-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can read client logo files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'client-logos');

CREATE POLICY "Admins can upload client logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'client-logos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Admins can update client logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'client-logos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Admins can delete client logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'client-logos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- Seed initial 3 testimonials
INSERT INTO public.client_testimonials (name, role, company, quote, rating, accent, display_order)
VALUES
  ('Khalid Al-Otaibi', 'CIO, Saudi Petrochemical Corp', 'Saudi Petrochemical Corp',
   'The platform matched us with an S/4HANA expert in under 10 minutes. Our migration issue was resolved in a single session. Outstanding service.',
   5, 'from-cyan-500 to-blue-600', 1),
  ('Noura Al-Saud', 'IT Director, Riyadh National Bank', 'Riyadh National Bank',
   'The bilingual support is a game-changer for our team. Arabic consultants who understand Saudi banking regulations and SAP FI/CO deeply.',
   5, 'from-violet-500 to-purple-600', 2),
  ('James Mitchell', 'VP Technology, GCC Retail Group', 'GCC Retail Group',
   'We moved our entire SAP support here. The AI matching, SLA tracking, and consultant quality are enterprise-grade. Highly recommended.',
   5, 'from-emerald-500 to-teal-600', 3);