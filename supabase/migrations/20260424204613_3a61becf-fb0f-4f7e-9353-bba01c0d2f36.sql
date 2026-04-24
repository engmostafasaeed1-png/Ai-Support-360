-- Add reward + badge fields to consultants
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS credibility_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_interview_completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS ai_interview_badge text;

-- Trigger function: award credits + badge when an AI interview is completed
CREATE OR REPLACE FUNCTION public.award_ai_interview_rewards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _score numeric;
  _badge text;
  _credit_award integer;
  _is_first boolean;
  _consultant_user_id uuid;
  _already_completed_at timestamp with time zone;
BEGIN
  -- Only fire when status transitions to 'completed' for an AI interview
  IF NEW.status <> 'completed' OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.interview_type::text, 'ai') <> 'ai' THEN
    RETURN NEW;
  END IF;

  _score := COALESCE(NEW.overall_score, 0);

  -- Determine badge tier
  IF _score >= 85 THEN
    _badge := 'Gold';
    _credit_award := 150;
  ELSIF _score >= 70 THEN
    _badge := 'Silver';
    _credit_award := 100;
  ELSIF _score >= 50 THEN
    _badge := 'Bronze';
    _credit_award := 75;
  ELSE
    _badge := 'Verified';
    _credit_award := 50;
  END IF;

  -- Check if consultant has previously completed an AI interview
  SELECT ai_interview_completed_at, user_id
    INTO _already_completed_at, _consultant_user_id
  FROM public.consultants
  WHERE id = NEW.consultant_id;

  _is_first := _already_completed_at IS NULL;

  -- Update consultant: always refresh score + badge; award credits only on first completion
  UPDATE public.consultants
  SET ai_skills_score = _score,
      ai_interview_badge = _badge,
      ai_interview_completed_at = COALESCE(ai_interview_completed_at, now()),
      credibility_credits = CASE
        WHEN _is_first THEN credibility_credits + _credit_award
        ELSE credibility_credits
      END,
      updated_at = now()
  WHERE id = NEW.consultant_id;

  -- Notify consultant
  IF _consultant_user_id IS NOT NULL THEN
    IF _is_first THEN
      PERFORM public.safe_insert_notification(
        _consultant_user_id,
        '🎉 AI Interview Reward Earned',
        'You completed your AI interview and earned the ' || _badge || ' badge plus ' || _credit_award || ' credibility credits. Clients can now see your verified skills score.',
        'interview',
        '/consultant/profile'
      );
    ELSE
      PERFORM public.safe_insert_notification(
        _consultant_user_id,
        'AI Interview Score Updated',
        'Your AI interview score has been updated. Your badge tier is now ' || _badge || '.',
        'interview',
        '/consultant/profile'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_ai_interview_rewards ON public.interview_sessions;
CREATE TRIGGER trg_award_ai_interview_rewards
AFTER UPDATE ON public.interview_sessions
FOR EACH ROW
EXECUTE FUNCTION public.award_ai_interview_rewards();