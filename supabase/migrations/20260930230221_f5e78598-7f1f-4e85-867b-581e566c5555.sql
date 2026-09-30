CREATE OR REPLACE FUNCTION public.guard_url_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _col text;
  _raw text;
  _val text;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  FOREACH _col IN ARRAY TG_ARGV LOOP
    _raw := to_jsonb(NEW) ->> _col;
    IF _raw IS NULL OR btrim(_raw) = '' THEN
      CONTINUE;
    END IF;
    IF TG_OP = 'UPDATE' AND _raw IS NOT DISTINCT FROM (to_jsonb(OLD) ->> _col) THEN
      CONTINUE;
    END IF;

    _val := btrim(_raw);

    -- any scheme other than http(s) is refused ("host:port" is not a scheme)
    IF _val ~* '^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))' AND _val !~* '^https?:' THEN
      RAISE EXCEPTION 'Invalid link in "%": only http(s) URLs are allowed', _col USING ERRCODE = '22023';
    END IF;

    IF _val !~* '^https?://' THEN
      _val := 'https://' || _val;
    END IF;

    IF length(_val) > 2048 OR _val !~* '^https?://[^[:space:]<>"''`]+$' THEN
      RAISE EXCEPTION 'Invalid link in "%": not a valid http(s) URL', _col USING ERRCODE = '22023';
    END IF;

    IF _val IS DISTINCT FROM _raw THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(_col, _val));
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_path_or_url_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _col text;
  _raw text;
  _val text;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  FOREACH _col IN ARRAY TG_ARGV LOOP
    _raw := to_jsonb(NEW) ->> _col;
    IF _raw IS NULL OR btrim(_raw) = '' THEN
      CONTINUE;
    END IF;
    IF TG_OP = 'UPDATE' AND _raw IS NOT DISTINCT FROM (to_jsonb(OLD) ->> _col) THEN
      CONTINUE;
    END IF;

    _val := btrim(_raw);

    IF _val ~* '^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))' AND _val !~* '^https?://' THEN
      RAISE EXCEPTION 'Invalid file reference in "%": script-capable or unknown URL scheme', _col USING ERRCODE = '22023';
    END IF;
    IF _val ~* '^https?://' AND (length(_val) > 2048 OR _val !~* '^https?://[^[:space:]<>"''`]+$') THEN
      RAISE EXCEPTION 'Invalid file reference in "%": not a valid http(s) URL', _col USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_url_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_path_or_url_columns() FROM PUBLIC, anon, authenticated;

DO $attach$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('remote_environments',         'guard_url_columns',          ARRAY['guacamole_url']),
      ('environment_connections',     'guard_url_columns',          ARRAY['guacamole_url']),
      ('sessions',                    'guard_url_columns',          ARRAY['meeting_url','recording_url']),
      ('ticket_interviews',           'guard_url_columns',          ARRAY['recording_url']),
      ('major_incidents',             'guard_url_columns',          ARRAY['war_room_link']),
      ('consultants',                 'guard_url_columns',          ARRAY['linkedin_url','github_url','personal_website','profile_video_url']),
      ('client_profiles',             'guard_url_columns',          ARRAY['company_website']),
      ('messages',                    'guard_path_or_url_columns',  ARRAY['file_url']),
      ('certifications',              'guard_path_or_url_columns',  ARRAY['document_url']),
      ('client_profiles',             'guard_path_or_url_columns',  ARRAY['custom_nda_url']),
      ('ticket_timesheet_submissions','guard_path_or_url_columns',  ARRAY['pdf_url']),
      ('work_diary_entries',          'guard_path_or_url_columns',  ARRAY['screenshot_url'])
    ) AS v(tbl, fn, cols)
  LOOP
    -- one trigger per (table, function) so a table can carry both kinds
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
                   'trg_' || r.fn || '_links', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I(%s)',
      'trg_' || r.fn || '_links', r.tbl, r.fn,
      (SELECT string_agg(quote_literal(c), ',') FROM unnest(r.cols) AS c)
    );
  END LOOP;
END
$attach$;