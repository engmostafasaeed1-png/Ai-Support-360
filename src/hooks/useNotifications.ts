import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';
import { isHeldNow } from '@/lib/notificationPause';
import { subscribeWhileVisible } from '@/lib/realtimeVisibility';

type Notification = Tables<'notifications'>;

// Unique per subscription. Several components can call this hook in the same render (header bell + notifications page);
// a Date.now() based name collided, supabase-js returned the already-subscribed channel and threw
// "cannot add `postgres_changes` callbacks ... after `subscribe()`", which crashed the Notifications page.
const uniqueSuffix = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchNotifications = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let data: Notification[] | null = null;
    let failed = false;
    try {
      const res = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (res.error) failed = true;
      else data = res.data;
    } catch {
      failed = true; // the request got no answer at all (offline, blocked)
    }

    if (data) {
      // Feature Q: notices held during a pause stay out of the bell until it ends.
      const now = Date.now();
      data = data.filter((n) => !isHeldNow(n as { held_until?: string | null }, now));
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.is_read).length);
    }
    // a failed load is not an empty inbox: the page shows an error with a Try again button
    setLoadError(failed);
    setLoading(false);
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  const markAllAsRead = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, []);

  const markManyAsRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    // Only count the ones currently unread so the badge stays accurate
    const targetSet = new Set(ids);
    let unreadDelta = 0;
    setNotifications(prev => {
      const next = prev.map(n => {
        if (targetSet.has(n.id) && !n.is_read) {
          unreadDelta++;
          return { ...n, is_read: true };
        }
        return n;
      });
      return next;
    });
    setUnreadCount(prev => Math.max(0, prev - unreadDelta));
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', ids);
    if (error) {
      // Roll back optimistic update on failure
      await fetchNotifications();
      throw error;
    }
  }, [fetchNotifications]);

  const deleteNotification = useCallback(async (id: string) => {
    const notif = notifications.find(n => n.id === id);
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (notif && !notif.is_read) setUnreadCount(prev => Math.max(0, prev - 1));
  }, [notifications]);

  useEffect(() => {
    fetchNotifications();

    // Only this person's rows (user_id filter), only while the tab is visible; on return the list is reloaded.
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return;
      cleanup = subscribeWhileVisible(() => supabase
        .channel(`notifications-realtime-${uniqueSuffix()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          (payload) => {
            const newNotif = payload.new as Notification;
            if (newNotif.user_id !== user.id) return;
            // The dashboard activity feed is built from notifications: refresh it here instead of a second channel.
            queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
            const extra = newNotif as Notification & { silent?: boolean; held_until?: string | null };
            if (isHeldNow(extra, Date.now())) return;
            setNotifications(prev => [newNotif, ...prev]);
            setUnreadCount(prev => prev + 1);
            // Paused in-app alerts arrive silently: kept in the bell, no pop-up.
            if (!extra.silent) {
              toast(newNotif.title, {
                description: newNotif.body || undefined,
              });
            }
          },
        ), () => {
        void fetchNotifications();
        queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
      });
    }).catch(() => { /* the list still loads; live updates are optional */ });

    return () => { cancelled = true; cleanup?.(); };
  }, [fetchNotifications, queryClient]);

  return { notifications, unreadCount, loading, loadError, markAsRead, markAllAsRead, markManyAsRead, deleteNotification, refetch: fetchNotifications };
}
