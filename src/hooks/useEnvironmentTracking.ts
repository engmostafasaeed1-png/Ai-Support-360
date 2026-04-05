import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useEnvironmentTracking() {
  const sessionIdRef = useRef<string | null>(null);

  const trackConnect = useCallback(async (environmentId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('environment_sessions')
      .insert({
        environment_id: environmentId,
        user_id: user.id,
      } as any)
      .select('id')
      .single();

    if (!error && data) {
      sessionIdRef.current = data.id;
    }
  }, []);

  const trackDisconnect = useCallback(async () => {
    if (!sessionIdRef.current) return;
    const id = sessionIdRef.current;
    sessionIdRef.current = null;

    const { data: session } = await supabase
      .from('environment_sessions')
      .select('connected_at')
      .eq('id', id)
      .single();

    const duration = session?.connected_at
      ? Math.round((Date.now() - new Date(session.connected_at).getTime()) / 60000)
      : 0;

    await supabase
      .from('environment_sessions')
      .update({
        disconnected_at: new Date().toISOString(),
        duration_minutes: duration,
      } as any)
      .eq('id', id);
  }, []);

  return { trackConnect, trackDisconnect };
}
