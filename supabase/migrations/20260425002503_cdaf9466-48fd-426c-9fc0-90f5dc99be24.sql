ALTER TABLE public.client_testimonials
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_client_testimonials_order
  ON public.client_testimonials (is_featured DESC, display_order ASC);