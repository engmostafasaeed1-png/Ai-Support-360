CREATE TABLE public.client_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  company_name TEXT,
  company_size TEXT,
  industry TEXT,
  sap_landscape TEXT,
  phone TEXT,
  preferred_language TEXT DEFAULT 'en',
  communication_preference TEXT DEFAULT 'email',
  timezone TEXT DEFAULT 'Asia/Riyadh',
  sap_modules TEXT[] DEFAULT '{}',
  onboarding_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.client_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own client profile"
ON public.client_profiles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own client profile"
ON public.client_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own client profile"
ON public.client_profiles FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all client profiles"
ON public.client_profiles FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_client_profiles_updated_at
BEFORE UPDATE ON public.client_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();