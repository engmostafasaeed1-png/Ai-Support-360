-- M22 (SAP Notes the client already tried): a request can list the SAP Note NUMBERS the client has already tried.
-- Only numbers are stored (5 to 8 digits, at most 8, no duplicates). No SAP text and no SAP login is stored anywhere:
-- a note opens in SAP for Me, where every person signs in with their own account.
-- Also: the third administrator switch (the live SAP Community look-up) gets the same "on or off only" check as the first two.

-- ===== A. the list of note numbers on a request =====
CREATE FUNCTION public.is_sap_note_list(_v text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT _v IS NOT NULL
    AND cardinality(_v) <= 8
    AND NOT EXISTS (SELECT 1 FROM unnest(_v) AS n WHERE n IS NULL OR n !~ '^[0-9]{5,8}$')
    AND (SELECT count(DISTINCT n) FROM unnest(_v) AS n) = cardinality(_v)
$function$;

ALTER TABLE public.tickets
  ADD COLUMN sap_notes_tried text[] NOT NULL DEFAULT '{}'::text[] CHECK (public.is_sap_note_list(sap_notes_tried));

-- ===== B. the switch for the live SAP Community look-up: on or off only =====
CREATE OR REPLACE FUNCTION public.guard_ai_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.key IN ('ai_suggestions_enabled', 'ai_learning_enabled', 'ai_sap_community_enabled') AND jsonb_typeof(NEW.value) <> 'boolean' THEN
    RAISE EXCEPTION 'This setting must be switched on or off' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;