-- Add open_for_bids columns to tickets table
ALTER TABLE public.tickets 
ADD COLUMN open_for_bids boolean NOT NULL DEFAULT false,
ADD COLUMN opened_for_bids_at timestamp with time zone;

-- Allow consultants to view tickets open for bids (they need this to browse and submit proposals)
CREATE POLICY "Consultants can view open-for-bids tickets"
ON public.tickets
FOR SELECT
TO authenticated
USING (
  open_for_bids = true
  AND EXISTS (
    SELECT 1 FROM public.consultants c WHERE c.user_id = auth.uid()
  )
);