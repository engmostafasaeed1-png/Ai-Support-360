import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PRESENCE_CHANNEL, presentIds } from '@/lib/presence';

/**
 * The ids of the consultants who are present now (the app is open in their browser), or null while that is not known:
 * before the first answer of the channel, when the connection fails, and when `enabled` is false.
 */
export function useConsultantPresence(enabled = true): ReadonlySet<string> | null {
  const [present, setPresent] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPresent(null);
      return;
    }
    const channel = supabase.channel(PRESENCE_CHANNEL);
    channel
      .on('presence', { event: 'sync' }, () => setPresent(presentIds(channel.presenceState())))
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return present;
}
