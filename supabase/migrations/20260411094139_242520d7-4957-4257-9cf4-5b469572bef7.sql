
-- VMware Pricing Plans
CREATE TABLE public.vmware_pricing_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tier TEXT NOT NULL DEFAULT 'basic', -- basic, pro, enterprise
  hourly_rate NUMERIC(10,4) DEFAULT 0,
  monthly_rate NUMERIC(10,2) DEFAULT 0,
  cpu_price_per_core NUMERIC(10,4) DEFAULT 0,
  ram_price_per_gb NUMERIC(10,4) DEFAULT 0,
  disk_price_per_gb NUMERIC(10,4) DEFAULT 0,
  included_cpu INTEGER DEFAULT 2,
  included_ram_gb INTEGER DEFAULT 4,
  included_disk_gb INTEGER DEFAULT 50,
  features JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vmware_pricing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view active plans"
  ON public.vmware_pricing_plans FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage plans"
  ON public.vmware_pricing_plans FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- VMware Subscriptions
CREATE TABLE public.vmware_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES public.vmware_pricing_plans(id),
  environment_id UUID REFERENCES public.remote_environments(id),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly', -- hourly, monthly, yearly
  status TEXT NOT NULL DEFAULT 'active', -- active, suspended, cancelled, expired
  current_monthly_cost NUMERIC(10,2) DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vmware_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own subscriptions"
  ON public.vmware_subscriptions FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

CREATE POLICY "Admins can manage all subscriptions"
  ON public.vmware_subscriptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- VMware Snapshots
CREATE TABLE public.vmware_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  environment_id UUID NOT NULL REFERENCES public.remote_environments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  size_gb NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'active', -- active, creating, restoring, deleting, failed
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vmware_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view snapshots"
  ON public.vmware_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create snapshots"
  ON public.vmware_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can delete own snapshots"
  ON public.vmware_snapshots FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- VMware VM Actions log
CREATE TABLE public.vmware_vm_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  environment_id UUID NOT NULL REFERENCES public.remote_environments(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- start, stop, restart, suspend
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, failed
  initiated_by UUID NOT NULL,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vmware_vm_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view actions"
  ON public.vmware_vm_actions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create actions"
  ON public.vmware_vm_actions FOR INSERT
  TO authenticated
  WITH CHECK (initiated_by = auth.uid());

-- Triggers for updated_at
CREATE TRIGGER update_vmware_pricing_plans_updated_at
  BEFORE UPDATE ON public.vmware_pricing_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vmware_subscriptions_updated_at
  BEFORE UPDATE ON public.vmware_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
