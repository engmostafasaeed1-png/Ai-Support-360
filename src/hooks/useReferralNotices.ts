import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const REFERRAL_UNREAD_KEY = ['referral-notices-unread'] as const;
export interface ReferralNote { id: string; type: string; title: string; body: string; link: string | null; created_at: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in person's unread Refer & earn notices of the last 30 days (own rows only, by row security). */
export function useUnreadReferralNotices(enabled: boolean) {
  return useQuery({
    queryKey: REFERRAL_UNREAD_KEY,
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReferralNote[]> => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase.from('notifications').select('id, type, title, body, link, created_at')
        .eq('type', 'referral').eq('is_read', false).gte('created_at', since).order('created_at', { ascending: false }).limit(20);
      if (error) return [];
      return (data ?? []) as ReferralNote[];
    },
  });
}

/** Marks own notifications as read. Non-notification ids (virtual items) are ignored. Throws on failure (retried by the caller). */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  const list = ids.filter((id) => UUID.test(id));
  if (!list.length) return;
  const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', list);
  if (error) throw new Error(error.message || 'Could not save');
}
