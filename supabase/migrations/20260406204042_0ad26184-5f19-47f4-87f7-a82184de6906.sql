
-- 1. Subscription tier enum
CREATE TYPE public.subscription_tier AS ENUM ('basic', 'professional', 'enterprise');
CREATE TYPE public.subscription_status AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'inactive');
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'manager', 'member');

-- 2. Tenants table
CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  domain text,
  subscription_tier subscription_tier NOT NULL DEFAULT 'basic',
  subscription_status subscription_status NOT NULL DEFAULT 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  max_users integer NOT NULL DEFAULT 5,
  max_tickets_per_month integer NOT NULL DEFAULT 10,
  max_sessions_per_month integer NOT NULL DEFAULT 5,
  ai_quota integer NOT NULL DEFAULT 50,
  trial_ends_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 3. Tenant members table
CREATE TABLE public.tenant_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  org_role org_role NOT NULL DEFAULT 'member',
  invited_by uuid,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

-- 4. Subscription plans reference table
CREATE TABLE public.subscription_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  tier subscription_tier NOT NULL UNIQUE,
  price_monthly numeric NOT NULL DEFAULT 0,
  price_yearly numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- 5. Security definer function to get current user's tenant_id
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() LIMIT 1
$$;

-- 6. Security definer function to check org role
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _tenant_id uuid, _role org_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND org_role = _role
  )
$$;

-- 7. Check if user belongs to tenant
CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id AND tenant_id = _tenant_id
  )
$$;

-- 8. Add tenant_id to key tables
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.knowledge_articles ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.knowledge_solutions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.remote_environments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

-- 9. Indexes for tenant_id queries
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON public.tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON public.sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON public.projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON public.payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON public.notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON public.tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON public.tenant_members(tenant_id);

-- 10. RLS policies for tenants
CREATE POLICY "Members can view own tenant"
  ON public.tenants FOR SELECT
  USING (public.is_tenant_member(auth.uid(), id));

CREATE POLICY "Owners and admins can update tenant"
  ON public.tenants FOR UPDATE
  USING (
    public.has_org_role(auth.uid(), id, 'owner') OR
    public.has_org_role(auth.uid(), id, 'admin')
  );

CREATE POLICY "Authenticated users can create tenants"
  ON public.tenants FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Super admins can view all tenants"
  ON public.tenants FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- 11. RLS policies for tenant_members
CREATE POLICY "Members can view co-members"
  ON public.tenant_members FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "Owners and admins can manage members"
  ON public.tenant_members FOR ALL
  USING (
    public.has_org_role(auth.uid(), tenant_id, 'owner') OR
    public.has_org_role(auth.uid(), tenant_id, 'admin')
  );

CREATE POLICY "Users can insert themselves as owner of new tenant"
  ON public.tenant_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Super admins can view all members"
  ON public.tenant_members FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- 12. RLS policies for subscription_plans (public read)
CREATE POLICY "Anyone can view active plans"
  ON public.subscription_plans FOR SELECT
  USING (is_active = true);

CREATE POLICY "Super admins can manage plans"
  ON public.subscription_plans FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- 13. Trigger for updated_at on tenants
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 14. Seed subscription plans
INSERT INTO public.subscription_plans (name, tier, price_monthly, price_yearly, currency, features, limits) VALUES
  ('Basic', 'basic', 49, 470, 'USD',
   '["Email support", "Basic ticket management", "Up to 5 users"]'::jsonb,
   '{"max_users": 5, "max_tickets_per_month": 10, "max_sessions_per_month": 5, "ai_quota": 0}'::jsonb),
  ('Professional', 'professional', 149, 1430, 'USD',
   '["AI-powered support", "Consultant matching", "Integrations", "Up to 25 users", "KPI reports"]'::jsonb,
   '{"max_users": 25, "max_tickets_per_month": 50, "max_sessions_per_month": 25, "ai_quota": 500}'::jsonb),
  ('Enterprise', 'enterprise', 499, 4790, 'USD',
   '["Dedicated support", "SLA guarantees", "Custom integrations", "Unlimited users", "Full AI access", "Remote environments"]'::jsonb,
   '{"max_users": -1, "max_tickets_per_month": -1, "max_sessions_per_month": -1, "ai_quota": -1}'::jsonb);
