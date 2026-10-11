-- M47: the notices of the referral program open the real Referrals page.
-- grant_referral_rewards() and process_referral_signup() wrote the link '/referrals', a page that does not exist (404).
-- The pages are /client/referrals and /consultant/referrals.

-- 1) The link for a person: the client page, or the consultant page for a person who is only a consultant.
CREATE OR REPLACE FUNCTION public.referrals_link_for(_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = 'client') THEN '/client/referrals'
    WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = 'consultant') THEN '/consultant/referrals'
    ELSE '/client/referrals'
  END;
$function$;
REVOKE ALL ON FUNCTION public.referrals_link_for(uuid) FROM PUBLIC, anon, authenticated;

-- 2) The reward notice (same function as before, only the link of the last notice changes).
CREATE OR REPLACE FUNCTION public.grant_referral_rewards(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ref public.referrals;
  _confirmed boolean;
  _rewarded integer;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO _ref FROM public.referrals
   WHERE referred_user_id = _user_id AND status = 'registered'
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT (u.email_confirmed_at IS NOT NULL) INTO _confirmed FROM auth.users u WHERE u.id = _user_id;
  IF NOT COALESCE(_confirmed, false) THEN
    RETURN;
  END IF;
  SELECT count(*) INTO _rewarded FROM public.referrals WHERE referrer_id = _ref.referrer_id AND status = 'rewarded';
  IF _rewarded >= 20 THEN
    UPDATE public.referrals SET status = 'expired', updated_at = now() WHERE id = _ref.id;
    RETURN;
  END IF;
  INSERT INTO public.referral_rewards (referral_id, user_id, reward_type, amount, currency, description)
  VALUES (_ref.id, _ref.referrer_id, 'credit', 25, 'USD', 'Referral bonus - the member you invited completed a first paid invoice'),
         (_ref.id, _user_id, 'discount', 15, 'USD', 'Welcome bonus - you joined through a referral and completed a first paid invoice')
  ON CONFLICT DO NOTHING;
  UPDATE public.referrals SET status = 'rewarded', updated_at = now() WHERE id = _ref.id;
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_ref.referrer_id, 'Referral reward earned', 'The member you invited completed a first paid invoice. You earned a $25 credit.', 'referral', public.referrals_link_for(_ref.referrer_id));
END;
$function$;

-- 3) The sign-up notice (same function as before, only the link changes).
CREATE OR REPLACE FUNCTION public.process_referral_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _referral_code text;
  _referrer_id uuid;
BEGIN
  _referral_code := NEW.raw_user_meta_data->>'referral_code';
  IF _referral_code IS NULL OR _referral_code = '' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO _referrer_id FROM public.profiles WHERE referral_code = _referral_code;
  IF _referrer_id IS NULL OR _referrer_id = NEW.id THEN
    RETURN NEW;
  END IF;

  UPDATE public.referrals
     SET status = 'registered', referred_user_id = NEW.id, updated_at = now()
   WHERE referral_code = _referral_code
     AND (referred_email = NEW.email OR referred_email IS NULL)
     AND status = 'pending';
  IF NOT FOUND THEN
    INSERT INTO public.referrals (referrer_id, referral_code, referred_user_id, status, referred_email)
    VALUES (_referrer_id, _referral_code, NEW.id, 'registered', NEW.email);
  END IF;

  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_referrer_id, 'Someone joined with your referral link',
          'Your $25 credit is added when the new member completes a first paid invoice.', 'referral', public.referrals_link_for(_referrer_id));
  RETURN NEW;
END;
$function$;

-- 4) Notices that were already written with the old link (none exist today) point to the right page.
UPDATE public.notifications SET link = public.referrals_link_for(user_id) WHERE link = '/referrals';
