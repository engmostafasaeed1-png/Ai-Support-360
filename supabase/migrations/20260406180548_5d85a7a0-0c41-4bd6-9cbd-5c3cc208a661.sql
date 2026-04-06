-- Referrals table
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referred_email text,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'rewarded', 'expired')),
  referred_user_id uuid,
  source text DEFAULT 'link' CHECK (source IN ('link', 'email', 'whatsapp', 'qr', 'social')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referral_code, referred_email)
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_referrals_referrer ON public.referrals(referrer_id);
CREATE INDEX idx_referrals_code ON public.referrals(referral_code);
CREATE INDEX idx_referrals_referred_user ON public.referrals(referred_user_id);

-- RLS for referrals
CREATE POLICY "Users can view own referrals"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

CREATE POLICY "Users can create referrals"
  ON public.referrals FOR INSERT
  WITH CHECK (auth.uid() = referrer_id);

CREATE POLICY "Users can update own referrals"
  ON public.referrals FOR UPDATE
  USING (auth.uid() = referrer_id);

CREATE POLICY "Admins can manage all referrals"
  ON public.referrals FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Referral rewards table
CREATE TABLE public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reward_type text NOT NULL DEFAULT 'credit' CHECK (reward_type IN ('credit', 'discount')),
  amount numeric NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'expired')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_rewards_user ON public.referral_rewards(user_id);
CREATE INDEX idx_rewards_referral ON public.referral_rewards(referral_id);

-- RLS for rewards
CREATE POLICY "Users can view own rewards"
  ON public.referral_rewards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all rewards"
  ON public.referral_rewards FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at on referrals
CREATE TRIGGER update_referrals_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add referral_code column to profiles for each user's unique code
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

-- Function to generate referral code on profile creation
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := upper(substring(md5(NEW.user_id::text || now()::text) from 1 for 8));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_referral_code();

-- Generate codes for existing profiles that don't have one
UPDATE public.profiles
SET referral_code = upper(substring(md5(user_id::text || now()::text) from 1 for 8))
WHERE referral_code IS NULL;

-- Function to process referral on signup
CREATE OR REPLACE FUNCTION public.process_referral_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _referral_code text;
  _referral_record RECORD;
  _referrer_id uuid;
BEGIN
  _referral_code := NEW.raw_user_meta_data->>'referral_code';
  IF _referral_code IS NULL OR _referral_code = '' THEN
    RETURN NEW;
  END IF;

  -- Find the referrer by code
  SELECT user_id INTO _referrer_id FROM public.profiles WHERE referral_code = _referral_code;
  IF _referrer_id IS NULL OR _referrer_id = NEW.id THEN
    RETURN NEW;
  END IF;

  -- Update any pending referral for this email or create one
  UPDATE public.referrals
  SET status = 'registered', referred_user_id = NEW.id, updated_at = now()
  WHERE referral_code = _referral_code
    AND (referred_email = NEW.email OR referred_email IS NULL)
    AND status = 'pending'
  RETURNING * INTO _referral_record;

  IF _referral_record IS NULL THEN
    INSERT INTO public.referrals (referrer_id, referral_code, referred_user_id, status, referred_email)
    VALUES (_referrer_id, _referral_code, NEW.id, 'registered', NEW.email)
    RETURNING * INTO _referral_record;
  END IF;

  -- Create both-side rewards
  -- Referrer reward
  INSERT INTO public.referral_rewards (referral_id, user_id, reward_type, amount, currency, description)
  VALUES (_referral_record.id, _referrer_id, 'credit', 25, 'USD', 'Referral bonus — you invited a new user');

  -- New user reward
  INSERT INTO public.referral_rewards (referral_id, user_id, reward_type, amount, currency, description)
  VALUES (_referral_record.id, NEW.id, 'discount', 15, 'USD', 'Welcome bonus — you joined via referral');

  -- Notify referrer
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (
    _referrer_id,
    'Referral Success! 🎉',
    'Someone signed up using your referral link. You earned a $25 credit!',
    'referral',
    '/referrals'
  );

  -- Update referral status
  UPDATE public.referrals SET status = 'rewarded' WHERE id = _referral_record.id;

  RETURN NEW;
END;
$$;

-- Attach after the existing handle_new_user trigger
CREATE TRIGGER on_referral_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.process_referral_signup();