-- Client-cycle hardening M13 (company invitations; follow-up to M12 and finding F17):
-- an owner or administrator of a company can invite a person by e-mail address. The invitation is a pending membership
-- (accepted_at stays empty until the invited person accepts it on the Companies page, see my_company_invitations / respond_to_company_invitation).
-- The answer is the same whether or not that e-mail address has an account, so the function cannot be used to find out who is registered.
-- At most 20 invitations per hour per person.
CREATE FUNCTION public.invite_to_company(_tenant_id uuid, _email text, _role org_role DEFAULT 'member')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _clean text := lower(btrim(COALESCE(_email, '')));
  _uid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_org_role(auth.uid(), _tenant_id, 'owner'::org_role) OR public.has_org_role(auth.uid(), _tenant_id, 'admin'::org_role)) THEN
    RAISE EXCEPTION 'Only a company owner or administrator can invite people' USING ERRCODE = '42501';
  END IF;
  IF _role IS NULL OR _role::text NOT IN ('admin', 'manager', 'member') THEN
    RAISE EXCEPTION 'An invited person can only be an admin, manager or member' USING ERRCODE = '22023';
  END IF;
  IF length(_clean) < 5 OR length(_clean) > 254 OR _clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid e-mail address' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('company-invite:' || auth.uid()::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many invitations in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  SELECT u.id INTO _uid FROM auth.users u WHERE lower(u.email) = _clean LIMIT 1;
  IF _uid IS NULL OR _uid = auth.uid() THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _tenant_id AND m.user_id = _uid) THEN
    RETURN;
  END IF;
  INSERT INTO public.tenant_members (tenant_id, user_id, org_role, invited_by, accepted_at)
  VALUES (_tenant_id, _uid, _role, auth.uid(), NULL);
  PERFORM public.safe_insert_notification(_uid, 'Company invitation',
    'You have a new company invitation. Open Companies to review it.', 'company', '/client/companies');
END;
$function$;
REVOKE ALL ON FUNCTION public.invite_to_company(uuid, text, org_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_company(uuid, text, org_role) TO authenticated;