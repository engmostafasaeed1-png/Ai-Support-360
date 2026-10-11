-- M53: invoice numbers restart every year and carry the quarter: INV-<year>-Q<quarter>-<6 digits>, for example INV-2026-Q4-000019.
-- The year and the quarter are taken in Cairo time. Invoices that exist keep their numbers (INV-<year>-<6 digits>).
-- The old sequence public.invoice_number_seq stays in the database but is not used any more.

-- 1. one counter per year, kept in a table: a failed invoice does not use a number, so the numbers have no holes
CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 2999),
  last_number bigint NOT NULL CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.invoice_number_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.invoice_number_counters TO authenticated;

CREATE POLICY "Administrators read the invoice counters"
  ON public.invoice_number_counters
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- 2. the history of changes remembers the year and the quarter it was made in
ALTER TABLE public.invoice_counter_changes
  ADD COLUMN IF NOT EXISTS period_year integer,
  ADD COLUMN IF NOT EXISTS period_quarter integer CHECK (period_quarter IS NULL OR period_quarter BETWEEN 1 AND 4);

-- 3. the year and the quarter of a moment in Cairo time (the only place where the time zone is written)
CREATE OR REPLACE FUNCTION public.invoice_period(_at timestamptz DEFAULT now())
 RETURNS TABLE (y integer, q integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT extract(year FROM _at AT TIME ZONE 'Africa/Cairo')::integer,
         extract(quarter FROM _at AT TIME ZONE 'Africa/Cairo')::integer
$function$;

-- 4. hands out the next number of the year (_at is only a parameter so that tests can use another date);
--    a new year starts at 1; a number that an invoice already has is skipped
CREATE OR REPLACE FUNCTION public.next_invoice_number(_at timestamptz DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _y integer;
  _q integer;
  _first bigint;
  _n bigint;
  _inv text;
  _tries integer := 0;
BEGIN
  SELECT p.y, p.q INTO _y, _q FROM public.invoice_period(_at) p;
  -- where a year without a counter starts: after the highest number its invoices already have (1 for a new year)
  SELECT COALESCE(max((regexp_match(i.invoice_number, '^INV-' || _y || '-(?:Q[1-4]-)?([0-9]{1,9})$'))[1]::bigint), 0) + 1
    INTO _first
    FROM public.payments i
   WHERE i.invoice_number LIKE 'INV-' || _y || '-%';
  LOOP
    INSERT INTO public.invoice_number_counters AS c (year, last_number)
    VALUES (_y, _first)
    ON CONFLICT (year) DO UPDATE SET last_number = c.last_number + 1, updated_at = now()
    RETURNING c.last_number INTO _n;
    _inv := 'INV-' || _y || '-Q' || _q || '-' || lpad(_n::text, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.payments i
       WHERE i.invoice_number LIKE 'INV-' || _y || '-%'
         AND i.invoice_number ~ ('^INV-' || _y || '-(?:Q[1-4]-)?0*' || _n::text || '$')
    );
    _tries := _tries + 1;
    IF _tries >= 50 THEN
      RAISE EXCEPTION 'Could not find a free invoice number' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN _inv;
END;
$function$;

-- 5. every new invoice takes its number from the counter of the year
CREATE OR REPLACE FUNCTION public.payments_set_identifiers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reference IS NULL THEN
    NEW.reference := 'QT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  END IF;
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := public.next_invoice_number();
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. the counter of this year continues where the old counter stopped
INSERT INTO public.invoice_number_counters (year, last_number)
SELECT p.y,
       GREATEST(
         (SELECT CASE WHEN s.is_called THEN s.last_value ELSE s.last_value - 1 END FROM public.invoice_number_seq s),
         COALESCE((SELECT max((regexp_match(i.invoice_number, '^INV-' || p.y || '-(?:Q[1-4]-)?([0-9]{1,9})$'))[1]::bigint)
                     FROM public.payments i
                    WHERE i.invoice_number LIKE 'INV-' || p.y || '-%'), 0))
  FROM public.invoice_period(now()) p
ON CONFLICT (year) DO NOTHING;

-- 7. reads the counter of this year: the next number, the highest number on an invoice, the last 20 changes
CREATE OR REPLACE FUNCTION public.admin_get_invoice_counter()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _y integer;
  _q integer;
  _last bigint;
  _next bigint;
  _highest bigint;
  _highest_inv text;
  _total bigint;
  _year_count bigint;
  _hist jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an administrator can see the invoice number counter' USING ERRCODE = '42501';
  END IF;
  SELECT p.y, p.q INTO _y, _q FROM public.invoice_period(now()) p;
  SELECT c.last_number INTO _last FROM public.invoice_number_counters c WHERE c.year = _y;
  _next := COALESCE(_last, 0) + 1;
  SELECT x.n, x.invoice_number
    INTO _highest, _highest_inv
    FROM (SELECT (regexp_match(i.invoice_number, '^INV-' || _y || '-(?:Q[1-4]-)?([0-9]{1,9})$'))[1]::bigint AS n, i.invoice_number
            FROM public.payments i
           WHERE i.invoice_number LIKE 'INV-' || _y || '-%') x
   WHERE x.n IS NOT NULL
   ORDER BY x.n DESC, x.invoice_number DESC
   LIMIT 1;
  _highest := COALESCE(_highest, 0);
  SELECT count(*) INTO _total FROM public.payments i WHERE i.invoice_number IS NOT NULL;
  SELECT count(*) INTO _year_count FROM public.payments i WHERE i.invoice_number LIKE 'INV-' || _y || '-%';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'changed_at', h.changed_at,
           'changed_by_name', COALESCE(pr.display_name, 'An administrator'),
           'old_next', h.old_next,
           'new_next', h.new_next,
           'reason', h.reason,
           'year', h.period_year,
           'quarter', h.period_quarter) ORDER BY h.changed_at DESC), '[]'::jsonb)
    INTO _hist
    FROM (SELECT * FROM public.invoice_counter_changes ORDER BY changed_at DESC LIMIT 20) h
    LEFT JOIN public.profiles pr ON pr.user_id = h.changed_by;
  RETURN jsonb_build_object(
    'year', _y,
    'quarter', _q,
    'next_number', _next,
    'next_invoice_number', 'INV-' || _y || '-Q' || _q || '-' || lpad(_next::text, 6, '0'),
    'highest_used', _highest,
    'highest_used_invoice', _highest_inv,
    'lowest_allowed_next', _highest + 1,
    'invoices_total', _total,
    'invoices_this_year', _year_count,
    'first_invoice_next_year', 'INV-' || (_y + 1) || '-Q1-000001',
    'history', _hist
  );
END;
$function$;

-- 8. moves the counter of this year: the next invoice gets the number _next. Refused when it would repeat a number of this year.
CREATE OR REPLACE FUNCTION public.admin_set_invoice_counter(_next bigint, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r text := btrim(COALESCE(_reason, ''));
  _y integer;
  _q integer;
  _last bigint;
  _cur bigint;
  _highest bigint;
  _highest_inv text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an administrator can change the invoice number counter' USING ERRCODE = '42501';
  END IF;
  IF _next IS NULL OR _next < 1 OR _next > 999999 THEN
    RAISE EXCEPTION 'The next invoice number must be a whole number from 1 to 999999' USING ERRCODE = '22023';
  END IF;
  IF char_length(_r) < 5 OR char_length(_r) > 300 THEN
    RAISE EXCEPTION 'Write the reason for the change (5 to 300 characters)' USING ERRCODE = '22023';
  END IF;
  -- no invoice can be created while the counter is checked and moved (the lock is released at the end of this call)
  PERFORM set_config('lock_timeout', '5000', true);
  LOCK TABLE public.payments IN SHARE ROW EXCLUSIVE MODE;
  SELECT p.y, p.q INTO _y, _q FROM public.invoice_period(now()) p;
  SELECT c.last_number INTO _last FROM public.invoice_number_counters c WHERE c.year = _y FOR UPDATE;
  _cur := COALESCE(_last, 0) + 1;
  IF _next = _cur THEN
    RAISE EXCEPTION 'The counter is already at this number' USING ERRCODE = '22023';
  END IF;
  SELECT x.n, x.invoice_number
    INTO _highest, _highest_inv
    FROM (SELECT (regexp_match(i.invoice_number, '^INV-' || _y || '-(?:Q[1-4]-)?([0-9]{1,9})$'))[1]::bigint AS n, i.invoice_number
            FROM public.payments i
           WHERE i.invoice_number LIKE 'INV-' || _y || '-%') x
   WHERE x.n IS NOT NULL
   ORDER BY x.n DESC, x.invoice_number DESC
   LIMIT 1;
  _highest := COALESCE(_highest, 0);
  IF _next <= _highest THEN
    RAISE EXCEPTION 'The next number must be at least % (% is already used).', _highest + 1, _highest_inv USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoice_number_counters AS c (year, last_number)
  VALUES (_y, _next - 1)
  ON CONFLICT (year) DO UPDATE SET last_number = EXCLUDED.last_number, updated_at = now();
  INSERT INTO public.invoice_counter_changes (changed_by, old_next, new_next, reason, period_year, period_quarter)
  VALUES (auth.uid(), _cur, _next, _r, _y, _q);
  RETURN public.admin_get_invoice_counter();
END;
$function$;

-- 9. who may call what
REVOKE ALL ON FUNCTION public.invoice_period(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_invoice_counter() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_invoice_counter() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_invoice_counter(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_invoice_counter(bigint, text) TO authenticated;