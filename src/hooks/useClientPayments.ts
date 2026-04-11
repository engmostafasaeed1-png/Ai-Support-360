import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockClientPayments } from '@/data/clientMockData';

export function useClientPayments() {
  const { isGuest } = useGuestMode();

  return useQuery({
    queryKey: ['client-payments'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, amount, currency, vat_amount, status, invoice_number, payment_method,
          description, due_date, created_at, updated_at, ticket_id, consultant_id,
          consultants:consultant_id (
            user_id,
            profiles:user_id (display_name)
          )
        `)
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Fetch ticket titles for linked payments
      const ticketIds = [...new Set((data || []).map((p: any) => p.ticket_id).filter(Boolean))];
      let ticketMap: Record<string, { title: string; sap_module: string; urgency: string }> = {};
      if (ticketIds.length > 0) {
        const { data: tickets } = await supabase
          .from('tickets')
          .select('id, title, sap_module, urgency')
          .in('id', ticketIds);
        (tickets || []).forEach((t: any) => {
          ticketMap[t.id] = { title: t.title, sap_module: t.sap_module, urgency: t.urgency };
        });
      }

      return (data || []).map((p: any) => ({
        id: p.id,
        invoice: p.invoice_number || `INV-${p.id.slice(0, 8).toUpperCase()}`,
        consultant: p.consultants?.profiles?.display_name || 'Unknown',
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
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (mockClientPayments as any) : undefined,
  });
}
