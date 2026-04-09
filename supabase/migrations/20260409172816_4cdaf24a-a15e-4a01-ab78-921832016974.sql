
-- Add ticket_id column to remote_environments
ALTER TABLE public.remote_environments
ADD COLUMN ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;

-- Drop the old status check constraint if it exists and recreate with expanded values
-- First check what constraint exists
DO $$
BEGIN
  -- Try to drop any existing check constraint on status
  BEGIN
    ALTER TABLE public.remote_environments DROP CONSTRAINT IF EXISTS remote_environments_status_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Create a validation trigger for status values
CREATE OR REPLACE FUNCTION public.validate_remote_env_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status NOT IN ('active', 'inactive', 'maintenance', 'hold', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_remote_env_status
BEFORE INSERT OR UPDATE ON public.remote_environments
FOR EACH ROW EXECUTE FUNCTION public.validate_remote_env_status();

-- Add index on ticket_id
CREATE INDEX idx_remote_environments_ticket_id ON public.remote_environments(ticket_id);

-- Add RLS policies for clients to manage their own environments
CREATE POLICY "Clients can create own environments"
ON public.remote_environments
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Clients can update own environments"
ON public.remote_environments
FOR UPDATE
TO authenticated
USING (auth.uid() = client_id);

CREATE POLICY "Clients can delete own environments"
ON public.remote_environments
FOR DELETE
TO authenticated
USING (auth.uid() = client_id);
