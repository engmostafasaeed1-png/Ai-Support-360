import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { PRESENCE_CHANNEL, presentIds } from '@/lib/presence';
import { presenceStore } from '@/lib/presenceStore';

/**
 * The only place in the app that opens the presence channel (the Realtime library gives the same channel object to everybody who asks for the same name in one tab,
 * so a page that opened it again would break). Mounted once in App. For everybody who is signed in it listens and saves who is present in presenceStore,
 * where the pages read it. A consultant also joins with the id of the consultant as the key and says that the consultant is there, and leaves when the window
 * is closed or the consultant signs out. Nobody else is ever listed as present.
 */
export default function ConsultantPresenceTracker() {
  const { isGuest } = useGuestMode();

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    let joined: { userId: string; channel: ReturnType<typeof supabase.channel> } | null = null;

    const leave = async () => {
      const old = joined;
      joined = null;
      presenceStore.set(null);
      if (old) await supabase.removeChannel(old.channel);
    };

    const follow = async (userId: string | null) => {
      if (cancelled || (userId && joined?.userId === userId)) return;
      await leave();
      if (!userId) return;
      const { data } = await supabase.from('consultants').select('id').eq('user_id', userId).maybeSingle();
      if (cancelled) return;
      const consultantId: string | null = data?.id ?? null;
      const channel = supabase.channel(PRESENCE_CHANNEL, consultantId ? { config: { presence: { key: consultantId } } } : undefined);
      channel.on('presence', { event: 'sync' }, () => presenceStore.set(presentIds(channel.presenceState())));
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED' && consultantId) void channel.track({ at: new Date().toISOString() });
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
      void leave();
    };
  }, [isGuest]);

  return null;
}
