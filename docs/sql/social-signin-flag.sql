-- Social sign-in switches (prepared only; apply when ready).
-- Until this is applied, visitors cannot read the switches, so the sign-in pages show no social buttons
-- (the app fails closed). After applying, the admin toggle in Platform Settings controls them.

INSERT INTO public.platform_settings (key, value) VALUES
  ('social_signin_enabled', 'false'::jsonb),
  ('social_signin_google', 'false'::jsonb),
  ('social_signin_apple', 'false'::jsonb),
  ('social_signin_microsoft', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can read social sign-in switches" ON public.platform_settings;
CREATE POLICY "Anyone can read social sign-in switches"
  ON public.platform_settings
  FOR SELECT
  TO anon, authenticated
  USING (key IN ('social_signin_enabled', 'social_signin_google', 'social_signin_apple', 'social_signin_microsoft'));
