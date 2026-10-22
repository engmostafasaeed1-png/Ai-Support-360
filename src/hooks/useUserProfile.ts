import { useSessionReady } from '@/hooks/useSessionReady';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getSessionWithRetry, onUserChange } from '@/lib/authSession';

interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
  email: string;
  initials: string;
}

export function useUserProfile() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Same account: only a profile/metadata change (USER_UPDATED) needs a refresh.
    return onUserChange(() => { void queryClient.invalidateQueries({ queryKey: ['user-profile'] }); }, ['USER_UPDATED']);
  }, [queryClient]);

  const signedIn = useSessionReady().signedIn;
  const { data: profile = null, isLoading: loading } = useQuery({
    enabled: signedIn,
    queryKey: ['user-profile'],
    queryFn: async (): Promise<UserProfile | null> => {
      const session = await getSessionWithRetry();
      if (!session?.user) return null;

      const user = session.user;
      const { data } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();

      const displayName = data?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
      const initials = displayName
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

      return {
        displayName,
        avatarUrl: data?.avatar_url || null,
        email: user.email || '',
        initials,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  return { profile, loading };
}
