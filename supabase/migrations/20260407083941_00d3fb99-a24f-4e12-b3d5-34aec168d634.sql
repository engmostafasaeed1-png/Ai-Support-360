CREATE TABLE public.landing_content (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_key text NOT NULL UNIQUE,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.landing_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active landing content"
ON public.landing_content FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage landing content"
ON public.landing_content FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_landing_content_updated_at
BEFORE UPDATE ON public.landing_content
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();