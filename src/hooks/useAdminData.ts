import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { adminStats, adminUsers, kanbanTickets } from '@/data/adminMockData';

export function useAdminStats() {
  const { isGuest } = useGuestMode();

  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [
        { count: totalUsers },
        { count: activeConsultants },
        { count: openTickets },
        { data: payments },
        { count: pendingApprovals },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('consultants').select('*', { count: 'exact', head: true }).eq('verification_status', 'verified'),
        supabase.from('tickets').select('*', { count: 'exact', head: true }).not('status', 'in', '("resolved","closed")'),
        supabase.from('payments').select('amount').eq('status', 'completed'),
        supabase.from('consultants').select('*', { count: 'exact', head: true }).eq('verification_status', 'pending'),
      ]);

      const revenue = (payments || []).reduce((s, p) => s + Number(p.amount), 0);

      return {
        totalUsers: totalUsers || 0,
        activeConsultants: activeConsultants || 0,
        openTickets: openTickets || 0,
        revenue,
        avgResolutionTime: adminStats.avgResolutionTime,
        satisfaction: adminStats.satisfaction,
        ticketsThisMonth: adminStats.ticketsThisMonth,
        pendingApprovals: pendingApprovals || 0,
      };
    },
    enabled: !isGuest,
    placeholderData: isGuest ? adminStats : undefined,
  });
}

export function useAdminUsers() {
  const { isGuest } = useGuestMode();

  return useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!profiles) return [];

      // Get roles for all users
      const userIds = profiles.map(p => p.user_id);
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', userIds);

      const roleMap = new Map((roles || []).map(r => [r.user_id, r.role]));

      return profiles.map(p => ({
        id: p.user_id,
        name: p.display_name || 'Unknown',
        email: '',
        role: (roleMap.get(p.user_id) || 'client') as 'client' | 'consultant' | 'admin',
        status: 'active' as const,
        joined: p.created_at.split('T')[0],
        tickets: 0,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (adminUsers as any) : undefined,
  });
}

export function useAdminTickets() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('admin-tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['admin-tickets-kanban'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient]);

    queryKey: ['admin-tickets-kanban'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          id, title, sap_module, urgency, status, created_at,
          profiles:client_id (display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const result: Record<string, Array<{ id: string; title: string; client: string; module: string; urgency: string; created: string }>> = {
        new: [], under_review: [], matched: [], in_progress: [], waiting_for_client: [], resolved: [], closed: [],
      };

      (data || []).forEach((t: any) => {
        const status = t.status || 'new';
        if (result[status]) {
          result[status].push({
            id: t.id.slice(0, 8),
            title: t.title,
            client: t.profiles?.display_name || 'Unknown',
            module: t.sap_module,
            urgency: t.urgency || 'medium',
            created: new Date(t.created_at).toLocaleDateString(),
          });
        }
      });

      return result;
    },
    enabled: !isGuest,
    placeholderData: isGuest ? kanbanTickets : undefined,
  });
}
