-- M59: Web Push (phone alerts in the browser) for consultants: the third free channel of the critical request alert, next to the in-app alarm,
-- the e-mail and Telegram. A consultant turns it on in the settings of a device; the critical request alert function then pushes a short message
-- to every active device of that consultant. The browser never reads these tables: it only writes through the functions below.

-- the address of the push service of a browser (the same rule is in supabase/functions/_shared/webpush.ts): only the push services of the browsers
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  CONSTRAINT push_subscriptions_endpoint_check CHECK (
    char_length(endpoint) <= 1200
    AND endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)?push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]]*$'
  ),
  CONSTRAINT push_subscriptions_keys_check CHECK (p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$' AND auth ~ '^[A-Za-z0-9_-]{22,24}={0,2}$')
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id) WHERE active;

-- the VAPID key pair of the platform: one row, written once by the function push-setup (service role); the private key never leaves the server
CREATE TABLE IF NOT EXISTS public.push_vapid_keys (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{87}$'),
  private_jwk jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- no policies on purpose: only the service role (edge functions) and the definer functions below touch these tables
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_vapid_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.push_vapid_keys FROM PUBLIC, anon, authenticated;

-- what has been pushed for which version of a critical request, next to emailed_ext / telegram_ext
ALTER TABLE public.critical_alerts
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_ext integer;

-- a consultant turns phone alerts on for this device (the browser gives the address and the two keys of its push subscription)
CREATE OR REPLACE FUNCTION public.push_subscribe(_endpoint text, _p256dh text, _auth text, _user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _n integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = _uid) THEN
    RAISE EXCEPTION 'Only consultants can turn on phone alerts' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('push-subscribe:' || _uid::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many attempts. Please wait a while and try again.' USING ERRCODE = '54000';
  END IF;
  IF _endpoint IS NULL OR char_length(_endpoint) > 1200
     OR _endpoint !~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)?push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]]*$' THEN
    RAISE EXCEPTION 'This browser address for push messages is not accepted' USING ERRCODE = '22023';
  END IF;
  IF _p256dh IS NULL OR _p256dh !~ '^[A-Za-z0-9_-]{86,88}={0,2}$' OR _auth IS NULL OR _auth !~ '^[A-Za-z0-9_-]{22,24}={0,2}$' THEN
    RAISE EXCEPTION 'The push keys of this browser are not valid' USING ERRCODE = '22023';
  END IF;
  -- one browser belongs to one account: the browser that signs in as somebody else takes the subscription with it
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, active, created_at)
  VALUES (_uid, _endpoint, _p256dh, _auth, left(_user_agent, 300), true, clock_timestamp())
  ON CONFLICT (endpoint) DO UPDATE
     SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent,
         active = true, created_at = clock_timestamp(), last_error = NULL, last_error_at = NULL;
  -- addresses that stopped answering for 30 days are deleted
  DELETE FROM public.push_subscriptions WHERE NOT active AND COALESCE(last_error_at, created_at) < now() - interval '30 days';
  -- at most 8 devices per account: dead ones go first, then the oldest live ones
  DELETE FROM public.push_subscriptions
   WHERE id IN (SELECT id FROM public.push_subscriptions WHERE user_id = _uid ORDER BY active DESC, created_at DESC OFFSET 8);
  SELECT count(*) INTO _n FROM public.push_subscriptions WHERE user_id = _uid AND active;
  RETURN jsonb_build_object('devices', _n);
END
$function$;

-- a consultant turns phone alerts off for this device
CREATE OR REPLACE FUNCTION public.push_unsubscribe(_endpoint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  DELETE FROM public.push_subscriptions WHERE user_id = _uid AND endpoint = _endpoint;
END
$function$;

-- how many devices of the consultant get phone alerts, and whether this device (its address is given) is one of them (never the keys or the addresses)
CREATE OR REPLACE FUNCTION public.push_my_status(_endpoint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  RETURN jsonb_build_object(
    'devices', (SELECT count(*) FROM public.push_subscriptions WHERE user_id = _uid AND active),
    'this_device', COALESCE((SELECT s.active FROM public.push_subscriptions s WHERE s.user_id = _uid AND s.endpoint = _endpoint), false)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.push_subscribe(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.push_unsubscribe(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.push_my_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_subscribe(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_unsubscribe(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_my_status(text) TO authenticated;