CREATE POLICY "Interviewers view assigned interviews" ON public.interview_sessions FOR SELECT TO authenticated
USING (public.interview_role(id, auth.uid()) = 'interviewer');

CREATE OR REPLACE FUNCTION public.complete_live_interview(_session_id uuid, _technical int, _soft int, _overall int, _summary text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.interview_role(_session_id, auth.uid()) = 'interviewer'
          OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Not an interviewer for this interview' USING ERRCODE = '42501';
  END IF;
  IF _overall < 0 OR _overall > 100 OR _technical < 0 OR _technical > 100 OR _soft < 0 OR _soft > 100 THEN
    RAISE EXCEPTION 'Scores must be 0-100';
  END IF;
  UPDATE public.interview_sessions
     SET status = 'completed', overall_score = _overall, technical_score = _technical,
         soft_skills_score = _soft, ai_summary = left(coalesce(_summary,''), 4000), completed_at = now()
   WHERE id = _session_id AND interview_style = 'live';
END $$;
REVOKE EXECUTE ON FUNCTION public.complete_live_interview(uuid,int,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_live_interview(uuid,int,int,int,text) TO authenticated, service_role;