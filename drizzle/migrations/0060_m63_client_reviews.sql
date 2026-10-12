-- M63: consultants rate the clients of their finished requests.
--  client_reviews: one review per request and consultant (overall, communication, clarity of requirements, cooperation, would work again, comment)
--  client_rating_stats: the averages per client, written only by the trigger; the client reads their own row
--  who sees what: consultants and the client see the averages and the count (RPC), comments only the consultant who wrote them and the administrators

CREATE TABLE IF NOT EXISTS public.client_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  communication_score integer CHECK (communication_score BETWEEN 1 AND 5),
  clarity_score integer CHECK (clarity_score BETWEEN 1 AND 5),
  cooperation_score integer CHECK (cooperation_score BETWEEN 1 AND 5),
  would_work_again boolean,
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  hidden boolean NOT NULL DEFAULT false,
  hidden_by uuid,
  hidden_reason text CHECK (hidden_reason IS NULL OR char_length(hidden_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, consultant_id)
);
CREATE INDEX IF NOT EXISTS client_reviews_client_idx ON public.client_reviews (client_id) WHERE NOT hidden;
CREATE INDEX IF NOT EXISTS client_reviews_consultant_idx ON public.client_reviews (consultant_id);

CREATE TABLE IF NOT EXISTS public.client_rating_stats (
  client_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avg_score numeric(3,2) NOT NULL,
  review_count integer NOT NULL,
  communication_avg numeric(3,2),
  clarity_avg numeric(3,2),
  cooperation_avg numeric(3,2),
  would_work_again_pct integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_rating_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants rate the clients of their finished requests" ON public.client_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT hidden
    AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = client_reviews.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified'::verification_status)
    AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = client_reviews.ticket_id AND t.client_id = client_reviews.client_id AND t.status::text IN ('resolved', 'closed'))
    AND public.consultant_assigned_to_ticket(client_reviews.ticket_id, client_reviews.consultant_id)
  );
CREATE POLICY "Consultants read their own client reviews" ON public.client_reviews
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = client_reviews.consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Consultants edit their own client review for 7 days" ON public.client_reviews
  FOR UPDATE TO authenticated
  USING (NOT hidden AND created_at > now() - interval '7 days' AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = client_reviews.consultant_id AND c.user_id = auth.uid()))
  WITH CHECK (NOT hidden AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = client_reviews.consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Administrators manage client reviews" ON public.client_reviews
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "A client reads their own rating averages" ON public.client_rating_stats
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

REVOKE ALL ON public.client_reviews FROM PUBLIC, anon;
REVOKE ALL ON public.client_rating_stats FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.client_reviews TO authenticated;
GRANT SELECT ON public.client_rating_stats TO authenticated;

-- the rate limit runs with the rights of the owner (the browser roles cannot call check_rate_limit themselves)
CREATE OR REPLACE FUNCTION public.client_review_rate_ok()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  SELECT auth.uid() IS NOT NULL AND public.check_rate_limit('client-review:' || auth.uid()::text, 20, 3600)
$function$;
REVOKE ALL ON FUNCTION public.client_review_rate_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_review_rate_ok() TO authenticated;

-- guard: the parties of a review never change, only an administrator hides a review, no contact details in the comment, at most 20 new reviews an hour
CREATE OR REPLACE FUNCTION public.guard_client_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.client_review_rate_ok() THEN
      RAISE EXCEPTION 'Too many attempts. Please wait a while and try again.' USING ERRCODE = '54000';
    END IF;
    NEW.hidden := false; NEW.hidden_by := NULL; NEW.hidden_reason := NULL;
  ELSE
    IF NEW.ticket_id <> OLD.ticket_id OR NEW.consultant_id <> OLD.consultant_id OR NEW.client_id <> OLD.client_id
       OR NEW.hidden IS DISTINCT FROM OLD.hidden OR NEW.hidden_by IS DISTINCT FROM OLD.hidden_by OR NEW.hidden_reason IS DISTINCT FROM OLD.hidden_reason THEN
      RAISE EXCEPTION 'Only the scores and the comment of a review can be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.comment IS NOT NULL AND (btrim(NEW.comment) = '' OR public.contact_details_in_text(NEW.comment)) THEN
    IF btrim(NEW.comment) = '' THEN
      NEW.comment := NULL;
    ELSE
      RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_client_review ON public.client_reviews;
CREATE TRIGGER trg_guard_client_review BEFORE INSERT OR UPDATE ON public.client_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_review();

-- the averages of a client (reviews that are not hidden)
CREATE OR REPLACE FUNCTION public.recompute_client_rating(_client uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _n integer;
BEGIN
  SELECT count(*) INTO _n FROM public.client_reviews WHERE client_id = _client AND NOT hidden;
  IF _n = 0 THEN
    DELETE FROM public.client_rating_stats WHERE client_id = _client;
    RETURN;
  END IF;
  INSERT INTO public.client_rating_stats AS s (client_id, avg_score, review_count, communication_avg, clarity_avg, cooperation_avg, would_work_again_pct, updated_at)
  SELECT _client, round(avg(score)::numeric, 2), count(*), round(avg(communication_score)::numeric, 2), round(avg(clarity_score)::numeric, 2), round(avg(cooperation_score)::numeric, 2),
         CASE WHEN count(would_work_again) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE would_work_again) / count(would_work_again))::integer END, now()
    FROM public.client_reviews WHERE client_id = _client AND NOT hidden
  ON CONFLICT (client_id) DO UPDATE
     SET avg_score = EXCLUDED.avg_score, review_count = EXCLUDED.review_count, communication_avg = EXCLUDED.communication_avg, clarity_avg = EXCLUDED.clarity_avg,
         cooperation_avg = EXCLUDED.cooperation_avg, would_work_again_pct = EXCLUDED.would_work_again_pct, updated_at = now();
END
$function$;

CREATE OR REPLACE FUNCTION public.on_client_review_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_client_rating(OLD.client_id);
  ELSE
    PERFORM public.recompute_client_rating(NEW.client_id);
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_on_client_review_change ON public.client_reviews;
CREATE TRIGGER trg_on_client_review_change AFTER INSERT OR UPDATE OR DELETE ON public.client_reviews
  FOR EACH ROW EXECUTE FUNCTION public.on_client_review_change();

REVOKE ALL ON FUNCTION public.recompute_client_rating(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_client_review_change() FROM PUBLIC, anon, authenticated;

-- who may see the averages of clients: verified consultants, administrators, and the client for their own row (never comments)
CREATE OR REPLACE FUNCTION public.client_rating_summaries(_client_ids uuid[])
RETURNS TABLE(client_id uuid, avg_score numeric, review_count integer, communication_avg numeric, clarity_avg numeric, cooperation_avg numeric, would_work_again_pct integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _all boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  _all := public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = _uid AND c.verification_status = 'verified'::verification_status);
  RETURN QUERY
    SELECT s.client_id, s.avg_score, s.review_count, s.communication_avg, s.clarity_avg, s.cooperation_avg, s.would_work_again_pct
      FROM public.client_rating_stats s
     WHERE s.client_id = ANY (_client_ids[1:100]) AND (_all OR s.client_id = _uid);
END
$function$;

REVOKE ALL ON FUNCTION public.client_rating_summaries(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_rating_summaries(uuid[]) TO authenticated;

-- an administrator hides or shows a review (the averages follow)
CREATE OR REPLACE FUNCTION public.admin_hide_client_review(_review_id uuid, _hidden boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only administrators can hide a review' USING ERRCODE = '42501';
  END IF;
  UPDATE public.client_reviews
     SET hidden = _hidden,
         hidden_by = CASE WHEN _hidden THEN auth.uid() ELSE NULL END,
         hidden_reason = CASE WHEN _hidden THEN left(NULLIF(btrim(COALESCE(_reason, '')), ''), 500) ELSE NULL END
   WHERE id = _review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = '42501';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_hide_client_review(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_hide_client_review(uuid, boolean, text) TO authenticated;
