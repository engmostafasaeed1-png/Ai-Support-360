import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

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

    const channelName = `notifications-realtime-${uniqueSuffix()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const newNotif = payload.new as Notification;
          // Check if it's for the current user by checking against existing state
          supabase.auth.getUser().then(({ data: { user } }) => {
            if (user && newNotif.user_id === user.id) {
              setNotifications(prev => [newNotif, ...prev]);
              setUnreadCount(prev => prev + 1);
              toast(newNotif.title, {
                description: newNotif.body || undefined,
              });
            }
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchNotifications]);

  return { notifications, unreadCount, loading, loadError, markAsRead, markAllAsRead, markManyAsRead, deleteNotification, refetch: fetchNotifications };
}
