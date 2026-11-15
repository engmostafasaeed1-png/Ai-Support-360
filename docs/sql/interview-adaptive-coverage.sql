-- Prepared only. Preserve server-owned coverage inside the existing transcript JSON.
BEGIN;
CREATE OR REPLACE FUNCTION public.interview_coverage_preserve() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE saved jsonb;
BEGIN
  IF current_user = 'service_role' OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
  saved := CASE WHEN TG_OP = 'UPDATE' THEN OLD.skill_results->0->'_coverage' ELSE NULL END;
  IF jsonb_typeof(NEW.skill_results) = 'array' AND jsonb_array_length(NEW.skill_results) > 0 THEN
    NEW.skill_results := (SELECT jsonb_agg(e - '_coverage' ORDER BY ord) FROM jsonb_array_elements(NEW.skill_results) WITH ORDINALITY x(e,ord));
    IF saved IS NOT NULL THEN NEW.skill_results := jsonb_set(NEW.skill_results, '{0,_coverage}', saved); END IF;
  ELSIF saved IS NOT NULL THEN
    NEW.skill_results := OLD.skill_results; -- do not erase server evidence with an empty browser save
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_interview_coverage_preserve ON public.interview_sessions;
CREATE TRIGGER trg_interview_coverage_preserve BEFORE INSERT OR UPDATE OF skill_results ON public.interview_sessions
FOR EACH ROW EXECUTE FUNCTION public.interview_coverage_preserve();
CREATE OR REPLACE FUNCTION public.interview_coverage_save(_interview_id uuid, _coverage jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE transcript jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF jsonb_typeof(_coverage) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid coverage'; END IF;
  SELECT skill_results INTO transcript FROM public.interview_sessions WHERE id = _interview_id AND status = 'in_progress' FOR UPDATE;
  IF jsonb_typeof(transcript) = 'array' AND jsonb_array_length(transcript) > 0 THEN
    UPDATE public.interview_sessions SET skill_results = jsonb_set(transcript, '{0,_coverage}', _coverage) WHERE id = _interview_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.interview_coverage_save(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interview_coverage_save(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.interview_coverage_preserve() FROM PUBLIC, anon, authenticated;
COMMIT;
