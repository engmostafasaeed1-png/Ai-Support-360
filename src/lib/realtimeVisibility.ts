import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Keeps a realtime channel open only while the tab is visible: it is removed when the tab is hidden
 * and rebuilt when the tab is shown again, then `onResume` runs so the page reloads what it missed.
 * Returns the cleanup for a useEffect (also removes the channel on unmount).
 */
export function subscribeWhileVisible(build: () => RealtimeChannel, onResume?: () => void): () => void {
  let channel: RealtimeChannel | null = null;
  const open = () => { if (!channel) channel = build().subscribe(); };
  const close = () => { if (channel) { void supabase.removeChannel(channel); channel = null; } };
  const hasDocument = typeof document !== 'undefined';
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') { close(); return; }
    if (!channel) { open(); onResume?.(); }
  };
  if (!hasDocument || document.visibilityState !== 'hidden') open();
  if (hasDocument) document.addEventListener('visibilitychange', onVisibility);
  return () => {
    if (hasDocument) document.removeEventListener('visibilitychange', onVisibility);
    close();
  };
}

/** Database id of the signed-in consultant (null for everyone else); one small lookup shared by realtime filters. */
let consultantIdCache: { userId: string; id: string | null } | null = null;
export async function consultantIdFor(userId: string): Promise<string | null> {
  if (consultantIdCache?.userId === userId) return consultantIdCache.id;
  const { data } = await supabase.from('consultants').select('id').eq('user_id', userId).maybeSingle();
  consultantIdCache = { userId, id: (data as { id?: string } | null)?.id ?? null };
  return consultantIdCache.id;
}
