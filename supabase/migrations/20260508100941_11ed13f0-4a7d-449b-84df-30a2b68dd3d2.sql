
-- 1. ticket_internal_notes: restrict to staff only
DROP POLICY IF EXISTS "Authors can manage own notes" ON public.ticket_internal_notes;

CREATE POLICY "Staff authors can insert own notes"
ON public.ticket_internal_notes
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND (
    public.has_role(auth.uid(), 'consultant'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Staff authors can update own notes"
ON public.ticket_internal_notes
FOR UPDATE
TO authenticated
USING (
  auth.uid() = author_id
  AND (
    public.has_role(auth.uid(), 'consultant'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Staff authors can delete own notes"
ON public.ticket_internal_notes
FOR DELETE
TO authenticated
USING (
  auth.uid() = author_id
  AND (
    public.has_role(auth.uid(), 'consultant'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Staff authors can view own notes"
ON public.ticket_internal_notes
FOR SELECT
TO authenticated
USING (
  auth.uid() = author_id
  AND (
    public.has_role(auth.uid(), 'consultant'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
);

-- 2. email_send_log: explicit admin read access via API
CREATE POLICY "Admins can read email send log"
ON public.email_send_log
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

-- 3. Public buckets: drop broad listing policies (public URLs still work)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public can read client logo files" ON storage.objects;

-- 4. Lock down search_path on email queue functions
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;
