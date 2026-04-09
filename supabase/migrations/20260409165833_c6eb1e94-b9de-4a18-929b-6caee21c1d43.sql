
ALTER TABLE public.ratings ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;
