-- ===== M43: the texts of the screens in other languages, kept in the database (QA defect DEF-024) =====
-- In Arabic mode a large part of the portal stayed English because the texts are written directly in the screens.
-- The Arabic text of every such sentence is now a row of this table; the app reads the table when the language is Arabic and replaces the English text it shows.
-- A row with {0}, {1} ... in the source is a pattern: the parts of the shown text that stand in the place of {0}, {1} ... are kept (names, numbers, titles).
-- Everyone can read the table (it only holds interface text); only the administrators can change it.

CREATE TABLE IF NOT EXISTS public.ui_translations (
  lang text NOT NULL,
  source text NOT NULL,
  target text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, source),
  CONSTRAINT ui_translations_lang_chk CHECK (lang ~ '^[a-z]{2}$'),
  CONSTRAINT ui_translations_source_len CHECK (char_length(source) BETWEEN 1 AND 600),
  CONSTRAINT ui_translations_target_len CHECK (char_length(target) BETWEEN 1 AND 1000)
);
COMMENT ON TABLE public.ui_translations IS 'Interface texts: source = the English text as shown by the app (or a pattern with {0}, {1}), target = the text in the language lang.';

ALTER TABLE public.ui_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ui_translations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ui_translations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ui_translations TO authenticated;

CREATE POLICY "Interface texts are readable by everyone" ON public.ui_translations
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Administrators manage interface texts" ON public.ui_translations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER update_ui_translations_updated_at
  BEFORE UPDATE ON public.ui_translations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- a short fingerprint of the texts of one language: the app keeps a copy of the texts and downloads them again only when the fingerprint changes
CREATE OR REPLACE FUNCTION public.ui_translations_version(_lang text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT md5(count(*)::text || ':' || coalesce(max(updated_at)::text, ''))
    FROM public.ui_translations
   WHERE lang = _lang;
$function$;

-- all texts of one language as one JSON object { source: target, ... }
CREATE OR REPLACE FUNCTION public.ui_translations_get(_lang text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_object_agg(source, target), '{}'::jsonb)
    FROM public.ui_translations
   WHERE lang = _lang;
$function$;

REVOKE EXECUTE ON FUNCTION public.ui_translations_version(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ui_translations_get(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ui_translations_version(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ui_translations_get(text) TO anon, authenticated;
