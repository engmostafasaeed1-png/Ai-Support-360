-- M33: an honest admin console.
-- 1) the Data Access Policies and File Storage sections show what is really in the database (they were typed lists)
-- 2) the "Open Registration" switch really closes sign-up: it was saved but nothing read it.
--    The stored value was OFF although sign-up has always been open, so it is set to ON here to keep today's behaviour.

-- 1a) tables, whether row-level security is on and how many policies each has
CREATE OR REPLACE FUNCTION public.admin_rls_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'table', c.relname,
        'rls_enabled', c.relrowsecurity,
        'policies', (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
      ) ORDER BY c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ), '[]'::jsonb);
END;
$fn$;

-- 1b) storage buckets with their size limit, number of files and total size
CREATE OR REPLACE FUNCTION public.admin_storage_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'public', b.public,
        'file_size_limit', b.file_size_limit,
        'objects', (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = b.id),
        'bytes', (SELECT COALESCE(sum(CASE WHEN (o.metadata ->> 'size') ~ '^[0-9]+$' THEN (o.metadata ->> 'size')::bigint ELSE 0 END), 0)
                    FROM storage.objects o WHERE o.bucket_id = b.id)
      ) ORDER BY b.name)
    FROM storage.buckets b
  ), '[]'::jsonb);
END;
$fn$;

-- 2a) is sign-up open? (missing or any value other than false means open); the sign-up page asks this before it shows the form
CREATE OR REPLACE FUNCTION public.registration_is_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE((SELECT NOT (ps.value IN ('false'::jsonb, '"false"'::jsonb))
                     FROM public.platform_settings ps WHERE ps.key = 'open_registration' LIMIT 1), true)
$fn$;

-- 2b) when it is closed, no new account can be created (e-mail sign-up and Google alike)
CREATE OR REPLACE FUNCTION public.block_signup_when_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.registration_is_open() THEN
    RAISE EXCEPTION 'Registration is closed at the moment' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_block_signup_when_closed
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_signup_when_closed();

-- 2c) keep today's behaviour: sign-up is open
INSERT INTO public.platform_settings (key, value)
VALUES ('open_registration', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb;

-- 3) who may call what
REVOKE ALL ON FUNCTION public.admin_rls_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_storage_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rls_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_storage_overview() TO authenticated;
REVOKE ALL ON FUNCTION public.registration_is_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_is_open() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.block_signup_when_closed() FROM PUBLIC, anon, authenticated;