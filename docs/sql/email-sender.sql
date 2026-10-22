-- E-mail sender identity (display name, From, Reply-To, footer contact) as admin settings + the locked switch for
-- platform e-mails to people who are NOT registered.
-- PREPARED ONLY - NOT APPLIED. Safe to run twice. Until it is applied the functions use the built-in defaults
-- ("AI Support 360" <noreply@aisupport360.com>, Reply-To and contact info@aisupport360.com) - mirror: _shared/emailSender.ts.
--
-- * From may only be an address on the verified sending domain aisupport360.com (delivered via the verified, managed
--   notify.aisupport360.com; SPF/DKIM are handled there). Reply-To and contact must be on our own domain.
-- * referral_invites_to_non_users_enabled is seeded OFF and cannot be switched on here: platform e-mails to people who are
--   not registered need the owner's explicit approval, a dedicated marketing e-mail service with consent records and
--   unsubscribe (see docs/referral-email-sending.md). Consultants share from their own mailbox / apps instead.

INSERT INTO public.platform_settings (key, value) VALUES
  ('email_sender_display_name', '"AI Support 360"'::jsonb),
  ('email_sender_from', '"noreply@aisupport360.com"'::jsonb),
  ('email_reply_to', '"info@aisupport360.com"'::jsonb),
  ('email_contact_address', '"info@aisupport360.com"'::jsonb),
  ('referral_invites_to_non_users_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.email_sender_problems(_name text, _from text, _reply text, _contact text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN _name IS NOT NULL AND btrim(_name) !~ '^[[:alnum:] &.''()-]{1,60}$' THEN 'display_name' END,
    CASE WHEN _from IS NOT NULL AND lower(btrim(_from)) !~ '^[a-z0-9]([a-z0-9._-]{0,38}[a-z0-9])?@([a-z0-9-]+\.)+[a-z]{2,}$' THEN 'from_format'
         WHEN _from IS NOT NULL AND split_part(lower(btrim(_from)), '@', 2) <> 'aisupport360.com' THEN 'from_domain_not_verified' END,
    CASE WHEN _reply IS NOT NULL AND lower(btrim(_reply)) !~ '^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?@aisupport360\.com$' THEN 'reply_to' END,
    CASE WHEN _contact IS NOT NULL AND lower(btrim(_contact)) !~ '^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?@aisupport360\.com$' THEN 'contact' END
  ], NULL)
$$;

CREATE OR REPLACE FUNCTION public.admin_email_sender_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Only administrators can read these settings' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'display_name', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'email_sender_display_name'), 'AI Support 360'),
    'from', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'email_sender_from'), 'noreply@aisupport360.com'),
    'reply_to', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'email_reply_to'), 'info@aisupport360.com'),
    'contact', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'email_contact_address'), 'info@aisupport360.com'),
    'verified_from_domain', 'aisupport360.com',
    'sending_domain', 'notify.aisupport360.com',
    'non_users_enabled', public.platform_flag('referral_invites_to_non_users_enabled', false),
    'can_edit', public.has_role(auth.uid(), 'super_admin'));
END $$;
REVOKE ALL ON FUNCTION public.admin_email_sender_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_sender_settings() TO authenticated;

-- Super admins only; validated like _shared/emailSender.ts; audited. The non-user switch can never be turned on here.
CREATE OR REPLACE FUNCTION public.admin_set_email_sender_settings(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _before jsonb; _bad text[];
BEGIN
  IF _me IS NULL OR NOT public.has_role(_me, 'super_admin') THEN RAISE EXCEPTION 'Only super admins can change the e-mail sender' USING ERRCODE = '42501'; END IF;
  IF COALESCE((_payload ->> 'non_users_enabled')::boolean, false) THEN
    RAISE EXCEPTION 'E-mails to people who are not registered need the owner''s approval and a dedicated marketing e-mail service' USING ERRCODE = '42501';
  END IF;
  _bad := public.email_sender_problems(_payload ->> 'display_name', _payload ->> 'from', _payload ->> 'reply_to', _payload ->> 'contact');
  IF cardinality(_bad) > 0 THEN
    RAISE EXCEPTION 'Invalid e-mail sender settings: %', array_to_string(_bad, ', ') USING ERRCODE = '22023';
  END IF;
  _before := public.admin_email_sender_settings();
  INSERT INTO public.platform_settings (key, value)
  SELECT k, to_jsonb(lower(btrim(v))) FROM (VALUES ('email_sender_from', _payload ->> 'from'), ('email_reply_to', _payload ->> 'reply_to'),
                                               ('email_contact_address', _payload ->> 'contact')) x(k, v) WHERE v IS NOT NULL
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  IF _payload ? 'display_name' THEN
    INSERT INTO public.platform_settings (key, value) VALUES ('email_sender_display_name', to_jsonb(btrim(_payload ->> 'display_name')))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, metadata)
  VALUES (_me, 'email_sender_settings', 'platform_settings', jsonb_build_object('before', _before, 'after', public.admin_email_sender_settings()));
  RETURN public.admin_email_sender_settings();
END $$;
REVOKE ALL ON FUNCTION public.admin_set_email_sender_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_email_sender_settings(jsonb) TO authenticated;
