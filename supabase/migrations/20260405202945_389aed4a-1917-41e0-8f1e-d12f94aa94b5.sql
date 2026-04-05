
CREATE POLICY "Anyone can read nda_template"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (key = 'nda_template');
