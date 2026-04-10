
-- ==========================================
-- 1. CHANGE MANAGEMENT
-- ==========================================
CREATE TABLE public.change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  change_type text NOT NULL DEFAULT 'normal', -- standard, normal, emergency
  risk_level text NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  status text NOT NULL DEFAULT 'draft', -- draft, submitted, cab_review, approved, scheduled, implementing, completed, failed, cancelled
  rollback_plan text,
  implementation_plan text,
  affected_services text[] DEFAULT '{}',
  affected_modules text[] DEFAULT '{}',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  ticket_id uuid REFERENCES public.tickets(id),
  requested_by uuid NOT NULL,
  assigned_to uuid,
  tenant_id uuid REFERENCES public.tenants(id),
  cab_required boolean DEFAULT true,
  cab_decision text, -- approved, rejected, deferred
  cab_decision_at timestamptz,
  cab_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own change requests" ON public.change_requests FOR SELECT USING (auth.uid() = requested_by);
CREATE POLICY "Users can create change requests" ON public.change_requests FOR INSERT WITH CHECK (auth.uid() = requested_by);
CREATE POLICY "Users can update own change requests" ON public.change_requests FOR UPDATE USING (auth.uid() = requested_by);
CREATE POLICY "Admins can manage all change requests" ON public.change_requests FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Assigned consultants can view change requests" ON public.change_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM consultants c WHERE c.user_id = auth.uid() AND c.id = change_requests.assigned_to)
);

CREATE TABLE public.change_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL REFERENCES public.change_requests(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL,
  decision text NOT NULL DEFAULT 'pending', -- pending, approved, rejected, deferred
  comments text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.change_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approvers can view own approvals" ON public.change_approvals FOR SELECT USING (auth.uid() = approver_id);
CREATE POLICY "Approvers can update own approvals" ON public.change_approvals FOR UPDATE USING (auth.uid() = approver_id);
CREATE POLICY "Admins can manage all approvals" ON public.change_approvals FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Change requester can view approvals" ON public.change_approvals FOR SELECT USING (
  EXISTS (SELECT 1 FROM change_requests cr WHERE cr.id = change_approvals.change_request_id AND cr.requested_by = auth.uid())
);

-- ==========================================
-- 2. PROBLEM MANAGEMENT
-- ==========================================
CREATE TABLE public.problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new', -- new, investigating, root_cause_identified, known_error, resolved, closed
  priority text NOT NULL DEFAULT 'medium',
  root_cause text,
  workaround text,
  resolution text,
  is_known_error boolean DEFAULT false,
  sap_module text,
  affected_services text[] DEFAULT '{}',
  incident_count integer DEFAULT 0,
  assigned_to uuid,
  created_by uuid NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.problems ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view problems" ON public.problems FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create problems" ON public.problems FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creators can update own problems" ON public.problems FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Admins can manage all problems" ON public.problems FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Assigned can update problems" ON public.problems FOR UPDATE USING (
  EXISTS (SELECT 1 FROM consultants c WHERE c.user_id = auth.uid() AND c.id = problems.assigned_to)
);

CREATE TABLE public.problem_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  linked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(problem_id, ticket_id)
);
ALTER TABLE public.problem_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view problem incidents" ON public.problem_incidents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can link incidents" ON public.problem_incidents FOR INSERT WITH CHECK (auth.uid() = linked_by);
CREATE POLICY "Admins can manage problem incidents" ON public.problem_incidents FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- ==========================================
-- 3. SERVICE CATALOG
-- ==========================================
CREATE TABLE public.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  icon text DEFAULT 'Package',
  sap_module text,
  form_schema jsonb DEFAULT '[]',
  estimated_time text,
  estimated_cost numeric DEFAULT 0,
  cost_currency text DEFAULT 'USD',
  requires_approval boolean DEFAULT false,
  approval_roles text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  usage_count integer DEFAULT 0,
  tenant_id uuid REFERENCES public.tenants(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active catalog items are public" ON public.catalog_items FOR SELECT USING (is_active = true);
CREATE POLICY "Admins can manage catalog items" ON public.catalog_items FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.catalog_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id uuid NOT NULL REFERENCES public.catalog_items(id),
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'submitted', -- submitted, pending_approval, approved, in_progress, fulfilled, rejected, cancelled
  form_data jsonb DEFAULT '{}',
  approval_status text DEFAULT 'none', -- none, pending, approved, rejected
  approved_by uuid,
  approved_at timestamptz,
  fulfilled_at timestamptz,
  ticket_id uuid REFERENCES public.tickets(id),
  notes text,
  tenant_id uuid REFERENCES public.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own catalog requests" ON public.catalog_requests FOR SELECT USING (auth.uid() = requested_by);
CREATE POLICY "Users can create catalog requests" ON public.catalog_requests FOR INSERT WITH CHECK (auth.uid() = requested_by);
CREATE POLICY "Users can update own catalog requests" ON public.catalog_requests FOR UPDATE USING (auth.uid() = requested_by);
CREATE POLICY "Admins can manage all catalog requests" ON public.catalog_requests FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- ==========================================
-- 4. MAJOR INCIDENT MANAGEMENT
-- ==========================================
CREATE TABLE public.major_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'p1', -- p1, p2
  status text NOT NULL DEFAULT 'declared', -- declared, investigating, mitigating, resolved, post_review, closed
  ticket_id uuid REFERENCES public.tickets(id),
  war_room_link text,
  incident_commander_id uuid,
  communication_lead_id uuid,
  affected_services text[] DEFAULT '{}',
  affected_users_count integer DEFAULT 0,
  business_impact text,
  timeline_summary text,
  root_cause text,
  resolution_summary text,
  pir_scheduled_at timestamptz,
  pir_completed_at timestamptz,
  pir_notes text,
  lessons_learned text,
  action_items jsonb DEFAULT '[]',
  declared_at timestamptz DEFAULT now(),
  mitigated_at timestamptz,
  resolved_at timestamptz,
  tenant_id uuid REFERENCES public.tenants(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.major_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view major incidents" ON public.major_incidents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create major incidents" ON public.major_incidents FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admins can manage major incidents" ON public.major_incidents FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Commanders can update major incidents" ON public.major_incidents FOR UPDATE USING (auth.uid() = incident_commander_id);

CREATE TABLE public.major_incident_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  major_incident_id uuid NOT NULL REFERENCES public.major_incidents(id) ON DELETE CASCADE,
  update_type text NOT NULL DEFAULT 'status', -- status, communication, technical, resolution
  content text NOT NULL,
  is_public boolean DEFAULT false,
  posted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.major_incident_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view updates" ON public.major_incident_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can post updates" ON public.major_incident_updates FOR INSERT WITH CHECK (auth.uid() = posted_by);
CREATE POLICY "Admins can manage updates" ON public.major_incident_updates FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- ==========================================
-- 5. PLAYBOOKS
-- ==========================================
CREATE TABLE public.playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text DEFAULT 'general',
  sap_module text,
  trigger_conditions jsonb DEFAULT '{}',
  steps jsonb NOT NULL DEFAULT '[]', -- [{order, title, description, type, required, automated}]
  is_active boolean DEFAULT true,
  usage_count integer DEFAULT 0,
  avg_completion_minutes integer,
  created_by uuid,
  tenant_id uuid REFERENCES public.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active playbooks visible to authenticated" ON public.playbooks FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Admins can manage playbooks" ON public.playbooks FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.playbook_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid NOT NULL REFERENCES public.playbooks(id),
  ticket_id uuid REFERENCES public.tickets(id),
  executed_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'in_progress', -- in_progress, completed, abandoned
  current_step integer DEFAULT 0,
  step_results jsonb DEFAULT '[]', -- [{step_order, status, notes, completed_at}]
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.playbook_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own executions" ON public.playbook_executions FOR SELECT USING (auth.uid() = executed_by);
CREATE POLICY "Users can create executions" ON public.playbook_executions FOR INSERT WITH CHECK (auth.uid() = executed_by);
CREATE POLICY "Users can update own executions" ON public.playbook_executions FOR UPDATE USING (auth.uid() = executed_by);
CREATE POLICY "Admins can manage all executions" ON public.playbook_executions FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- ==========================================
-- 6. PREDICTIVE INTELLIGENCE
-- ==========================================
CREATE TABLE public.prediction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
  prediction_type text NOT NULL, -- assignment, priority, resolution_time, category, similar_incidents
  predicted_value jsonb NOT NULL,
  confidence numeric,
  model_used text,
  accepted boolean,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prediction_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view predictions" ON public.prediction_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can insert predictions" ON public.prediction_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can manage predictions" ON public.prediction_logs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- ==========================================
-- 7. ON-CALL SCHEDULING
-- ==========================================
CREATE TABLE public.oncall_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  sap_module text,
  rotation_type text NOT NULL DEFAULT 'weekly', -- daily, weekly, biweekly, custom
  timezone text DEFAULT 'Asia/Riyadh',
  is_active boolean DEFAULT true,
  tenant_id uuid REFERENCES public.tenants(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oncall_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view schedules" ON public.oncall_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage schedules" ON public.oncall_schedules FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.oncall_rotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.oncall_schedules(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id),
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  is_override boolean DEFAULT false,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oncall_rotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view rotations" ON public.oncall_rotations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage rotations" ON public.oncall_rotations FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Consultants can view own rotations" ON public.oncall_rotations FOR SELECT USING (
  EXISTS (SELECT 1 FROM consultants c WHERE c.user_id = auth.uid() AND c.id = oncall_rotations.consultant_id)
);

-- ==========================================
-- Triggers for updated_at
-- ==========================================
CREATE TRIGGER update_change_requests_updated_at BEFORE UPDATE ON public.change_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_problems_updated_at BEFORE UPDATE ON public.problems FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_catalog_items_updated_at BEFORE UPDATE ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_catalog_requests_updated_at BEFORE UPDATE ON public.catalog_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_major_incidents_updated_at BEFORE UPDATE ON public.major_incidents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_playbooks_updated_at BEFORE UPDATE ON public.playbooks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_oncall_schedules_updated_at BEFORE UPDATE ON public.oncall_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_change_requests_status ON public.change_requests(status);
CREATE INDEX idx_change_requests_requested_by ON public.change_requests(requested_by);
CREATE INDEX idx_problems_status ON public.problems(status);
CREATE INDEX idx_problems_is_known_error ON public.problems(is_known_error);
CREATE INDEX idx_catalog_items_category ON public.catalog_items(category);
CREATE INDEX idx_catalog_requests_requested_by ON public.catalog_requests(requested_by);
CREATE INDEX idx_major_incidents_status ON public.major_incidents(status);
CREATE INDEX idx_playbook_executions_ticket ON public.playbook_executions(ticket_id);
CREATE INDEX idx_prediction_logs_ticket ON public.prediction_logs(ticket_id);
CREATE INDEX idx_oncall_rotations_dates ON public.oncall_rotations(start_date, end_date);
