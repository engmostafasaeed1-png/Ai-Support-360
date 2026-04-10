
-- ═══════════════════════════════════════════
-- 1. SLA POLICIES & TRACKING
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  urgency TEXT NOT NULL DEFAULT 'medium',
  sap_module TEXT,
  response_time_minutes INT NOT NULL DEFAULT 240,
  resolution_time_minutes INT NOT NULL DEFAULT 1440,
  business_hours_only BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage SLA policies" ON public.ticket_sla_policies FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view active SLA policies" ON public.ticket_sla_policies FOR SELECT TO authenticated USING (is_active = true);

-- Add SLA fields to tickets
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS sla_policy_id UUID REFERENCES public.ticket_sla_policies(id),
  ADD COLUMN IF NOT EXISTS sla_response_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS editing_by UUID,
  ADD COLUMN IF NOT EXISTS editing_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into_ticket_id UUID REFERENCES public.tickets(id);

-- ═══════════════════════════════════════════
-- 2. CANNED RESPONSES
-- ═══════════════════════════════════════════

CREATE TABLE public.canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  sap_module TEXT,
  shortcut TEXT,
  created_by UUID,
  is_active BOOLEAN DEFAULT true,
  usage_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.canned_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage canned responses" ON public.canned_responses FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Creators can manage own responses" ON public.canned_responses FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "Authenticated can view active responses" ON public.canned_responses FOR SELECT TO authenticated USING (is_active = true);

-- ═══════════════════════════════════════════
-- 3. INTERNAL NOTES
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  content TEXT NOT NULL,
  mentioned_users UUID[] DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_internal_notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_internal_notes_ticket ON public.ticket_internal_notes(ticket_id);

CREATE POLICY "Admins can manage all notes" ON public.ticket_internal_notes FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authors can manage own notes" ON public.ticket_internal_notes FOR ALL USING (auth.uid() = author_id);
CREATE POLICY "Consultants can view notes on assigned tickets" ON public.ticket_internal_notes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.ticket_assignments ta
    JOIN public.consultants c ON c.id = ta.consultant_id
    WHERE ta.ticket_id = ticket_internal_notes.ticket_id AND c.user_id = auth.uid()
  ));

-- ═══════════════════════════════════════════
-- 4. CSAT SATISFACTION SURVEYS
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_satisfaction_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  consultant_id UUID,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_satisfaction_surveys ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_csat_ticket ON public.ticket_satisfaction_surveys(ticket_id);

CREATE POLICY "Admins can manage all surveys" ON public.ticket_satisfaction_surveys FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients can manage own surveys" ON public.ticket_satisfaction_surveys FOR ALL USING (auth.uid() = client_id);
CREATE POLICY "Consultants can view surveys on their tickets" ON public.ticket_satisfaction_surveys FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_satisfaction_surveys.consultant_id AND c.user_id = auth.uid()));

-- ═══════════════════════════════════════════
-- 5. TAGS
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  added_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, tag)
);

ALTER TABLE public.ticket_tags ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ticket_tags ON public.ticket_tags(ticket_id);

CREATE POLICY "Admins can manage all tags" ON public.ticket_tags FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Tag creators can manage own" ON public.ticket_tags FOR ALL USING (auth.uid() = added_by);
CREATE POLICY "Authenticated can view tags" ON public.ticket_tags FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════
-- 6. WATCHERS
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_watchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, user_id)
);

ALTER TABLE public.ticket_watchers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ticket_watchers ON public.ticket_watchers(ticket_id);

CREATE POLICY "Admins can manage all watchers" ON public.ticket_watchers FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can manage own watches" ON public.ticket_watchers FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Authenticated can view watchers" ON public.ticket_watchers FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════
-- 7. AUTO-ASSIGNMENT RULES
-- ═══════════════════════════════════════════

CREATE TABLE public.auto_assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sap_module TEXT,
  urgency TEXT,
  assignment_method TEXT NOT NULL DEFAULT 'round_robin',
  consultant_pool UUID[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  priority INT DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auto_assignment_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage assignment rules" ON public.auto_assignment_rules FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view active rules" ON public.auto_assignment_rules FOR SELECT TO authenticated USING (is_active = true);

-- ═══════════════════════════════════════════
-- 8. TICKET LINKS (MERGING & LINKING)
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  target_ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'related',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_ticket_id, target_ticket_id)
);

ALTER TABLE public.ticket_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ticket_links_source ON public.ticket_links(source_ticket_id);
CREATE INDEX idx_ticket_links_target ON public.ticket_links(target_ticket_id);

CREATE POLICY "Admins can manage all links" ON public.ticket_links FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view links" ON public.ticket_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create links" ON public.ticket_links FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- ═══════════════════════════════════════════
-- 9. ESCALATION RULES
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_escalation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  trigger_condition TEXT NOT NULL DEFAULT 'sla_breach',
  time_threshold_minutes INT DEFAULT 60,
  urgency_filter TEXT,
  sap_module_filter TEXT,
  escalate_to_role TEXT DEFAULT 'admin',
  notify_users UUID[] DEFAULT '{}',
  auto_change_urgency TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_escalation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage escalation rules" ON public.ticket_escalation_rules FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view active rules" ON public.ticket_escalation_rules FOR SELECT TO authenticated USING (is_active = true);

-- ═══════════════════════════════════════════
-- 10. CUSTOM FIELDS & FORMS
-- ═══════════════════════════════════════════

CREATE TABLE public.ticket_custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  options JSONB DEFAULT '[]',
  sap_module TEXT,
  is_required BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  placeholder TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_custom_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage custom fields" ON public.ticket_custom_field_definitions FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view active fields" ON public.ticket_custom_field_definitions FOR SELECT TO authenticated USING (is_active = true);

CREATE TABLE public.ticket_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.ticket_custom_field_definitions(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, field_id)
);

ALTER TABLE public.ticket_custom_field_values ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_custom_field_values ON public.ticket_custom_field_values(ticket_id);

CREATE POLICY "Admins can manage all field values" ON public.ticket_custom_field_values FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients can manage field values on own tickets" ON public.ticket_custom_field_values FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_custom_field_values.ticket_id AND t.client_id = auth.uid()));
CREATE POLICY "Consultants can view field values on assigned tickets" ON public.ticket_custom_field_values FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.ticket_assignments ta
    JOIN public.consultants c ON c.id = ta.consultant_id
    WHERE ta.ticket_id = ticket_custom_field_values.ticket_id AND c.user_id = auth.uid()
  ));

-- ═══════════════════════════════════════════
-- NOTIFY WATCHERS ON TICKET UPDATES
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_ticket_watchers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _watcher RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.urgency IS DISTINCT FROM OLD.urgency THEN
    FOR _watcher IN SELECT user_id FROM public.ticket_watchers WHERE ticket_id = NEW.id
    LOOP
      IF _watcher.user_id != auth.uid() THEN
        INSERT INTO public.notifications (user_id, title, body, type, link)
        VALUES (
          _watcher.user_id,
          'Watched Ticket Updated',
          'Ticket "' || NEW.title || '" was updated (status: ' || replace(NEW.status, '_', ' ') || ').',
          'ticket',
          '/client/tickets/' || NEW.id
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_watchers ON public.tickets;
CREATE TRIGGER trg_notify_watchers
  AFTER UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_watchers();

-- Timestamp triggers for new tables
CREATE TRIGGER update_sla_policies_updated_at BEFORE UPDATE ON public.ticket_sla_policies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_canned_responses_updated_at BEFORE UPDATE ON public.canned_responses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_internal_notes_updated_at BEFORE UPDATE ON public.ticket_internal_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_assignment_rules_updated_at BEFORE UPDATE ON public.auto_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_escalation_rules_updated_at BEFORE UPDATE ON public.ticket_escalation_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_custom_fields_updated_at BEFORE UPDATE ON public.ticket_custom_field_definitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_custom_values_updated_at BEFORE UPDATE ON public.ticket_custom_field_values FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
