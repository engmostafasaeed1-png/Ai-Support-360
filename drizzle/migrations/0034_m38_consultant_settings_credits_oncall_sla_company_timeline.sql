-- lovable-cron-fallback-reviewed: SLA breach detection is genuinely time-based (deadlines pass independently of any row change); a 5-minute cadence keeps breach flags and notifications within minutes of the deadline, which is the requirement. 288 runs/day accepted.
-- ===== M38: features behind the QA findings (DEF-038, 045, 051, 059, 060) =====

-- DEF-059: the consultant's settings are stored and applied (profile visibility, availability display, new-case alerts)
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS profile_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_availability boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS new_case_alerts boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Verified consultants readable; owner and admins see all" ON public.consultants;
CREATE POLICY "Verified consultants readable; owner and admins see all" ON public.consultants
  FOR SELECT
  USING (
    (verification_status = 'verified'::verification_status
       AND (profile_visible OR public.consultant_related_to_client(id, auth.uid(), true)))
    OR auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.skip_muted_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type = 'match_request' AND EXISTS (
       SELECT 1 FROM public.consultants c WHERE c.user_id = NEW.user_id AND c.new_case_alerts = false) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_skip_muted_notifications ON public.notifications;
CREATE TRIGGER trg_skip_muted_notifications
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.skip_muted_notifications();
REVOKE EXECUTE ON FUNCTION public.skip_muted_notifications() FROM PUBLIC, anon, authenticated;

-- DEF-060: credits are a ledger (one row per award, balance = sum of the rows)
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('opening_balance', 'ai_interview', 'fully_verified', 'five_star_review', 'review_removed', 'adjustment')),
  source_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_once_per_source
  ON public.credit_ledger (consultant_id, reason, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_consultant_idx ON public.credit_ledger (consultant_id, created_at DESC);
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Consultants read their own credit history" ON public.credit_ledger;
CREATE POLICY "Consultants read their own credit history" ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = credit_ledger.consultant_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins read all credit history" ON public.credit_ledger;
CREATE POLICY "Admins read all credit history" ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public.credit_ledger_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.consultants
     SET credibility_credits = GREATEST((SELECT COALESCE(sum(l.amount), 0) FROM public.credit_ledger l WHERE l.consultant_id = NEW.consultant_id), 0)::integer,
         updated_at = now()
   WHERE id = NEW.consultant_id;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_credit_ledger_apply ON public.credit_ledger;
CREATE TRIGGER trg_credit_ledger_apply
  AFTER INSERT ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.credit_ledger_apply();
REVOKE EXECUTE ON FUNCTION public.credit_ledger_apply() FROM PUBLIC, anon, authenticated;

INSERT INTO public.credit_ledger (consultant_id, amount, reason, note)
SELECT c.id, c.credibility_credits, 'opening_balance', 'Balance before the credit history existed'
  FROM public.consultants c
 WHERE c.credibility_credits > 0
   AND NOT EXISTS (SELECT 1 FROM public.credit_ledger l WHERE l.consultant_id = c.id);

CREATE OR REPLACE FUNCTION public.award_ai_interview_rewards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _score numeric;
  _badge text;
  _credit_award integer;
  _is_first boolean;
  _consultant_user_id uuid;
  _already_completed_at timestamp with time zone;
BEGIN
  IF NEW.status <> 'completed' OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.interview_type::text, 'ai') <> 'ai' THEN
    RETURN NEW;
  END IF;

  _score := COALESCE(NEW.overall_score, 0);

  IF _score >= 85 THEN
    _badge := 'Gold';
    _credit_award := 150;
  ELSIF _score >= 70 THEN
    _badge := 'Silver';
    _credit_award := 100;
  ELSIF _score >= 50 THEN
    _badge := 'Bronze';
    _credit_award := 75;
  ELSE
    _badge := 'Verified';
    _credit_award := 50;
  END IF;

  SELECT ai_interview_completed_at, user_id
    INTO _already_completed_at, _consultant_user_id
  FROM public.consultants
  WHERE id = NEW.consultant_id;

  _is_first := _already_completed_at IS NULL;

  UPDATE public.consultants
  SET ai_skills_score = _score,
      ai_interview_badge = _badge,
      ai_interview_completed_at = COALESCE(ai_interview_completed_at, now()),
      updated_at = now()
  WHERE id = NEW.consultant_id;

  IF _is_first THEN
    INSERT INTO public.credit_ledger (consultant_id, amount, reason, source_id, note)
    VALUES (NEW.consultant_id, _credit_award, 'ai_interview', NEW.id, _badge || ' tier')
    ON CONFLICT DO NOTHING;
  END IF;

  IF _consultant_user_id IS NOT NULL THEN
    IF _is_first THEN
      PERFORM public.safe_insert_notification(
        _consultant_user_id,
        '🎉 AI Interview Reward Earned',
        'You completed your AI interview and earned the ' || _badge || ' badge plus ' || _credit_award || ' credibility credits. Clients can now see your verified skills score.',
        'interview',
        '/consultant/profile'
      );
    ELSE
      PERFORM public.safe_insert_notification(
        _consultant_user_id,
        'AI Interview Score Updated',
        'Your AI interview score has been updated. Your badge tier is now ' || _badge || '.',
        'interview',
        '/consultant/profile'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.award_verified_credits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.verification_status = 'verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    INSERT INTO public.credit_ledger (consultant_id, amount, reason, source_id, note)
    VALUES (NEW.id, 40, 'fully_verified', NEW.id, 'Verified by the platform')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM public.safe_insert_notification(NEW.user_id, 'Credits earned',
        'You were verified and earned 40 credibility credits.', 'info', '/consultant/credits');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_award_verified_credits ON public.consultants;
CREATE TRIGGER trg_award_verified_credits
  AFTER UPDATE OF verification_status ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.award_verified_credits();
REVOKE EXECUTE ON FUNCTION public.award_verified_credits() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.award_review_credits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.score = 5 THEN
      INSERT INTO public.credit_ledger (consultant_id, amount, reason, source_id, note)
      VALUES (NEW.consultant_id, 10, 'five_star_review', NEW.id, 'A client gave 5 stars')
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_ledger l WHERE l.consultant_id = OLD.consultant_id AND l.reason = 'five_star_review' AND l.source_id = OLD.id) THEN
    INSERT INTO public.credit_ledger (consultant_id, amount, reason, source_id, note)
    VALUES (OLD.consultant_id, -10, 'review_removed', OLD.id, 'A 5-star review was removed')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$function$;
DROP TRIGGER IF EXISTS trg_award_review_credits ON public.ratings;
CREATE TRIGGER trg_award_review_credits
  AFTER INSERT OR DELETE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.award_review_credits();
REVOKE EXECUTE ON FUNCTION public.award_review_credits() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_consultant_id uuid, _amount integer, _note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only administrators can adjust credits' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount = 0 OR abs(_amount) > 1000 THEN
    RAISE EXCEPTION 'The amount must be between -1000 and 1000 and not zero' USING ERRCODE = '22023';
  END IF;
  IF _note IS NULL OR char_length(btrim(_note)) < 3 THEN
    RAISE EXCEPTION 'Please give a reason for the adjustment' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.credit_ledger (consultant_id, amount, reason, note, created_by)
  VALUES (_consultant_id, _amount, 'adjustment', left(btrim(_note), 300), auth.uid());
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) TO authenticated;

-- DEF-038: the on-call rotation decides who answers an emergency (fallback: the assigned consultant, then an administrator)
ALTER TABLE public.oncall_rotations
  ADD CONSTRAINT oncall_rotations_period_ordered CHECK (end_date > start_date);

CREATE OR REPLACE FUNCTION public.guard_oncall_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_override, false) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('oncall:' || NEW.schedule_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.oncall_rotations r
     WHERE r.schedule_id = NEW.schedule_id AND r.id <> NEW.id AND NOT COALESCE(r.is_override, false)
       AND r.start_date < NEW.end_date AND r.end_date > NEW.start_date
  ) THEN
    RAISE EXCEPTION 'This shift overlaps another shift of the same schedule (use an override for exceptions)' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_oncall_overlap ON public.oncall_rotations;
CREATE TRIGGER trg_guard_oncall_overlap
  BEFORE INSERT OR UPDATE OF schedule_id, start_date, end_date, is_override ON public.oncall_rotations
  FOR EACH ROW EXECUTE FUNCTION public.guard_oncall_overlap();
REVOKE EXECUTE ON FUNCTION public.guard_oncall_overlap() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_oncall_consultant(_ticket_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.consultant_id
    FROM public.tickets t
    JOIN public.oncall_schedules s
      ON s.is_active IS NOT FALSE
     AND (s.tenant_id IS NULL OR s.tenant_id = t.tenant_id)
     AND (s.sap_module IS NULL OR btrim(s.sap_module) = ''
          OR upper(s.sap_module) = upper(t.sap_module)
          OR upper(s.sap_module) = ANY (SELECT upper(m) FROM unnest(COALESCE(t.sap_modules, ARRAY[]::text[])) AS m))
    JOIN public.oncall_rotations r ON r.schedule_id = s.id AND r.start_date <= now() AND r.end_date > now()
    JOIN public.consultants c ON c.id = r.consultant_id AND c.verification_status = 'verified'
   WHERE t.id = _ticket_id
   ORDER BY COALESCE(r.is_override, false) DESC,
            (s.sap_module IS NOT NULL AND btrim(s.sap_module) <> '') DESC,
            (s.tenant_id IS NOT NULL) DESC,
            r.start_date DESC
   LIMIT 1
$function$;
REVOKE EXECUTE ON FUNCTION public.resolve_oncall_consultant(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.get_emergency_contact(uuid);
CREATE OR REPLACE FUNCTION public.get_emergency_contact(_ticket_id uuid)
 RETURNS TABLE(display_name text, phone text, hourly_rate numeric, source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t public.tickets;
  _cid uuid;
  _src text;
BEGIN
  SELECT * INTO _t FROM public.tickets t
   WHERE t.id = _ticket_id AND t.client_id = auth.uid() AND t.urgency::text IN ('high', 'critical');
  IF NOT FOUND THEN
    RETURN;
  END IF;
  _cid := public.resolve_oncall_consultant(_ticket_id);
  _src := 'on_call';
  IF _cid IS NULL AND _t.consultant_id IS NOT NULL THEN
    _cid := _t.consultant_id;
    _src := 'assigned_consultant';
  END IF;
  IF _cid IS NOT NULL THEN
    RETURN QUERY
      SELECT p.display_name, p.phone, c.hourly_rate, _src
        FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id
       WHERE c.id = _cid;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.display_name, p.phone, NULL::numeric, 'administrator'::text
      FROM public.user_roles ur JOIN public.profiles p ON p.user_id = ur.user_id
     WHERE ur.role = 'admin'::app_role
     ORDER BY (p.phone IS NOT NULL AND btrim(p.phone) <> '') DESC, ur.created_at
     LIMIT 1;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_emergency_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_emergency_contact(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_emergency_alert(_ticket_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _oncall uuid;
  _cons uuid;
  _cons_user uuid;
  _admin record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT t.id, t.title, t.client_id, t.consultant_id, t.urgency INTO _t
  FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('emergency-alert:' || auth.uid()::text, 5, 3600) THEN
    RAISE EXCEPTION 'Too many alerts in the last hour; please wait or call the consultant' USING ERRCODE = '54000';
  END IF;
  _oncall := public.resolve_oncall_consultant(_ticket_id);
  FOR _cons IN SELECT DISTINCT x FROM unnest(ARRAY[_oncall, _t.consultant_id]) AS x WHERE x IS NOT NULL LOOP
    SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _cons;
    IF _cons_user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_cons_user, 'Emergency contact',
        'The client urgently needs to reach you regarding "' || _t.title || '". Please respond immediately.',
        'ticket', '/consultant/cases/' || _t.id);
    END IF;
  END LOOP;
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin.user_id, 'Emergency alert on a ticket',
      'A client sent an emergency alert for "' || _t.title || '".', 'ticket', '/admin/tickets');
  END LOOP;
  INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, metadata)
  VALUES ('emergency_contact.portal_notification', 'ticket', _t.id, auth.uid(),
          jsonb_build_object('consultant_id', _t.consultant_id, 'on_call_consultant_id', _oncall, 'urgency', _t.urgency::text));
  RETURN true;
END;
$function$;

-- DEF-045: SLA policies are applied to tickets, breaches are flagged and notified
INSERT INTO public.ticket_sla_policies (name, description, urgency, response_time_minutes, resolution_time_minutes, business_hours_only, is_active)
SELECT v.name, v.description, v.urgency, v.rt, v.res, false, true
  FROM (VALUES
    ('Default - Critical', 'Platform default. Deadlines count elapsed time.', 'critical', 60, 480),
    ('Default - High',     'Platform default. Deadlines count elapsed time.', 'high',     240, 1440),
    ('Default - Medium',   'Platform default. Deadlines count elapsed time.', 'medium',   480, 4320),
    ('Default - Low',      'Platform default. Deadlines count elapsed time.', 'low',      1440, 10080)
  ) AS v(name, description, urgency, rt, res)
 WHERE NOT EXISTS (SELECT 1 FROM public.ticket_sla_policies p WHERE p.client_id IS NULL AND p.name = v.name);

CREATE OR REPLACE FUNCTION public.tickets_apply_sla()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.ticket_sla_policies;
  _start timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.sla_breached := false;
    NEW.first_response_at := NULL;
    NEW.sla_policy_id := NULL;
    NEW.sla_response_deadline := NULL;
    NEW.sla_deadline := NULL;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.urgency IS DISTINCT FROM OLD.urgency OR NEW.sap_module IS DISTINCT FROM OLD.sap_module)
     AND NEW.status::text NOT IN ('resolved', 'closed') THEN
    SELECT * INTO _p FROM public.ticket_sla_policies p
     WHERE p.is_active IS NOT FALSE
       AND p.urgency = NEW.urgency::text
       AND (p.client_id = NEW.client_id OR p.client_id IS NULL)
       AND (p.sap_module IS NULL OR btrim(p.sap_module) = '' OR upper(p.sap_module) = upper(NEW.sap_module))
     ORDER BY (p.client_id IS NOT NULL) DESC, (p.sap_module IS NOT NULL AND btrim(p.sap_module) <> '') DESC, p.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      _start := COALESCE(NEW.created_at, now());
      NEW.sla_policy_id := _p.id;
      IF NEW.first_response_at IS NULL THEN
        NEW.sla_response_deadline := _start + make_interval(mins => _p.response_time_minutes);
      END IF;
      NEW.sla_deadline := _start + make_interval(mins => _p.resolution_time_minutes);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.first_response_at IS NULL AND OLD.status::text = 'new' AND NEW.status::text <> 'new' THEN
      NEW.first_response_at := now();
    END IF;
    IF OLD.status::text NOT IN ('resolved', 'closed') AND NEW.status::text IN ('resolved', 'closed')
       AND NEW.sla_deadline IS NOT NULL AND now() > NEW.sla_deadline THEN
      NEW.sla_breached := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_tickets_apply_sla ON public.tickets;
CREATE TRIGGER trg_tickets_apply_sla
  BEFORE INSERT OR UPDATE OF urgency, sap_module, status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_apply_sla();
REVOKE EXECUTE ON FUNCTION public.tickets_apply_sla() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.flag_sla_breaches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _n integer := 0;
  _cons_user uuid;
  _admin uuid;
  _what text;
BEGIN
  FOR _t IN
    UPDATE public.tickets t SET sla_breached = true
     WHERE t.sla_breached IS NOT TRUE
       AND t.status::text NOT IN ('resolved', 'closed')
       AND ((t.sla_response_deadline IS NOT NULL AND t.first_response_at IS NULL AND t.sla_response_deadline < now())
         OR (t.sla_deadline IS NOT NULL AND t.sla_deadline < now()))
    RETURNING t.id, t.title, t.consultant_id, t.first_response_at, t.sla_response_deadline
  LOOP
    _n := _n + 1;
    _what := CASE WHEN _t.first_response_at IS NULL AND _t.sla_response_deadline IS NOT NULL AND _t.sla_response_deadline < now()
                  THEN 'response time' ELSE 'resolution time' END;
    FOR _admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
      PERFORM public.safe_insert_notification(_admin, 'SLA breached',
        'The ' || _what || ' of "' || left(_t.title, 120) || '" has run out.', 'ticket', '/admin/tickets');
    END LOOP;
    IF _t.consultant_id IS NOT NULL THEN
      SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _t.consultant_id;
      IF _cons_user IS NOT NULL THEN
        PERFORM public.safe_insert_notification(_cons_user, 'SLA breached',
          'The ' || _what || ' of "' || left(_t.title, 120) || '" has run out.', 'ticket', '/consultant/cases/' || _t.id);
      END IF;
    END IF;
  END LOOP;
  RETURN _n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.flag_sla_breaches() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sla-breach-check') THEN
    PERFORM cron.unschedule('sla-breach-check');
  END IF;
  PERFORM cron.schedule('sla-breach-check', '*/5 * * * *', 'select public.flag_sla_breaches()');
END
$cron$;

-- DEF-051: every company keeps its own name, industry and size (a second company no longer overwrites the first)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS company_size text;

UPDATE public.tenants t
   SET industry = COALESCE(t.industry, cp.industry),
       company_size = COALESCE(t.company_size, cp.company_size)
  FROM (SELECT DISTINCT ON (tm.user_id) tm.user_id, tm.tenant_id FROM public.tenant_members tm ORDER BY tm.user_id, tm.created_at) f
  JOIN public.client_profiles cp ON cp.user_id = f.user_id
 WHERE t.id = f.tenant_id AND (t.industry IS NULL OR t.company_size IS NULL);

CREATE OR REPLACE FUNCTION public.create_company(_name text, _industry text DEFAULT NULL, _size text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := gen_random_uuid();
  _n text := btrim(COALESCE(_name, ''));
  _ind text := NULLIF(btrim(COALESCE(_industry, '')), '');
  _sz text := NULLIF(btrim(COALESCE(_size, '')), '');
  _first boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;
  IF char_length(_n) < 1 OR char_length(_n) > 200 THEN
    RAISE EXCEPTION 'Please enter the company name (up to 200 characters)' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_ind, '')) > 80 OR char_length(COALESCE(_sz, '')) > 40 THEN
    RAISE EXCEPTION 'Invalid company details' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('create-company:' || auth.uid()::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many companies created in the last hour' USING ERRCODE = '54000';
  END IF;
  _first := NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = auth.uid());
  INSERT INTO public.tenants (id, name, slug, industry, company_size, created_by)
  VALUES (_id, _n,
          COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(_n), '[^a-z0-9]+', '-', 'g')), ''), 'company') || '-' || substr(replace(_id::text, '-', ''), 1, 8),
          _ind, _sz, auth.uid());
  INSERT INTO public.tenant_members (tenant_id, user_id, org_role) VALUES (_id, auth.uid(), 'owner')
  ON CONFLICT DO NOTHING;
  IF _first THEN
    INSERT INTO public.client_profiles (user_id, company_name, industry, company_size)
    VALUES (auth.uid(), _n, _ind, _sz)
    ON CONFLICT (user_id) DO UPDATE
      SET company_name = COALESCE(NULLIF(public.client_profiles.company_name, ''), EXCLUDED.company_name),
          industry = COALESCE(public.client_profiles.industry, EXCLUDED.industry),
          company_size = COALESCE(public.client_profiles.company_size, EXCLUDED.company_size);
  END IF;
  RETURN _id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_company(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company(text, text, text) TO authenticated;

-- DEF-022: the ticket activity timeline is built from the real history (status changes, assignments, urgency, plan decisions, match requests)
CREATE OR REPLACE FUNCTION public.ticket_timeline(_ticket_id uuid)
 RETURNS TABLE(event_at timestamptz, kind text, title text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t public.tickets;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO _t FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT (_t.client_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'super_admin'::app_role)
          OR public.ticket_consultant_for_me(_ticket_id) IS NOT NULL
          OR public.is_ticket_participant(_ticket_id)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT x.event_at, x.kind, x.title, x.detail
    FROM (
      SELECT _t.created_at AS event_at, 'created'::text AS kind, 'Ticket created'::text AS title, NULL::text AS detail
      UNION ALL
      SELECT a.created_at, 'status', 'Status changed to ' || replace(a.metadata #>> '{new,status}', '_', ' '),
             CASE WHEN a.metadata #>> '{old,status}' IS NOT NULL THEN 'Before: ' || replace(a.metadata #>> '{old,status}', '_', ' ') END
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,status}' IS NOT NULL
         AND a.metadata #>> '{new,status}' IS DISTINCT FROM a.metadata #>> '{old,status}'
      UNION ALL
      SELECT a.created_at, 'assignment',
             CASE WHEN a.metadata #>> '{new,consultant_id}' IS NULL THEN 'Consultant removed from the ticket' ELSE 'Consultant assigned' END,
             NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND (a.metadata -> 'new') ? 'consultant_id'
         AND a.metadata #>> '{new,consultant_id}' IS DISTINCT FROM a.metadata #>> '{old,consultant_id}'
      UNION ALL
      SELECT a.created_at, 'urgency', 'Urgency changed to ' || (a.metadata #>> '{new,urgency}'),
             CASE WHEN a.metadata #>> '{old,urgency}' IS NOT NULL THEN 'Before: ' || (a.metadata #>> '{old,urgency}') END
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,urgency}' IS NOT NULL
         AND a.metadata #>> '{new,urgency}' IS DISTINCT FROM a.metadata #>> '{old,urgency}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan submitted for approval', NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_submitted_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_submitted_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_submitted_at}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan approved', NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_approved_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_approved_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_approved_at}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan rejected', NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_rejected_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_rejected_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_rejected_at}'
      UNION ALL
      SELECT m.created_at, 'match', 'A consultant was asked to take this ticket', NULL
        FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket_id
      UNION ALL
      SELECT m.responded_at, 'match',
             CASE WHEN m.status::text = 'accepted' THEN 'A consultant accepted the match request' ELSE 'A consultant answered the match request (' || replace(m.status::text, '_', ' ') || ')' END,
             NULL
        FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket_id AND m.responded_at IS NOT NULL
    ) x
   WHERE x.event_at IS NOT NULL
   ORDER BY x.event_at DESC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.ticket_timeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_timeline(uuid) TO authenticated;

-- hygiene: the audit helper functions are used only by the audit trigger (which runs as the owner)
REVOKE EXECUTE ON FUNCTION public.audit_is_sensitive_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_scrub_row(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_changed(jsonb, jsonb) FROM PUBLIC, anon, authenticated;