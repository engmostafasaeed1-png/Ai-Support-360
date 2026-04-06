
-- Generic audit log trigger function
CREATE OR REPLACE FUNCTION public.audit_log_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _action text;
  _entity_type text;
  _entity_id uuid;
  _user_id uuid;
  _metadata jsonb;
BEGIN
  _entity_type := TG_TABLE_NAME;

  IF TG_OP = 'INSERT' THEN
    _action := _entity_type || '.created';
    _entity_id := NEW.id;
    _metadata := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    _action := _entity_type || '.updated';
    _entity_id := NEW.id;
    _metadata := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    _action := _entity_type || '.deleted';
    _entity_id := OLD.id;
    _metadata := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  -- Try to get the current user
  _user_id := auth.uid();

  INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, metadata)
  VALUES (_action, _entity_type, _entity_id, _user_id, _metadata);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Tickets audit
CREATE TRIGGER audit_tickets
AFTER INSERT OR UPDATE OR DELETE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- User roles audit
CREATE TRIGGER audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- Platform settings audit
CREATE TRIGGER audit_platform_settings
AFTER INSERT OR UPDATE OR DELETE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- NDA agreements audit
CREATE TRIGGER audit_nda_agreements
AFTER INSERT OR UPDATE OR DELETE ON public.nda_agreements
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- Payments audit
CREATE TRIGGER audit_payments
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- Consultants audit (verification changes)
CREATE TRIGGER audit_consultants
AFTER INSERT OR UPDATE OR DELETE ON public.consultants
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- Sessions audit
CREATE TRIGGER audit_sessions
AFTER INSERT OR UPDATE OR DELETE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- Profiles audit
CREATE TRIGGER audit_profiles
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();
