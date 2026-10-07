ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS rate_discount_percent numeric NOT NULL DEFAULT 0 CHECK (rate_discount_percent >= 0 AND rate_discount_percent <= 100),
  ADD COLUMN IF NOT EXISTS tickets_roll_over boolean NOT NULL DEFAULT false;
GRANT SELECT ON public.subscription_plans TO anon, authenticated;