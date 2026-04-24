
-- 1. Drop leftover broad policies that override our scoped ones
DROP POLICY IF EXISTS "Authenticated can view updates" ON public.major_incident_updates;
DROP POLICY IF EXISTS "Authenticated can view predictions" ON public.prediction_logs;
DROP POLICY IF EXISTS "Authenticated can view active rules" ON public.auto_assignment_rules;
DROP POLICY IF EXISTS "Authenticated can view active rules" ON public.ticket_escalation_rules;

-- 2. RATINGS — scope to participants and admins
DROP POLICY IF EXISTS "Authenticated users can view ratings" ON public.ratings;

CREATE POLICY "Ratings visible to participants or admin"
ON public.ratings FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR client_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = ratings.consultant_id AND c.user_id = auth.uid()
  )
);

-- 3. TICKET TAGS — ticket participants or admin
DROP POLICY IF EXISTS "Authenticated can view tags" ON public.ticket_tags;

CREATE POLICY "Tags visible to ticket participants or admin"
ON public.ticket_tags FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    LEFT JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.id = ticket_tags.ticket_id
      AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
  )
);

-- 4. TICKET WATCHERS — ticket participants, the watcher themselves, or admin
DROP POLICY IF EXISTS "Authenticated can view watchers" ON public.ticket_watchers;

CREATE POLICY "Watchers visible to ticket participants or admin"
ON public.ticket_watchers FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR ticket_watchers.user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    LEFT JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.id = ticket_watchers.ticket_id
      AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
  )
);

-- 5. TICKET LINKS — participant of source OR target ticket, or admin
DROP POLICY IF EXISTS "Authenticated can view links" ON public.ticket_links;

CREATE POLICY "Links visible to participants of either ticket or admin"
ON public.ticket_links FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    LEFT JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.id IN (ticket_links.source_ticket_id, ticket_links.target_ticket_id)
      AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
  )
);

-- 6. ENVIRONMENT_CONSULTANTS — env owner, the consultant, or admin
DROP POLICY IF EXISTS "Authenticated users can view environment consultants" ON public.environment_consultants;
DROP POLICY IF EXISTS "Authenticated can view environment consultants" ON public.environment_consultants;

CREATE POLICY "Env-consultant assignments visible to participants or admin"
ON public.environment_consultants FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = environment_consultants.consultant_id AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.remote_environments re
    WHERE re.id = environment_consultants.environment_id AND re.client_id = auth.uid()
  )
);

-- 7. STORAGE: proposal-documents UPDATE policy mirroring INSERT
DROP POLICY IF EXISTS "Proposal docs updates by proposal owner" ON storage.objects;

CREATE POLICY "Proposal docs updates by proposal owner"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'proposal-documents'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.consultants c ON c.id = p.consultant_id
      WHERE position(p.id::text in name) > 0
        AND c.user_id = auth.uid()
    )
  )
)
WITH CHECK (
  bucket_id = 'proposal-documents'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.proposals p
      JOIN public.consultants c ON c.id = p.consultant_id
      WHERE position(p.id::text in name) > 0
        AND c.user_id = auth.uid()
    )
  )
);
