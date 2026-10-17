-- Feature C — prepared only; NOT applied. No historical backfill.
CREATE TABLE public.founding_consultants (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  founding_number integer UNIQUE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT founding_number_positive CHECK (founding_number IS NULL OR founding_number > 0),
  CONSTRAINT founding_active_number CHECK ((revoked_at IS NULL) = (founding_number IS NOT NULL))
);
GRANT SELECT ON public.founding_consultants TO authenticated;
GRANT ALL ON public.founding_consultants TO service_role;
ALTER TABLE public.founding_consultants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Visible consultant founding badges" ON public.founding_consultants FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id));

CREATE FUNCTION public.founding_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT jsonb_build_object(
  'enabled', COALESCE((SELECT value::text::boolean FROM public.platform_settings WHERE key='founding_consultant_enabled'),true),
  'limit', COALESCE((SELECT value::text::integer FROM public.platform_settings WHERE key='founding_consultant_limit'),100),
  'boost_months', COALESCE((SELECT value::text::integer FROM public.platform_settings WHERE key='founding_boost_months'),0));
$$;
REVOKE ALL ON FUNCTION public.founding_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.founding_settings() TO service_role;

CREATE FUNCTION public.set_founding_award(_cid uuid, _grant boolean, _reason text, _automatic boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg jsonb; n integer; old_award jsonb;
BEGIN
 -- Only the trigger owner may request automatic mode; callers cannot bypass role checks.
 IF NOT _automatic AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
  RAISE EXCEPTION 'Administrators only' USING ERRCODE='42501';
 END IF;
 IF NOT _automatic AND (length(trim(COALESCE(_reason,''))) < 1 OR length(_reason)>1000) THEN RAISE EXCEPTION 'A reason is required'; END IF;
 PERFORM pg_advisory_xact_lock(7100360);
 PERFORM 1 FROM public.consultants WHERE id=_cid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Consultant not found'; END IF;
 cfg := public.founding_settings();
 SELECT to_jsonb(f) INTO old_award FROM public.founding_consultants f WHERE consultant_id=_cid;
 IF _grant THEN
  IF EXISTS (SELECT 1 FROM public.founding_consultants WHERE consultant_id=_cid AND revoked_at IS NULL) THEN RETURN; END IF;
  IF _automatic AND NOT (cfg->>'enabled')::boolean THEN RETURN; END IF;
  SELECT s INTO n FROM generate_series(1,GREATEST(0,(cfg->>'limit')::integer)) s
   WHERE NOT EXISTS (SELECT 1 FROM public.founding_consultants WHERE founding_number=s) ORDER BY s LIMIT 1;
  IF n IS NULL THEN
   IF _automatic THEN RETURN; ELSE RAISE EXCEPTION 'No founding spots remain'; END IF;
  END IF;
  INSERT INTO public.founding_consultants(consultant_id,founding_number,awarded_at,revoked_at) VALUES(_cid,n,now(),NULL)
   ON CONFLICT(consultant_id) DO UPDATE SET founding_number=n,awarded_at=now(),revoked_at=NULL;
 ELSE
  UPDATE public.founding_consultants SET founding_number=NULL,revoked_at=now() WHERE consultant_id=_cid AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
 END IF;
 INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,metadata)
 VALUES(auth.uid(),CASE WHEN _grant THEN 'founding_granted' ELSE 'founding_revoked' END,'consultant',_cid,
 jsonb_build_object('reason',_reason,'automatic',_automatic,'previous',old_award,'number',n));
END;
$$;
-- Internal helper is never callable by clients, including automatic=true.
REVOKE ALL ON FUNCTION public.set_founding_award(uuid,boolean,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_founding_award(uuid,boolean,text,boolean) TO service_role;

CREATE FUNCTION public.award_founding_on_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.verification_status='verified' AND (TG_OP='INSERT' OR OLD.verification_status IS DISTINCT FROM NEW.verification_status)
  AND NOT EXISTS (SELECT 1 FROM public.founding_consultants WHERE consultant_id=NEW.id) THEN
  PERFORM public.set_founding_award(NEW.id,true,'Platform verification',true);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.award_founding_on_verification() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER founding_on_verification AFTER INSERT OR UPDATE OF verification_status ON public.consultants
FOR EACH ROW EXECUTE FUNCTION public.award_founding_on_verification();

CREATE FUNCTION public.admin_set_founding_consultant(_cid uuid,_grant boolean,_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.set_founding_award(_cid,_grant,_reason,false); END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_founding_consultant(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_founding_consultant(uuid,boolean,text) TO authenticated,service_role;

CREATE FUNCTION public.founding_spots_remaining() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN (public.founding_settings()->>'enabled')::boolean THEN
 GREATEST(0,(public.founding_settings()->>'limit')::integer-(SELECT count(*)::integer FROM public.founding_consultants WHERE revoked_at IS NULL)) ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.founding_spots_remaining() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.founding_spots_remaining() TO anon,authenticated,service_role;

CREATE FUNCTION public.founding_boost_duration() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT (public.founding_settings()->>'boost_months')::integer; $$;
REVOKE ALL ON FUNCTION public.founding_boost_duration() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.founding_boost_duration() TO authenticated,service_role;

CREATE FUNCTION public.admin_founding_settings(_enabled boolean DEFAULT NULL,_limit integer DEFAULT NULL,_boost integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(7100360);
 IF _limit IS NOT NULL AND (_limit<1 OR _limit>100000 OR _limit<(SELECT COALESCE(max(founding_number),0) FROM public.founding_consultants)) THEN RAISE EXCEPTION 'Limit cannot be below an existing award number'; END IF;
 IF _boost IS NOT NULL AND (_boost<0 OR _boost>120) THEN RAISE EXCEPTION 'Boost months must be between 0 and 120'; END IF;
 IF _enabled IS NOT NULL THEN INSERT INTO public.platform_settings(key,value) VALUES('founding_consultant_enabled',to_jsonb(_enabled)) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value; END IF;
 IF _limit IS NOT NULL THEN INSERT INTO public.platform_settings(key,value) VALUES('founding_consultant_limit',to_jsonb(_limit)) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value; END IF;
 IF _boost IS NOT NULL THEN INSERT INTO public.platform_settings(key,value) VALUES('founding_boost_months',to_jsonb(_boost)) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value; END IF;
 IF _enabled IS NOT NULL OR _limit IS NOT NULL OR _boost IS NOT NULL THEN
 INSERT INTO public.audit_logs(user_id,action,entity_type,metadata) VALUES(auth.uid(),'founding_settings_changed','platform_settings',public.founding_settings());
 END IF;
 RETURN public.founding_settings();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_founding_settings(boolean,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_founding_settings(boolean,integer,integer) TO authenticated,service_role;
