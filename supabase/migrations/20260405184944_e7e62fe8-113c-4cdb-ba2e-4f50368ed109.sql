
CREATE OR REPLACE FUNCTION public.notify_payment_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consultant_user_id uuid;
BEGIN
  -- Only fire when status changes to completed
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    -- Notify the client
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Payment Confirmed',
      'Your payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || ' has been completed.',
      'payment',
      '/client/payments'
    );

    -- Look up the consultant's user_id
    SELECT user_id INTO _consultant_user_id
    FROM public.consultants
    WHERE id = NEW.consultant_id;

    IF _consultant_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link)
      VALUES (
        _consultant_user_id,
        'Payment Received',
        'You received a payment of ' || NEW.amount || ' ' || COALESCE(NEW.currency, 'USD') || '.',
        'payment',
        '/consultant/earnings'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_payment_completed_notify
AFTER UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.notify_payment_completed();
