CREATE OR REPLACE FUNCTION public.platform_flag(_key text, _default boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN jsonb_typeof(value) = 'boolean' THEN value::text::boolean
                                WHEN value::text IN ('"true"','"false"') THEN (value #>> '{}')::boolean END
                   FROM public.platform_settings WHERE key = _key), _default)
$$;
REVOKE ALL ON FUNCTION public.platform_flag(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_flag(text, boolean) TO authenticated, service_role;

-- admin_alerts: when off, in-app notifications addressed to administrators are not stored
CREATE OR REPLACE FUNCTION public.guard_admin_alerts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.platform_flag('admin_alerts', true)
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role IN ('admin','super_admin')) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_admin_alerts ON public.notifications;
CREATE TRIGGER trg_guard_admin_alerts BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_alerts();

-- audit_logging: when off, audit rows are skipped, except changes to settings and roles
CREATE OR REPLACE FUNCTION public.guard_audit_logging()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.platform_flag('audit_logging', true)
     AND COALESCE(NEW.entity_type, '') NOT IN ('platform_settings','user_roles')
     AND NEW.action NOT ILIKE '%role%' AND NEW.action NOT ILIKE '%setting%' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_audit_logging ON public.audit_logs;
CREATE TRIGGER trg_guard_audit_logging BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_audit_logging();

-- require_2fa must be readable by every signed-in user so the app can enforce it
CREATE POLICY "Signed-in users can read require_2fa" ON public.platform_settings
  FOR SELECT TO authenticated USING (key = 'require_2fa');