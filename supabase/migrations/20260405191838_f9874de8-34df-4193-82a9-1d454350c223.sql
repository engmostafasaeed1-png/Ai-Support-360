
-- 1. Fix notifications INSERT policy: restrict to own user_id only
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;
CREATE POLICY "Authenticated users can insert own notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 2. Remove payments and payouts from realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.payments;
ALTER PUBLICATION supabase_realtime DROP TABLE public.payouts;

-- 3. Fix attachments INSERT: verify entity access (tickets or sessions the user participates in)
DROP POLICY IF EXISTS "Users can upload attachments" ON public.attachments;
CREATE POLICY "Users can upload attachments with entity access"
ON public.attachments FOR INSERT
WITH CHECK (
  auth.uid() = uploaded_by
  AND (
    -- Ticket attachments: user is client or assigned consultant
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = entity_id
      AND (t.client_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.consultants c WHERE c.id = t.consultant_id AND c.user_id = auth.uid()
      ))
    )
    OR
    -- Session attachments: user is participant
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = entity_id
      AND (s.client_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.consultants c WHERE c.id = s.consultant_id AND c.user_id = auth.uid()
      ))
    )
    OR
    -- Admin override
    has_role(auth.uid(), 'admin')
  )
);

-- 4. Also fix attachments SELECT to allow entity participants to view
DROP POLICY IF EXISTS "Uploaders can view own attachments" ON public.attachments;
CREATE POLICY "Users can view accessible attachments"
ON public.attachments FOR SELECT
USING (
  auth.uid() = uploaded_by
  OR has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = entity_id
    AND (t.client_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.consultants c WHERE c.id = t.consultant_id AND c.user_id = auth.uid()
    ))
  )
  OR EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = entity_id
    AND (s.client_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.consultants c WHERE c.id = s.consultant_id AND c.user_id = auth.uid()
    ))
  )
);
