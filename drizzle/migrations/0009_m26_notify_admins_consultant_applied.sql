-- M26 (new consultant applications): when a consultant finishes the profile setup (profiles.onboarding_completed turns true), every administrator gets a notice
-- in the bell with a link to the approvals page. Until now nobody was told: an application waited until an administrator happened to open the approvals page.
-- Nothing is deleted or rewritten. A failure to write a notice never stops the consultant's own save (the error is only logged as a warning).

CREATE OR REPLACE FUNCTION public.notify_admins_consultant_applied()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _name text;
  _admin uuid;
BEGIN
  -- only a consultant whose application is not decided yet (a user with a consultants row that is pending, under review or on hold)
  IF NOT EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.user_id = NEW.user_id AND c.verification_status IN ('pending', 'under_review', 'on_hold')
  ) THEN
    RETURN NEW;
  END IF;

  _name := left(COALESCE(NULLIF(btrim(NEW.display_name), ''), 'Someone'), 120);

  -- every administrator except the applicant (an administrator who is also a consultant does not need a notice about their own application)
  FOR _admin IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    WHERE ur.role IN ('admin', 'super_admin') AND ur.user_id <> NEW.user_id
  LOOP
    PERFORM public.safe_insert_notification(
      _admin,
      'A consultant is waiting for review',
      _name || ' applied as a consultant. Open the approvals page to review the profile.',
      'approval',
      '/admin/approvals'
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_consultant_applied: %', SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_notify_admins_consultant_applied
  AFTER UPDATE OF onboarding_completed ON public.profiles
  FOR EACH ROW
  WHEN (NEW.onboarding_completed IS TRUE AND OLD.onboarding_completed IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION public.notify_admins_consultant_applied();