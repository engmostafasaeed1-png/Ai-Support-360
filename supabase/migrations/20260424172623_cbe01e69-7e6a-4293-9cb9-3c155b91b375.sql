ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS communication_score integer,
  ADD COLUMN IF NOT EXISTS technical_expertise_score integer,
  ADD COLUMN IF NOT EXISTS responsiveness_score integer;

ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_communication_score_check;
ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_communication_score_check
  CHECK (communication_score IS NULL OR (communication_score BETWEEN 1 AND 5));

ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_technical_expertise_score_check;
ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_technical_expertise_score_check
  CHECK (technical_expertise_score IS NULL OR (technical_expertise_score BETWEEN 1 AND 5));

ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_responsiveness_score_check;
ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_responsiveness_score_check
  CHECK (responsiveness_score IS NULL OR (responsiveness_score BETWEEN 1 AND 5));