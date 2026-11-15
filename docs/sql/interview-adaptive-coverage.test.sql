-- Run only after the prepared file, always rolled back.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.interview_coverage_save(uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'Missing coverage RPC'; END IF;
 IF has_function_privilege('authenticated','public.interview_coverage_save(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Candidate can change coverage'; END IF;
 IF has_function_privilege('anon','public.interview_coverage_save(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous coverage access'; END IF;
 IF NOT has_function_privilege('service_role','public.interview_coverage_save(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Worker cannot save coverage'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_interview_coverage_preserve' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Missing preservation trigger'; END IF;
END $$;
ROLLBACK;
