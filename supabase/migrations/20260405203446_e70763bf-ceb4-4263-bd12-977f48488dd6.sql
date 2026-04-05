
ALTER TABLE public.nda_agreements
ADD COLUMN revoked_at timestamptz DEFAULT NULL,
ADD COLUMN revoked_by uuid DEFAULT NULL;
