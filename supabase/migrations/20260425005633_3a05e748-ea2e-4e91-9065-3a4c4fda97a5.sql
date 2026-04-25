-- Demo requests submitted from the public landing page wizard.
CREATE TABLE public.demo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  user_id UUID,
  demo_type TEXT NOT NULL CHECK (demo_type IN ('live','ai-triage','pricing-roi','module-deep-dive')),
  scheduling_preference TEXT NOT NULL CHECK (scheduling_preference IN ('asap','this-week','next-week','flexible')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','contacted','scheduled','completed','cancelled')),
  status_note TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_demo_requests_email ON public.demo_requests (email);
CREATE INDEX idx_demo_requests_status ON public.demo_requests (status);
CREATE INDEX idx_demo_requests_user_id ON public.demo_requests (user_id);

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous visitors) can submit a demo request.
CREATE POLICY "Anyone can submit a demo request"
ON public.demo_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Authenticated users see their own requests (matched by user_id when set,
-- or by their email otherwise).
CREATE POLICY "Users can view their own demo requests"
ON public.demo_requests
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
);

-- Admins and super admins can read everything.
CREATE POLICY "Admins can view all demo requests"
ON public.demo_requests
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Admins and super admins can manage status / notes.
CREATE POLICY "Admins can update demo requests"
ON public.demo_requests
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can delete demo requests"
ON public.demo_requests
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

-- Keep updated_at fresh.
CREATE TRIGGER set_demo_requests_updated_at
BEFORE UPDATE ON public.demo_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Lookup function for anonymous confirmation page: callers pass the
-- request_token they received after submitting; returns a safe subset
-- of columns. SECURITY DEFINER bypasses RLS but only ever returns the
-- single row matching the token.
CREATE OR REPLACE FUNCTION public.get_demo_request_by_token(_token TEXT)
RETURNS TABLE (
  id UUID,
  demo_type TEXT,
  scheduling_preference TEXT,
  full_name TEXT,
  email TEXT,
  company TEXT,
  notes TEXT,
  status TEXT,
  status_note TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, demo_type, scheduling_preference, full_name, email, company,
         notes, status, status_note, created_at, updated_at
  FROM public.demo_requests
  WHERE request_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_demo_request_by_token(TEXT) TO anon, authenticated;
