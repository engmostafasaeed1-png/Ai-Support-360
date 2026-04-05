import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
  email: string;
  initials: string;
}

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); return; }

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

      setProfile({
        displayName,
        avatarUrl: data?.avatar_url || null,
        email: user.email || '',
        initials,
      });
      setLoading(false);
    };

    fetch();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetch();
    });

    return () => subscription.unsubscribe();
  }, []);

  return { profile, loading };
}
