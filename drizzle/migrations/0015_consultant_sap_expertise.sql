ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS sap_role text,
  ADD COLUMN IF NOT EXISTS seniority_level text,
  ADD COLUMN IF NOT EXISTS total_sap_years integer,
  ADD COLUMN IF NOT EXISTS sap_technologies text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS localization_countries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS project_types text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.consultants
  ADD CONSTRAINT consultants_sap_role_chk CHECK (sap_role IS NULL OR sap_role IN ('functional','technical','techno_functional','architect','basis','project_manager','integration','data_analytics')),
  ADD CONSTRAINT consultants_seniority_chk CHECK (seniority_level IS NULL OR seniority_level IN ('junior','mid','senior','lead','principal')),
  ADD CONSTRAINT consultants_sap_years_chk CHECK (total_sap_years IS NULL OR total_sap_years BETWEEN 0 AND 50),
  ADD CONSTRAINT consultants_sap_arrays_chk CHECK (cardinality(sap_technologies) <= 40 AND cardinality(localization_countries) <= 60 AND cardinality(project_types) <= 10);