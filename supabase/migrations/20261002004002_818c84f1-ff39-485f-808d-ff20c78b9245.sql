-- Client-cycle hardening M9 (finding F09, second half):
-- consultants read the reviews about them through the view consultant_reviews (which hides who wrote an anonymous review);
-- the base table is readable only by the rater and by administrators.
DROP POLICY IF EXISTS "Ratings visible to participants or admin" ON public.ratings;
CREATE POLICY "Ratings visible to the rater or admin" ON public.ratings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR client_id = auth.uid());