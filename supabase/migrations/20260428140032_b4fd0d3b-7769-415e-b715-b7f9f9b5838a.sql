
CREATE TABLE public.error_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL DEFAULT 'error',
  source TEXT NOT NULL DEFAULT 'client',
  message TEXT NOT NULL,
  stack TEXT,
  url TEXT,
  route TEXT,
  user_agent TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  context JSONB DEFAULT '{}'::jsonb,
  fingerprint TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_error_reports_created_at ON public.error_reports(created_at DESC);
CREATE INDEX idx_error_reports_resolved ON public.error_reports(resolved, created_at DESC);
CREATE INDEX idx_error_reports_fingerprint ON public.error_reports(fingerprint);
CREATE INDEX idx_error_reports_user_id ON public.error_reports(user_id);

ALTER TABLE public.error_reports ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins manage all error reports"
ON public.error_reports
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Authenticated users can insert their own error reports
CREATE POLICY "Users can submit their own error reports"
ON public.error_reports
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE TRIGGER trg_error_reports_updated_at
BEFORE UPDATE ON public.error_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notify admins on new error/fatal reports
CREATE OR REPLACE FUNCTION public.notify_admins_error_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _admin RECORD;
  _short_msg TEXT;
BEGIN
  IF NEW.level NOT IN ('error', 'fatal') THEN
    RETURN NEW;
  END IF;

  _short_msg := substring(NEW.message FROM 1 FOR 140);

  FOR _admin IN
    SELECT user_id FROM public.user_roles WHERE role IN ('admin', 'super_admin')
  LOOP
    PERFORM public.safe_insert_notification(
      _admin.user_id,
      '🚨 New Error Reported',
      COALESCE(NEW.source, 'client') || ' • ' || _short_msg,
      'error',
      '/admin/errors'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_admins_error_report
AFTER INSERT ON public.error_reports
FOR EACH ROW EXECUTE FUNCTION public.notify_admins_error_report();
