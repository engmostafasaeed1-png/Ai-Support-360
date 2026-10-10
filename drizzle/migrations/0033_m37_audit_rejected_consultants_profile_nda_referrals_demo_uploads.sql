-- ===== M36 part 3: audit trail, rejected consultants, profile rules (QA defects DEF-032, 039, 040) =====

-- DEF-039 (a): the generic audit stores only what changed and hides personal or free-text columns
CREATE OR REPLACE FUNCTION public.audit_is_sensitive_key(_k text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _k ~* '(^cv_|password|secret|token|api_key|signature|ip_address|user_agent|phone|email|nationality|latitude|longitude|meeting_url|recording_url|file_url|pdf_url|bank|iban|reference|description|notes|summary|content|body|message|stripe_|area_details)'
$function$;

CREATE OR REPLACE FUNCTION public.audit_scrub_row(_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_object_agg(e.key,
           CASE WHEN public.audit_is_sensitive_key(e.key) AND e.value <> 'null'::jsonb THEN to_jsonb('[hidden]'::text)
                WHEN jsonb_typeof(e.value) = 'string' AND char_length(e.value #>> '{}') > 160 THEN to_jsonb(left(e.value #>> '{}', 160) || '…')
                ELSE e.value END), '{}'::jsonb)
  FROM jsonb_each(COALESCE(_row, '{}'::jsonb)) AS e
$function$;

CREATE OR REPLACE FUNCTION public.audit_changed(_old jsonb, _new jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _k text;
  _o jsonb := '{}'::jsonb;
  _n jsonb := '{}'::jsonb;
BEGIN
  FOR _k IN SELECT jsonb_object_keys(COALESCE(_new, '{}'::jsonb)) LOOP
    IF _k IN ('updated_at', 'created_at') THEN
      CONTINUE;
    END IF;
    IF (_old -> _k) IS DISTINCT FROM (_new -> _k) THEN
      IF public.audit_is_sensitive_key(_k) THEN
        _o := _o || jsonb_build_object(_k, '[hidden]');
        _n := _n || jsonb_build_object(_k, '[changed]');
      ELSE
        _o := _o || public.audit_scrub_row(jsonb_build_object(_k, _old -> _k));
        _n := _n || public.audit_scrub_row(jsonb_build_object(_k, _new -> _k));
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('old', _o, 'new', _n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_log_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _action text;
  _entity_type text;
  _entity_id uuid;
  _metadata jsonb;
  _diff jsonb;
BEGIN
  _entity_type := TG_TABLE_NAME;

  IF TG_OP = 'INSERT' THEN
    _action := _entity_type || '.created';
    _entity_id := NEW.id;
    _metadata := jsonb_build_object('new', public.audit_scrub_row(to_jsonb(NEW)));
  ELSIF TG_OP = 'UPDATE' THEN
    _action := _entity_type || '.updated';
    _entity_id := NEW.id;
    _diff := public.audit_changed(to_jsonb(OLD), to_jsonb(NEW));
    IF _diff -> 'new' = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    _metadata := _diff;
  ELSIF TG_OP = 'DELETE' THEN
    _action := _entity_type || '.deleted';
    _entity_id := OLD.id;
    _metadata := jsonb_build_object('old', public.audit_scrub_row(to_jsonb(OLD)));
  END IF;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, metadata)
  VALUES (_action, _entity_type, _entity_id, auth.uid(), _metadata);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- DEF-039 (b): clean the entries that were already stored (whole rows) in the same way
UPDATE public.audit_logs a
   SET metadata = CASE
         WHEN a.action LIKE '%.updated' AND a.metadata ? 'old' AND a.metadata ? 'new'
           THEN public.audit_changed(a.metadata -> 'old', a.metadata -> 'new')
         ELSE (SELECT COALESCE(jsonb_object_agg(m.key,
                       CASE WHEN m.key IN ('old', 'new') AND jsonb_typeof(m.value) = 'object' THEN public.audit_scrub_row(m.value) ELSE m.value END), '{}'::jsonb)
                 FROM jsonb_each(a.metadata) AS m)
       END
 WHERE jsonb_typeof(a.metadata) = 'object' AND (a.metadata ? 'old' OR a.metadata ? 'new');

-- DEF-039 (c): the verification audit can only be read and its reason written once by the reviewer of that decision
CREATE OR REPLACE FUNCTION public.guard_verification_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Verification audit entries can not be deleted' USING ERRCODE = '42501';
  ELSIF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Verification audit entries are written by the platform' USING ERRCODE = '42501';
  END IF;
  IF ROW(NEW.id, NEW.consultant_id, NEW.old_status, NEW.new_status, NEW.reviewer_id, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.consultant_id, OLD.old_status, OLD.new_status, OLD.reviewer_id, OLD.created_at)
     OR OLD.reason IS NOT NULL
     OR OLD.reviewer_id IS DISTINCT FROM auth.uid()
     OR OLD.created_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'Verification audit entries can not be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_verification_audit ON public.consultant_verification_audit;
CREATE TRIGGER trg_guard_verification_audit
  BEFORE INSERT OR UPDATE OR DELETE ON public.consultant_verification_audit
  FOR EACH ROW EXECUTE FUNCTION public.guard_verification_audit();
REVOKE EXECUTE ON FUNCTION public.guard_verification_audit() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Admins can manage all verification audit entries" ON public.consultant_verification_audit;
CREATE POLICY "Admins can view verification audit entries" ON public.consultant_verification_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can add the reason to their fresh entry" ON public.consultant_verification_audit
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- DEF-040: a consultant who is rejected or suspended loses the ongoing work at once
CREATE OR REPLACE FUNCTION public.offboard_consultant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.verification_status::text NOT IN ('rejected', 'suspended')
     OR OLD.verification_status IS NOT DISTINCT FROM NEW.verification_status THEN
    RETURN NEW;
  END IF;
  UPDATE public.ticket_assignments SET status = 'removed', updated_at = now()
   WHERE consultant_id = NEW.id AND status = 'active';
  UPDATE public.tickets
     SET consultant_id = NULL,
         status = CASE WHEN status::text IN ('matched', 'in_progress', 'waiting_for_client') THEN 'under_review'::public.ticket_status ELSE status END
   WHERE consultant_id = NEW.id AND status::text NOT IN ('resolved', 'closed');
  UPDATE public.sessions SET status = 'cancelled'
   WHERE consultant_id = NEW.id AND status::text = 'scheduled' AND (scheduled_at IS NULL OR scheduled_at > now());
  UPDATE public.proposals SET status = 'withdrawn'
   WHERE consultant_id = NEW.id AND status::text = 'pending';
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_offboard_consultant ON public.consultants;
CREATE TRIGGER trg_offboard_consultant
  AFTER UPDATE OF verification_status ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.offboard_consultant();
REVOKE EXECUTE ON FUNCTION public.offboard_consultant() FROM PUBLIC, anon, authenticated;

-- DEF-032: profile data rules in the database (duplicates, bad date ranges, empty names, reversed or overlapping availability)
ALTER TABLE public.consultant_skills
  ADD CONSTRAINT consultant_skills_one_row_per_module UNIQUE (consultant_id, sap_module),
  ADD CONSTRAINT consultant_skills_module_not_blank CHECK (btrim(sap_module) <> '');
ALTER TABLE public.consultant_work_history
  ADD CONSTRAINT work_history_dates_ordered CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  ADD CONSTRAINT work_history_text_not_blank CHECK (btrim(company_name) <> '' AND btrim(job_title) <> '');
ALTER TABLE public.consultant_education
  ADD CONSTRAINT education_years_ordered CHECK (start_year IS NULL OR end_year IS NULL OR end_year >= start_year),
  ADD CONSTRAINT education_years_plausible CHECK ((start_year IS NULL OR start_year BETWEEN 1940 AND 2100) AND (end_year IS NULL OR end_year BETWEEN 1940 AND 2100)),
  ADD CONSTRAINT education_institution_not_blank CHECK (btrim(institution) <> '');
ALTER TABLE public.availability_slots
  ADD CONSTRAINT availability_slots_time_ordered CHECK (end_time > start_time);

CREATE OR REPLACE FUNCTION public.guard_availability_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('availability:' || NEW.consultant_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.availability_slots s
     WHERE s.consultant_id = NEW.consultant_id
       AND s.id <> NEW.id
       AND s.start_time < NEW.end_time AND s.end_time > NEW.start_time
       AND ((NEW.specific_date IS NOT NULL AND s.specific_date = NEW.specific_date)
            OR (NEW.specific_date IS NULL AND s.specific_date IS NULL AND s.day_of_week IS NOT DISTINCT FROM NEW.day_of_week))
  ) THEN
    RAISE EXCEPTION 'This time overlaps another availability slot' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_availability_overlap ON public.availability_slots;
CREATE TRIGGER trg_guard_availability_overlap
  BEFORE INSERT OR UPDATE OF consultant_id, day_of_week, specific_date, start_time, end_time ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.guard_availability_overlap();
REVOKE EXECUTE ON FUNCTION public.guard_availability_overlap() FROM PUBLIC, anon, authenticated;

-- ===== M36 part 4: NDA, referral rewards, demo requests, join events, uploads (QA defects DEF-003, 012, 029, 037, 052, 065) =====

-- DEF-029: protected remote access needs BOTH signatures (consultant and client), not only the consultant's
CREATE OR REPLACE FUNCTION public.has_active_nda(_consultant_id uuid, _client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.nda_agreements n
    JOIN public.consultants c ON c.id = n.consultant_id
    WHERE n.consultant_id = _consultant_id AND n.client_id = _client_id AND n.revoked_at IS NULL
      AND n.client_signed_at IS NOT NULL
      AND (c.user_id = auth.uid() OR n.client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
$function$;

CREATE OR REPLACE FUNCTION public.my_consultant_env_access(_env uuid, _connectable boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.remote_environments re
    JOIN public.consultants c ON c.user_id = auth.uid() AND c.verification_status = 'verified'
    WHERE re.id = _env
      AND (re.consultant_id = c.id
           OR EXISTS (SELECT 1 FROM public.environment_consultants ec WHERE ec.environment_id = re.id AND ec.consultant_id = c.id))
      AND EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = c.id AND n.client_id = re.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NOT NULL)
      AND (NOT _connectable OR re.status::text = 'active')
  )
$function$;

CREATE OR REPLACE FUNCTION public.notify_environment_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _u uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    FOR _u IN
      SELECT DISTINCT c.user_id
      FROM public.consultants c
      WHERE (c.id = NEW.consultant_id OR c.id IN (SELECT ec.consultant_id FROM public.environment_consultants ec WHERE ec.environment_id = NEW.id))
        AND EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = c.id AND n.client_id = NEW.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NOT NULL)
    LOOP
      PERFORM public.safe_insert_notification(_u, 'Environment status changed',
        'A client environment you work on is now ' || NEW.status::text || '.', 'remote_access', '/consultant/remote-access');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_shared_remote_config_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cu uuid;
  _name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT p.display_name INTO _name
    FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id
    WHERE c.id = NEW.consultant_id;
    PERFORM public.safe_insert_notification(NEW.client_id, 'Remote access accepted',
      COALESCE(_name, 'The consultant') || ' accepted the ' || NEW.tool_type || ' remote access you shared.', 'remote_access', '/client/remote-access');
  ELSIF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    SELECT c.user_id INTO _cu FROM public.consultants c WHERE c.id = NEW.consultant_id;
    IF _cu IS NOT NULL AND EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = NEW.consultant_id AND n.client_id = NEW.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NOT NULL) THEN
      SELECT p.display_name INTO _name FROM public.profiles p WHERE p.user_id = NEW.client_id;
      PERFORM public.safe_insert_notification(_cu, 'Remote access revoked',
        COALESCE(_name, 'A client') || ' revoked the ' || NEW.tool_type || ' remote access.', 'remote_access', '/consultant/remote-access');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_nda_signed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_name text;
BEGIN
  SELECT p.display_name INTO _consultant_name
  FROM public.consultants c
  JOIN public.profiles p ON p.user_id = c.user_id
  WHERE c.id = NEW.consultant_id;

  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (
    NEW.client_id,
    'NDA signed by consultant - your signature is needed',
    'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" has signed a Non-Disclosure Agreement for your account. Please sign it as well: protected access (remote environments and shared remote tools) is released only after both signatures.',
    'nda',
    '/client/contracts'
  );

  RETURN NEW;
END;
$function$;

-- DEF-037: a referral reward is granted for a real result (confirmed e-mail and the first completed invoice payment), once, with a cap per referrer
CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_once_per_side
  ON public.referral_rewards (referral_id, user_id, reward_type);

CREATE OR REPLACE FUNCTION public.process_referral_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _referral_code text;
  _referrer_id uuid;
BEGIN
  _referral_code := NEW.raw_user_meta_data->>'referral_code';
  IF _referral_code IS NULL OR _referral_code = '' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO _referrer_id FROM public.profiles WHERE referral_code = _referral_code;
  IF _referrer_id IS NULL OR _referrer_id = NEW.id THEN
    RETURN NEW;
  END IF;

  UPDATE public.referrals
     SET status = 'registered', referred_user_id = NEW.id, updated_at = now()
   WHERE referral_code = _referral_code
     AND (referred_email = NEW.email OR referred_email IS NULL)
     AND status = 'pending';
  IF NOT FOUND THEN
    INSERT INTO public.referrals (referrer_id, referral_code, referred_user_id, status, referred_email)
    VALUES (_referrer_id, _referral_code, NEW.id, 'registered', NEW.email);
  END IF;

  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_referrer_id, 'Someone joined with your referral link',
          'Your $25 credit is added when the new member completes a first paid invoice.', 'referral', '/referrals');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_referral_rewards(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ref public.referrals;
  _confirmed boolean;
  _rewarded integer;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO _ref FROM public.referrals
   WHERE referred_user_id = _user_id AND status = 'registered'
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT (u.email_confirmed_at IS NOT NULL) INTO _confirmed FROM auth.users u WHERE u.id = _user_id;
  IF NOT COALESCE(_confirmed, false) THEN
    RETURN;
  END IF;
  SELECT count(*) INTO _rewarded FROM public.referrals WHERE referrer_id = _ref.referrer_id AND status = 'rewarded';
  IF _rewarded >= 20 THEN
    UPDATE public.referrals SET status = 'expired', updated_at = now() WHERE id = _ref.id;
    RETURN;
  END IF;
  INSERT INTO public.referral_rewards (referral_id, user_id, reward_type, amount, currency, description)
  VALUES (_ref.id, _ref.referrer_id, 'credit', 25, 'USD', 'Referral bonus - the member you invited completed a first paid invoice'),
         (_ref.id, _user_id, 'discount', 15, 'USD', 'Welcome bonus - you joined through a referral and completed a first paid invoice')
  ON CONFLICT DO NOTHING;
  UPDATE public.referrals SET status = 'rewarded', updated_at = now() WHERE id = _ref.id;
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_ref.referrer_id, 'Referral reward earned', 'The member you invited completed a first paid invoice. You earned a $25 credit.', 'referral', '/referrals');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.grant_referral_rewards(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.referral_after_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user uuid;
BEGIN
  IF NEW.status::text = 'completed' AND NEW.kind = 'invoice' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.grant_referral_rewards(NEW.client_id);
    SELECT c.user_id INTO _consultant_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
    PERFORM public.grant_referral_rewards(_consultant_user);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_referral_after_payment ON public.payments;
CREATE TRIGGER trg_referral_after_payment
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.referral_after_payment();
REVOKE EXECUTE ON FUNCTION public.referral_after_payment() FROM PUBLIC, anon, authenticated;

-- DEF-012: a demo can not be requested for a time that has already passed (judged in the visitor's timezone)
CREATE OR REPLACE FUNCTION public.assert_demo_slot_not_past(_date date, _slot text, _timezone text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamp;
  _slot_time time;
BEGIN
  IF _date IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    _now := now() AT TIME ZONE COALESCE(NULLIF(btrim(_timezone), ''), 'UTC');
  EXCEPTION WHEN others THEN
    _now := now() AT TIME ZONE 'UTC';
  END;
  IF _date < _now::date THEN
    RAISE EXCEPTION 'Please choose a date that is not in the past' USING ERRCODE = '22023';
  END IF;
  IF _date > _now::date + 365 THEN
    RAISE EXCEPTION 'Please choose a date within the next year' USING ERRCODE = '22023';
  END IF;
  IF _date = _now::date AND _slot ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    _slot_time := _slot::time;
    IF _slot_time <= _now::time THEN
      RAISE EXCEPTION 'Please choose a time that is still ahead' USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.assert_demo_slot_not_past(date, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_demo_request(_demo_type text, _scheduling_preference text, _scheduled_date date, _scheduled_slot text, _timezone text, _meeting_format text, _full_name text, _email text, _company text, _notes text, _source text DEFAULT 'landing-wizard'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _token text;
  _mail  text := lower(btrim(COALESCE(_email, '')));
BEGIN
  IF length(btrim(COALESCE(_full_name, ''))) < 2 OR length(_full_name) > 120 THEN
    RAISE EXCEPTION 'Please enter your full name' USING ERRCODE = '22023';
  END IF;
  IF length(_mail) > 254 OR _mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Please enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF _demo_type IS NULL OR _demo_type NOT IN ('live', 'ai-triage', 'pricing-roi', 'module-deep-dive') THEN
    RAISE EXCEPTION 'Please choose a demo type' USING ERRCODE = '22023';
  END IF;
  IF _scheduling_preference IS NULL OR _scheduling_preference NOT IN ('asap', 'this-week', 'next-week', 'flexible') THEN
    RAISE EXCEPTION 'Please choose when you would like the demo' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(_scheduled_slot, '')) > 60
     OR length(COALESCE(_timezone, '')) > 80
     OR length(COALESCE(_meeting_format, '')) > 60
     OR length(COALESCE(_company, '')) > 200
     OR length(COALESCE(_notes, '')) > 2000
     OR length(COALESCE(_source, '')) > 60 THEN
    RAISE EXCEPTION 'Invalid demo request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_demo_slot_not_past(_scheduled_date, _scheduled_slot, _timezone);
  IF NOT public.check_rate_limit('demo_request:' || _mail, 3, 3600)
     OR NOT public.check_rate_limit('demo_request:all', 120, 3600) THEN
    RAISE EXCEPTION 'Too many requests. Please try again later.' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.demo_requests
    (user_id, demo_type, scheduling_preference, scheduled_date, scheduled_slot, timezone,
     meeting_format, full_name, email, company, notes, source, status)
  VALUES
    (auth.uid(), _demo_type, _scheduling_preference, _scheduled_date, NULLIF(_scheduled_slot, ''),
     NULLIF(_timezone, ''), NULLIF(_meeting_format, ''), btrim(_full_name), _mail,
     NULLIF(btrim(COALESCE(_company, '')), ''), NULLIF(btrim(COALESCE(_notes, '')), ''),
     COALESCE(NULLIF(_source, ''), 'landing-wizard'), 'received')
  RETURNING request_token INTO _token;

  RETURN _token;
END;
$function$;

-- DEF-012 (rescheduling): every proposed slot must also be in the future
CREATE OR REPLACE FUNCTION public.request_demo_reschedule(_token text, _proposed_slots jsonb, _reason text DEFAULT NULL::text)
 RETURNS demo_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.demo_requests;
  _slot jsonb;
  _tz text;
BEGIN
  IF _proposed_slots IS NULL OR jsonb_typeof(_proposed_slots) <> 'array' OR jsonb_array_length(_proposed_slots) = 0 THEN
    RAISE EXCEPTION 'At least one proposed slot is required';
  END IF;
  IF jsonb_array_length(_proposed_slots) > 5 THEN
    RAISE EXCEPTION 'Please propose at most 5 slots';
  END IF;

  SELECT timezone INTO _tz FROM public.demo_requests WHERE request_token = _token;
  FOR _slot IN SELECT * FROM jsonb_array_elements(_proposed_slots) LOOP
    IF jsonb_typeof(_slot) = 'object' AND (_slot ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' THEN
      PERFORM public.assert_demo_slot_not_past((_slot ->> 'date')::date, _slot ->> 'time', _tz);
    END IF;
  END LOOP;

  UPDATE public.demo_requests
  SET status = 'rescheduling',
      proposed_slots = _proposed_slots,
      reschedule_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
      reschedule_requested_at = now(),
      status_note = 'Requester proposed new time slots — awaiting confirmation.',
      updated_at = now()
  WHERE request_token = _token
    AND status IN ('received','contacted','scheduled','rescheduling')
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Demo request not found or cannot be rescheduled in its current status';
  END IF;
  RETURN _row;
END;
$function$;

-- DEF-003: the team is told about every new demo request (in the portal; the admin page and the e-mail follow in the app)
CREATE OR REPLACE FUNCTION public.notify_admins_demo_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _admin uuid;
BEGIN
  FOR _admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
    PERFORM public.safe_insert_notification(
      _admin,
      'New demo request',
      left(NEW.full_name, 80) || COALESCE(' (' || left(NEW.company, 80) || ')', '') || ' asked for a "' || NEW.demo_type || '" demo'
        || COALESCE(' on ' || to_char(NEW.scheduled_date, 'YYYY-MM-DD') || COALESCE(' at ' || NEW.scheduled_slot, ''), ' (' || NEW.scheduling_preference || ')') || '.',
      'demo_request',
      '/admin/demo-requests');
  END LOOP;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_notify_admins_demo_request ON public.demo_requests;
CREATE TRIGGER trg_notify_admins_demo_request
  AFTER INSERT ON public.demo_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_demo_request();
REVOKE EXECUTE ON FUNCTION public.notify_admins_demo_request() FROM PUBLIC, anon, authenticated;

-- DEF-052: the join-events log keeps only the origin of the referrer (no query string, no preview token)
CREATE OR REPLACE FUNCTION public.clean_join_event_referrer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _ref text;
BEGIN
  _ref := NEW.metadata ->> 'referrer';
  IF _ref IS NOT NULL THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{referrer}', to_jsonb(COALESCE(substring(_ref from '^(https?://[^/?#[:space:]]+)'), '')));
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_clean_join_event_referrer ON public.meeting_join_events;
CREATE TRIGGER trg_clean_join_event_referrer
  BEFORE INSERT OR UPDATE ON public.meeting_join_events
  FOR EACH ROW EXECUTE FUNCTION public.clean_join_event_referrer();
REVOKE EXECUTE ON FUNCTION public.clean_join_event_referrer() FROM PUBLIC, anon, authenticated;

UPDATE public.meeting_join_events
   SET metadata = jsonb_set(metadata, '{referrer}', to_jsonb(COALESCE(substring(metadata ->> 'referrer' from '^(https?://[^/?#[:space:]]+)'), '')))
 WHERE metadata ? 'referrer' AND metadata ->> 'referrer' IS NOT NULL
   AND metadata ->> 'referrer' !~ '^https?://[^/?#[:space:]]+$';

-- DEF-065: no executable or script files in the private document buckets (the app checks type and size too)
DROP POLICY IF EXISTS "Block executable and script uploads" ON storage.objects;
CREATE POLICY "Block executable and script uploads" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id NOT IN ('ticket-documents', 'chat-files', 'proposal-documents', 'business-process-docs', 'dispute-evidence', 'consultant-documents', 'nda-documents')
    OR COALESCE(lower(substring(name from '\.([^./]+)$')), '') NOT IN
       ('exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'dll', 'vbs', 'vbe', 'wsf', 'ps1', 'psm1', 'jar', 'apk', 'app', 'dmg', 'iso', 'lnk', 'reg', 'hta', 'cpl')
  );
DROP POLICY IF EXISTS "Block executable and script renames" ON storage.objects;
CREATE POLICY "Block executable and script renames" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (
    bucket_id NOT IN ('ticket-documents', 'chat-files', 'proposal-documents', 'business-process-docs', 'dispute-evidence', 'consultant-documents', 'nda-documents')
    OR COALESCE(lower(substring(name from '\.([^./]+)$')), '') NOT IN
       ('exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'dll', 'vbs', 'vbe', 'wsf', 'ps1', 'psm1', 'jar', 'apk', 'app', 'dmg', 'iso', 'lnk', 'reg', 'hta', 'cpl')
  );