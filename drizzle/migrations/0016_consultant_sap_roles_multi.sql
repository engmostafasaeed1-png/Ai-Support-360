ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS sap_roles text[] NOT NULL DEFAULT '{}';
UPDATE public.consultants SET sap_roles = ARRAY[sap_role] WHERE sap_role IS NOT NULL AND cardinality(sap_roles) = 0;
ALTER TABLE public.consultants ADD CONSTRAINT consultants_sap_roles_chk CHECK (cardinality(sap_roles) <= 15);
COMMENT ON COLUMN public.consultants.sap_role IS 'DEPRECATED: replaced by sap_roles';