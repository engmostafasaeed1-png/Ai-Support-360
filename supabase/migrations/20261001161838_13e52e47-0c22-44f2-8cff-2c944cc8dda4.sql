-- Client-cycle hardening M6 (findings F20, F24, F25, F30 and an opt-in switch for F10):
-- input validation, the legacy credential column can never hold a secret, a trigger that could never work is removed,
-- the AI interview instructions are no longer readable by candidates, plan limits can be switched on.

-- ---------------------------------------------------------------------------------------------
-- F20: input validation
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_title_not_blank CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 300);
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_description_length CHECK (description IS NULL OR char_length(description) <= 50000);
ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_length CHECK (content IS NULL OR char_length(content) <= 10000);

CREATE OR REPLACE FUNCTION public.validate_work_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.hours IS NULL OR NEW.hours <= 0 OR NEW.hours > 24 THEN
    RAISE EXCEPTION 'Hours must be greater than 0 and at most 24 per entry' USING ERRCODE = '22023';
  END IF;
  IF NEW.work_date IS NOT NULL AND (NEW.work_date > current_date + 1 OR NEW.work_date < current_date - 365) THEN
    RAISE EXCEPTION 'The work date must be within the last year and not in the future' USING ERRCODE = '22023';
  END IF;
  IF NEW.hourly_rate IS NOT NULL AND (NEW.hourly_rate < 0 OR NEW.hourly_rate > 100000) THEN
    RAISE EXCEPTION 'Invalid hourly rate' USING ERRCODE = '22023';
  END IF;
  IF NEW.description IS NOT NULL AND char_length(NEW.description) > 5000 THEN
    RAISE EXCEPTION 'The description is too long' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_work_log() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_validate_work_log ON public.ticket_work_logs;
CREATE TRIGGER trg_validate_work_log BEFORE INSERT OR UPDATE ON public.ticket_work_logs
  FOR EACH ROW EXECUTE FUNCTION public.validate_work_log();

-- a ticket document points at a storage path or an http(s) link, never at a script
DROP TRIGGER IF EXISTS trg_guard_path_or_url_columns_links ON public.ticket_documents;
CREATE TRIGGER trg_guard_path_or_url_columns_links BEFORE INSERT OR UPDATE ON public.ticket_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_path_or_url_columns('file_url');

-- ---------------------------------------------------------------------------------------------
-- F24: the legacy plain column of environment_credentials can never hold a secret (the screens only ever write a placeholder)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.neutralise_legacy_credential_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.password_encrypted := 'ENCRYPTED';
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.neutralise_legacy_credential_column() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_neutralise_legacy_credential_column ON public.environment_credentials;
CREATE TRIGGER trg_neutralise_legacy_credential_column BEFORE INSERT OR UPDATE ON public.environment_credentials
  FOR EACH ROW EXECUTE FUNCTION public.neutralise_legacy_credential_column();
UPDATE public.environment_credentials SET password_encrypted = 'ENCRYPTED' WHERE password_encrypted IS DISTINCT FROM 'ENCRYPTED';

-- ---------------------------------------------------------------------------------------------
-- F25: this trigger needs settings that are not configured and an extension that is not installed: it could only ever do nothing
-- or, once configured, fail and block the completion of every session. The analysis stays available from the screen.
-- ---------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auto_analyze_session ON public.sessions;
DROP FUNCTION IF EXISTS public.auto_analyze_session();

-- ---------------------------------------------------------------------------------------------
-- F30: the AI interview questions and instructions are for the interviewer, not for the candidate
-- (the edge function reads them with the service role; administrators keep their own policy)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view active configs" ON public.interview_training_config;

-- ---------------------------------------------------------------------------------------------
-- F10: plan limits. OFF until an administrator sets platform_settings key 'enforce_plan_limits' to true.
-- Then a company can not open more tickets per month / hold more members than its plan allows (administrators exempt).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_limits_enforced()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT lower(ps.value #>> '{}') = 'true' FROM public.platform_settings ps WHERE ps.key = 'enforce_plan_limits' LIMIT 1), false)
$function$;
REVOKE ALL ON FUNCTION public.plan_limits_enforced() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_ticket_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _max integer;
  _n integer;
BEGIN
  IF NEW.tenant_id IS NULL OR NOT public.plan_limits_enforced() THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RETURN NEW;
  END IF;
  SELECT t.max_tickets_per_month INTO _max FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF _max IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _n FROM public.tickets x WHERE x.tenant_id = NEW.tenant_id AND x.created_at >= date_trunc('month', now());
  IF _n >= _max THEN
    RAISE EXCEPTION 'Your plan allows % tickets per month. Please upgrade to open more.', _max USING ERRCODE = '53400';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_ticket_plan_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_ticket_plan_limit ON public.tickets;
CREATE TRIGGER trg_enforce_ticket_plan_limit BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_plan_limit();

CREATE OR REPLACE FUNCTION public.enforce_member_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _max integer;
  _n integer;
BEGIN
  IF NOT public.plan_limits_enforced() THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RETURN NEW;
  END IF;
  SELECT t.max_users INTO _max FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF _max IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _n FROM public.tenant_members m WHERE m.tenant_id = NEW.tenant_id;
  IF _n >= _max THEN
    RAISE EXCEPTION 'Your plan allows % users. Please upgrade to add more.', _max USING ERRCODE = '53400';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_member_plan_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_member_plan_limit ON public.tenant_members;
CREATE TRIGGER trg_enforce_member_plan_limit BEFORE INSERT ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_plan_limit();