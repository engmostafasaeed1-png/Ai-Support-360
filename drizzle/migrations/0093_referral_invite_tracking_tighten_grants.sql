REVOKE ALL ON public.referral_invitation_clicks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.referral_invitation_clicks FROM authenticated;
GRANT SELECT ON public.referral_invitation_clicks TO authenticated;