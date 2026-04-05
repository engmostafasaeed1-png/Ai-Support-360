
-- 1. Make chat-files bucket private
UPDATE storage.buckets SET public = false WHERE id = 'chat-files';

-- 2. Messages: restrict INSERT to session participants
DROP POLICY IF EXISTS "Session participants can send messages" ON public.messages;
CREATE POLICY "Session participants can send messages"
ON public.messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = messages.session_id
    AND (
      s.client_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = s.consultant_id AND c.user_id = auth.uid())
    )
  )
);

-- 3. Consultants: restrict to authenticated users
DROP POLICY IF EXISTS "Consultants are publicly readable" ON public.consultants;
CREATE POLICY "Consultants are readable by authenticated users"
ON public.consultants FOR SELECT TO authenticated
USING (true);

-- 4. Certifications: replace ALL policy with specific operation policies
DROP POLICY IF EXISTS "Consultants can manage own certs" ON public.certifications;

CREATE POLICY "Consultants can insert own certs"
ON public.certifications FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = certifications.consultant_id AND c.user_id = auth.uid())
);

CREATE POLICY "Consultants can update own certs"
ON public.certifications FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = certifications.consultant_id AND c.user_id = auth.uid())
);

CREATE POLICY "Consultants can delete own certs"
ON public.certifications FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = certifications.consultant_id AND c.user_id = auth.uid())
);

-- 5. Skills: restrict to authenticated (marketplace requires login)
DROP POLICY IF EXISTS "Skills are publicly readable" ON public.consultant_skills;
CREATE POLICY "Skills are readable by authenticated users"
ON public.consultant_skills FOR SELECT TO authenticated
USING (true);

-- 6. Availability slots: restrict to authenticated
DROP POLICY IF EXISTS "Slots are publicly readable" ON public.availability_slots;
CREATE POLICY "Slots are readable by authenticated users"
ON public.availability_slots FOR SELECT TO authenticated
USING (true);
