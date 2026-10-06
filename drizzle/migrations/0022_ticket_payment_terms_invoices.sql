CREATE TABLE public.ticket_payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  term_type text NOT NULL DEFAULT 'due_on_receipt' CHECK (term_type IN ('due_on_receipt','net','deposit','milestones')),
  net_days integer NOT NULL DEFAULT 0 CHECK (net_days IN (0,7,15,30)),
  deposit_percent numeric NOT NULL DEFAULT 0 CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined')),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ticket_payment_terms TO authenticated;
GRANT ALL ON public.ticket_payment_terms TO service_role;
ALTER TABLE public.ticket_payment_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants and admins read payment terms" ON public.ticket_payment_terms FOR SELECT TO authenticated
USING (public.is_ticket_participant(ticket_id) OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.ticket_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  invoice_number text NOT NULL DEFAULT ('INV-' || to_char(now(),'YYMMDD') || '-' || upper(substr(md5(random()::text),1,5))),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  vat_percent numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  timesheet_id uuid,
  note text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','approved','rejected')),
  rejection_reason text,
  payment_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ticket_invoices TO authenticated;
GRANT ALL ON public.ticket_invoices TO service_role;
ALTER TABLE public.ticket_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants and admins read ticket invoices" ON public.ticket_invoices FOR SELECT TO authenticated
USING (client_id = auth.uid() OR public.is_ticket_participant(ticket_id) OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.ticket_consultant_for_me(_ticket_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.consultants c
  WHERE c.user_id = auth.uid() AND (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.consultant_id = c.id)
    OR EXISTS (SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = _ticket_id AND a.consultant_id = c.id AND a.status = 'active'))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.set_ticket_payment_terms(_ticket_id uuid, _term_type text, _net_days integer, _deposit_percent numeric, _milestones jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c uuid := public.ticket_consultant_for_me(_ticket_id); _id uuid; _client uuid; _sum numeric;
BEGIN
  IF _c IS NULL THEN RAISE EXCEPTION 'Only the consultant on this ticket can set payment terms' USING ERRCODE='42501'; END IF;
  IF _term_type NOT IN ('due_on_receipt','net','deposit','milestones') THEN RAISE EXCEPTION 'Unknown payment term' USING ERRCODE='22023'; END IF;
  IF _term_type = 'net' AND COALESCE(_net_days,0) NOT IN (7,15,30) THEN RAISE EXCEPTION 'Choose 7, 15 or 30 days' USING ERRCODE='22023'; END IF;
  IF _term_type = 'deposit' AND (COALESCE(_deposit_percent,0) <= 0 OR _deposit_percent >= 100) THEN RAISE EXCEPTION 'The deposit must be between 1 and 99 percent' USING ERRCODE='22023'; END IF;
  IF _term_type = 'milestones' THEN
    IF jsonb_typeof(_milestones) <> 'array' OR jsonb_array_length(_milestones) < 1 OR jsonb_array_length(_milestones) > 20 THEN RAISE EXCEPTION 'Add between 1 and 20 milestones' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(sum((m->>'percent')::numeric),0) INTO _sum FROM jsonb_array_elements(_milestones) m;
    IF _sum <> 100 THEN RAISE EXCEPTION 'Milestone percentages must add up to 100' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.ticket_payment_terms (ticket_id, consultant_id, term_type, net_days, deposit_percent, milestones, status, decision_note, decided_at)
  VALUES (_ticket_id, _c, _term_type,
    CASE WHEN _term_type='net' THEN _net_days ELSE 0 END,
    CASE WHEN _term_type='deposit' THEN _deposit_percent ELSE 0 END,
    CASE WHEN _term_type='milestones' THEN _milestones ELSE '[]'::jsonb END, 'proposed', NULL, NULL)
  ON CONFLICT (ticket_id) DO UPDATE SET consultant_id=EXCLUDED.consultant_id, term_type=EXCLUDED.term_type, net_days=EXCLUDED.net_days,
    deposit_percent=EXCLUDED.deposit_percent, milestones=EXCLUDED.milestones, status='proposed', decision_note=NULL, decided_at=NULL, updated_at=now()
  RETURNING id INTO _id;
  SELECT client_id INTO _client FROM public.tickets WHERE id=_ticket_id;
  PERFORM public.safe_insert_notification(_client, 'Payment terms proposed', 'Your consultant proposed payment terms for a ticket. Open the ticket to accept or decline.', 'payment', '/client/tickets/' || _ticket_id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.respond_ticket_payment_terms(_ticket_id uuid, _accept boolean, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tickets WHERE id=_ticket_id AND client_id=auth.uid()) THEN RAISE EXCEPTION 'Only the client can respond' USING ERRCODE='42501'; END IF;
  IF NOT _accept AND char_length(btrim(COALESCE(_note,''))) < 3 THEN RAISE EXCEPTION 'Give a reason of at least 3 characters' USING ERRCODE='22023'; END IF;
  UPDATE public.ticket_payment_terms SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END,
    decision_note = left(btrim(COALESCE(_note,'')),500), decided_at=now(), updated_at=now()
  WHERE ticket_id=_ticket_id AND status='proposed';
  IF NOT FOUND THEN RAISE EXCEPTION 'There are no proposed terms to respond to' USING ERRCODE='22023'; END IF;
  SELECT c.user_id INTO _uid FROM public.ticket_payment_terms p JOIN public.consultants c ON c.id=p.consultant_id WHERE p.ticket_id=_ticket_id;
  PERFORM public.safe_insert_notification(_uid, CASE WHEN _accept THEN 'Payment terms accepted' ELSE 'Payment terms declined' END,
    COALESCE(NULLIF(btrim(_note),''),'The client responded to your payment terms.'), 'payment', '/consultant/cases/' || _ticket_id);
END $$;

CREATE OR REPLACE FUNCTION public.send_ticket_invoice(_ticket_id uuid, _lines jsonb, _vat_percent numeric, _currency text, _timesheet_id uuid, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c uuid := public.ticket_consultant_for_me(_ticket_id); _client uuid; _sub numeric; _vat numeric; _id uuid; _cur text := upper(btrim(COALESCE(_currency,'USD')));
BEGIN
  IF _c IS NULL THEN RAISE EXCEPTION 'Only the consultant on this ticket can send an invoice' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) < 1 OR jsonb_array_length(_lines) > 50 THEN RAISE EXCEPTION 'Add between 1 and 50 invoice lines' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) l WHERE char_length(btrim(COALESCE(l->>'description',''))) < 2
     OR (l->>'quantity')::numeric <= 0 OR (l->>'unit_price')::numeric < 0) THEN RAISE EXCEPTION 'Each line needs a description, a quantity above 0 and a price' USING ERRCODE='22023'; END IF;
  IF COALESCE(_vat_percent,0) < 0 OR _vat_percent > 50 THEN RAISE EXCEPTION 'VAT must be between 0 and 50 percent' USING ERRCODE='22023'; END IF;
  IF _cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Invalid currency' USING ERRCODE='22023'; END IF;
  IF _timesheet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ticket_timesheet_submissions s WHERE s.id=_timesheet_id AND s.ticket_id=_ticket_id) THEN RAISE EXCEPTION 'Timesheet not on this ticket' USING ERRCODE='22023'; END IF;
  SELECT round(sum((l->>'quantity')::numeric * (l->>'unit_price')::numeric),2) INTO _sub FROM jsonb_array_elements(_lines) l;
  IF _sub <= 0 OR _sub > 10000000 THEN RAISE EXCEPTION 'The invoice total must be above 0' USING ERRCODE='22023'; END IF;
  _vat := round(_sub * COALESCE(_vat_percent,0) / 100, 2);
  SELECT client_id INTO _client FROM public.tickets WHERE id=_ticket_id;
  INSERT INTO public.ticket_invoices (ticket_id, consultant_id, client_id, lines, subtotal, vat_percent, vat_amount, total, currency, timesheet_id, note)
  VALUES (_ticket_id, _c, _client, _lines, _sub, COALESCE(_vat_percent,0), _vat, _sub + _vat, _cur, _timesheet_id, left(btrim(COALESCE(_note,'')),1000))
  RETURNING id INTO _id;
  PERFORM public.safe_insert_notification(_client, 'Invoice to approve', 'Your consultant sent an invoice of ' || (_sub+_vat)::text || ' ' || _cur || '. Open the ticket to approve or reject it.', 'payment', '/client/tickets/' || _ticket_id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.respond_ticket_invoice(_invoice_id uuid, _approve boolean, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.ticket_invoices; _days integer := 0; _pid uuid; _uid uuid;
BEGIN
  SELECT * INTO _inv FROM public.ticket_invoices WHERE id=_invoice_id FOR UPDATE;
  IF _inv.id IS NULL OR _inv.client_id <> auth.uid() THEN RAISE EXCEPTION 'Only the client can respond to this invoice' USING ERRCODE='42501'; END IF;
  IF _inv.status <> 'sent' THEN RAISE EXCEPTION 'This invoice was already answered' USING ERRCODE='22023'; END IF;
  SELECT user_id INTO _uid FROM public.consultants WHERE id=_inv.consultant_id;
  IF NOT _approve THEN
    IF char_length(btrim(COALESCE(_reason,''))) < 3 THEN RAISE EXCEPTION 'Give a reason of at least 3 characters' USING ERRCODE='22023'; END IF;
    UPDATE public.ticket_invoices SET status='rejected', rejection_reason=left(btrim(_reason),1000), decided_at=now(), updated_at=now() WHERE id=_invoice_id;
    PERFORM public.safe_insert_notification(_uid, 'Invoice rejected', 'Invoice ' || _inv.invoice_number || ' was rejected: ' || left(btrim(_reason),200), 'payment', '/consultant/cases/' || _inv.ticket_id);
    RETURN NULL;
  END IF;
  SELECT CASE WHEN term_type='net' THEN net_days ELSE 0 END INTO _days FROM public.ticket_payment_terms WHERE ticket_id=_inv.ticket_id AND status='accepted';
  INSERT INTO public.payments (client_id, consultant_id, ticket_id, amount, vat_amount, currency, status, kind, description, due_date, payment_method, invoice_number, timesheet_id)
  VALUES (_inv.client_id, _inv.consultant_id, _inv.ticket_id, _inv.total, _inv.vat_amount, _inv.currency, 'pending', 'invoice',
    left('Invoice ' || _inv.invoice_number || COALESCE(' — ' || NULLIF(_inv.note,''),''),300), now() + make_interval(days => COALESCE(_days,0)), 'bank_transfer', _inv.invoice_number, _inv.timesheet_id)
  RETURNING id INTO _pid;
  UPDATE public.ticket_invoices SET status='approved', payment_id=_pid, decided_at=now(), updated_at=now() WHERE id=_invoice_id;
  PERFORM public.safe_insert_notification(_uid, 'Invoice approved', 'Invoice ' || _inv.invoice_number || ' was approved and is now awaiting payment.', 'payment', '/consultant/cases/' || _inv.ticket_id);
  RETURN _pid;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_ticket_payment_terms(uuid,text,integer,numeric,jsonb), public.respond_ticket_payment_terms(uuid,boolean,text),
  public.send_ticket_invoice(uuid,jsonb,numeric,text,uuid,text), public.respond_ticket_invoice(uuid,boolean,text), public.ticket_consultant_for_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ticket_payment_terms(uuid,text,integer,numeric,jsonb), public.respond_ticket_payment_terms(uuid,boolean,text),
  public.send_ticket_invoice(uuid,jsonb,numeric,text,uuid,text), public.respond_ticket_invoice(uuid,boolean,text), public.ticket_consultant_for_me(uuid) TO authenticated;