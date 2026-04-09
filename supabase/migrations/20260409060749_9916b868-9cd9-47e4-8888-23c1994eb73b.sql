
INSERT INTO public.user_roles (user_id, role)
SELECT id, (raw_user_meta_data->>'role')::app_role
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_roles)
  AND raw_user_meta_data->>'role' IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;
