-- Feature V: a consultant can only SUBMIT (finish) the profile when every mandatory item is complete.
-- Mandatory = consultant_missing_fields() (admin field rules, incl. hard-required country/city) plus, for new
-- registrations, the current Consultant Service Policy acknowledgement. Drafts keep saving as before.
-- Additive only: one new column, a guard trigger on that column and three functions.

ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS profile_submitted_at timestamptz;
COMMENT ON COLUMN public.consultants.profile_submitted_at IS 'Set only by submit_consultant_profile() once nothing mandatory is missing.';

-- The browser can never set or clear the submission time itself.
CREATE OR REPLACE FUNCTION public.guard_profile_submitted_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('app.profile_submit', true), '') = 'on' OR NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.profile_submitted_at := NULL;
  ELSIF NEW.profile_submitted_at IS DISTINCT FROM OLD.profile_submitted_at THEN
    RAISE EXCEPTION 'The profile is submitted only through submit_consultant_profile' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile_submitted_at ON public.consultants;
CREATE TRIGGER trg_guard_profile_submitted_at BEFORE INSERT OR UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_submitted_at();

-- Every mandatory item still missing, in rule order; 'service_policy' last when a new registration has not accepted it.
CREATE OR REPLACE FUNCTION public.consultant_submission_missing(_cid uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _missing text[] := public.consultant_missing_fields(_cid);
  _policy jsonb := public.consultant_policy_state(_cid);
  _created timestamptz;
BEGIN
  -- Hard-required fields (country, city) count even if an admin changed their mode.
  _missing := _missing || COALESCE((
    SELECT array_agg(r.field_key ORDER BY r.sort_order) FROM public.profile_field_rules r
     WHERE r.hard_required AND r.mode <> 'required' AND NOT public.profile_field_filled(_cid, r.field_key)), ARRAY[]::text[]);
  SELECT created_at INTO _created FROM public.consultants WHERE id = _cid;
  IF _policy->>'state' IN ('pending', 'grace', 'blocked')
     AND (_created IS NULL OR _policy->>'effective_at' IS NULL OR _created >= (_policy->>'effective_at')::timestamptz
          OR _policy->>'accepted_version' IS NULL) THEN
    _missing := _missing || ARRAY['service_policy'];
  END IF;
  RETURN _missing;
END $$;

-- The signed-in consultant's submission state for the profile screen.
CREATE OR REPLACE FUNCTION public.my_profile_submission()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c public.consultants;
  _missing text[];
  _total integer;
BEGIN
  SELECT * INTO _c FROM public.consultants WHERE user_id = auth.uid();
  IF NOT FOUND THEN RETURN NULL; END IF;
  _missing := public.consultant_submission_missing(_c.id);
  SELECT count(*) INTO _total FROM public.profile_field_rules r WHERE r.mode = 'required' OR r.hard_required;
  RETURN jsonb_build_object(
    'submitted_at', _c.profile_submitted_at,
    'verification_status', _c.verification_status,
    'missing', to_jsonb(_missing),
    'required_total', _total + CASE WHEN 'service_policy' = ANY(_missing)
                                     OR (public.consultant_policy_state(_c.id)->>'state') = 'accepted'
                                        AND _c.created_at >= COALESCE((public.consultant_policy_state(_c.id)->>'effective_at')::timestamptz, 'infinity')
                                    THEN 1 ELSE 0 END);
END $$;

-- Finish / submit for review. Rejects with the list of missing items, so the gate cannot be bypassed.
CREATE OR REPLACE FUNCTION public.submit_consultant_profile()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c public.consultants;
  _missing text[];
  _at timestamptz;
BEGIN
  SELECT * INTO _c FROM public.consultants WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_consultant' USING ERRCODE = '42501'; END IF;
  _missing := public.consultant_submission_missing(_c.id);
  IF cardinality(_missing) > 0 THEN
    RAISE EXCEPTION 'missing_required:%', array_to_string(_missing, ',')
      USING ERRCODE = 'P0001', DETAIL = array_to_string(_missing, ','), HINT = 'Complete these required items to finish';
  END IF;
  PERFORM set_config('app.profile_submit', 'on', true);
  UPDATE public.consultants SET profile_submitted_at = COALESCE(profile_submitted_at, now())
   WHERE id = _c.id RETURNING profile_submitted_at INTO _at;
  PERFORM set_config('app.profile_submit', '', true);
  UPDATE public.profiles SET onboarding_completed = true WHERE user_id = _c.user_id AND onboarding_completed IS DISTINCT FROM true;
  IF _c.profile_submitted_at IS NULL THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'consultant.profile_submitted', 'consultant', _c.id, jsonb_build_object('submitted_at', _at));
  END IF;
  RETURN jsonb_build_object('submitted_at', _at);
END $$;

REVOKE ALL ON FUNCTION public.consultant_submission_missing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_profile_submission() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_consultant_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_submission_missing(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_profile_submission() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_consultant_profile() TO authenticated;
