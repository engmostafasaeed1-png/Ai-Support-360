
CREATE TABLE public.user_screen_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  screen_key TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, screen_key)
);

ALTER TABLE public.user_screen_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own screen preferences"
ON public.user_screen_preferences FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own screen preferences"
ON public.user_screen_preferences FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own screen preferences"
ON public.user_screen_preferences FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own screen preferences"
ON public.user_screen_preferences FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_user_screen_preferences_updated_at
BEFORE UPDATE ON public.user_screen_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
