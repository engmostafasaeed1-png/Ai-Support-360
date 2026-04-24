
-- Helper: drop a known-broad SELECT policy by exact name (idempotent)
-- We use DROP POLICY IF EXISTS with the literal names from the scan.

-- 1. VMWARE SNAPSHOTS
DROP POLICY IF EXISTS "Authenticated users can view snapshots" ON public.vmware_snapshots;

CREATE POLICY "Snapshots visible to env owner, assigned consultant, or admin"
ON public.vmware_snapshots FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.remote_environments re
    LEFT JOIN public.consultants c ON c.id = re.consultant_id
    WHERE re.id = vmware_snapshots.environment_id
      AND (re.client_id = auth.uid() OR c.user_id = auth.uid())
  )
);

-- 2. VMWARE VM ACTIONS
DROP POLICY IF EXISTS "Authenticated users can view vm actions" ON public.vmware_vm_actions;
DROP POLICY IF EXISTS "Authenticated users can view actions" ON public.vmware_vm_actions;

CREATE POLICY "VM actions visible to env owner, assigned consultant, or admin"
ON public.vmware_vm_actions FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.remote_environments re
    LEFT JOIN public.consultants c ON c.id = re.consultant_id
    WHERE re.id = vmware_vm_actions.environment_id
      AND (re.client_id = auth.uid() OR c.user_id = auth.uid())
  )
);

-- 3. PREDICTION LOGS — restrict to users who can view the related ticket
DROP POLICY IF EXISTS "Authenticated can view prediction logs" ON public.prediction_logs;
DROP POLICY IF EXISTS "Authenticated users can view prediction logs" ON public.prediction_logs;

CREATE POLICY "Prediction logs visible to ticket participants or admin"
ON public.prediction_logs FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    LEFT JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.id = prediction_logs.ticket_id
      AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
  )
);

-- 4. PROBLEMS — tenant members or admin
DROP POLICY IF EXISTS "Authenticated can view problems" ON public.problems;
DROP POLICY IF EXISTS "Authenticated users can view problems" ON public.problems;

CREATE POLICY "Problems visible to tenant members or admin"
ON public.problems FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id))
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
);

-- 5. PROBLEM_INCIDENTS — restrict to users with access to the linked ticket
DROP POLICY IF EXISTS "Authenticated can view problem incidents" ON public.problem_incidents;
DROP POLICY IF EXISTS "Authenticated users can view problem incidents" ON public.problem_incidents;

CREATE POLICY "Problem-incident links visible to ticket participants or admin"
ON public.problem_incidents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    LEFT JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.id = problem_incidents.ticket_id
      AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
  )
);

-- 6. MAJOR INCIDENTS — tenant scoped
DROP POLICY IF EXISTS "Authenticated can view major incidents" ON public.major_incidents;
DROP POLICY IF EXISTS "Authenticated users can view major incidents" ON public.major_incidents;

CREATE POLICY "Major incidents visible to tenant members or admin"
ON public.major_incidents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id))
  OR created_by = auth.uid()
  OR incident_commander_id = auth.uid()
  OR communication_lead_id = auth.uid()
);

-- 7. MAJOR INCIDENT UPDATES — public updates: tenant members; non-public: admins only
DROP POLICY IF EXISTS "Authenticated can view major incident updates" ON public.major_incident_updates;
DROP POLICY IF EXISTS "Authenticated users can view major incident updates" ON public.major_incident_updates;

CREATE POLICY "Major incident updates visibility scoped"
ON public.major_incident_updates FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    is_public = true
    AND EXISTS (
      SELECT 1 FROM public.major_incidents mi
      WHERE mi.id = major_incident_updates.major_incident_id
        AND (
          (mi.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), mi.tenant_id))
          OR mi.created_by = auth.uid()
        )
    )
  )
);

-- 8. ONCALL SCHEDULES — admins and consultants in the rotation
DROP POLICY IF EXISTS "Authenticated can view schedules" ON public.oncall_schedules;
DROP POLICY IF EXISTS "Authenticated users can view schedules" ON public.oncall_schedules;

CREATE POLICY "Schedules visible to admin or rotation members"
ON public.oncall_schedules FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.oncall_rotations r
    JOIN public.consultants c ON c.id = r.consultant_id
    WHERE r.schedule_id = oncall_schedules.id
      AND c.user_id = auth.uid()
  )
);

-- 9. ONCALL ROTATIONS — admins and the consultant in the rotation
DROP POLICY IF EXISTS "Authenticated can view rotations" ON public.oncall_rotations;
DROP POLICY IF EXISTS "Authenticated users can view rotations" ON public.oncall_rotations;

CREATE POLICY "Rotations visible to admin or rotation member"
ON public.oncall_rotations FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = oncall_rotations.consultant_id
      AND c.user_id = auth.uid()
  )
);

-- 10. AUTO ASSIGNMENT RULES — admin only
DROP POLICY IF EXISTS "Authenticated can view auto assignment rules" ON public.auto_assignment_rules;
DROP POLICY IF EXISTS "Authenticated users can view auto assignment rules" ON public.auto_assignment_rules;

CREATE POLICY "Auto-assignment rules admin-only read"
ON public.auto_assignment_rules FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 11. TICKET ESCALATION RULES — admin only
DROP POLICY IF EXISTS "Authenticated can view escalation rules" ON public.ticket_escalation_rules;
DROP POLICY IF EXISTS "Authenticated users can view escalation rules" ON public.ticket_escalation_rules;

CREATE POLICY "Escalation rules admin-only read"
ON public.ticket_escalation_rules FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 12. REALTIME — restrict postgres_changes too
DROP POLICY IF EXISTS "Users can subscribe to their own channels" ON realtime.messages;
DROP POLICY IF EXISTS "Users can broadcast to their own channels" ON realtime.messages;

CREATE POLICY "Users can subscribe to scoped channels"
ON realtime.messages FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR topic LIKE '%' || auth.uid()::text || '%'
);

CREATE POLICY "Users can broadcast to scoped channels"
ON realtime.messages FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR topic LIKE '%' || auth.uid()::text || '%'
);

-- 13. STORAGE: consultants can read approved business process docs for their ticket clients
DROP POLICY IF EXISTS "Consultants can view approved business process docs" ON storage.objects;

CREATE POLICY "Consultants can view approved business process docs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-process-docs'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1
      FROM public.consultants c
      JOIN public.tickets t ON t.consultant_id = c.id
      WHERE c.user_id = auth.uid()
        AND t.client_id::text = (storage.foldername(name))[1]
    )
  )
);
