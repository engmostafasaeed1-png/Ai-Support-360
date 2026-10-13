-- M66: progress of the guided tours (consultant tour after registration, per user, kept across devices).
CREATE TABLE IF NOT EXISTS public.user_tour_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_key text NOT NULL CHECK (tour_key ~ '^[a-z0-9_-]{2,40}$'),
  tour_version integer NOT NULL DEFAULT 1 CHECK (tour_version BETWEEN 1 AND 1000),
  last_step integer NOT NULL DEFAULT 0 CHECK (last_step BETWEEN 0 AND 50),
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_key)
);
ALTER TABLE public.user_tour_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own tour progress" ON public.user_tour_progress FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON public.user_tour_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_tour_progress TO authenticated;

CREATE OR REPLACE FUNCTION public.save_tour_progress(_key text, _version integer, _last_step integer, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  IF _key IS NULL OR _key !~ '^[a-z0-9_-]{2,40}$' OR _version IS NULL OR _version NOT BETWEEN 1 AND 1000
     OR _last_step IS NULL OR _last_step NOT BETWEEN 0 AND 50 OR _status NOT IN ('in_progress', 'completed', 'skipped') THEN
    RAISE EXCEPTION 'The tour data is not valid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('tour-save:' || auth.uid()::text, 120, 3600) THEN
    RAISE EXCEPTION 'Too many attempts. Please wait a while and try again.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.user_tour_progress (user_id, tour_key, tour_version, last_step, completed_at, skipped_at, updated_at)
  VALUES (auth.uid(), _key, _version, _last_step,
          CASE WHEN _status = 'completed' THEN now() END, CASE WHEN _status = 'skipped' THEN now() END, now())
  ON CONFLICT (user_id, tour_key) DO UPDATE
    SET tour_version = EXCLUDED.tour_version, last_step = EXCLUDED.last_step,
        completed_at = EXCLUDED.completed_at, skipped_at = EXCLUDED.skipped_at, updated_at = now();
END
$function$;

-- "Take the tour again"
CREATE OR REPLACE FUNCTION public.reset_tour_progress(_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.user_tour_progress WHERE user_id = auth.uid() AND tour_key = _key;
END
$function$;

REVOKE ALL ON FUNCTION public.save_tour_progress(text, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_tour_progress(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tour_progress(text, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_tour_progress(text) TO authenticated;
