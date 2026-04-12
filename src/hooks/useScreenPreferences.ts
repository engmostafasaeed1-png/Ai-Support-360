import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ScreenItem {
  key: string;
  label: string;
  group?: string;
}

export function useScreenPreferences(screens: ScreenItem[]) {
  const [hiddenScreens, setHiddenScreens] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || cancelled) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('user_screen_preferences')
        .select('screen_key, is_visible')
        .eq('user_id', session.user.id);

      if (!error && data && !cancelled) {
        const hidden = new Set<string>();
        data.forEach((row: any) => {
          if (!row.is_visible) hidden.add(row.screen_key);
        });
        setHiddenScreens(hidden);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleScreen = useCallback(async (screenKey: string, visible: boolean) => {
    setHiddenScreens(prev => {
      const next = new Set(prev);
      if (visible) next.delete(screenKey);
      else next.add(screenKey);
      return next;
    });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { error } = await supabase
      .from('user_screen_preferences')
      .upsert(
        { user_id: session.user.id, screen_key: screenKey, is_visible: visible },
        { onConflict: 'user_id,screen_key' }
      );

    if (error) {
      toast({ title: 'Error saving preference', description: error.message, variant: 'destructive' });
    }
  }, [toast]);

  const resetAll = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    await supabase
      .from('user_screen_preferences')
      .delete()
      .eq('user_id', session.user.id);

    setHiddenScreens(new Set());
    toast({ title: 'All screens restored' });
  }, [toast]);

  const isVisible = useCallback((key: string) => !hiddenScreens.has(key), [hiddenScreens]);

  return { hiddenScreens, loading, toggleScreen, resetAll, isVisible };
}
