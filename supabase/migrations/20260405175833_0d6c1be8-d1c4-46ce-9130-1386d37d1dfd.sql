
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role text;
BEGIN
  -- Create base profile
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));

  -- Get role from signup metadata
  _role := COALESCE(NEW.raw_user_meta_data->>'role', 'client');

  -- Create user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Create role-specific profile
  IF _role = 'consultant' THEN
    INSERT INTO public.consultants (user_id)
    VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.client_profiles (user_id)
    VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
