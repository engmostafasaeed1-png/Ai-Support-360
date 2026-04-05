
CREATE OR REPLACE FUNCTION public.notify_nda_signed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consultant_name text;
BEGIN
  -- Look up consultant display name
  SELECT p.display_name INTO _consultant_name
  FROM public.consultants c
  JOIN public.profiles p ON p.user_id = c.user_id
  WHERE c.id = NEW.consultant_id;

  -- Notify the client
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (
    NEW.client_id,
    'NDA Signed by Consultant',
    'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" has signed a Non-Disclosure Agreement for your account.',
    'nda',
    '/client/tickets'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_nda_signed
  AFTER INSERT ON public.nda_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_nda_signed();
