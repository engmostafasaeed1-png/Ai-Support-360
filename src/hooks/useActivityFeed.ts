import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
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

  return useQuery({
    queryKey: ['activity-feed'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, type, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;

      const iconMap: Record<string, string> = {
        ticket: 'ticket',
        session: 'calendar',
        match: 'match',
        payment: 'payment',
        resolved: 'resolved',
      };

      return (data || []).map(n => ({
        id: n.id,
        type: n.type || 'ticket',
        message: n.body || n.title,
        time: timeAgo(n.created_at),
        icon: iconMap[n.type || ''] || 'ticket',
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockActivityFeed : undefined,
  });
}
