-- M32: VMware pricing is edited by administrators in the admin console.
-- - a free plan on Oracle Cloud's Always Free tier and a pay-as-you-go plan live in the same table as the paid plans
--   (the rates are no longer typed into the client page)
-- - a client cannot insert a subscription (no policy allows it, which is right): the client asks for a plan with
--   request_vmware_plan(), an administrator activates or rejects it, and the client is told

-- 1) plan fields and sanity checks
ALTER TABLE public.vmware_pricing_plans
  ADD COLUMN provider_name text,
  ADD COLUMN external_url text;

ALTER TABLE public.vmware_pricing_plans
  ADD CONSTRAINT vmware_pricing_plans_tier_check
    CHECK (tier IN ('free', 'basic', 'pro', 'enterprise', 'payg')),
  ADD CONSTRAINT vmware_pricing_plans_non_negative
    CHECK (hourly_rate >= 0 AND monthly_rate >= 0 AND cpu_price_per_core >= 0 AND ram_price_per_gb >= 0 AND disk_price_per_gb >= 0
           AND included_cpu >= 0 AND included_ram_gb >= 0 AND included_disk_gb >= 0),
  ADD CONSTRAINT vmware_pricing_plans_text_lengths
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80
           AND (description IS NULL OR char_length(description) <= 500)
           AND (provider_name IS NULL OR char_length(provider_name) <= 80)),
  ADD CONSTRAINT vmware_pricing_plans_url_check
    CHECK (external_url IS NULL OR (char_length(external_url) <= 500 AND external_url ~* '^https?://[^[:space:]<>"''`]+$'));

-- 2) the free plan (Oracle Cloud Free Tier) and the pay-as-you-go plan; administrators can edit both
INSERT INTO public.vmware_pricing_plans
  (name, description, tier, hourly_rate, monthly_rate, cpu_price_per_core, ram_price_per_gb, disk_price_per_gb,
   included_cpu, included_ram_gb, included_disk_gb, features, is_active, sort_order, provider_name, external_url)
SELECT 'Free sandbox (Oracle Cloud Free Tier)',
       'A free practice server on Oracle Cloud''s Always Free tier. Oracle sets the free limits and can change them.',
       'free', 0, 0, 0, 0, 0, 2, 12, 200,
       '["Up to 2 Arm (Ampere A1) OCPUs and 12 GB RAM in total","Or up to 2 small AMD VMs with 1 GB RAM each","Up to 200 GB block storage, shared","No charge from us: Oracle''s free limits apply","You need your own Oracle Cloud account"]'::jsonb,
       true, 0, 'Oracle Cloud Free Tier', 'https://www.oracle.com/cloud/free/'
WHERE NOT EXISTS (SELECT 1 FROM public.vmware_pricing_plans WHERE tier = 'free');

INSERT INTO public.vmware_pricing_plans
  (name, description, tier, hourly_rate, monthly_rate, cpu_price_per_core, ram_price_per_gb, disk_price_per_gb,
   included_cpu, included_ram_gb, included_disk_gb, features, is_active, sort_order)
SELECT 'Pay as you go',
       'No monthly fee: you pay only for the resources you use.',
       'payg', 0, 0, 0.05, 0.01, 0.0005, 0, 0, 0,
       '["No minimum spend or lock-in","Billed per second, invoiced monthly","Resources can be scaled up or down","Usage dashboard"]'::jsonb,
       true, 100
WHERE NOT EXISTS (SELECT 1 FROM public.vmware_pricing_plans WHERE tier = 'payg');

-- 3) one open request or subscription per client and plan
CREATE UNIQUE INDEX vmware_subscriptions_one_open_per_plan
  ON public.vmware_subscriptions (client_id, plan_id) WHERE status IN ('requested', 'active');

-- 4) a client asks for a plan
CREATE OR REPLACE FUNCTION public.request_vmware_plan(p_plan_id uuid, p_billing_cycle text DEFAULT 'monthly')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _plan public.vmware_pricing_plans%ROWTYPE;
  _cycle text := lower(COALESCE(p_billing_cycle, 'monthly'));
  _id uuid;
  _name text;
  _admin uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _cycle NOT IN ('monthly', 'hourly', 'payg') THEN
    RAISE EXCEPTION 'Unknown billing cycle' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('vmware-plan-request:' || _uid::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many requests, please try again later' USING ERRCODE = '54000';
  END IF;
  SELECT * INTO _plan FROM public.vmware_pricing_plans WHERE id = p_plan_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This plan is not available' USING ERRCODE = 'P0002';
  END IF;
  IF _plan.tier = 'payg' THEN
    _cycle := 'payg';
  ELSIF _plan.tier = 'free' THEN
    _cycle := 'monthly';
  ELSIF _cycle = 'payg' THEN
    RAISE EXCEPTION 'Choose monthly or hourly billing for this plan' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vmware_subscriptions s
              WHERE s.client_id = _uid AND s.plan_id = p_plan_id AND s.status IN ('requested', 'active')) THEN
    RAISE EXCEPTION 'You already have this plan or have asked for it' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vmware_subscriptions (client_id, plan_id, billing_cycle, status, current_monthly_cost)
  VALUES (_uid, p_plan_id, _cycle, 'requested', CASE WHEN _cycle = 'monthly' THEN _plan.monthly_rate ELSE 0 END)
  RETURNING id INTO _id;

  BEGIN
    _name := left(COALESCE(NULLIF(btrim((SELECT p.display_name FROM public.profiles p WHERE p.user_id = _uid LIMIT 1)), ''), 'A client'), 120);
    FOR _admin IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin', 'super_admin') AND ur.user_id <> _uid
    LOOP
      PERFORM public.safe_insert_notification(
        _admin,
        'A client asked for a VMware plan',
        _name || ' asked for the plan "' || left(_plan.name, 80) || '". Open VMware Pricing in the admin console to activate it.',
        'vmware',
        '/admin/console/vmware-pricing'
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'request_vmware_plan notice: %', SQLERRM;
  END;

  RETURN _id;
END;
$fn$;

-- 5) when an administrator changes the status, the dates are set and the client is told
CREATE OR REPLACE FUNCTION public.vmware_subscription_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _plan text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT p.name INTO _plan FROM public.vmware_pricing_plans p WHERE p.id = NEW.plan_id;
  IF NEW.status = 'active' THEN
    NEW.started_at := now();
    NEW.cancelled_at := NULL;
    PERFORM public.safe_insert_notification(NEW.client_id, 'Your VMware plan is active',
      COALESCE(_plan, 'Your plan') || ' is active. We will contact you with the access details.', 'vmware', '/client/vmware-pricing');
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    NEW.cancelled_at := now();
    PERFORM public.safe_insert_notification(NEW.client_id,
      CASE WHEN NEW.status = 'rejected' THEN 'Your VMware plan request was not accepted' ELSE 'Your VMware plan was cancelled' END,
      COALESCE(_plan, 'The plan') || '. Contact support if you have questions.', 'vmware', '/client/vmware-pricing');
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_vmware_subscription_status
  BEFORE UPDATE OF status ON public.vmware_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.vmware_subscription_status_changed();

-- 6) price and plan changes are written to the audit log
CREATE TRIGGER audit_vmware_pricing_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.vmware_pricing_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();
CREATE TRIGGER audit_vmware_subscriptions
  AFTER INSERT OR UPDATE OR DELETE ON public.vmware_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

-- 7) who may call what
REVOKE ALL ON FUNCTION public.request_vmware_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_vmware_plan(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.vmware_subscription_status_changed() FROM PUBLIC, anon, authenticated;