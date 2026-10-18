-- Feature D: APPLY MANUALLY. No new table, no audit suppression, no role changes.
-- Coalesce consultant-owned profile writes into one scrubbed audit row per save burst
-- (30 seconds of inactivity ends a burst); other writers retain ordinary audit rows.
CREATE OR REPLACE FUNCTION public.audit_profile_save_burst()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _audit uuid;
  _metadata jsonb;
  _diff jsonb;
  _part jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    _diff := public.audit_changed(to_jsonb(OLD), to_jsonb(NEW));
    IF _diff->'new' = '{}'::jsonb THEN RETURN NEW; END IF;
    _metadata := _diff;
  ELSIF TG_OP = 'INSERT' THEN
    _metadata := jsonb_build_object('new', public.audit_scrub_row(to_jsonb(NEW)));
  ELSE
    _metadata := jsonb_build_object('old', public.audit_scrub_row(to_jsonb(OLD)));
  END IF;
  IF TG_OP = 'UPDATE' AND _uid IS NOT NULL AND NEW.user_id = _uid
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='consultant') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('profile-save-audit:'||_uid::text,0));
    SELECT id, metadata->TG_TABLE_NAME INTO _audit, _part
    FROM public.audit_logs
    WHERE user_id=_uid AND action='profile.save_burst'
      AND (metadata->>'last_saved_at')::timestamptz > clock_timestamp()-interval '30 seconds'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF _audit IS NOT NULL THEN
      -- Preserve the earliest old value of each field and latest new value.
      _part := jsonb_build_object('old', coalesce(_diff->'old','{}'::jsonb)||coalesce(_part->'old','{}'::jsonb),
                                 'new',coalesce(_part->'new','{}'::jsonb)||coalesce(_diff->'new','{}'::jsonb));
      UPDATE public.audit_logs SET metadata=metadata||jsonb_build_object(TG_TABLE_NAME,_part,'last_saved_at',clock_timestamp()) WHERE id=_audit;
    ELSE
      INSERT INTO public.audit_logs(action,entity_type,entity_id,user_id,metadata)
      VALUES('profile.save_burst','consultant_profile',NEW.id,_uid,
             jsonb_build_object(TG_TABLE_NAME,_diff,'last_saved_at',clock_timestamp()));
    END IF;
  ELSE
    INSERT INTO public.audit_logs(action,entity_type,entity_id,user_id,metadata)
    VALUES(TG_TABLE_NAME||CASE TG_OP WHEN 'INSERT' THEN '.created' WHEN 'DELETE' THEN '.deleted' ELSE '.updated' END,
           TG_TABLE_NAME,CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,_uid,_metadata);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_profile_save_burst() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_profile_save_burst() TO service_role;
-- Preserve other business/verification triggers; replace only the two audit triggers.
DROP TRIGGER IF EXISTS audit_consultants ON public.consultants;
CREATE TRIGGER audit_consultants AFTER INSERT OR UPDATE OR DELETE ON public.consultants FOR EACH ROW EXECUTE FUNCTION public.audit_profile_save_burst();
DROP TRIGGER IF EXISTS audit_profiles ON public.profiles;
CREATE TRIGGER audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.audit_profile_save_burst();
CREATE OR REPLACE FUNCTION public.profile_autosave_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND
    (SELECT count(*)=2 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
     WHERE t.tgrelid IN ('public.consultants'::regclass,'public.profiles'::regclass)
       AND t.tgname IN ('audit_consultants','audit_profiles') AND t.tgenabled <> 'D'
       AND p.proname='audit_profile_save_burst' AND p.pronamespace='public'::regnamespace);
$$;
REVOKE ALL ON FUNCTION public.profile_autosave_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_autosave_ready() TO authenticated, service_role;
-- Check activation: SELECT public.profile_autosave_ready() from a signed-in session.
-- Admin audit view: action='profile.save_burst'; metadata.last_saved_at is the latest save.
