-- Refer & earn invitation + referral event notices: contents of docs/sql/referral-invitations.sql (see that file for the full commented version).
INSERT INTO public.platform_settings (key, value) VALUES
  ('referral_invitations_enabled', 'false'::jsonb),
  ('referral_invitation_version', '1'::jsonb),
  ('referral_invitation_max_recipients', '500'::jsonb),
  ('referral_invitation_resend_days', '14'::jsonb),
  ('referral_email_example_fee', '1000'::jsonb),
  ('referral_email_example_currency', '"USD"'::jsonb),
  ('referral_terms_draft', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
