
-- Add resolution_notes to tickets
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS resolution_notes text;

-- Add source_ticket_id to playbooks for traceability
ALTER TABLE public.playbooks ADD COLUMN IF NOT EXISTS source_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_playbooks_source_ticket ON public.playbooks(source_ticket_id);

-- Function to auto-create/update playbook from closed ticket
CREATE OR REPLACE FUNCTION public.auto_create_playbook_from_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only fire when status changes to closed or resolved
  IF (NEW.status IN ('closed', 'resolved')) AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Check if playbook already exists for this ticket
    IF EXISTS (SELECT 1 FROM public.playbooks WHERE source_ticket_id = NEW.id) THEN
      UPDATE public.playbooks
      SET
        title = 'Resolution: ' || NEW.title,
        description = COALESCE(NEW.resolution_notes, NEW.description),
        sap_module = NEW.sap_module,
        category = COALESCE(NEW.ticket_type, 'standard'),
        steps = jsonb_build_array(
          jsonb_build_object('title', 'Problem Description', 'description', COALESCE(NEW.description, 'N/A')),
          jsonb_build_object('title', 'Resolution', 'description', COALESCE(NEW.resolution_notes, 'No resolution notes provided'))
        ),
        updated_at = now()
      WHERE source_ticket_id = NEW.id;
    ELSE
      INSERT INTO public.playbooks (title, description, category, sap_module, steps, is_active, source_ticket_id, tenant_id)
      VALUES (
        'Resolution: ' || NEW.title,
        COALESCE(NEW.resolution_notes, NEW.description),
        COALESCE(NEW.ticket_type, 'standard'),
        NEW.sap_module,
        jsonb_build_array(
          jsonb_build_object('title', 'Problem Description', 'description', COALESCE(NEW.description, 'N/A')),
          jsonb_build_object('title', 'Resolution', 'description', COALESCE(NEW.resolution_notes, 'No resolution notes provided'))
        ),
        true,
        NEW.id,
        NEW.tenant_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger on ticket status change
DROP TRIGGER IF EXISTS trg_auto_playbook_on_close ON public.tickets;
CREATE TRIGGER trg_auto_playbook_on_close
AFTER UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_playbook_from_ticket();
