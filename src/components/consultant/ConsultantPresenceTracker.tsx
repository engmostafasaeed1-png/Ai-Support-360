import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { PRESENCE_CHANNEL } from '@/lib/presence';

/**
 * While the app is open in the browser of a consultant, the consultant is "present": the browser joins the presence channel with the id of the consultant as the key,
 * and leaves it when the window is closed or the consultant signs out. Clients see Online or Busy only for a consultant who is present.
 * It renders nothing and is mounted once in App. Somebody who is not a consultant never joins.
 */
export default function ConsultantPresenceTracker() {
  const { isGuest } = useGuestMode();

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    let joined: { userId: string; channel: ReturnType<typeof supabase.channel> } | null = null;

    const leave = () => {
      if (joined) {
        void supabase.removeChannel(joined.channel);
        joined = null;
      }
    };

    const follow = async (userId: string | null) => {
      if (cancelled || (userId && joined?.userId === userId)) return;
      leave();
      if (!userId) return;
      const { data } = await supabase.from('consultants').select('id').eq('user_id', userId).maybeSingle();
      if (cancelled || !data?.id) return;
      const channel = supabase.channel(PRESENCE_CHANNEL, { config: { presence: { key: data.id } } });
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') void channel.track({ at: new Date().toISOString() });
      });
      joined = { userId, channel };
    };

    // One change at a time, so that two quick changes of the session can not join the channel twice.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (userId: string | null) => {
      queue = queue.then(() => follow(userId)).catch(() => undefined);
    };

    void supabase.auth.getSession().then(({ data }) => enqueue(data.session?.user.id ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase asks not to call it again from inside this callback: do it a moment later.
      setTimeout(() => enqueue(session?.user.id ?? null), 0);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
      leave();
    };
  }, [isGuest]);

  return null;
}
