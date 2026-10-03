-- M19 (AI suggestions from anonymised knowledge, and "solved before" expert matching).
-- The AI may only use knowledge that an administrator has published (anonymised articles and solutions, admin-written playbooks).
-- Nothing from another client's ticket, chat or session reaches a client or a prompt. Consultants appear only with two counts.
-- A. knowledge_solutions: the areas an item belongs to (generic names, like tickets.sap_modules).
-- B. knowledge_solution_meta: where an item came from and what the privacy check removed. Administrators only.
-- C. Functions for the edge functions only (service role): find published knowledge for a ticket text, count the similar issues each verified consultant solved.
-- D. The two administrator switches (platform_settings keys ai_suggestions_enabled, ai_learning_enabled): true or false only.
-- E. Feedback on suggestions (helpful / not helpful / solved my problem): own rows only, rate limited.

-- ===== A. areas of a knowledge item =====
ALTER TABLE public.knowledge_solutions
  ADD COLUMN sap_modules text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(sap_modules) <= 12);

-- ===== B. origin and privacy check of a knowledge item (administrators only) =====
CREATE TABLE public.knowledge_solution_meta (
  solution_id uuid PRIMARY KEY REFERENCES public.knowledge_solutions(id) ON DELETE CASCADE,
  origin_kind text NOT NULL CHECK (origin_kind IN ('session', 'ticket', 'manual')),
  source_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  source_consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  privacy_flags text[] NOT NULL DEFAULT '{}'::text[],
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- one anonymised item per ticket and kind: running the learning twice does not duplicate
CREATE UNIQUE INDEX knowledge_solution_meta_ticket_kind_key ON public.knowledge_solution_meta (source_ticket_id, origin_kind) WHERE source_ticket_id IS NOT NULL;
CREATE INDEX knowledge_solution_meta_consultant_idx ON public.knowledge_solution_meta (source_consultant_id) WHERE source_consultant_id IS NOT NULL;
ALTER TABLE public.knowledge_solution_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_solution_meta FROM anon, authenticated;
GRANT SELECT ON public.knowledge_solution_meta TO authenticated;
CREATE POLICY "Administrators read knowledge origins" ON public.knowledge_solution_meta
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- when an administrator publishes an item, remember who and when
CREATE FUNCTION public.mark_knowledge_solution_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.knowledge_solution_meta SET reviewed_by = auth.uid(), reviewed_at = now() WHERE solution_id = NEW.id;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_knowledge_solution_reviewed() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_knowledge_solution_reviewed
  AFTER UPDATE OF status ON public.knowledge_solutions
  FOR EACH ROW WHEN (NEW.status = 'published' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.mark_knowledge_solution_reviewed();

-- ===== C. search functions (edge functions only) =====
-- the words of a ticket text: letters and digits only (nothing the query parser could take as an operator), no common words,
-- at most 30 words, 3 characters or more (2 characters only with a digit, like the message numbers M7 or F5)
CREATE FUNCTION public.knowledge_terms(_query text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _stop constant text[] := ARRAY[
    'the','and','for','with','that','this','from','have','has','had','not','but','are','was','were','when','what','which','where','while',
    'there','their','they','them','then','than','into','onto','over','under','after','before','about','also','been','being','can','could',
    'would','should','will','just','only','some','any','all','our','your','you','how','why','who','its','out','off','one','two','new','now',
    'get','got','see','use','used','using','may','might','must','yet','too','very','much','many','more','most','such','each','both','same',
    'other','another','these','those','here','does','did','done','doing','don','doesn','didn','cant','cannot','wont','isnt','arent','wasnt',
    'werent','hasnt','havent','hadnt','want','wants','need','needs','needed','like','able','unable','trying','tried','try','still','again',
    'always','never','sometimes','since','during','between','through','without','within','because','please','thanks','thank','hello',
    'regards','kindly','help','urgent','issue','issues','problem','problems','error','errors','system','sap','ticket','user','users',
    'working','work','works','worked','show','shows','showing','shown','message','messages','appears','appear','happens','happen',
    'happened','occurs','occur','occurred','getting','give','gives','given','make','makes','made','take','takes','taken','come','comes',
    'came','find','found','look','looks','looking','know','think','thought','say','said','says','per','via','etc','yes',
    'على','هذا','هذه','ذلك','التي','الذي','كان','عند','بعد','قبل','لدي','لدينا','مشكلة','خطأ','عندي','يوجد','اريد','أريد','مساعدة'
  ];
  _terms text[];
BEGIN
  SELECT array_agg(b.t ORDER BY b.pos) INTO _terms FROM (
    SELECT a.t, min(a.ord) AS pos
    FROM (
      SELECT lower(m[1]) AS t, row_number() OVER () AS ord
      FROM regexp_matches(left(COALESCE(_query, ''), 4000), '[[:alnum:]]{2,40}', 'g') AS m
    ) a
    WHERE a.t <> ALL (_stop)
      AND a.t !~ '^[0-9]+$'
      AND (char_length(a.t) >= 3 OR a.t ~ '[0-9]')
    GROUP BY a.t
    ORDER BY min(a.ord)
    LIMIT 30
  ) b;
  RETURN _terms;
END;
$function$;
REVOKE ALL ON FUNCTION public.knowledge_terms(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_terms(text) TO service_role;

-- the same words as a prefix OR query
CREATE FUNCTION public.knowledge_tsquery(_query text)
RETURNS tsquery
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _terms text[] := public.knowledge_terms(_query);
BEGIN
  IF _terms IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN to_tsquery('simple', array_to_string(ARRAY(SELECT quote_literal(x) || ':*' FROM unnest(_terms) x), ' | '));
END;
$function$;
REVOKE ALL ON FUNCTION public.knowledge_tsquery(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_tsquery(text) TO service_role;

-- published, anonymised knowledge for a ticket text: an item must contain at least 2 of the words (1 when the text has only one).
-- The caller's company (_tenant) sees global items and its own, never another company's.
CREATE FUNCTION public.search_knowledge(_query text, _areas text[], _tenant uuid, _limit integer DEFAULT 8)
RETURNS TABLE (kind text, id uuid, title text, problem text, solution text, sap_module text, tags text[], rank real)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _terms text[] := public.knowledge_terms(_query);
  _tsq tsquery := public.knowledge_tsquery(_query);
  _tqs tsquery[];
  _min integer;
  _lim integer := LEAST(GREATEST(COALESCE(_limit, 8), 1), 10);
  _ar text[] := COALESCE(_areas, '{}'::text[]);
BEGIN
  IF _tsq IS NULL THEN
    RETURN;
  END IF;
  SELECT array_agg(to_tsquery('simple', quote_literal(x) || ':*')) INTO _tqs FROM unnest(_terms) x;
  _min := LEAST(2, cardinality(_terms));
  RETURN QUERY
  WITH cands AS (
    SELECT 'solution'::text AS k, s.id AS i, s.title AS ti, s.problem_description AS pr, s.solution AS so, s.sap_module AS m, s.tags AS tg,
           to_tsvector('simple', COALESCE(s.title, '') || ' ' || COALESCE(s.problem_description, '') || ' ' || COALESCE(s.solution, '') || ' '
             || COALESCE(s.sap_module, '') || ' ' || COALESCE(array_to_string(s.tags, ' '), '')) AS v,
           (s.sap_modules && _ar OR s.sap_module = ANY (_ar)) AS hit
    FROM public.knowledge_solutions s
    WHERE s.status = 'published' AND (s.tenant_id IS NULL OR s.tenant_id = _tenant)
    UNION ALL
    SELECT 'article'::text, a.id, a.title, NULL::text, left(COALESCE(a.content, ''), 3000), a.sap_module, a.tags,
           to_tsvector('simple', COALESCE(a.title, '') || ' ' || COALESCE(a.content, '') || ' ' || COALESCE(a.sap_module, '') || ' '
             || COALESCE(array_to_string(a.tags, ' '), '')),
           (a.sap_module = ANY (_ar))
    FROM public.knowledge_articles a
    WHERE a.status = 'published' AND (a.tenant_id IS NULL OR a.tenant_id = _tenant)
    UNION ALL
    SELECT 'playbook'::text, p.id, p.title, p.description,
           left(CASE WHEN jsonb_typeof(p.steps) = 'array'
                     THEN (SELECT string_agg(COALESCE(e ->> 'title', '') || ': ' || COALESCE(e ->> 'description', ''), E'\n') FROM jsonb_array_elements(p.steps) e)
                     ELSE p.steps::text END, 3000),
           p.sap_module, ARRAY[]::text[],
           to_tsvector('simple', COALESCE(p.title, '') || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(p.sap_module, '') || ' ' || COALESCE(p.steps::text, '')),
           (p.sap_module = ANY (_ar))
    FROM public.playbooks p
    WHERE p.is_active AND p.source_ticket_id IS NULL AND p.tenant_id IS NULL
  )
  SELECT c.k, c.i, c.ti, c.pr, left(COALESCE(c.so, ''), 3000), c.m, COALESCE(c.tg, ARRAY[]::text[]),
         (ts_rank_cd(c.v, _tsq, 32) + CASE WHEN COALESCE(c.hit, false) THEN 0.25 ELSE 0 END)::real
  FROM cands c
  WHERE c.v @@ _tsq
    AND (SELECT count(*) FROM unnest(_tqs) q WHERE c.v @@ q) >= _min
  ORDER BY 8 DESC, c.i
  LIMIT _lim;
END;
$function$;
REVOKE ALL ON FUNCTION public.search_knowledge(text, text[], uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge(text, text[], uuid, integer) TO service_role;

-- per verified consultant: published solutions that came from their tickets and contain at least 3 of the words (fewer if the text has fewer),
-- and resolved tickets in the same areas. Counts only.
CREATE FUNCTION public.consultants_solved_similar(_query text, _areas text[], _tenant uuid, _limit integer DEFAULT 20)
RETURNS TABLE (consultant_id uuid, solved_similar integer, resolved_in_areas integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _terms text[] := public.knowledge_terms(_query);
  _tsq tsquery := public.knowledge_tsquery(_query);
  _tqs tsquery[];
  _min integer := 1;
  _lim integer := LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
  _ar text[] := COALESCE(_areas, '{}'::text[]);
BEGIN
  IF _terms IS NOT NULL THEN
    SELECT array_agg(to_tsquery('simple', quote_literal(x) || ':*')) INTO _tqs FROM unnest(_terms) x;
    _min := LEAST(3, cardinality(_terms));
  END IF;
  RETURN QUERY
  WITH sol AS (
    SELECT m.source_consultant_id AS cid, count(*)::integer AS n
    FROM public.knowledge_solutions s
    JOIN public.knowledge_solution_meta m ON m.solution_id = s.id
    CROSS JOIN LATERAL (SELECT to_tsvector('simple', COALESCE(s.title, '') || ' ' || COALESCE(s.problem_description, '') || ' ' || COALESCE(s.solution, '') || ' '
            || COALESCE(s.sap_module, '') || ' ' || COALESCE(array_to_string(s.tags, ' '), '')) AS v) d
    WHERE _tsq IS NOT NULL
      AND s.status = 'published' AND (s.tenant_id IS NULL OR s.tenant_id = _tenant)
      AND m.source_consultant_id IS NOT NULL
      AND d.v @@ _tsq
      AND (SELECT count(*) FROM unnest(_tqs) q WHERE d.v @@ q) >= _min
    GROUP BY m.source_consultant_id
  ), res AS (
    SELECT t.consultant_id AS cid, count(*)::integer AS n
    FROM public.tickets t
    WHERE t.consultant_id IS NOT NULL AND t.status IN ('resolved', 'closed')
      AND cardinality(_ar) > 0 AND (t.sap_modules && _ar OR t.sap_module = ANY (_ar))
    GROUP BY t.consultant_id
  )
  SELECT c.id, COALESCE(sol.n, 0), COALESCE(res.n, 0)
  FROM public.consultants c
  LEFT JOIN sol ON sol.cid = c.id
  LEFT JOIN res ON res.cid = c.id
  WHERE c.verification_status = 'verified' AND (sol.n IS NOT NULL OR res.n IS NOT NULL)
  ORDER BY COALESCE(sol.n, 0) DESC, COALESCE(res.n, 0) DESC, c.id
  LIMIT _lim;
END;
$function$;
REVOKE ALL ON FUNCTION public.consultants_solved_similar(text, text[], uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultants_solved_similar(text, text[], uuid, integer) TO service_role;

-- ===== D. administrator switches =====
CREATE FUNCTION public.guard_ai_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.key IN ('ai_suggestions_enabled', 'ai_learning_enabled') AND jsonb_typeof(NEW.value) <> 'boolean' THEN
    RAISE EXCEPTION 'This setting must be switched on or off' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_ai_settings() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_ai_settings
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_settings();

-- ===== E. feedback on suggestions =====
CREATE TABLE public.ai_suggestion_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('helpful', 'not_helpful', 'solved')),
  item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(item_ids) <= 10),
  mode text CHECK (mode IS NULL OR mode IN ('knowledge', 'general')),
  areas text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(areas) <= 12),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_suggestion_feedback_user_idx ON public.ai_suggestion_feedback (user_id, created_at DESC);
ALTER TABLE public.ai_suggestion_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_suggestion_feedback FROM anon, authenticated;
GRANT SELECT, INSERT ON public.ai_suggestion_feedback TO authenticated;
CREATE POLICY "Users give their own feedback" ON public.ai_suggestion_feedback
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users read their own feedback, administrators read all" ON public.ai_suggestion_feedback
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE FUNCTION public.guard_ai_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.check_rate_limit('ai-feedback:' || auth.uid()::text, 40, 3600) THEN
    RAISE EXCEPTION 'Too many answers in a short time. Please try again later.' USING ERRCODE = '53400';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_ai_feedback() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_ai_feedback
  BEFORE INSERT ON public.ai_suggestion_feedback
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_feedback();

-- a helpful answer counts for the items that were shown
CREATE FUNCTION public.count_ai_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.verdict IN ('helpful', 'solved') AND cardinality(NEW.item_ids) > 0 THEN
    UPDATE public.knowledge_solutions SET helpful_count = COALESCE(helpful_count, 0) + 1 WHERE id = ANY (NEW.item_ids);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.count_ai_feedback() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_count_ai_feedback
  AFTER INSERT ON public.ai_suggestion_feedback
  FOR EACH ROW EXECUTE FUNCTION public.count_ai_feedback();