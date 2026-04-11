
-- Add hierarchy columns to business_processes
ALTER TABLE public.business_processes
  ADD COLUMN parent_id UUID REFERENCES public.business_processes(id) ON DELETE CASCADE,
  ADD COLUMN level INTEGER NOT NULL DEFAULT 1;

-- Index for tree queries
CREATE INDEX idx_business_processes_parent ON public.business_processes(parent_id);

-- Validation trigger: level must be 1-4 and match parent's level + 1
CREATE OR REPLACE FUNCTION public.validate_business_process_level()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.level < 1 OR NEW.level > 4 THEN
    RAISE EXCEPTION 'Business process level must be between 1 and 4';
  END IF;
  
  IF NEW.parent_id IS NOT NULL THEN
    DECLARE
      parent_level INTEGER;
    BEGIN
      SELECT level INTO parent_level FROM public.business_processes WHERE id = NEW.parent_id;
      IF parent_level IS NULL THEN
        RAISE EXCEPTION 'Parent business process not found';
      END IF;
      IF NEW.level != parent_level + 1 THEN
        RAISE EXCEPTION 'Child level must be parent level + 1';
      END IF;
    END;
  ELSE
    IF NEW.level != 1 THEN
      RAISE EXCEPTION 'Root processes must be level 1';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER validate_bp_level
  BEFORE INSERT OR UPDATE ON public.business_processes
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_business_process_level();
