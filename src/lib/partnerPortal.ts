import { safeRpc } from '@/lib/safeRpc';

/** Partner portal MVP: browser talks only to the partner_* RPCs (docs/sql/partner-portal-mvp.sql). */
export interface PartnerResource {
  resource_id: string; consultant_id: string; status: 'invited' | 'active'; name: string;
  availability: 'available' | 'busy' | 'offline' | null; capacity_hours_week: number | null;
  hold: { from: string; to: string } | null; active_tickets: number; sla_at_risk: number;
  approved_hours_month: number; pending_hours_month: number; agreement_capacity: number;
}

/** Hours committed to agreements above the capacity the partner opened. */
export function capacityConflict(r: Pick<PartnerResource, 'capacity_hours_week' | 'agreement_capacity'>): number {
  if (r.capacity_hours_week == null) return 0;
  return Math.max(0, Number(r.agreement_capacity || 0) - r.capacity_hours_week);
}

export const partnerApi = {
  context: () => safeRpc<{ partner: boolean; demo_default: boolean; admin: boolean }>('partner_context'),
  adminSetDemo: (tenant: string, on: boolean) => safeRpc('admin_set_tenant_demo_partner', { _tenant: tenant, _on: on }),
  amI: () => safeRpc<boolean>('partner_am_i'),
  overview: () => safeRpc<PartnerResource[]>('partner_overview'),
  resource: (consultantId: string) => safeRpc<Record<string, any>>('partner_resource_overview', { _consultant_id: consultantId }),
  invite: (email: string) => safeRpc<'invited' | 'already' | 'not_found'>('partner_invite_resource', { _email: email }),
  setAvailability: (ids: string[], v: { status?: string | null; capacity?: number | null; holdFrom?: string | null; holdTo?: string | null }) =>
    safeRpc<{ consultant_id: string; agreement: string; committed: number }[]>('partner_set_availability', {
      _consultant_ids: ids, _status: v.status ?? null, _capacity: v.capacity ?? null, _hold_from: v.holdFrom ?? null, _hold_to: v.holdTo ?? null,
    }),
  myLinks: () => safeRpc<{ id: string; tenant_name: string; status: 'invited' | 'active'; invited_at: string }[]>('partner_my_links'),
  respond: (id: string, accept: boolean) => safeRpc('partner_respond', { _id: id, _accept: accept }),
  leave: () => safeRpc('partner_leave'),
  adminSetPartner: (tenant: string, on: boolean) => safeRpc('admin_set_tenant_partner', { _tenant: tenant, _on: on }),
};
