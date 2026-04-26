CREATE TABLE public.logo_upload_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  bucket TEXT NOT NULL,
  path TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT,
  success BOOLEAN NOT NULL DEFAULT false,
  error_code TEXT,
  error_message TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_logo_upload_attempts_user_id ON public.logo_upload_attempts(user_id);
CREATE INDEX idx_logo_upload_attempts_created_at ON public.logo_upload_attempts(created_at DESC);
CREATE INDEX idx_logo_upload_attempts_success ON public.logo_upload_attempts(success);

ALTER TABLE public.logo_upload_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own logo upload attempts"
  ON public.logo_upload_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own logo upload attempts"
  ON public.logo_upload_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all logo upload attempts"
  ON public.logo_upload_attempts
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));