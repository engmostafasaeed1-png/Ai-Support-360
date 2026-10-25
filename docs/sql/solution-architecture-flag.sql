-- Owner switch "solution_architecture_visible" (prepared only; apply when ready).
-- Hides the client page /client/solution-architecture (menus, search, direct links) while false.
-- Without this file the page is already hidden for clients (they cannot read the setting, which counts as off);
-- administrators can switch it in Admin settings > General. Applying it adds the default row and lets signed-in
-- users read this one key, so switching it on shows the page to clients without a deploy.

INSERT INTO public.platform_settings (key, value) VALUES ('solution_architecture_visible', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Signed-in users can read solution_architecture_visible" ON public.platform_settings;
CREATE POLICY "Signed-in users can read solution_architecture_visible"
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (key = 'solution_architecture_visible');
