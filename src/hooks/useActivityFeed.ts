import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';
import { mockActivityFeed } from '@/data/clientMockData';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function useActivityFeed() {
  const { isGuest } = useGuestMode();
  const { tenant, loading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('activity-feed-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
        queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient]);

  return useQuery({
    queryKey: ['activity-feed', tenant?.id ?? null],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      let feed = supabase
        .from('notifications')
        .select('id, title, body, type, link, created_at')
        .or('type.is.null,type.neq.error')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(40);
      // the activity of the active company; an entry that belongs to no company shows in every company
      if (tenant?.id) feed = feed.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
      const { data, error } = await feed;
      if (error) throw error;

      const iconMap: Record<string, string> = {
        ticket: 'ticket',
        session: 'calendar',
        match: 'match',
        payment: 'payment',
        resolved: 'resolved',
      };

      const own = (data || []).filter(n => !/^\/(admin|consultant)(\/|$)/.test(n.link || '')).slice(0, 10);

      return own.map(n => ({
        id: n.id,
        type: n.type || 'ticket',
        message: n.body || n.title,
        time: timeAgo(n.created_at),
        icon: iconMap[n.type || ''] || 'ticket',
      }));
    },
    enabled: !isGuest && !tenantLoading,
    placeholderData: isGuest ? mockActivityFeed : undefined,
  });
}