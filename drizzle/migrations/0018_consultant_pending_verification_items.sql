CREATE TABLE public.consultant_verification_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'custom' CHECK (kind IN ('certificates','links','cv','custom')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','verified')),
  consultant_note text CHECK (consultant_note IS NULL OR char_length(consultant_note) <= 1000),
  due_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_by uuid DEFAULT auth.uid(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.consultant_verification_items (consultant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_verification_items TO authenticated;
GRANT ALL ON public.consultant_verification_items TO service_role;
ALTER TABLE public.consultant_verification_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage verification items" ON public.consultant_verification_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Consultants view own verification items" ON public.consultant_verification_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Consultants answer own verification items" ON public.consultant_verification_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Visible consultants show open items" ON public.consultant_verification_items
  FOR SELECT TO authenticated
  USING (public.consultant_profile_visible(consultant_id));

CREATE OR REPLACE FUNCTION public.guard_verification_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR auth.uid() IS NULL THEN
    IF NEW.status = 'verified' AND OLD.status IS DISTINCT FROM 'verified' THEN NEW.completed_at := now(); END IF;
    RETURN NEW;
  END IF;
  -- consultants may only add a note and mark an open item as submitted
  IF NEW.consultant_id <> OLD.consultant_id OR NEW.kind <> OLD.kind OR NEW.label <> OLD.label
     OR NEW.due_at <> OLD.due_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.status NOT IN ('open','submitted') OR OLD.status = 'verified' THEN
    RAISE EXCEPTION 'Only the platform can change this verification item' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_verification_item BEFORE UPDATE ON public.consultant_verification_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_verification_item();