import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockEarnings } from '@/data/consultantMockData';

export function useConsultantEarnings() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('consultant-earnings-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        queryClient.invalidateQueries({ queryKey: ['consultant-earnings'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payouts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['consultant-earnings'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient]);

  return useQuery({
    queryKey: ['consultant-earnings'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return mockEarnings;

      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!consultant) return mockEarnings;

      const { data: payments } = await supabase
        .from('payments')
        .select('amount, status, created_at')
        .eq('consultant_id', consultant.id);

      const { data: payouts } = await supabase
        .from('payouts')
        .select('amount, status')
        .eq('consultant_id', consultant.id);

      const all = payments || [];
      const total = all.reduce((s, p) => s + Number(p.amount), 0);
      const pending = all.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0);
      const completed = all.filter(p => p.status === 'completed').reduce((s, p) => s + Number(p.amount), 0);
      const paidOut = (payouts || []).filter(p => p.status === 'completed').reduce((s, p) => s + Number(p.amount), 0);

      const now = new Date();
      const thisMonth = all
        .filter(p => {
          const d = new Date(p.created_at);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((s, p) => s + Number(p.amount), 0);

      return {
        total,
        thisMonth,
        pending,
        available: completed - paidOut,
        currency: 'USD',
        monthlyTrend: mockEarnings.monthlyTrend,
      };
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockEarnings : undefined,
  });
}
