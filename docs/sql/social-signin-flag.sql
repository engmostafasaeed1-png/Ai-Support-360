-- Social sign-in settings (prepared only; apply when ready).
-- social_login_providers: providers on /login for returning users (default Google).
-- social_signup_enabled: offers them on sign-up screens too (default off).
-- Until this is applied, visitors cannot read the settings and the app uses the defaults above.

INSERT INTO public.platform_settings (key, value) VALUES
  ('social_signup_enabled', 'false'::jsonb),
  ('social_login_providers', '["google"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can read social sign-in switches" ON public.platform_settings;
DROP POLICY IF EXISTS "Anyone can read social sign-in settings" ON public.platform_settings;
CREATE POLICY "Anyone can read social sign-in settings"
  ON public.platform_settings
  FOR SELECT
  TO anon, authenticated
  USING (key IN ('social_signup_enabled', 'social_login_providers'));
