
-- Enable pg_net for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function to auto-trigger AI analysis on session completion
CREATE OR REPLACE FUNCTION public.auto_analyze_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _supabase_url text;
  _anon_key text;
BEGIN
  -- Only fire when status changes to completed
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    -- Get the Supabase URL and anon key from vault or hardcode
    _supabase_url := current_setting('app.settings.supabase_url', true);
    _anon_key := current_setting('app.settings.anon_key', true);

    -- If settings not available, skip (analysis can be triggered manually)
    IF _supabase_url IS NULL OR _anon_key IS NULL THEN
      RAISE NOTICE 'Supabase URL or anon key not configured, skipping auto-analysis';
      RETURN NEW;
    END IF;

    -- Call the edge function asynchronously
    PERFORM extensions.http_post(
      url := _supabase_url || '/functions/v1/ai-session-analysis',
      body := json_build_object('session_id', NEW.id)::text,
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _anon_key
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER trg_auto_analyze_session
AFTER UPDATE OF status ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.auto_analyze_session();
