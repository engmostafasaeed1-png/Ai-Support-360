
-- Add social/personal columns to consultants
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS github_url text,
  ADD COLUMN IF NOT EXISTS personal_website text,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text;

-- Work history table
CREATE TABLE public.consultant_work_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  job_title text NOT NULL,
  start_date date,
  end_date date,
  description text,
  is_current boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultant_work_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants can manage own work history"
  ON public.consultant_work_history FOR ALL
  USING (EXISTS (SELECT 1 FROM consultants c WHERE c.id = consultant_work_history.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Admins can view all work history"
  ON public.consultant_work_history FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Work history readable by authenticated"
  ON public.consultant_work_history FOR SELECT TO authenticated
  USING (true);

-- Education table
CREATE TABLE public.consultant_education (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  institution text NOT NULL,
  degree text,
  field_of_study text,
  start_year integer,
  end_year integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultant_education ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants can manage own education"
  ON public.consultant_education FOR ALL
  USING (EXISTS (SELECT 1 FROM consultants c WHERE c.id = consultant_education.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Education readable by authenticated"
  ON public.consultant_education FOR SELECT TO authenticated
  USING (true);

-- Project portfolio table
CREATE TABLE public.consultant_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  client_industry text,
  sap_modules text[],
  description text,
  duration_months integer,
  role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultant_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants can manage own projects"
  ON public.consultant_projects FOR ALL
  USING (EXISTS (SELECT 1 FROM consultants c WHERE c.id = consultant_projects.consultant_id AND c.user_id = auth.uid()));

CREATE POLICY "Projects readable by authenticated"
  ON public.consultant_projects FOR SELECT TO authenticated
  USING (true);
