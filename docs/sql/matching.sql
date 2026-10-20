-- Feature H: explainable consultant matching. Prepared for the owner to apply; NOT applied by the agent.
-- Safe to run more than once. Nothing here reads or stores ticket text.

-- 1) Match run log (for later learning): ticket id, inputs hash, weights version, top 10 ids + scores. No raw ticket text.
CREATE TABLE IF NOT EXISTS public.ticket_match_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
  run_by uuid,
  inputs_hash text NOT NULL CHECK (char_length(inputs_hash) <= 64),
  weights_version text NOT NULL CHECK (char_length(weights_version) <= 64),
  weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  top jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(top) = 'array' AND jsonb_array_length(top) <= 10),
  eligible_count integer NOT NULL DEFAULT 0,
  excluded_count integer NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(signals::text) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_match_runs_ticket_idx ON public.ticket_match_runs (ticket_id, created_at DESC);

-- Written only by the matching service; administrators can read it. No client or consultant access.
REVOKE ALL ON public.ticket_match_runs FROM anon, authenticated;
GRANT SELECT ON public.ticket_match_runs TO authenticated;
GRANT ALL ON public.ticket_match_runs TO service_role;
ALTER TABLE public.ticket_match_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read match runs" ON public.ticket_match_runs;
CREATE POLICY "Admins read match runs" ON public.ticket_match_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 2) Extra request fields used by matching: deployment, work mode and the maximum hourly budget (stored as text).
CREATE OR REPLACE FUNCTION public.guard_ticket_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _k text;
  _v jsonb;
BEGIN
  IF NEW.ticket_context IS NOT DISTINCT FROM '{}'::jsonb OR NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.ticket_context) <> 'object' OR octet_length(NEW.ticket_context::text) > 4000 THEN
    RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
  END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(NEW.ticket_context) LOOP
    IF _k NOT IN ('industry', 'customer_segment', 'country', 'project_type', 'vertical_solutions', 'localization_solutions',
                  'deployment', 'work_mode', 'budget_max_rate') THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
    IF _k = 'budget_max_rate' AND jsonb_typeof(_v) = 'string' AND (_v #>> '{}') !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_v) = 'string' THEN
      IF char_length(_v #>> '{}') > 160 OR public.contact_details_in_text(_v #>> '{}') THEN
        RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(_v) = 'array' THEN
      IF jsonb_array_length(_v) > 12 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(_v) e
         WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 160 OR public.contact_details_in_text(e #>> '{}')
      ) THEN
        RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(_v) <> 'null' THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

-- 3) Suspended accounts are never matched (service-only; returns ids only).
CREATE OR REPLACE FUNCTION public.matching_inactive_consultants()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.consultants c JOIN auth.users u ON u.id = c.user_id
   WHERE u.banned_until IS NOT NULL AND u.banned_until > now()
      OR c.verification_status IN ('suspended', 'rejected');
$$;
REVOKE ALL ON FUNCTION public.matching_inactive_consultants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.matching_inactive_consultants() TO service_role;

-- 4) Activation check used by the request form to show the extra fields only after this file is applied.
CREATE OR REPLACE FUNCTION public.matching_v2_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND to_regclass('public.ticket_match_runs') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.matching_v2_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.matching_v2_ready() TO authenticated, service_role;

-- Weights live in platform_settings key 'match_weights' (edited on the admin Settings screen; defaults apply when absent).
-- Check: SELECT public.matching_v2_ready();  Recent runs: SELECT ticket_id, weights_version, top, created_at FROM public.ticket_match_runs ORDER BY created_at DESC LIMIT 20;
