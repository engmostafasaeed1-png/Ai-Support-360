
CREATE POLICY "Anyone can read maintenance_mode"
  ON public.platform_settings FOR SELECT
  TO anon, authenticated
  USING (key = 'maintenance_mode');
