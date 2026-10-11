-- M58: Telegram alerts for consultants (a free push channel next to the in-app alarm and the e-mail).
-- A consultant links a private Telegram chat through a one-time code; the critical request alert function then sends a short message there.
-- The browser never reads the chat id: it only gets its own status from telegram_my_status().

CREATE TABLE IF NOT EXISTS public.telegram_links (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL UNIQUE,
  telegram_username text,
  active boolean NOT NULL DEFAULT true,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  last_error text,
  last_error_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user_idx ON public.telegram_link_codes (user_id, created_at DESC);

-- no policies on purpose: only the service role (edge functions) and the definer functions below touch these two tables
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_link_codes FROM PUBLIC, anon, authenticated;

-- what has been sent for which version of a critical request (version = number of extensions), next to emailed_at / emailed_ext
ALTER TABLE public.critical_alerts
  ADD COLUMN IF NOT EXISTS telegram_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_ext integer;

-- the consultant's own status (never the chat id)
CREATE OR REPLACE FUNCTION public.telegram_my_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _l public.telegram_links;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO _l FROM public.telegram_links WHERE user_id = _uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('linked', false);
  END IF;
  RETURN jsonb_build_object(
    'linked', true,
    'active', _l.active,
    'username', _l.telegram_username,
    'linked_at', _l.linked_at,
    'last_sent_at', _l.last_sent_at,
    'paused_reason', CASE WHEN _l.active THEN NULL ELSE COALESCE(_l.last_error, 'stopped') END
  );
END
$function$;

-- the consultant disconnects: the link and the codes that are still open are removed
CREATE OR REPLACE FUNCTION public.telegram_unlink()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  DELETE FROM public.telegram_links WHERE user_id = _uid;
  DELETE FROM public.telegram_link_codes WHERE user_id = _uid AND used_at IS NULL;
END
$function$;

-- called by the webhook (service role) when Telegram sends "/start <code>": the code is single use and short lived
CREATE OR REPLACE FUNCTION public.telegram_complete_link(_code_hash text, _chat_id bigint, _username text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid;
  _old uuid;
BEGIN
  UPDATE public.telegram_link_codes
     SET used_at = now()
   WHERE code_hash = _code_hash AND used_at IS NULL AND expires_at > now()
  RETURNING user_id INTO _uid;
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;
  -- one Telegram chat belongs to one portal account: a chat that moves to another account leaves the old one, and the old account is told
  DELETE FROM public.telegram_links WHERE chat_id = _chat_id AND user_id <> _uid RETURNING user_id INTO _old;
  IF _old IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_old, 'Your Telegram alerts moved to another account',
      'The Telegram chat that received your critical request alerts was just connected to a different portal account, so you no longer get them there. If you did not do this, do not open links from people you do not know. Press Connect Telegram in your settings to connect again.',
      'critical_request', '/consultant/settings');
  END IF;
  INSERT INTO public.telegram_links (user_id, chat_id, telegram_username, active, linked_at, last_error, last_error_at)
  VALUES (_uid, _chat_id, left(NULLIF(btrim(_username), ''), 64), true, now(), NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
     SET chat_id = EXCLUDED.chat_id, telegram_username = EXCLUDED.telegram_username, active = true,
         linked_at = now(), last_error = NULL, last_error_at = NULL;
  DELETE FROM public.telegram_link_codes WHERE created_at < now() - interval '1 day';
  RETURN _uid;
END
$function$;

REVOKE ALL ON FUNCTION public.telegram_my_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.telegram_unlink() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.telegram_complete_link(text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_my_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_unlink() TO authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_complete_link(text, bigint, text) TO service_role;