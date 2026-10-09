-- M35: only the interviewer (or an administrator) can complete and score a live interview, and only once.
-- Before: IF NOT (interview_role(...) = 'interviewer' OR has_role(admin) OR has_role(super_admin)) THEN raise
--   For a user with no row in interview_participants interview_role() is NULL, the test is NULL and nothing was raised:
--   any signed-in user could complete and score any live interview. An interview could also be completed again.
CREATE OR REPLACE FUNCTION public.complete_live_interview(_session_id uuid, _technical integer, _soft integer, _overall integer, _summary text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(
       (public.interview_role(_session_id, auth.uid()) = 'interviewer')
       OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'), false) THEN
    RAISE EXCEPTION 'Not an interviewer for this interview' USING ERRCODE = '42501';
  END IF;
  IF _overall IS NULL OR _technical IS NULL OR _soft IS NULL
     OR _overall < 0 OR _overall > 100 OR _technical < 0 OR _technical > 100 OR _soft < 0 OR _soft > 100 THEN
    RAISE EXCEPTION 'Scores must be 0-100' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.interview_sessions WHERE id = _session_id AND interview_style = 'live' AND status::text = 'completed') THEN
    RAISE EXCEPTION 'This interview is already completed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.interview_sessions
     SET status = 'completed', overall_score = _overall, technical_score = _technical,
         soft_skills_score = _soft, ai_summary = left(coalesce(_summary, ''), 4000), completed_at = now()
   WHERE id = _session_id AND interview_style = 'live' AND status::text <> 'completed';
END $function$;