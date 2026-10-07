CREATE TABLE public.client_plan_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  tickets_per_month integer NOT NULL CHECK (tickets_per_month > 0),
  base_monthly_price numeric NOT NULL,
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  discount_amount numeric NOT NULL DEFAULT 0,
  final_monthly_price numeric NOT NULL,
  free_until timestamptz,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.client_plan_subscriptions TO authenticated;
GRANT ALL ON public.client_plan_subscriptions TO service_role;
ALTER TABLE public.client_plan_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients see own plan subscriptions" ON public.client_plan_subscriptions FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Price quote: ticket range price for the month, then voucher. Does not consume the voucher.
CREATE OR REPLACE FUNCTION public.quote_plan_price(_plan_id uuid, _tickets integer, _voucher_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v record; t jsonb; base numeric; disc numeric := 0; free_m integer := 0; msg text := NULL;
BEGIN
  IF _tickets IS NULL OR _tickets < 1 OR _tickets > 100000 THEN RAISE EXCEPTION 'Enter a ticket count of at least 1'; END IF;
  SELECT * INTO p FROM subscription_plans WHERE id = _plan_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not available'; END IF;
  base := p.price_monthly;
  IF jsonb_array_length(COALESCE(p.ticket_tiers,'[]'::jsonb)) > 0 THEN
    base := NULL;
    FOR t IN SELECT * FROM jsonb_array_elements(p.ticket_tiers) LOOP
      IF _tickets >= (t->>'min')::numeric AND (t->>'max' IS NULL OR _tickets <= (t->>'max')::numeric) THEN
        base := (t->>'price')::numeric; EXIT;
      END IF;
    END LOOP;
    IF base IS NULL THEN RAISE EXCEPTION 'No price range covers % tickets on this plan', _tickets; END IF;
  END IF;
  IF NULLIF(btrim(_voucher_code),'') IS NOT NULL THEN
    SELECT * INTO v FROM vouchers WHERE code = upper(btrim(_voucher_code));
    IF NOT FOUND OR NOT v.is_active THEN msg := 'Voucher code is not valid';
    ELSIF v.expires_at IS NOT NULL AND v.expires_at < now() THEN msg := 'Voucher has expired';
    ELSIF v.max_uses IS NOT NULL AND v.used_count >= v.max_uses THEN msg := 'Voucher has been fully used';
    ELSIF v.plan_id IS NOT NULL AND v.plan_id <> _plan_id THEN msg := 'Voucher does not apply to this plan';
    ELSIF v.discount_type = 'percent' THEN disc := round(base * v.value / 100, 2);
    ELSIF v.discount_type = 'fixed' THEN disc := LEAST(v.value, base);
    ELSE free_m := v.value::integer;
    END IF;
  END IF;
  RETURN jsonb_build_object('base', base, 'discount', disc, 'final', base - disc, 'free_months', free_m,
    'currency', COALESCE(p.currency,'USD'), 'voucher_id', CASE WHEN msg IS NULL THEN v.id END, 'voucher_error', msg);
END $$;
REVOKE ALL ON FUNCTION public.quote_plan_price(uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_plan_price(uuid,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.client_subscribe_plan(_plan_id uuid, _tickets integer, _voucher_code text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q jsonb; vid uuid; sub_id uuid; pay_id uuid; final numeric; free_m integer; pname text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NOT public.has_role(auth.uid(),'client') THEN RAISE EXCEPTION 'Only clients can subscribe'; END IF;
  IF NULLIF(btrim(_voucher_code),'') IS NOT NULL THEN
    PERFORM 1 FROM vouchers WHERE code = upper(btrim(_voucher_code)) FOR UPDATE;
  END IF;
  q := public.quote_plan_price(_plan_id, _tickets, _voucher_code);
  IF q->>'voucher_error' IS NOT NULL THEN RAISE EXCEPTION '%', q->>'voucher_error'; END IF;
  vid := (q->>'voucher_id')::uuid; final := (q->>'final')::numeric; free_m := (q->>'free_months')::integer;
  SELECT name INTO pname FROM subscription_plans WHERE id = _plan_id;
  IF free_m = 0 AND final > 0 THEN
    INSERT INTO payments (client_id, amount, vat_amount, currency, status, kind, description, due_date, payment_method)
    VALUES (auth.uid(), final, 0, q->>'currency', 'pending', 'subscription',
      format('%s plan — up to %s tickets/month (first month)', pname, _tickets), now() + interval '7 days', 'bank_transfer')
    RETURNING id INTO pay_id;
  END IF;
  INSERT INTO client_plan_subscriptions (client_id, plan_id, tickets_per_month, base_monthly_price, voucher_id, discount_amount, final_monthly_price, free_until, payment_id, status)
  VALUES (auth.uid(), _plan_id, _tickets, (q->>'base')::numeric, vid, (q->>'discount')::numeric, final,
    CASE WHEN free_m > 0 THEN now() + make_interval(months => free_m) END, pay_id,
    CASE WHEN pay_id IS NULL THEN 'active' ELSE 'pending' END)
  RETURNING id INTO sub_id;
  IF vid IS NOT NULL THEN UPDATE vouchers SET used_count = used_count + 1, updated_at = now() WHERE id = vid; END IF;
  RETURN sub_id;
END $$;
REVOKE ALL ON FUNCTION public.client_subscribe_plan(uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_subscribe_plan(uuid,integer,text) TO authenticated;