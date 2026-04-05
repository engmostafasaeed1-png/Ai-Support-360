-- Add location column to consultants
ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS location point;

-- Enable realtime for consultants table
ALTER PUBLICATION supabase_realtime ADD TABLE public.consultants;