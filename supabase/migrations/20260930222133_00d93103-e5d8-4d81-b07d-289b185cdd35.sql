-- =====================================================================
-- SECURITY HARDENING MIGRATION
--
-- C1  privilege escalation at signup (role taken from client metadata)
-- C2  any user could become owner of any tenant; owners could edit billing
-- C3  consultants could self-verify / forge ratings, scores, credits
-- C5  email-queue RPCs were executable by anon (read auth emails, inject mail)
-- H2  notification spoofing via safe_insert_notification
-- +   grant hardening, ratings integrity, KB publishing, demo-request RPC,
--     integration endpoint validation, DB-backed rate limiting
--
-- Idempotent: safe to re-run. Does NOT modify existing rows except
-- generating a webhook secret for integrations that have none.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helper: is the current statement coming from an untrusted API caller?
--    current_user is 'authenticated'/'anon' only for direct PostgREST calls.
--    SECURITY DEFINER functions (owner = postgres), service_role (edge
--    functions) and migrations run as other roles and are NOT restricted.
--    Platform admins are never restricted.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_untrusted_writer()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT current_user IN ('authenticated', 'anon')
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
$$;

-- ---------------------------------------------------------------------
-- 1. C1 — privileges are never taken from client-controlled signup metadata
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role public.app_role;
BEGIN
  -- Only the two self-service roles can ever be assigned here.
  -- Anything else (admin, super_admin, unknown) becomes 'client'.
  IF lower(COALESCE(NEW.raw_user_meta_data->>'role', '')) = 'consultant' THEN
    _role := 'consultant';
  ELSE
    _role := 'client';
  END IF;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NULLIF(left(NEW.raw_user_meta_data->>'display_name', 120), ''), NEW.email))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF _role = 'consultant' THEN
    INSERT INTO public.consultants (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.client_profiles (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. DB-backed rate limiting (used by edge functions with the service role)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No direct access to rate limit counters" ON public.rate_limit_counters;
CREATE POLICY "No direct access to rate limit counters"
  ON public.rate_limit_counters FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.rate_limit_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_rate_limit(_bucket text, _limit integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ws   timestamptz;
  _hits integer;
BEGIN
  IF _window_seconds IS NULL OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid window' USING ERRCODE = '22023';
  END IF;
  _ws := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  INSERT INTO public.rate_limit_counters AS c (bucket, window_start, hits)
  VALUES (left(_bucket, 200), _ws, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = c.hits + 1
  RETURNING c.hits INTO _hits;

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN _hits <= _limit;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. C5 / H2 — lock down the RPC surface.
--    Supabase grants EXECUTE to anon/authenticated by default and
--    REVOKE ... FROM PUBLIC does not remove those direct grants.
-- ---------------------------------------------------------------------
-- 3a. email queue plumbing and rate limiter: service_role only
REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_email(text, bigint)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)               TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint)               TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

-- 3b. notification spoofing: only triggers (definer) and service_role may call it
REVOKE ALL ON FUNCTION public.safe_insert_notification(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.safe_insert_notification(uuid, text, text, text, text) TO service_role;

-- 3c. signed-in-only RPCs must not be callable anonymously
REVOKE ALL ON FUNCTION public.admin_confirm_reschedule_slot(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retry_failed_notification(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_integration_credentials(uuid)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_vmware_settings_safe(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_tenant_id()                               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_reschedule_slot(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_notification(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_integration_credentials(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vmware_settings_safe(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id()                               TO authenticated;

-- ---------------------------------------------------------------------
-- 4. C2 — tenants: creators bootstrap their own tenant only;
--    owners can no longer edit billing / quota fields
-- ---------------------------------------------------------------------
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.tenants ALTER COLUMN created_by SET DEFAULT auth.uid();

CREATE OR REPLACE FUNCTION public.can_bootstrap_tenant_membership(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.created_by = auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _tenant_id)
$$;
REVOKE ALL ON FUNCTION public.can_bootstrap_tenant_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_bootstrap_tenant_membership(uuid) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;
DROP POLICY IF EXISTS "Authenticated users can create own tenants" ON public.tenants;
CREATE POLICY "Authenticated users can create own tenants"
  ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can insert themselves as owner of new tenant" ON public.tenant_members;
DROP POLICY IF EXISTS "Creators bootstrap their own tenant ownership" ON public.tenant_members;
CREATE POLICY "Creators bootstrap their own tenant ownership"
  ON public.tenant_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND org_role = 'owner'
    AND public.can_bootstrap_tenant_membership(tenant_id)
  );

CREATE OR REPLACE FUNCTION public.guard_tenant_entitlements()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.subscription_tier        := 'basic';
    NEW.subscription_status      := 'active';
    NEW.max_users                := 5;
    NEW.max_tickets_per_month    := 10;
    NEW.max_sessions_per_month   := 5;
    NEW.ai_quota                 := 50;
    NEW.stripe_customer_id       := NULL;
    NEW.stripe_subscription_id   := NULL;
    NEW.trial_ends_at            := NULL;
    NEW.created_by               := auth.uid();
    RETURN NEW;
  END IF;

  IF ROW(NEW.subscription_tier, NEW.subscription_status, NEW.max_users, NEW.max_tickets_per_month,
         NEW.max_sessions_per_month, NEW.ai_quota, NEW.stripe_customer_id, NEW.stripe_subscription_id,
         NEW.trial_ends_at, NEW.created_by)
     IS DISTINCT FROM
     ROW(OLD.subscription_tier, OLD.subscription_status, OLD.max_users, OLD.max_tickets_per_month,
         OLD.max_sessions_per_month, OLD.ai_quota, OLD.stripe_customer_id, OLD.stripe_subscription_id,
         OLD.trial_ends_at, OLD.created_by) THEN
    RAISE EXCEPTION 'Subscription, billing and quota fields are managed by the platform'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_tenant_entitlements ON public.tenants;
CREATE TRIGGER trg_guard_tenant_entitlements
  BEFORE INSERT OR UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_entitlements();

-- ---------------------------------------------------------------------
-- 5. C3 — trust columns are written by the platform, never by the profile owner
-- ---------------------------------------------------------------------
-- 5a. consultants
CREATE OR REPLACE FUNCTION public.guard_consultant_trust_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status         := 'pending';
    NEW.rating                      := 0;
    NEW.total_reviews               := 0;
    NEW.response_time_minutes       := 0;
    NEW.credibility_credits         := 0;
    NEW.ai_skills_score             := NULL;
    NEW.ai_interview_badge          := NULL;
    NEW.ai_interview_completed_at   := NULL;
    RETURN NEW;
  END IF;

  IF ROW(NEW.user_id, NEW.verification_status, NEW.rating, NEW.total_reviews, NEW.response_time_minutes,
         NEW.credibility_credits, NEW.ai_skills_score, NEW.ai_interview_badge, NEW.ai_interview_completed_at)
     IS DISTINCT FROM
     ROW(OLD.user_id, OLD.verification_status, OLD.rating, OLD.total_reviews, OLD.response_time_minutes,
         OLD.credibility_credits, OLD.ai_skills_score, OLD.ai_interview_badge, OLD.ai_interview_completed_at) THEN
    RAISE EXCEPTION 'Verification status, ratings, scores and credits are managed by the platform'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_consultant_trust_columns ON public.consultants;
CREATE TRIGGER trg_guard_consultant_trust_columns
  BEFORE INSERT OR UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.guard_consultant_trust_columns();

-- 5b. certifications: only admins / verification services can mark a certificate verified
CREATE OR REPLACE FUNCTION public.guard_certification_verified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verified := false;
    RETURN NEW;
  END IF;

  IF NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'Certification verification is managed by the platform' USING ERRCODE = '42501';
  END IF;

  -- editing the substance of a verified certificate invalidates the verification
  IF OLD.verified AND ROW(NEW.name, NEW.issuer, NEW.issue_date, NEW.expiry_date, NEW.document_url)
                      IS DISTINCT FROM
                      ROW(OLD.name, OLD.issuer, OLD.issue_date, OLD.expiry_date, OLD.document_url) THEN
    NEW.verified := false;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_certification_verified ON public.certifications;
CREATE TRIGGER trg_guard_certification_verified
  BEFORE INSERT OR UPDATE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_certification_verified();

-- 5c. interview_sessions: results/completion come from the evaluation service only
CREATE OR REPLACE FUNCTION public.guard_interview_session_results()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status            := 'pending';
    NEW.overall_score     := NULL;
    NEW.technical_score   := NULL;
    NEW.soft_skills_score := NULL;
    NEW.ai_summary        := NULL;
    NEW.completed_at      := NULL;
    RETURN NEW;
  END IF;

  IF ROW(NEW.consultant_id, NEW.interview_type, NEW.requested_by, NEW.overall_score,
         NEW.technical_score, NEW.soft_skills_score, NEW.ai_summary, NEW.completed_at)
     IS DISTINCT FROM
     ROW(OLD.consultant_id, OLD.interview_type, OLD.requested_by, OLD.overall_score,
         OLD.technical_score, OLD.soft_skills_score, OLD.ai_summary, OLD.completed_at) THEN
    RAISE EXCEPTION 'Interview results are produced by the platform' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status NOT IN ('pending', 'in_progress') OR NEW.status NOT IN ('pending', 'in_progress')) THEN
    RAISE EXCEPTION 'Interview status transitions to completed/reviewed are managed by the platform'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_interview_session_results ON public.interview_sessions;
CREATE TRIGGER trg_guard_interview_session_results
  BEFORE INSERT OR UPDATE ON public.interview_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_interview_session_results();

-- 5d. interview_answers: scores/feedback are produced by the evaluation service
CREATE OR REPLACE FUNCTION public.guard_interview_answer_scores()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.score       := NULL;
    NEW.ai_feedback := NULL;
    RETURN NEW;
  END IF;

  IF ROW(NEW.score, NEW.ai_feedback) IS DISTINCT FROM ROW(OLD.score, OLD.ai_feedback) THEN
    RAISE EXCEPTION 'Interview scores are produced by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_interview_answer_scores ON public.interview_answers;
CREATE TRIGGER trg_guard_interview_answer_scores
  BEFORE INSERT OR UPDATE ON public.interview_answers
  FOR EACH ROW EXECUTE FUNCTION public.guard_interview_answer_scores();

-- ---------------------------------------------------------------------
-- 6. Other mass-assignment guards (participants keep every legitimate edit)
-- ---------------------------------------------------------------------
-- 6a. tickets: ownership, tenant and SLA bookkeeping are immutable for participants
CREATE OR REPLACE FUNCTION public.guard_ticket_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.client_id, NEW.tenant_id, NEW.sla_policy_id, NEW.sla_response_deadline, NEW.first_response_at, NEW.sla_breached)
     IS DISTINCT FROM
     ROW(OLD.client_id, OLD.tenant_id, OLD.sla_policy_id, OLD.sla_response_deadline, OLD.first_response_at, OLD.sla_breached) THEN
    RAISE EXCEPTION 'Ticket ownership, tenant and SLA tracking fields cannot be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_ticket_protected_columns ON public.tickets;
CREATE TRIGGER trg_guard_ticket_protected_columns
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_protected_columns();

-- 6b. sessions: parties, links and AI output are immutable for participants
CREATE OR REPLACE FUNCTION public.guard_session_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.client_id, NEW.consultant_id, NEW.ticket_id, NEW.tenant_id, NEW.ai_summary, NEW.ai_action_items)
     IS DISTINCT FROM
     ROW(OLD.client_id, OLD.consultant_id, OLD.ticket_id, OLD.tenant_id, OLD.ai_summary, OLD.ai_action_items) THEN
    RAISE EXCEPTION 'Session parties and AI analysis fields cannot be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_session_protected_columns ON public.sessions;
CREATE TRIGGER trg_guard_session_protected_columns
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_protected_columns();

-- 6c. referrals: lifecycle is driven by the signup trigger, not by the referrer
CREATE OR REPLACE FUNCTION public.guard_referral_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.referrer_id, NEW.referral_code, NEW.referred_user_id, NEW.status)
     IS DISTINCT FROM
     ROW(OLD.referrer_id, OLD.referral_code, OLD.referred_user_id, OLD.status) THEN
    RAISE EXCEPTION 'Referral status is managed by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_referral_protected_columns ON public.referrals;
CREATE TRIGGER trg_guard_referral_protected_columns
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.guard_referral_protected_columns();

-- 6d. profiles: a user cannot re-point their referral code at someone else's
CREATE OR REPLACE FUNCTION public.guard_profile_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_untrusted_writer() AND NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'Referral code cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_profile_referral_code ON public.profiles;
CREATE TRIGGER trg_guard_profile_referral_code
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_referral_code();

-- 6e. knowledge base: only admins can publish (published rows are world-readable)
CREATE OR REPLACE FUNCTION public.guard_knowledge_publish()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_untrusted_writer()
     AND (NEW.status::text = 'published' OR (TG_OP = 'UPDATE' AND OLD.status::text = 'published')) THEN
    RAISE EXCEPTION 'Only administrators can publish or edit published knowledge content'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_knowledge_articles_publish ON public.knowledge_articles;
CREATE TRIGGER trg_guard_knowledge_articles_publish
  BEFORE INSERT OR UPDATE ON public.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.guard_knowledge_publish();
DROP TRIGGER IF EXISTS trg_guard_knowledge_solutions_publish ON public.knowledge_solutions;
CREATE TRIGGER trg_guard_knowledge_solutions_publish
  BEFORE INSERT OR UPDATE ON public.knowledge_solutions
  FOR EACH ROW EXECUTE FUNCTION public.guard_knowledge_publish();

-- ---------------------------------------------------------------------
-- 7. Ratings: only for your own completed session, once per session
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients can create ratings" ON public.ratings;
DROP POLICY IF EXISTS "Clients can rate their own completed sessions" ON public.ratings;
CREATE POLICY "Clients can rate their own completed sessions"
  ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = client_id
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = ratings.session_id
        AND s.client_id = auth.uid()
        AND s.consultant_id = ratings.consultant_id
        AND s.status = 'completed'
    )
  );
CREATE UNIQUE INDEX IF NOT EXISTS ratings_one_per_session_client
  ON public.ratings (session_id, client_id);

-- ---------------------------------------------------------------------
-- 8. Integrations: https-only endpoint, mandatory strong webhook secret
-- ---------------------------------------------------------------------
UPDATE public.integrations
   SET webhook_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 WHERE webhook_secret IS NULL OR length(webhook_secret) < 32;

ALTER TABLE public.integrations
  ALTER COLUMN webhook_secret SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
ALTER TABLE public.integrations ALTER COLUMN webhook_secret SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.integrations'::regclass AND conname = 'integrations_webhook_secret_len'
  ) THEN
    ALTER TABLE public.integrations
      ADD CONSTRAINT integrations_webhook_secret_len CHECK (length(webhook_secret) >= 32);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_integration_endpoint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.platform_url IS NULL
     OR length(NEW.platform_url) > 2048
     OR NEW.platform_url !~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?(/[^[:space:]]*)?$' THEN
    RAISE EXCEPTION 'platform_url must be a valid https:// URL without credentials' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_integration_endpoint ON public.integrations;
CREATE TRIGGER trg_guard_integration_endpoint
  BEFORE INSERT OR UPDATE OF platform_url ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.guard_integration_endpoint();

-- ---------------------------------------------------------------------
-- 9. Demo requests: anonymous visitors cannot SELECT, so the wizard's
--    "INSERT ... RETURNING request_token" failed for them. Provide a
--    validated, rate-limited RPC that returns only the token.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_demo_request(
  _demo_type              text,
  _scheduling_preference  text,
  _scheduled_date         date,
  _scheduled_slot         text,
  _timezone               text,
  _meeting_format         text,
  _full_name              text,
  _email                  text,
  _company                text,
  _notes                  text,
  _source                 text DEFAULT 'landing-wizard'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NOT public.check_rate_limit('demo_request:' || _mail, 3, 3600) THEN
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
$$;
REVOKE ALL ON FUNCTION public.submit_demo_request(text, text, date, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_demo_request(text, text, date, text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. Ticket lifecycle bug fix.
--     notify_ticket_status_change() and notify_ticket_watchers() called
--     replace(NEW.status, ...) on an ENUM column
--     ("function replace(ticket_status, unknown, unknown) does not exist"),
--     so EVERY ticket status change failed with an error and no ticket could
--     ever leave 'new'. Cast to text.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_ticket_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _msg text;
  _consultant_user_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _msg := 'Ticket "' || NEW.title || '" status changed to "' || replace(NEW.status::text, '_', ' ') || '".';

    -- Notify client
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (NEW.client_id, 'Ticket Status Update', _msg, 'ticket', '/client/tickets/' || NEW.id);

    -- Notify assigned consultant if any
    IF NEW.consultant_id IS NOT NULL THEN
      SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
      IF _consultant_user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, body, type, link)
        VALUES (_consultant_user_id, 'Ticket Status Update', _msg, 'ticket', '/consultant/cases/' || NEW.id);
      END IF;
    END IF;
  END IF;

  -- Notify client when plan is submitted for approval
  IF NEW.plan_submitted_at IS NOT NULL AND OLD.plan_submitted_at IS NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Plan Ready for Approval',
      'A cost & effort plan (' || NEW.planned_hours || 'h, ' || NEW.planned_cost || ' ' || COALESCE(NEW.cost_currency, 'USD')
        || ') for "' || NEW.title || '" needs your approval.',
      'ticket',
      '/client/tickets/' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_ticket_watchers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _watcher RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.urgency IS DISTINCT FROM OLD.urgency THEN
    FOR _watcher IN SELECT user_id FROM public.ticket_watchers WHERE ticket_id = NEW.id LOOP
      IF _watcher.user_id != auth.uid() THEN
        INSERT INTO public.notifications (user_id, title, body, type, link)
        VALUES (
          _watcher.user_id,
          'Watched Ticket Updated',
          'Ticket "' || NEW.title || '" was updated (status: ' || replace(NEW.status::text, '_', ' ') || ').',
          'ticket',
          '/client/tickets/' || NEW.id
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 11. Additional integrity guards (legitimate owner/participant edits keep working)
-- ---------------------------------------------------------------------
-- 11a. shared remote-access configs: strict connection-ID charset (it is placed in
--      teamviewer:// / rustdesk:// links and .rdp files by the consultant's browser),
--      and a consultant may only accept a config, never rewrite it or re-point it.
CREATE OR REPLACE FUNCTION public.guard_shared_remote_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tool_type IS NULL OR NEW.tool_type !~ '^[a-z0-9_-]{2,32}$' THEN
    RAISE EXCEPTION 'Invalid remote access tool' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(NEW.config) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid remote access configuration' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(NEW.config->>'connectionId', '') <> ''
     AND (jsonb_typeof(NEW.config->'connectionId') <> 'string'
          OR (NEW.config->>'connectionId') !~ '^[A-Za-z0-9._:@-]{3,128}$') THEN
    RAISE EXCEPTION 'Invalid connection ID (letters, digits and . _ : @ - only, 3-128 characters)' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(NEW.message, '')) > 1000 THEN
    RAISE EXCEPTION 'Message is too long' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND public.is_untrusted_writer() THEN
    IF ROW(NEW.client_id, NEW.consultant_id, NEW.tool_type)
       IS DISTINCT FROM ROW(OLD.client_id, OLD.consultant_id, OLD.tool_type) THEN
      RAISE EXCEPTION 'Shared configuration parties cannot be changed' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS DISTINCT FROM OLD.client_id
       AND ROW(NEW.config, NEW.message, NEW.revoked_at, NEW.shared_at)
           IS DISTINCT FROM ROW(OLD.config, OLD.message, OLD.revoked_at, OLD.shared_at) THEN
      RAISE EXCEPTION 'Consultants can only accept a shared configuration' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_shared_remote_config ON public.shared_remote_configs;
CREATE TRIGGER trg_guard_shared_remote_config
  BEFORE INSERT OR UPDATE ON public.shared_remote_configs
  FOR EACH ROW EXECUTE FUNCTION public.guard_shared_remote_config();

-- 11b. proposals: only the ticket owner accepts/rejects; the proposing consultant
--      can submit (always 'pending') and withdraw.
CREATE OR REPLACE FUNCTION public.guard_proposal_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _is_ticket_owner boolean;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  _is_ticket_owner := EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.id = NEW.ticket_id AND t.client_id = auth.uid()
  );
  IF _is_ticket_owner THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status       := 'pending';
    NEW.client_notes := NULL;
    RETURN NEW;
  END IF;

  IF ROW(NEW.ticket_id, NEW.consultant_id, NEW.client_notes)
     IS DISTINCT FROM ROW(OLD.ticket_id, OLD.consultant_id, OLD.client_notes) THEN
    RAISE EXCEPTION 'Only the ticket owner can change proposal ownership or notes' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text <> 'withdrawn' THEN
    RAISE EXCEPTION 'Only the ticket owner can accept or reject a proposal' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_proposal_status ON public.proposals;
CREATE TRIGGER trg_guard_proposal_status
  BEFORE INSERT OR UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_proposal_status();

-- 11c. timesheets: a submitter cannot forge the client's signature or approval
CREATE OR REPLACE FUNCTION public.guard_timesheet_signature()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.signed_at      := NULL;
    NEW.signed_by_name := NULL;
    NEW.signature_data := NULL;
    IF NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'A new timesheet can only be saved as draft or submitted' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.ticket_id, NEW.submitted_by, NEW.signed_at, NEW.signed_by_name, NEW.signature_data)
     IS DISTINCT FROM ROW(OLD.ticket_id, OLD.submitted_by, OLD.signed_at, OLD.signed_by_name, OLD.signature_data) THEN
    RAISE EXCEPTION 'Timesheet signature fields are managed by the platform' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Timesheet approval is managed by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_timesheet_signature ON public.ticket_timesheet_submissions;
CREATE TRIGGER trg_guard_timesheet_signature
  BEFORE INSERT OR UPDATE ON public.ticket_timesheet_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_timesheet_signature();

-- 11d. milestones: the assigned consultant may only mark work as submitted; funding,
--      approval and release are controlled by the project's client (or admins).
CREATE OR REPLACE FUNCTION public.guard_milestone_escrow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _is_project_client boolean;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  _is_project_client := EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.client_id = auth.uid()
  );
  IF _is_project_client THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Only the project client can create milestones' USING ERRCODE = '42501';
  END IF;

  IF ROW(NEW.project_id, NEW.title, NEW.description, NEW.amount, NEW.currency, NEW.position,
         NEW.due_date, NEW.funded_at, NEW.approved_at, NEW.released_at)
     IS DISTINCT FROM
     ROW(OLD.project_id, OLD.title, OLD.description, OLD.amount, OLD.currency, OLD.position,
         OLD.due_date, OLD.funded_at, OLD.approved_at, OLD.released_at) THEN
    RAISE EXCEPTION 'Milestone terms and escrow timestamps are controlled by the project client' USING ERRCODE = '42501';
  END IF;
  IF NEW.escrow_status IS DISTINCT FROM OLD.escrow_status
     AND NOT (OLD.escrow_status::text IN ('funded', 'in_progress') AND NEW.escrow_status::text IN ('in_progress', 'submitted')) THEN
    RAISE EXCEPTION 'Consultants can only start or submit a funded milestone' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_milestone_escrow ON public.milestones;
CREATE TRIGGER trg_guard_milestone_escrow
  BEFORE INSERT OR UPDATE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.guard_milestone_escrow();

-- 11e. work logs: a consultant can log time only on tickets assigned to them
DROP POLICY IF EXISTS "Consultants can manage own work logs" ON public.ticket_work_logs;
DROP POLICY IF EXISTS "Consultants manage own work logs on assigned tickets" ON public.ticket_work_logs;
CREATE POLICY "Consultants manage own work logs on assigned tickets"
  ON public.ticket_work_logs FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_work_logs.consultant_id AND c.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_work_logs.consultant_id AND c.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_work_logs.ticket_id AND t.consultant_id = ticket_work_logs.consultant_id)
  );

-- ---------------------------------------------------------------------
-- 12. Trigger functions are never RPC endpoints (run LAST so that the
--     guard/notify functions created above are covered too).
--     EXECUTE on a trigger function is only checked at CREATE TRIGGER time,
--     so this does not affect firing. auth.users triggers are excluded.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prorettype = 'trigger'::regtype
      AND p.proname NOT IN ('handle_new_user', 'process_referral_signup')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END;
$$;