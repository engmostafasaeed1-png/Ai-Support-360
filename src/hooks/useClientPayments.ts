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
          id, amount, currency, vat_amount, status, invoice_number, created_at,
          consultants:consultant_id (
            profiles:user_id (display_name)
          )
        `)
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((p: any) => ({
        id: p.id,
        invoice: p.invoice_number || `INV-${p.id.slice(0, 8)}`,
        consultant: p.consultants?.profiles?.display_name || 'Unknown',
        amount: p.amount,
        currency: p.currency || 'USD',
        vat: p.vat_amount || 0,
        status: p.status || 'pending',
        date: p.created_at?.split('T')[0] || '',
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockClientPayments : undefined,
  });
}
