-- =============================================================================
-- Feature X — consultant name privacy (prepared, NOT APPLIED by the assistant).
--
-- What it does
--   * consultants.name_format: 'masked' (default, "M. S****"), 'initial_family' ("M. Saeed"),
--     'initials' ("M.S."), 'full' ("Mostafa Saeed"). Only the owner (and administrators) can change it.
--   * platform setting consultant_name_masking_enabled (default ON). OFF = everyone sees full names again.
--   * public.consultant_public_name(_consultant_id): the name as the CURRENT viewer may see it.
--     Full name for: the consultant, administrators, and clients (or their company colleagues) of a ticket where
--     the consultant is team status ready/active, or has a legacy active assignment / is the ticket consultant,
--     AND an NDA between them is signed by both and not revoked. Everyone else (visitors, other clients,
--     other consultants, assigned clients without the NDA) sees only the chosen format.
--   * profile_directory (the only way the app reads other people's names) now returns that string for consultants,
--     so directory, map, cards, bids, invitations, reviews, favourites, sessions, timeline, profile page title and
--     share text all follow one rule. Search in the browser can only match what it received (the masked text).
--   * Notification texts and e-mails to clients about consultants use the name as the recipient may see it.
--
-- Leak found and closed by this file
--   profile_directory is a definer view: any signed-in user could read the full display_name of EVERY verified
--   consultant (users_visible_to_each_other is true for all verified consultants). profiles itself is safe
--   (row security: own row or administrators only). Server functions also put full names in client notifications.
--
-- Migration note for existing consultants
--   The new column is added with DEFAULT 'masked', so every existing consultant starts masked ("M. S****").
--   Nothing else changes for them; they can pick another format in Settings > Privacy.
--
-- Safe to run more than once. Checks: docs/sql/consultant-name-privacy.test.sql (rolled back).
-- =============================================================================

-- 1) Column, check, grants -----------------------------------------------------
ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS name_format text NOT NULL DEFAULT 'masked';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultants_name_format_check' AND conrelid = 'public.consultants'::regclass) THEN
    ALTER TABLE public.consultants ADD CONSTRAINT consultants_name_format_check
      CHECK (name_format IN ('masked', 'initial_family', 'initials', 'full'));
  END IF;
END $$;
COMMENT ON COLUMN public.consultants.name_format IS 'How the name is shown before the full name is unlocked: masked | initial_family | initials | full (Feature X).';
GRANT SELECT (name_format) ON public.consultants TO anon, authenticated;
GRANT UPDATE (name_format) ON public.consultants TO authenticated;
GRANT ALL ON public.consultants TO service_role;

-- 2) Setting (default ON) --------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
SELECT 'consultant_name_masking_enabled', 'true'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'consultant_name_masking_enabled');

CREATE OR REPLACE FUNCTION public.consultant_name_masking_on()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT s.value::text NOT IN ('false', '"false"') FROM public.platform_settings s
                    WHERE s.key = 'consultant_name_masking_enabled' LIMIT 1), true)
$$;

-- 3) Formatter (mirror of supabase/functions/_shared/consultantName.ts) ----------
-- A word without accents, Arabic diacritics and tatweel (letters are picked and counted on this).
CREATE OR REPLACE FUNCTION public.consultant_name_clean(_w text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
  SELECT regexp_replace(normalize(regexp_replace(normalize(COALESCE(_w, ''), NFD), '[\u0300-\u036f]', '', 'g'), NFC),
                        '[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g')
$$;

-- Words as written (edge punctuation removed), without titles ("Dr.", "Eng.", "م.", "د.") and suffixes.
CREATE OR REPLACE FUNCTION public.consultant_name_words(_name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
DECLARE
  _letter constant text := '[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FC]';
  _edge constant text := '[[:space:].,;:''"`()\[\]{}\-_/\\|·•،؛]';
  _titles constant text[] := ARRAY['dr','eng','engr','prof','mr','mrs','ms','miss','sir','sheikh','sh',
    'م','د','أ','ا','مهندس','المهندس','دكتور','الدكتور','أستاذ','الأستاذ','استاذ','الاستاذ','الشيخ','شيخ'];
  _suffixes constant text[] := ARRAY['phd','mba','pmp','msc','bsc','jr','sr'];
  _w text; _out text[] := ARRAY[]::text[];
BEGIN
  FOREACH _w IN ARRAY regexp_split_to_array(btrim(COALESCE(_name, '')), '[[:space:]\u200B-\u200F]+') LOOP
    _w := regexp_replace(_w, '^' || _edge || '+|' || _edge || '+$', '', 'g');
    IF public.consultant_name_clean(_w) ~ _letter THEN _out := _out || _w; END IF;
  END LOOP;
  WHILE cardinality(_out) > 1 AND lower(replace(public.consultant_name_clean(_out[1]), '.', '')) = ANY (_titles) LOOP _out := _out[2:]; END LOOP;
  WHILE cardinality(_out) > 1 AND lower(replace(public.consultant_name_clean(_out[cardinality(_out)]), '.', '')) = ANY (_suffixes) LOOP
    _out := _out[1:cardinality(_out) - 1];
  END LOOP;
  RETURN _out;
END $$;

CREATE OR REPLACE FUNCTION public.format_consultant_name(_name text, _format text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
DECLARE
  _letter constant text := '[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FC]';
  _w text[]; _first text; _last text; _f text; _l text; _n int;
BEGIN
  IF _format = 'full' THEN RETURN btrim(regexp_replace(COALESCE(_name, ''), '[[:space:]]+', ' ', 'g')); END IF;
  _w := public.consultant_name_words(_name);
  _n := cardinality(_w);
  IF _n = 0 THEN RETURN ''; END IF;
  _first := _w[1];
  _f := upper(substring(public.consultant_name_clean(_first) FROM _letter));
  IF _n = 1 THEN
    IF _format = 'initials' THEN RETURN _f || '.'; END IF;
    IF _format = 'initial_family' THEN RETURN _first; END IF;
    RETURN _f || repeat('*', LEAST(5, GREATEST(3, (SELECT count(*)::int FROM regexp_matches(public.consultant_name_clean(_first), _letter, 'g')) - 1)));
  END IF;
  _last := _w[_n];
  _l := upper(substring(public.consultant_name_clean(_last) FROM _letter));
  IF _format = 'initials' THEN RETURN _f || '.' || _l || '.'; END IF;
  IF _format = 'initial_family' THEN RETURN _f || '. ' || _last; END IF;
  RETURN _f || '. ' || _l || repeat('*', LEAST(5, GREATEST(3, (SELECT count(*)::int FROM regexp_matches(public.consultant_name_clean(_last), _letter, 'g')) - 1)));
END $$;

-- 4) Who may see the full name ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultant_name_unlocked(_consultant_id uuid, _viewer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT _viewer IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _consultant_id AND c.user_id = _viewer)
    OR public.has_role(_viewer, 'admin'::app_role) OR public.has_role(_viewer, 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.tickets t
       WHERE (t.client_id = _viewer
              OR (t.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members tm
                   WHERE tm.tenant_id = t.tenant_id AND tm.user_id = _viewer AND tm.accepted_at IS NOT NULL)))
         AND (EXISTS (SELECT 1 FROM public.ticket_team_members m
                       WHERE m.ticket_id = t.id AND m.consultant_id = _consultant_id AND m.status IN ('ready', 'active'))
              OR EXISTS (SELECT 1 FROM public.ticket_assignments a
                          WHERE a.ticket_id = t.id AND a.consultant_id = _consultant_id AND a.status::text = 'active')
              OR t.consultant_id = _consultant_id)
         AND EXISTS (SELECT 1 FROM public.nda_agreements n
                      WHERE n.consultant_id = _consultant_id AND n.client_id = t.client_id AND n.revoked_at IS NULL
                        AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL)))
$$;

-- The name for a given viewer (internal: notifications pass the recipient). NULL when the consultant does not exist.
CREATE OR REPLACE FUNCTION public.consultant_name_for(_consultant_id uuid, _viewer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE
           WHEN NOT public.consultant_name_masking_on() OR public.consultant_name_unlocked(c.id, _viewer)
             THEN NULLIF(public.format_consultant_name(p.display_name, 'full'), '')
           ELSE NULLIF(public.format_consultant_name(p.display_name, COALESCE(c.name_format, 'masked')), '')
         END
    FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id
   WHERE c.id = _consultant_id
$$;

-- Any person for a viewer: consultants through the rule above, everyone else by their display name.
CREATE OR REPLACE FUNCTION public.person_name_for(_user_id uuid, _viewer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT public.consultant_name_for(c.id, _viewer) FROM public.consultants c WHERE c.user_id = _user_id LIMIT 1),
    (SELECT p.display_name FROM public.profiles p WHERE p.user_id = _user_id
        AND NOT EXISTS (SELECT 1 FROM public.consultants c2 WHERE c2.user_id = _user_id)))
$$;

REVOKE ALL ON FUNCTION public.consultant_name_unlocked(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consultant_name_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_name_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_name_unlocked(uuid, uuid), public.consultant_name_for(uuid, uuid), public.person_name_for(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.consultant_name_masking_on() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_name_masking_on() TO authenticated, service_role;

-- The public entry point: the name as the current viewer may see it.
CREATE OR REPLACE FUNCTION public.consultant_public_name(_consultant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$ SELECT public.consultant_name_for(_consultant_id, auth.uid()) $$;
GRANT EXECUTE ON FUNCTION public.consultant_public_name(uuid) TO anon, authenticated, service_role;

-- Tells the app the feature is installed (the settings picker stays hidden until then).
CREATE OR REPLACE FUNCTION public.consultant_name_privacy_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$ SELECT jsonb_build_object('enabled', public.consultant_name_masking_on(), 'formats', jsonb_build_array('masked', 'initial_family', 'initials', 'full')) $$;
GRANT EXECUTE ON FUNCTION public.consultant_name_privacy_config() TO anon, authenticated, service_role;

-- 5) Only the owner and administrators may change name_format ----------------------
CREATE OR REPLACE FUNCTION public.guard_consultant_trust_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status         := 'pending';
    NEW.rating                      := 0;
    NEW.total_reviews               := 0;
    NEW.response_time_minutes       := 0;
    NEW.credibility_credits         := 0;
    NEW.ai_skills_score             := NULL;
    NEW.ai_interview_badge          := NULL;
    NEW.ai_interview_completed_at   := NULL;
    NEW.linkedin_checked_at         := NULL;
    NEW.credly_checked_at           := NULL;
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN NEW.name_format := 'masked'; END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.user_id, NEW.verification_status, NEW.rating, NEW.total_reviews, NEW.response_time_minutes,
         NEW.credibility_credits, NEW.ai_skills_score, NEW.ai_interview_badge, NEW.ai_interview_completed_at,
         NEW.linkedin_checked_at, NEW.credly_checked_at)
     IS DISTINCT FROM
     ROW(OLD.user_id, OLD.verification_status, OLD.rating, OLD.total_reviews, OLD.response_time_minutes,
         OLD.credibility_credits, OLD.ai_skills_score, OLD.ai_interview_badge, OLD.ai_interview_completed_at,
         OLD.linkedin_checked_at, OLD.credly_checked_at) THEN
    RAISE EXCEPTION 'Verification status, ratings, scores, credits and the checks of the LinkedIn and Credly links are managed by the platform'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.name_format IS DISTINCT FROM OLD.name_format AND auth.uid() IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Only the consultant can choose how their name is shown' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- 6) The directory of names: consultants through the rule, everyone else unchanged --------
CREATE OR REPLACE VIEW public.profile_directory WITH (security_invoker = false) AS
  SELECT p.user_id,
         CASE WHEN c.id IS NULL THEN p.display_name ELSE public.consultant_public_name(c.id) END AS display_name,
         p.avatar_url
    FROM public.profiles p
    LEFT JOIN public.consultants c ON c.user_id = p.user_id
   WHERE (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)
          OR public.users_visible_to_each_other(auth.uid(), p.user_id));
REVOKE ALL ON public.profile_directory FROM anon;
GRANT SELECT ON public.profile_directory TO authenticated, service_role;

-- 7) Names in team texts and notifications -------------------------------------------
-- Context-free (used by Feature I/L/M notification texts): the consultant's chosen public format, never unlocked,
-- because a stored notification cannot follow later NDA changes.
CREATE OR REPLACE FUNCTION public.team_consultant_name(_consultant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.consultant_name_for(_consultant_id, NULL), 'A consultant')
$function$;

CREATE OR REPLACE FUNCTION public.get_emergency_contact(_ticket_id uuid)
 RETURNS TABLE(display_name text, phone text, hourly_rate numeric, source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t public.tickets;
BEGIN
  SELECT * INTO _t FROM public.tickets t
   WHERE t.id = _ticket_id AND t.client_id = auth.uid() AND t.urgency::text IN ('high', 'critical');
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- only the consultant assigned to this ticket; before that, the administrator of the platform
  IF _t.consultant_id IS NOT NULL THEN
    RETURN QUERY
      SELECT COALESCE(public.consultant_name_for(c.id, auth.uid()), 'Your consultant'), p.phone, c.hourly_rate, 'assigned_consultant'::text
        FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id
       WHERE c.id = _t.consultant_id;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.display_name, p.phone, NULL::numeric, 'administrator'::text
      FROM public.user_roles ur JOIN public.profiles p ON p.user_id = ur.user_id
     WHERE ur.role = 'admin'::app_role
     ORDER BY (p.phone IS NOT NULL AND btrim(p.phone) <> '') DESC, ur.created_at
     LIMIT 1;
END;
$function$;

-- Redefined from their live versions; only the consultant-name lines changed (to consultant_name_for / person_name_for).
-- claim_assignment_info_emails
CREATE OR REPLACE FUNCTION public.claim_assignment_info_emails(_limit integer DEFAULT 100, _info_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(info_id uuid, request_id uuid, kind text, recipient_user_id uuid, lang text, ticket_id uuid, ticket_title text, consultant_name text, topics text[], question text, client_due_at timestamp with time zone, response_due_at timestamp with time zone, timezone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(_limit, 100), 1), 200);
  r RECORD;
  v_n INT := 0;
  v_l TEXT;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Unanswered within info_wait: back to the client as "Waiting for your answer" (never counted against the consultant).
  FOR r IN
    SELECT i.id AS iid, i.request_id AS qid, i.ticket_id AS tid, t.client_id AS clid, t.title AS ttitle, c.user_id AS cuid
      FROM public.assignment_info_requests i
      JOIN public.tickets t ON t.id = i.ticket_id
      JOIN public.consultants c ON c.id = i.consultant_id
     WHERE i.status = 'open' AND i.client_due_at <= now() AND (_info_id IS NULL OR i.id = _info_id)
     ORDER BY i.client_due_at
     LIMIT v_limit
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.assignment_info_requests SET status = 'timed_out', timed_out_at = now() WHERE id = r.iid;
    v_l := public.assignment_user_lang(r.clid);
    PERFORM public.safe_insert_notification(r.clid,
      CASE WHEN v_l = 'ar' THEN 'بانتظار إجابتك' ELSE 'Waiting for your answer' END,
      CASE WHEN v_l = 'ar' THEN 'ما زال الاستشاري ينتظر إجابتك عن سؤاله بشأن "' || left(COALESCE(r.ttitle, 'طلبك'), 80) || '". أجب في بطاقة التذكرة ليتمكن من الرد.'
           ELSE 'The consultant is still waiting for your answer about "' || left(COALESCE(r.ttitle, 'your request'), 80) || '". Answer on the ticket card so they can decide.' END,
      'match_request', '/client/tickets/' || r.tid || '?info=' || r.iid);
    v_l := public.assignment_user_lang(r.cuid);
    PERFORM public.safe_insert_notification(r.cuid,
      CASE WHEN v_l = 'ar' THEN 'لم يُجب العميل بعد' ELSE 'The client has not answered yet' END,
      CASE WHEN v_l = 'ar' THEN 'طلب "' || left(COALESCE(r.ttitle, 'طلب'), 80) || '" متوقف حتى يجيب العميل، ولا يُحتسب ضدك. ما زال بإمكانك القبول أو الرفض.'
           ELSE '"' || left(COALESCE(r.ttitle, 'A request'), 80) || '" stays paused until the client answers and is not counted against you. You can still accept or decline.' END,
      'match_request', '/consultant/requests?request=' || r.qid);
  END LOOP;

  FOR r IN
    SELECT i.id AS iid, i.request_id AS qid, i.ticket_id AS tid, i.status AS st, i.topics AS tp, i.question AS qu,
           i.client_due_at AS cdue, i.ask_email_at, i.answer_email_at, i.timeout_email_at,
           t.client_id AS clid, t.title AS ttitle, c.user_id AS cuid, c.id AS ccid, q.response_due_at AS rdue,
           COALESCE(NULLIF(c.timezone, ''), 'Asia/Riyadh') AS tz
      FROM public.assignment_info_requests i
      JOIN public.ticket_match_requests q ON q.id = i.request_id
      JOIN public.tickets t ON t.id = i.ticket_id
      JOIN public.consultants c ON c.id = i.consultant_id
     WHERE i.asked_at > now() - interval '14 days'
       AND (_info_id IS NULL OR i.id = _info_id)
       AND (i.ask_email_at IS NULL
            OR (i.status = 'answered' AND i.answer_email_at IS NULL)
            OR (i.status = 'timed_out' AND i.timeout_email_at IS NULL))
     ORDER BY i.asked_at
     LIMIT v_limit
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= v_limit;
    info_id := r.iid; request_id := r.qid; ticket_id := r.tid; ticket_title := r.ttitle; consultant_name := NULL;
    topics := r.tp; question := r.qu; client_due_at := r.cdue; response_due_at := r.rdue;
    IF r.ask_email_at IS NULL THEN
      UPDATE public.assignment_info_requests SET ask_email_at = now() WHERE id = r.iid;
      -- An answer or a time-out that already happened makes the question e-mail pointless; mark it, send the newer one.
      IF r.st = 'open' THEN
        kind := 'ask'; recipient_user_id := r.clid; lang := public.assignment_user_lang(r.clid); timezone := 'Asia/Riyadh';
        consultant_name := public.consultant_name_for(r.ccid, recipient_user_id);
        v_n := v_n + 1;
        RETURN NEXT;
      END IF;
    END IF;
    IF r.st = 'answered' AND r.answer_email_at IS NULL THEN
      UPDATE public.assignment_info_requests SET answer_email_at = now() WHERE id = r.iid;
      kind := 'answer'; recipient_user_id := r.cuid; lang := public.assignment_user_lang(r.cuid); timezone := r.tz;
        consultant_name := public.consultant_name_for(r.ccid, recipient_user_id);
      v_n := v_n + 1;
      RETURN NEXT;
    ELSIF r.st = 'timed_out' AND r.timeout_email_at IS NULL THEN
      UPDATE public.assignment_info_requests SET timeout_email_at = now() WHERE id = r.iid;
      kind := 'timeout'; recipient_user_id := r.clid; lang := public.assignment_user_lang(r.clid); timezone := 'Asia/Riyadh';
        consultant_name := public.consultant_name_for(r.ccid, recipient_user_id);
      v_n := v_n + 1;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- notify_environment_session_started
CREATE OR REPLACE FUNCTION public.notify_environment_session_started()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _env text;
  _who text;
BEGIN
  SELECT re.client_id, re.name INTO _client, _env FROM public.remote_environments re WHERE re.id = NEW.environment_id;
  IF _client IS NOT NULL AND _client IS DISTINCT FROM NEW.user_id THEN
    _who := public.person_name_for(NEW.user_id, _client);
    PERFORM public.safe_insert_notification(_client, 'Remote session started',
      COALESCE(_who, 'A consultant') || ' connected to "' || _env || '".', 'remote_access', '/client/remote-access');
  END IF;
  RETURN NEW;
END;
$function$;

-- notify_match_accepted
CREATE OR REPLACE FUNCTION public.notify_match_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_id uuid;
  _ticket_title text;
  _tenant uuid;
  _consultant_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT t.client_id, t.title, t.tenant_id INTO _client_id, _ticket_title, _tenant FROM public.tickets t WHERE t.id = NEW.ticket_id;
    _consultant_name := public.consultant_name_for(NEW.consultant_id, _client_id);
    IF public.team_ticket_gated(NEW.ticket_id) THEN
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (_client_id, 'Consultant Accepted Match',
        'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" accepted the invitation for "' || COALESCE(_ticket_title, 'your ticket') || '". Next: approve the hourly rate on the Team panel.',
        'match_request', '/client/tickets/' || NEW.ticket_id || '?tab=work', _tenant);
    ELSE
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (_client_id, 'Consultant Accepted Match',
        'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" accepted the match for "' || COALESCE(_ticket_title, 'your ticket') || '". You can now choose them.',
        'match_request', '/client/tickets/' || NEW.ticket_id, _tenant);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- notify_nda_signed
CREATE OR REPLACE FUNCTION public.notify_nda_signed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_name text;
BEGIN
  _consultant_name := public.consultant_name_for(NEW.consultant_id, NEW.client_id);

  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (
    NEW.client_id,
    'NDA signed by consultant - your signature is needed',
    'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" has signed a Non-Disclosure Agreement for your account. Please sign it as well: protected access (remote environments and shared remote tools) is released only after both signatures.',
    'nda',
    '/client/contracts'
  );

  RETURN NEW;
END;
$function$;

-- notify_proposal_events
CREATE OR REPLACE FUNCTION public.notify_proposal_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _title text;
  _cons_user uuid;
  _cons_name text;
  _v text;
BEGIN
  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  _cons_name := public.consultant_name_for(NEW.consultant_id, _client);
  IF TG_OP = 'INSERT' THEN
    _v := CASE WHEN COALESCE(NEW.version, 1) > 1 THEN ' (v' || NEW.version || ')' ELSE '' END;
    IF _client IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_client, 'New bid received' || _v,
        COALESCE(_cons_name, 'A consultant') || ' bid on "' || COALESCE(_title, 'your request') || '": ' || COALESCE(NEW.proposed_rate::text, '?') || '/hr, '
          || COALESCE(NEW.estimated_hours::text, '?') || ' h estimated.', 'ticket', '/client/tickets/' || NEW.ticket_id || '?tab=bids');
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status::text = 'accepted' AND _cons_user IS NOT NULL THEN
      IF public.team_ticket_gated(NEW.ticket_id) THEN
        PERFORM public.safe_insert_notification(_cons_user, 'Your bid was accepted',
          'The client accepted your bid for "' || COALESCE(_title, 'a request') || '". Next: sign the NDA and confirm the engagement summary before you start.', 'ticket', '/consultant/requests');
      ELSE
        PERFORM public.safe_insert_notification(_cons_user, 'Your bid was accepted',
          'The client accepted your bid for "' || COALESCE(_title, 'a request') || '". The request is now assigned to you.', 'ticket', '/consultant/proposals');
      END IF;
    ELSIF NEW.status::text = 'rejected' AND _cons_user IS NOT NULL THEN
      IF NEW.rejection_reason = 'another_chosen' THEN
        PERFORM public.safe_insert_notification(_cons_user, 'Another consultant was chosen',
          'The client chose another consultant for "' || COALESCE(_title, 'a request') || '". Thank you for bidding.', 'ticket', '/consultant/proposals');
      ELSE
        PERFORM public.safe_insert_notification(_cons_user, 'Your bid was declined',
          'Your bid for "' || COALESCE(_title, 'a request') || '" was declined.' || CASE WHEN NEW.rejection_reason IS NOT NULL AND NEW.rejection_reason <> '' THEN ' Reason: ' || left(NEW.rejection_reason, 200) ELSE '' END,
          'ticket', '/consultant/proposals');
      END IF;
    ELSIF NEW.status::text = 'withdrawn' AND COALESCE(NEW.rejection_reason, '') <> 'superseded' AND _client IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_client, 'A bid was withdrawn',
        COALESCE(_cons_name, 'A consultant') || ' withdrew the bid for "' || COALESCE(_title, 'your request') || '".', 'ticket', '/client/tickets/' || NEW.ticket_id || '?tab=bids');
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.shortlisted IS TRUE AND OLD.shortlisted IS NOT TRUE AND _cons_user IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_cons_user, 'You are on the shortlist',
      'The client shortlisted your bid for "' || COALESCE(_title, 'a request') || '".', 'ticket', '/consultant/proposals');
  END IF;
  RETURN NEW;
END
$function$;

-- notify_session_lifecycle
CREATE OR REPLACE FUNCTION public.notify_session_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
  _client_name text;
  _consultant_name text;
  _when text;
  _is_confirmed boolean := false;
  _is_started boolean := false;
BEGIN
  IF NEW.consultant_id IS NOT NULL THEN
    SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    SELECT display_name INTO _client_name FROM public.profiles WHERE user_id = NEW.client_id;
  END IF;
  IF _consultant_user_id IS NOT NULL THEN
    _consultant_name := public.consultant_name_for(NEW.consultant_id, NEW.client_id);
  END IF;

  IF NEW.scheduled_at IS NOT NULL THEN
    _when := to_char(NEW.scheduled_at AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH24:MI" UTC"');
  ELSE
    _when := 'soon';
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_confirmed := COALESCE(NEW.status, 'scheduled') = 'scheduled';
    _is_started := NEW.status = 'in_progress';
  ELSIF TG_OP = 'UPDATE' THEN
    _is_confirmed := NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM 'scheduled';
    _is_started := NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress';
  END IF;

  IF _is_confirmed THEN
    IF NEW.client_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        NEW.client_id, 'Session Confirmed',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_consultant_name, 'your consultant') || ' is confirmed for ' || _when || '.',
        'session', '/client/sessions/' || NEW.id
      );
    END IF;
    IF _consultant_user_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        _consultant_user_id, 'Session Confirmed',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_client_name, 'a client') || ' is confirmed for ' || _when || '.',
        'session', '/consultant/sessions/' || NEW.id
      );
    END IF;
  END IF;

  IF _is_started THEN
    IF NEW.client_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        NEW.client_id, 'Session Starting Now',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_consultant_name, 'your consultant') || ' has started. Join now.',
        'session', '/client/sessions/' || NEW.id
      );
    END IF;
    IF _consultant_user_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        _consultant_user_id, 'Session Starting Now',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_client_name, 'a client') || ' has started.',
        'session', '/consultant/sessions/' || NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- notify_shared_remote_config_change
CREATE OR REPLACE FUNCTION public.notify_shared_remote_config_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cu uuid;
  _name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    _name := public.consultant_name_for(NEW.consultant_id, NEW.client_id);
    PERFORM public.safe_insert_notification(NEW.client_id, 'Remote access accepted',
      COALESCE(_name, 'The consultant') || ' accepted the ' || NEW.tool_type || ' remote access you shared.', 'remote_access', '/client/remote-access');
  ELSIF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    SELECT c.user_id INTO _cu FROM public.consultants c WHERE c.id = NEW.consultant_id;
    IF _cu IS NOT NULL AND EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = NEW.consultant_id AND n.client_id = NEW.client_id AND n.revoked_at IS NULL AND n.client_signed_at IS NOT NULL) THEN
      SELECT p.display_name INTO _name FROM public.profiles p WHERE p.user_id = NEW.client_id;
      PERFORM public.safe_insert_notification(_cu, 'Remote access revoked',
        COALESCE(_name, 'A client') || ' revoked the ' || NEW.tool_type || ' remote access.', 'remote_access', '/consultant/remote-access');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- set_environment_consultants
CREATE OR REPLACE FUNCTION public.set_environment_consultants(_environment_id uuid, _consultant_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _env record;
  _new uuid[];
  _id uuid;
  _user uuid;
  _name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an administrator can assign consultants' USING ERRCODE = '42501';
  END IF;
  SELECT re.id, re.name, re.client_id, re.consultant_id INTO _env FROM public.remote_environments re WHERE re.id = _environment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Environment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(x.id ORDER BY x.ord), ARRAY[]::uuid[]) INTO _new
  FROM (SELECT DISTINCT ON (u.id) u.id, u.ord
        FROM unnest(COALESCE(_consultant_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS u(id, ord)
        ORDER BY u.id, u.ord) AS x;
  IF EXISTS (SELECT 1 FROM unnest(_new) AS u(id) WHERE NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = u.id AND c.verification_status = 'verified')) THEN
    RAISE EXCEPTION 'Only verified consultants can be assigned' USING ERRCODE = '42501';
  END IF;

  FOR _id IN SELECT ec.consultant_id FROM public.environment_consultants ec WHERE ec.environment_id = _environment_id AND NOT (ec.consultant_id = ANY (_new)) LOOP
    DELETE FROM public.environment_consultants WHERE environment_id = _environment_id AND consultant_id = _id;
    SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = _id;
    IF _user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_user, 'Environment access removed',
        'You no longer have access to a client environment.', 'remote_access', '/consultant/remote-access');
    END IF;
  END LOOP;

  FOR _id IN SELECT u.id FROM unnest(_new) AS u(id) WHERE NOT EXISTS (SELECT 1 FROM public.environment_consultants ec WHERE ec.environment_id = _environment_id AND ec.consultant_id = u.id) LOOP
    INSERT INTO public.environment_consultants (environment_id, consultant_id, assigned_by) VALUES (_environment_id, _id, auth.uid());
    SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = _id;
    _name := public.consultant_name_for(_id, _env.client_id);
    IF _user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_user, 'Client environment assigned',
        'A client environment was assigned to you. Sign the client''s NDA in Remote Access to see it.', 'remote_access', '/consultant/remote-access');
    END IF;
    PERFORM public.safe_insert_notification(_env.client_id, 'Consultant assigned to your environment',
      COALESCE(_name, 'A consultant') || ' was assigned to "' || _env.name || '". They can connect only after signing your NDA.', 'remote_access', '/client/remote-access');
  END LOOP;

  UPDATE public.remote_environments
  SET consultant_id = CASE WHEN _env.consultant_id = ANY (_new) THEN _env.consultant_id ELSE _new[1] END
  WHERE id = _environment_id;
END;
$function$;

-- team_panel
CREATE OR REPLACE FUNCTION public.team_panel(_ticket_id uuid)
 RETURNS TABLE(member_id uuid, consultant_id uuid, display_name text, avatar_url text, engagement_mode text, team_role text, is_primary boolean, status text, is_legacy boolean, gates jsonb, next_step jsonb, availability_note text, approved_rate numeric, proposed_rate numeric, rate_currency text, rate_surcharge_percent numeric, confirmation jsonb, invited_at timestamp with time zone, viewed_at timestamp with time zone, accepted_at timestamp with time zone, bid_sent_at timestamp with time zone, rate_approved_at timestamp with time zone, nda_signed_at timestamp with time zone, confirmed_at timestamp with time zone, ready_at timestamp with time zone, ended_at timestamp with time zone, expires_at timestamp with time zone, notice_until timestamp with time zone, end_reason text, blocked_reason text, suggest_next boolean, client_nudged_at timestamp with time zone, consultant_nudged_at timestamp with time zone, ticket_gated boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE _all boolean; _me uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  _all := EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = auth.uid())
          OR public.ticket_in_my_company(_ticket_id) OR public.team_is_admin();
  SELECT c.id INTO _me FROM public.consultants c WHERE c.user_id = auth.uid();
  IF NOT _all AND _me IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.id, m.consultant_id, COALESCE(public.consultant_name_for(m.consultant_id, auth.uid()), 'A consultant'), p.avatar_url, m.engagement_mode, m.team_role, m.is_primary,
         m.status, m.is_legacy, public.team_gates(m.id), public.team_next_step(m.id), m.availability_note,
         ra.hourly_rate, rp.hourly_rate, COALESCE(ra.currency, rp.currency), COALESCE(ra.surcharge_percent, rp.surcharge_percent),
         (SELECT to_jsonb(ec) - 'client_id' FROM public.engagement_confirmations ec WHERE ec.member_id = m.id AND ec.superseded_at IS NULL),
         m.invited_at, m.viewed_at, m.accepted_at, m.bid_sent_at, m.rate_approved_at, m.nda_signed_at, m.confirmed_at, m.ready_at, m.ended_at,
         m.expires_at, m.notice_until, m.end_reason, m.blocked_reason, m.suggest_next, m.client_nudged_at, m.consultant_nudged_at,
         public.team_ticket_gated(_ticket_id)
    FROM public.ticket_team_members m
    JOIN public.consultants c ON c.id = m.consultant_id
    LEFT JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.ticket_rates ra ON ra.ticket_id = m.ticket_id AND ra.consultant_id = m.consultant_id AND ra.status = 'approved'
    LEFT JOIN public.ticket_rates rp ON rp.ticket_id = m.ticket_id AND rp.consultant_id = m.consultant_id AND rp.status = 'proposed'
   WHERE m.ticket_id = _ticket_id AND (_all OR m.consultant_id = _me)
   ORDER BY public.team_live(m.status) DESC, m.is_primary DESC, (m.team_role = 'lead') DESC, m.created_at;
END $function$;

-- team_thread
CREATE OR REPLACE FUNCTION public.team_thread(_ticket_id uuid, _before timestamp with time zone DEFAULT NULL::timestamp with time zone, _limit integer DEFAULT 50)
 RETURNS TABLE(message_id uuid, sender_role text, sender_name text, mine boolean, body text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.team_thread_role(_ticket_id) IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT tm.id, tm.sender_role,
         CASE tm.sender_role
           WHEN 'consultant' THEN COALESCE(public.consultant_name_for(tm.sender_consultant_id, auth.uid()), 'A consultant')
           WHEN 'admin' THEN 'Administrator'
           ELSE COALESCE((SELECT NULLIF(btrim(p.display_name), '') FROM public.profiles p WHERE p.user_id = tm.sender_id), 'Client') END,
         tm.sender_id = auth.uid(), tm.body, tm.created_at
    FROM public.ticket_team_messages tm
   WHERE tm.ticket_id = _ticket_id AND (_before IS NULL OR tm.created_at < _before)
   ORDER BY tm.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
END $function$;

-- ticket_timeline_v2
CREATE OR REPLACE FUNCTION public.ticket_timeline_v2(_ticket_id uuid)
 RETURNS TABLE(event_at timestamp with time zone, kind text, title text, detail text, actor_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t public.tickets;
  _money boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO _t FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT (_t.client_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'super_admin'::app_role)
          OR public.ticket_consultant_for_me(_ticket_id) IS NOT NULL
          OR public.is_ticket_participant(_ticket_id)) THEN
    RETURN;
  END IF;
  -- rates and timesheets are only for the client, the consultant of the ticket and administrators
  _money := _t.client_id = auth.uid()
            OR public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'super_admin'::app_role)
            OR public.ticket_consultant_for_me(_ticket_id) IS NOT NULL;
  RETURN QUERY
  SELECT x.event_at, x.kind, x.title, x.detail,
         COALESCE(public.person_name_for(x.actor_id, auth.uid()), x.actor_text) AS actor_name
    FROM (
      SELECT _t.created_at AS event_at, 'created'::text AS kind, 'Ticket created'::text AS title, NULL::text AS detail,
             _t.client_id AS actor_id, NULL::text AS actor_text
      UNION ALL
      SELECT a.created_at, 'status', 'Status changed to ' || replace(a.metadata #>> '{new,status}', '_', ' '),
             CASE WHEN a.metadata #>> '{old,status}' IS NOT NULL THEN 'Before: ' || replace(a.metadata #>> '{old,status}', '_', ' ') END,
             a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,status}' IS NOT NULL
         AND a.metadata #>> '{new,status}' IS DISTINCT FROM a.metadata #>> '{old,status}'
      UNION ALL
      SELECT a.created_at, 'assignment',
             CASE WHEN a.metadata #>> '{new,consultant_id}' IS NULL THEN 'Consultant removed from the ticket' ELSE 'Consultant assigned' END,
             (SELECT public.consultant_name_for(cc.id, auth.uid()) FROM public.consultants cc WHERE cc.id::text = a.metadata #>> '{new,consultant_id}'),
             a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND (a.metadata -> 'new') ? 'consultant_id'
         AND a.metadata #>> '{new,consultant_id}' IS DISTINCT FROM a.metadata #>> '{old,consultant_id}'
      UNION ALL
      SELECT a.created_at, 'urgency', 'Urgency changed to ' || (a.metadata #>> '{new,urgency}'),
             CASE WHEN a.metadata #>> '{old,urgency}' IS NOT NULL THEN 'Before: ' || (a.metadata #>> '{old,urgency}') END,
             a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,urgency}' IS NOT NULL
         AND a.metadata #>> '{new,urgency}' IS DISTINCT FROM a.metadata #>> '{old,urgency}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan submitted for approval', NULL, a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_submitted_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_submitted_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_submitted_at}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan approved', NULL, a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_approved_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_approved_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_approved_at}'
      UNION ALL
      SELECT a.created_at, 'plan', 'Plan rejected', a.metadata #>> '{new,plan_rejection_reason}', a.user_id, NULL
        FROM public.audit_logs a
       WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket_id AND a.action = 'tickets.updated'
         AND a.metadata #>> '{new,plan_rejected_at}' IS NOT NULL
         AND a.metadata #>> '{new,plan_rejected_at}' IS DISTINCT FROM a.metadata #>> '{old,plan_rejected_at}'
      UNION ALL
      SELECT m.created_at, 'match', 'A consultant was asked to take this ticket',
             public.consultant_name_for(m.consultant_id, auth.uid()),
             m.sent_by, NULL
        FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket_id
      UNION ALL
      SELECT m.responded_at, 'match',
             CASE WHEN m.status::text = 'accepted' THEN 'A consultant accepted the match request' ELSE 'A consultant answered the match request (' || replace(m.status::text, '_', ' ') || ')' END,
             NULL,
             (SELECT cc.user_id FROM public.consultants cc WHERE cc.id = m.consultant_id), NULL
        FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket_id AND m.responded_at IS NOT NULL
      UNION ALL
      SELECT d.created_at, 'document', 'Document uploaded: ' || d.file_name, 'Version ' || COALESCE(d.version, 1)::text, d.uploaded_by, NULL
        FROM public.ticket_documents d WHERE d.ticket_id = _ticket_id
      UNION ALL
      SELECT r.created_at, 'rate', 'Hourly rate proposed: ' || to_char(r.hourly_rate, 'FM999999990.00') || ' ' || COALESCE(r.currency, 'USD'), NULL, r.proposed_by, NULL
        FROM public.ticket_rates r WHERE _money AND r.ticket_id = _ticket_id
      UNION ALL
      SELECT r.decided_at, 'rate',
             CASE WHEN r.status = 'approved' THEN 'Hourly rate approved: ' ELSE 'Hourly rate declined: ' END || to_char(r.hourly_rate, 'FM999999990.00') || ' ' || COALESCE(r.currency, 'USD'),
             r.decision_note, r.decided_by, NULL
        FROM public.ticket_rates r WHERE _money AND r.ticket_id = _ticket_id AND r.decided_at IS NOT NULL AND r.status IN ('approved', 'rejected')
      UNION ALL
      SELECT s.created_at, 'timesheet', 'Timesheet submitted',
             to_char(COALESCE(s.total_hours, 0), 'FM990.00') || ' h logged, ' || to_char(COALESCE(s.billable_hours, 0), 'FM990.00') || ' h billable',
             s.submitted_by, NULL
        FROM public.ticket_timesheet_submissions s WHERE _money AND s.ticket_id = _ticket_id
      UNION ALL
      SELECT c.created_at, 'timesheet',
             CASE c.kind WHEN 'change_request' THEN 'Changes requested on the timesheet' WHEN 'resubmitted' THEN 'Timesheet sent again' ELSE 'Comment on the timesheet' END,
             left(c.body, 200), c.author_id, NULL
        FROM public.ticket_timesheet_comments c
        JOIN public.ticket_timesheet_submissions s ON s.id = c.submission_id
       WHERE _money AND s.ticket_id = _ticket_id
      UNION ALL
      SELECT s.signed_at, 'timesheet', 'Timesheet approved', NULL, NULL, s.signed_by_name
        FROM public.ticket_timesheet_submissions s WHERE _money AND s.ticket_id = _ticket_id AND s.signed_at IS NOT NULL
    ) x
   WHERE x.event_at IS NOT NULL
   ORDER BY x.event_at DESC, (x.title <> 'Timesheet submitted') DESC;
END;
$function$;
