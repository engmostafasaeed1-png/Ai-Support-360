-- 1. Audit table
CREATE TABLE public.consultant_verification_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  old_status verification_status,
  new_status verification_status NOT NULL,
  reviewer_id UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consultant_verification_audit_consultant
  ON public.consultant_verification_audit(consultant_id, created_at DESC);

-- 2. RLS
ALTER TABLE public.consultant_verification_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all verification audit entries"
ON public.consultant_verification_audit
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Consultants can view their own verification audit entries"
ON public.consultant_verification_audit
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = consultant_verification_audit.consultant_id
      AND c.user_id = auth.uid()
  )
);

-- 3. Trigger function: log every verification_status change
CREATE OR REPLACE FUNCTION public.log_consultant_verification_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reason TEXT;
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    -- Optional reason can be passed by the caller via SET LOCAL "app.verification_reason"
    BEGIN
      _reason := current_setting('app.verification_reason', true);
    EXCEPTION WHEN OTHERS THEN
      _reason := NULL;
    END;

    INSERT INTO public.consultant_verification_audit
      (consultant_id, old_status, new_status, reviewer_id, reason)
    VALUES
      (NEW.id, OLD.verification_status, NEW.verification_status, auth.uid(), NULLIF(_reason, ''));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_consultant_verification_change
AFTER UPDATE OF verification_status ON public.consultants
FOR EACH ROW
EXECUTE FUNCTION public.log_consultant_verification_change();