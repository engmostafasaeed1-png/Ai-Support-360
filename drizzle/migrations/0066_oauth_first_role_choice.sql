CREATE OR REPLACE FUNCTION public.choose_first_oauth_role(_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _created timestamptz;
  _provider text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF lower(_role) NOT IN ('client','consultant') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  SELECT created_at, raw_app_meta_data->>'provider' INTO _created, _provider FROM auth.users WHERE id = _uid;
  IF lower(_role) = 'client' THEN RETURN 'client'; END IF;
  -- Only a brand-new social sign-in account that holds nothing but the default client role may switch.
  IF _provider IS NULL OR _provider = 'email' OR _created < now() - interval '1 hour' THEN
    RAISE EXCEPTION 'Role choice is no longer available';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role <> 'client') THEN
    RETURN (SELECT role::text FROM public.user_roles WHERE user_id = _uid AND role <> 'client' LIMIT 1);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id = _uid) THEN
    RAISE EXCEPTION 'Role choice is no longer available';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'client';
  DELETE FROM public.client_profiles WHERE user_id = _uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'consultant') ON CONFLICT DO NOTHING;
  INSERT INTO public.consultants (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;
  RETURN 'consultant';
END;
$$;
REVOKE ALL ON FUNCTION public.choose_first_oauth_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.choose_first_oauth_role(text) TO authenticated;