-- M45: a payment (invoice) and the notices about it belong to the company of the ticket

-- 1) A payment of a ticket gets the company of that ticket (the three functions that write invoices do not set it).
CREATE OR REPLACE FUNCTION public.payments_default_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.ticket_id IS NOT NULL THEN
    SELECT t.tenant_id INTO NEW.tenant_id FROM public.tickets t WHERE t.id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.payments_default_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payments_default_tenant ON public.payments;
CREATE TRIGGER trg_payments_default_tenant
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_default_tenant();

-- 2) Existing payments get the company of their ticket.
UPDATE public.payments p
   SET tenant_id = t.tenant_id
  FROM public.tickets t
 WHERE p.ticket_id = t.id AND p.tenant_id IS NULL AND t.tenant_id IS NOT NULL;

-- 3) A notice about a payment carries the company of the payment that is written in the same transaction
--    (the invoice is written first, then the notice); everything else stays as it was.
CREATE OR REPLACE FUNCTION public.default_notification_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.link IS NOT NULL THEN
    BEGIN
      _id := substring(NEW.link from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid;
    EXCEPTION WHEN others THEN
      _id := NULL;
    END;
    IF _id IS NOT NULL THEN
      SELECT t.tenant_id INTO NEW.tenant_id FROM public.tickets t WHERE t.id = _id;
      IF NEW.tenant_id IS NULL THEN
        SELECT s.tenant_id INTO NEW.tenant_id FROM public.sessions s WHERE s.id = _id;
      END IF;
    END IF;
  END IF;
  IF NEW.tenant_id IS NULL AND NEW.type = 'payment' THEN
    SELECT p.tenant_id INTO NEW.tenant_id
      FROM public.payments p
     WHERE p.created_at = now() AND p.tenant_id IS NOT NULL
       AND (p.client_id = NEW.user_id
            OR p.consultant_id IN (SELECT c.id FROM public.consultants c WHERE c.user_id = NEW.user_id))
     ORDER BY p.created_at DESC
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) Existing payment notices get the company of their payment (written at the same moment, or naming the invoice number).
UPDATE public.notifications n
   SET tenant_id = p.tenant_id
  FROM public.payments p
 WHERE n.tenant_id IS NULL AND n.type = 'payment' AND p.tenant_id IS NOT NULL
   AND (p.client_id = n.user_id OR p.consultant_id IN (SELECT c.id FROM public.consultants c WHERE c.user_id = n.user_id))
   AND (n.created_at = p.created_at OR position(COALESCE(p.invoice_number, '#none#') IN COALESCE(n.body, '')) > 0);