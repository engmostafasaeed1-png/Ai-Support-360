-- Partner portal MVP (prepared only; owner reviews before applying).
-- Partner = tenant with is_partner=true (admin sets). Resources linked via partner_resources.
-- Browser has NO table grants on partner_resources; everything goes through the RPCs below.

INSERT INTO public.platform_settings (key, value) VALUES ('partner_portal', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
DROP POLICY IF EXISTS "Signed-in users can read partner_portal" ON public.platform_settings;
CREATE POLICY "Signed-in users can read partner_portal" ON public.platform_settings
  FOR SELECT TO authenticated USING (key = 'partner_portal');

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_partner boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.partner_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','declined','left','removed')),
  capacity_hours_week integer CHECK (capacity_hours_week BETWEEN 0 AND 80),
  invited_by uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  ended_at timestamptz
);
GRANT ALL ON public.partner_resources TO service_role;
ALTER TABLE public.partner_resources ENABLE ROW LEVEL SECURITY; -- no policies: RPC access only
CREATE UNIQUE INDEX IF NOT EXISTS partner_resources_one_active ON public.partner_resources (consultant_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS partner_resources_one_invite ON public.partner_resources (tenant_id, consultant_id) WHERE status = 'invited';

-- Feature on?
CREATE OR REPLACE FUNCTION public.partner_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT value = 'true'::jsonb FROM platform_settings WHERE key = 'partner_portal'), false)
$$;

-- Partner tenant the caller manages (owner/admin/manager of a partner tenant), else NULL.
CREATE OR REPLACE FUNCTION public.partner_tenant_for(_uid uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = _uid AND t.is_partner AND m.org_role IN ('owner','admin','manager') AND partner_enabled()
  ORDER BY m.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.partner_am_i() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT partner_tenant_for(auth.uid()) IS NOT NULL
$$;

-- Admin toggle.
CREATE OR REPLACE FUNCTION public.admin_set_tenant_partner(_tenant uuid, _on boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin')) THEN RAISE EXCEPTION 'permission_missing'; END IF;
  UPDATE tenants SET is_partner = _on, updated_at = now() WHERE id = _tenant;
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'partner_flag', 'tenant', _tenant, jsonb_build_object('is_partner', _on));
END $$;

-- Invite a consultant by e-mail (notification row; the existing pipeline e-mails it).
CREATE OR REPLACE FUNCTION public.partner_invite_resource(_email text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := partner_tenant_for(auth.uid()); _c uuid; _u uuid; _tname text;
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'permission_missing'; END IF;
  IF (SELECT count(*) FROM partner_resources WHERE tenant_id = _t AND invited_at > now() - interval '1 day') >= 20 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT c.id, c.user_id INTO _c, _u FROM auth.users a JOIN consultants c ON c.user_id = a.id WHERE lower(a.email) = lower(trim(_email));
  IF _c IS NULL THEN RETURN 'not_found'; END IF; -- same answer shape; no account details leaked
  IF EXISTS (SELECT 1 FROM partner_resources WHERE consultant_id = _c AND tenant_id = _t AND status IN ('invited','active')) THEN RETURN 'already'; END IF;
  INSERT INTO partner_resources (tenant_id, consultant_id, invited_by) VALUES (_t, _c, auth.uid());
  SELECT name INTO _tname FROM tenants WHERE id = _t;
  INSERT INTO notifications (user_id, title, body, type, link)
  VALUES (_u, 'Partner invitation', _tname || ' invites you to join its team on AI Support 360. Open your dashboard to accept or decline.', 'partner', '/consultant');
  RETURN 'invited';
END $$;

-- Consultant: my invitations / membership.
CREATE OR REPLACE FUNCTION public.partner_my_links() RETURNS TABLE (id uuid, tenant_name text, status text, invited_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, t.name, r.status, r.invited_at FROM partner_resources r
  JOIN tenants t ON t.id = r.tenant_id JOIN consultants c ON c.id = r.consultant_id
  WHERE c.user_id = auth.uid() AND r.status IN ('invited','active') AND partner_enabled()
$$;

CREATE OR REPLACE FUNCTION public.partner_respond(_id uuid, _accept boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partner_resources r JOIN consultants c ON c.id = r.consultant_id
                 WHERE r.id = _id AND c.user_id = auth.uid() AND r.status = 'invited') THEN RAISE EXCEPTION 'permission_missing'; END IF;
  IF _accept AND EXISTS (SELECT 1 FROM partner_resources r2 WHERE r2.consultant_id = (SELECT consultant_id FROM partner_resources WHERE id = _id) AND r2.status = 'active')
    THEN RAISE EXCEPTION 'already_in_partner'; END IF;
  UPDATE partner_resources SET status = CASE WHEN _accept THEN 'active' ELSE 'declined' END,
    accepted_at = CASE WHEN _accept THEN now() END, ended_at = CASE WHEN _accept THEN NULL ELSE now() END WHERE id = _id;
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata) VALUES (auth.uid(), 'partner_respond', 'partner_resource', _id, jsonb_build_object('accept', _accept));
END $$;

CREATE OR REPLACE FUNCTION public.partner_leave() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE partner_resources r SET status = 'left', ended_at = now() FROM consultants c
  WHERE c.id = r.consultant_id AND c.user_id = auth.uid() AND r.status = 'active';
  INSERT INTO audit_logs (user_id, action, entity_type, metadata) VALUES (auth.uid(), 'partner_leave', 'partner_resource', '{}'::jsonb);
END $$;

-- Partner: list of resources with headline numbers.
CREATE OR REPLACE FUNCTION public.partner_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := partner_tenant_for(auth.uid());
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'permission_missing'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'resource_id', r.id, 'consultant_id', r.consultant_id, 'status', r.status,
    'name', consultant_public_name(r.consultant_id), 'availability', c.availability_status,
    'capacity_hours_week', r.capacity_hours_week,
    'hold', (SELECT jsonb_build_object('from', p.starts_at, 'to', p.ends_at) FROM consultant_unavailable_periods p
             WHERE p.consultant_id = r.consultant_id AND p.ends_at >= now() ORDER BY p.starts_at LIMIT 1),
    'active_tickets', (SELECT count(*) FROM tickets k WHERE k.status NOT IN ('resolved','closed') AND (k.consultant_id = r.consultant_id
        OR EXISTS (SELECT 1 FROM ticket_team_members m WHERE m.ticket_id = k.id AND m.consultant_id = r.consultant_id AND m.ended_at IS NULL AND m.accepted_at IS NOT NULL))),
    'sla_at_risk', (SELECT count(*) FROM tickets k WHERE k.consultant_id = r.consultant_id AND k.status NOT IN ('resolved','closed')
        AND (k.sla_breached OR (k.first_response_at IS NULL AND k.sla_response_deadline < now() + interval '4 hours'))),
    'approved_hours_month', (SELECT coalesce(sum(w.hours),0) FROM ticket_work_logs w JOIN ticket_timesheet_submissions s ON s.id = w.submission_id
        WHERE w.consultant_id = r.consultant_id AND s.status = 'approved' AND w.work_date >= date_trunc('month', now())),
    'pending_hours_month', (SELECT coalesce(sum(w.hours),0) FROM ticket_work_logs w LEFT JOIN ticket_timesheet_submissions s ON s.id = w.submission_id
        WHERE w.consultant_id = r.consultant_id AND coalesce(s.status,'draft') <> 'approved' AND w.work_date >= date_trunc('month', now())),
    'agreement_capacity', (SELECT coalesce(sum(a.capacity_hours_per_week),0) FROM sa_members a WHERE a.consultant_id = r.consultant_id AND a.ended_at IS NULL)
  ) ORDER BY r.status, r.invited_at) FROM partner_resources r JOIN consultants c ON c.id = r.consultant_id
    WHERE r.tenant_id = _t AND r.status IN ('invited','active')), '[]'::jsonb);
END $$;

-- Partner: one resource end to end (active resources of the caller's partner only).
CREATE OR REPLACE FUNCTION public.partner_resource_overview(_consultant_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := partner_tenant_for(auth.uid()); c consultants%ROWTYPE;
BEGIN
  IF _t IS NULL OR NOT EXISTS (SELECT 1 FROM partner_resources WHERE tenant_id = _t AND consultant_id = _consultant_id AND status = 'active')
    THEN RAISE EXCEPTION 'permission_missing'; END IF;
  SELECT * INTO c FROM consultants WHERE id = _consultant_id;
  RETURN jsonb_build_object(
    'name', consultant_public_name(c.id), 'verification', c.verification_status,
    'profile_submitted', c.profile_submitted_at IS NOT NULL, 'interview_done', c.ai_interview_completed_at IS NOT NULL,
    'policy_accepted', EXISTS (SELECT 1 FROM consultant_policy_acknowledgements a WHERE a.user_id = c.user_id),
    'nda_signed', (SELECT count(*) FROM nda_agreements n WHERE n.consultant_id IN (c.id, c.user_id) AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL AND n.revoked_at IS NULL),
    'rating', c.rating, 'reviews', c.total_reviews,
    'responsiveness', (SELECT jsonb_build_object('level', public_level, 'rate_90d', rate_90d) FROM consultant_responsiveness WHERE consultant_id = c.id),
    'success', (SELECT jsonb_build_object('level', level, 'solved_12m', solved_12m, 'requests_12m', requests_12m) FROM consultant_success_stats WHERE consultant_id = c.id),
    'tickets', coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'status', k.status, 'sla_breached', k.sla_breached,
        'sla_deadline', k.sla_response_deadline, 'first_response_at', k.first_response_at) ORDER BY k.created_at DESC)
      FROM tickets k WHERE k.status NOT IN ('resolved','closed') AND (k.consultant_id = c.id OR EXISTS (SELECT 1 FROM ticket_team_members m
        WHERE m.ticket_id = k.id AND m.consultant_id = c.id AND m.ended_at IS NULL AND m.accepted_at IS NOT NULL))), '[]'::jsonb),
    'agreements', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'ref', g.reference, 'status', g.status,
        'role', m.member_role, 'capacity', m.capacity_hours_per_week))
      FROM sa_members m JOIN sa_agreements g ON g.id = m.agreement_id AND m.ended_at IS NULL
      WHERE m.consultant_id = c.id), '[]'::jsonb),
    'hours_month', jsonb_build_object(
      'approved', (SELECT coalesce(sum(w.hours),0) FROM ticket_work_logs w JOIN ticket_timesheet_submissions s ON s.id = w.submission_id
        WHERE w.consultant_id = c.id AND s.status = 'approved' AND w.work_date >= date_trunc('month', now())),
      'logged', (SELECT coalesce(sum(w.hours),0) FROM ticket_work_logs w WHERE w.consultant_id = c.id AND w.work_date >= date_trunc('month', now()))));
END $$;

-- Partner: open/close availability, capacity and hold for selected active resources. Returns agreement conflicts.
CREATE OR REPLACE FUNCTION public.partner_set_availability(_consultant_ids uuid[], _status availability_status, _capacity integer, _hold_from timestamptz, _hold_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := partner_tenant_for(auth.uid()); _ids uuid[];
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'permission_missing'; END IF;
  SELECT array_agg(consultant_id) INTO _ids FROM partner_resources WHERE tenant_id = _t AND status = 'active' AND consultant_id = ANY(_consultant_ids);
  IF _ids IS NULL OR cardinality(_ids) <> cardinality(_consultant_ids) THEN RAISE EXCEPTION 'permission_missing'; END IF;
  IF _hold_from IS NOT NULL AND (_hold_to IS NULL OR _hold_to <= _hold_from OR _hold_to > _hold_from + interval '90 days') THEN RAISE EXCEPTION 'invalid_hold'; END IF;
  IF _status IS NOT NULL THEN UPDATE consultants SET availability_status = _status, updated_at = now() WHERE id = ANY(_ids); END IF;
  IF _capacity IS NOT NULL THEN UPDATE partner_resources SET capacity_hours_week = _capacity WHERE tenant_id = _t AND status = 'active' AND consultant_id = ANY(_ids); END IF;
  IF _hold_from IS NOT NULL THEN
    INSERT INTO consultant_unavailable_periods (consultant_id, starts_at, ends_at, reason) SELECT unnest(_ids), _hold_from, _hold_to, 'Set by partner';
  END IF;
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata) VALUES (auth.uid(), 'partner_availability', 'tenant', _t,
    jsonb_build_object('consultants', _ids, 'status', _status, 'capacity', _capacity, 'hold_from', _hold_from, 'hold_to', _hold_to));
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('consultant_id', m.consultant_id, 'agreement', g.name, 'committed', m.capacity_hours_per_week))
    FROM sa_members m JOIN sa_agreements g ON g.id = m.agreement_id
    WHERE m.consultant_id = ANY(_ids) AND m.ended_at IS NULL AND g.status IN ('agreed','active')
      AND (_status IN ('offline','busy') OR (_capacity IS NOT NULL AND _capacity < m.capacity_hours_per_week)
           OR (_hold_from IS NOT NULL AND (g.end_date IS NULL OR g.end_date >= _hold_from::date)))), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.partner_enabled(), public.partner_tenant_for(uuid), public.partner_am_i(), public.admin_set_tenant_partner(uuid, boolean),
  public.partner_invite_resource(text), public.partner_my_links(), public.partner_respond(uuid, boolean), public.partner_leave(),
  public.partner_overview(), public.partner_resource_overview(uuid),
  public.partner_set_availability(uuid[], availability_status, integer, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_am_i(), public.admin_set_tenant_partner(uuid, boolean), public.partner_invite_resource(text),
  public.partner_my_links(), public.partner_respond(uuid, boolean), public.partner_leave(), public.partner_overview(),
  public.partner_resource_overview(uuid), public.partner_set_availability(uuid[], availability_status, integer, timestamptz, timestamptz) TO authenticated;
