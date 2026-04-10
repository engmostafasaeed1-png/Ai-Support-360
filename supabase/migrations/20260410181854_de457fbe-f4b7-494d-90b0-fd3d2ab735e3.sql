
ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS sap_product text,
  ADD COLUMN IF NOT EXISTS sap_version text,
  ADD COLUMN IF NOT EXISTS sap_database_type text,
  ADD COLUMN IF NOT EXISTS sap_os_type text,
  ADD COLUMN IF NOT EXISTS sap_support_pack text,
  ADD COLUMN IF NOT EXISTS sap_go_live_date date,
  ADD COLUMN IF NOT EXISTS sap_user_count integer,
  ADD COLUMN IF NOT EXISTS sap_custom_dev_count integer,
  ADD COLUMN IF NOT EXISTS sap_interfaces text[],
  ADD COLUMN IF NOT EXISTS sap_third_party_tools text[],
  ADD COLUMN IF NOT EXISTS sap_landscape_notes text;
