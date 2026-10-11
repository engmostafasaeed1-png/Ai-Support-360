import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';
import { mockClientPayments } from '@/data/clientMockData';

export function useClientPayments() {
  const { isGuest } = useGuestMode();
  const { tenant, loading: tenantLoading } = useTenant();

  return useQuery({
    queryKey: ['client-payments', tenant?.id ?? null],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, currency, vat_amount, status, invoice_number, payment_method, description, due_date, created_at, updated_at, ticket_id, consultant_id, session_id, kind, reference, client_reported_at, client_transfer_reference, client_transfer_date, rejection_note, paid_at, provider_status, card_started_at, pricing_model, base_amount, service_fee_percent, service_fee_amount, processing_fee_percent, processing_fee_amount, vat_percent, tenant_id, buyer_details, buyer_details_revision, buyer_details_at')
        .eq('client_id', user.id)
        // the payments of the active company; a payment that belongs to no company shows in every company
        .or(tenant?.id ? `tenant_id.eq.${tenant.id},tenant_id.is.null` : 'tenant_id.is.null,tenant_id.not.is.null')
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Fetch consultant names separately
      const consultantIds = [...new Set((data || []).map((p: any) => p.consultant_id).filter(Boolean))];
      const consultantMap: Record<string, string> = {};
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', consultantIds);
        if (consultants && consultants.length > 0) {
          const userIds = consultants.map((c: any) => c.user_id);
          const { data: profiles } = await supabase
            .from('profile_directory')
            .select('user_id, display_name')
            .in('user_id', userIds);
          const profileMap: Record<string, string> = {};
          (profiles || []).forEach((p: any) => { profileMap[p.user_id] = p.display_name; });
          consultants.forEach((c: any) => { consultantMap[c.id] = profileMap[c.user_id] || 'Unknown'; });
        }
      }

      // Fetch ticket titles for linked payments
      const ticketIds = [...new Set((data || []).map((p: any) => p.ticket_id).filter(Boolean))];
      const ticketMap: Record<string, { title: string; sap_module: string; urgency: string }> = {};
      if (ticketIds.length > 0) {
        const { data: tickets } = await supabase
          .from('tickets')
          .select('id, title, sap_module, urgency')
          .in('id', ticketIds);
        (tickets || []).forEach((t: any) => {
          ticketMap[t.id] = { title: t.title, sap_module: t.sap_module, urgency: t.urgency };
        });
      }

      // Fetch session info for linked payments
      const sessionIds = [...new Set((data || []).map((p: any) => p.session_id).filter(Boolean))];
      const sessionMap: Record<string, { session_type: string; status: string; scheduled_at: string | null; duration_minutes: number | null }> = {};
      if (sessionIds.length > 0) {
        const { data: sessions } = await supabase
          .from('sessions')
          .select('id, session_type, status, scheduled_at, duration_minutes')
          .in('id', sessionIds);
        (sessions || []).forEach((s: any) => {
          sessionMap[s.id] = {
            session_type: s.session_type,
            status: s.status,
            scheduled_at: s.scheduled_at,
            duration_minutes: s.duration_minutes,
          };
        });
      }

      return (data || []).map((p: any) => ({
        id: p.id,
        invoice: p.invoice_number || `INV-${p.id.slice(0, 8).toUpperCase()}`,
        consultant: p.consultant_id ? (consultantMap[p.consultant_id] || 'Unknown') : 'Unassigned',
        amount: p.amount,
        currency: p.currency || 'USD',
        vat: p.vat_amount || 0,
        status: p.status || 'pending',
        payment_method: p.payment_method || null,
        description: p.description || null,
        due_date: p.due_date || null,
        date: p.created_at?.split('T')[0] || '',
        created_at: p.created_at,
        updated_at: p.updated_at,
        ticket_id: p.ticket_id || null,
        ticket_title: p.ticket_id ? ticketMap[p.ticket_id]?.title : null,
        ticket_sap_module: p.ticket_id ? ticketMap[p.ticket_id]?.sap_module : null,
        ticket_urgency: p.ticket_id ? ticketMap[p.ticket_id]?.urgency : null,
        session_id: p.session_id || null,
        kind: p.kind || 'invoice',
        reference: p.reference || null,
        client_reported_at: p.client_reported_at || null,
        client_transfer_reference: p.client_transfer_reference || null,
        client_transfer_date: p.client_transfer_date || null,
        rejection_note: p.rejection_note || null,
        paid_at: p.paid_at || null,
        provider_status: p.provider_status || null,
        card_started_at: p.card_started_at || null,
        pricing_model: p.pricing_model || 'legacy',
        base_amount: p.base_amount ?? null,
        service_fee_percent: p.service_fee_percent ?? null,
        service_fee_amount: p.service_fee_amount ?? null,
        processing_fee_percent: p.processing_fee_percent ?? null,
        processing_fee_amount: p.processing_fee_amount ?? null,
vat_percent: p.vat_percent ?? null,
        tenant_id: p.tenant_id || null,
        buyer_details: p.buyer_details || null,
        buyer_details_revision: p.buyer_details_revision ?? 0,
        buyer_details_at: p.buyer_details_at || null,
        session_type: p.session_id ? sessionMap[p.session_id]?.session_type : null,
        session_status: p.session_id ? sessionMap[p.session_id]?.status : null,
        session_scheduled_at: p.session_id ? sessionMap[p.session_id]?.scheduled_at : null,
        session_duration_minutes: p.session_id ? sessionMap[p.session_id]?.duration_minutes : null,
      }));
    },
    enabled: !isGuest && !tenantLoading,
    placeholderData: isGuest ? (mockClientPayments as any) : undefined,
  });
}
