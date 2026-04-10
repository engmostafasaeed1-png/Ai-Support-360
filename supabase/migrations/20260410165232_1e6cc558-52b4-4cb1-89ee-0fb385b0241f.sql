
-- Add planning & approval columns to tickets
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS planned_hours numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS cost_breakdown jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS plan_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_approved_by uuid,
  ADD COLUMN IF NOT EXISTS plan_rejection_reason text;

-- Expand ticket status to support full workflow
-- We'll use text status (already text in the table) so no enum change needed.
-- The statuses are enforced at the application level.

-- Create trigger to notify on every status change
CREATE OR REPLACE FUNCTION public.notify_ticket_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _msg text;
  _consultant_user_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _msg := 'Ticket "' || NEW.title || '" status changed to "' || replace(NEW.status, '_', ' ') || '".';

    -- Notify client
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Ticket Status Update',
      _msg,
      'ticket',
      '/client/tickets/' || NEW.id
    );

    -- Notify assigned consultant if any
    IF NEW.consultant_id IS NOT NULL THEN
      SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
      IF _consultant_user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, body, type, link)
        VALUES (
          _consultant_user_id,
          'Ticket Status Update',
          _msg,
          'ticket',
          '/consultant/cases/' || NEW.id
        );
      END IF;
    END IF;
  END IF;

  -- Notify client when plan is submitted for approval
  IF NEW.plan_submitted_at IS NOT NULL AND OLD.plan_submitted_at IS NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Plan Ready for Approval',
      'A cost & effort plan (' || NEW.planned_hours || 'h, ' || NEW.planned_cost || ' ' || COALESCE(NEW.cost_currency, 'USD') || ') for "' || NEW.title || '" needs your approval.',
      'ticket',
      '/client/tickets/' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_status_change ON public.tickets;
CREATE TRIGGER trg_ticket_status_change
  AFTER UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ticket_status_change();
