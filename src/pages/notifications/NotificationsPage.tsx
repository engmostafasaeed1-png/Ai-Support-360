import { useEffect, useMemo, useState } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Bell, Check, CheckCheck, Trash2, MessageSquare, Ticket, CreditCard, UserCheck, Info, X, AlertTriangle, RotateCw, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import NotificationPauseCard from '@/components/notifications/NotificationPauseCard';
import { BroadcastMessageDialog } from '@/components/messages/BroadcastMessages';
import { BROADCAST_TYPES } from '@/lib/bulkMessaging';
import { isReferralNotice, referralNoticeView } from '@/lib/referralNotice';
import { ReferralNoticeContent, ReferralNoticeIcon } from '@/components/notifications/ReferralNotice';

const isBroadcast = (type: string | null | undefined) => (BROADCAST_TYPES as readonly string[]).includes(String(type ?? ''));

const typeIcons: Record<string, typeof Bell> = {
  message: MessageSquare,
  ticket: Ticket,
  payment: CreditCard,
  approval: UserCheck,
  admin_message: Megaphone,
  admin_marketing: Megaphone,
};

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    markManyAsRead,
    deleteNotification,
    loadError,
    refetch,
  } = useNotifications();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language === 'ar' ? ar : enUS;

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Feature R: "Messages from AI Support 360" (admin bulk messages) open in their own window, and can be listed alone.
  const [params, setParams] = useSearchParams();
  const [onlyMessages, setOnlyMessages] = useState(false);
  const [openMessage, setOpenMessage] = useState<string | null>(null);
  const hasMessages = notifications.some((n) => isBroadcast(n.type));
  const shown = onlyMessages ? notifications.filter((n) => isBroadcast(n.type)) : notifications;
  const broadcastParam = params.get('broadcast');
  useEffect(() => {
    if (!broadcastParam) return;
    const hit = notifications.find((n) => isBroadcast(n.type) && (n.link ?? '').includes(broadcastParam));
    if (!hit) return;
    setOpenMessage(hit.id);
    if (!hit.is_read) markAsRead(hit.id);
    const next = new URLSearchParams(params); next.delete('broadcast'); setParams(next, { replace: true });
  }, [broadcastParam, notifications]); // eslint-disable-line react-hooks/exhaustive-deps

  const unreadSelectableIds = useMemo(
    () => notifications.filter((n) => !n.is_read).map((n) => n.id),
    [notifications]
  );

  const allUnreadSelected =
    unreadSelectableIds.length > 0 &&
    unreadSelectableIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  const selectAllUnread = () => {
    setSelectedIds(new Set(unreadSelectableIds));
  };

  const handleBulkMarkRead = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBusy(true);
    try {
      await markManyAsRead(ids);
      toast.success(
        ids.length === 1
          ? '1 notification marked as read'
          : `${ids.length} notifications marked as read`
      );
      exitSelectMode();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to mark notifications as read');
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async (id: string) => {
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)('retry_failed_notification', { _id: id });
      if (error) throw error;
      const status = (data as any)?.delivery_status;
      if (status === 'delivered') toast.success('Notification re-delivered');
      else toast.error('Retry failed — please try again');
    } catch (e: any) {
      toast.error(e?.message || 'Retry failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('notifications.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {unreadCount > 0
              ? t('notifications.unread_count', { count: unreadCount })
              : t('notifications.all_read')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!selectMode && notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={enterSelectMode}
              className="gap-1.5"
            >
              <Check className="w-4 h-4" />
              Select
            </Button>
          )}
          {unreadCount > 0 && !selectMode && (
            <Button variant="outline" size="sm" onClick={markAllAsRead} className="gap-1.5">
              <CheckCheck className="w-4 h-4" />
              {t('notifications.mark_all_read')}
            </Button>
          )}
        </div>
      </div>

      <NotificationPauseCard className="rounded-2xl" />

      {selectMode && (
        <Card className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-primary/30 bg-primary/5">
          <div className="flex items-center gap-3 text-sm">
            <Checkbox
              id="select-all-unread"
              checked={allUnreadSelected}
              onCheckedChange={(v) => (v ? selectAllUnread() : setSelectedIds(new Set()))}
              disabled={unreadSelectableIds.length === 0}
            />
            <label htmlFor="select-all-unread" className="cursor-pointer">
              {selectedCount > 0
                ? `${selectedCount} selected`
                : unreadSelectableIds.length > 0
                ? `Select all unread (${unreadSelectableIds.length})`
                : 'No unread notifications'}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleBulkMarkRead}
              disabled={selectedCount === 0 || busy}
              className="gap-1.5"
            >
              <CheckCheck className="w-4 h-4" />
              Mark as read
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelectMode} className="gap-1.5">
              <X className="w-4 h-4" />
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {loadError && (
        <Card
          className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-destructive/30 bg-destructive/5"
          role="alert"
          data-testid="notifications-load-error"
        >
          <div className="flex items-start gap-3 flex-1">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Your notifications could not be loaded</p>
              <p className="text-xs text-muted-foreground">
                {notifications.length > 0 ? 'The list below may be out of date.' : 'This is not an empty inbox: the list did not load.'} Check your connection and try again.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await refetch();
              } finally {
                setBusy(false);
              }
            }}
          >
            <RotateCw className="w-4 h-4" />
            Try again
          </Button>
        </Card>
      )}

      {notifications.length === 0 ? (
        loadError ? null : (
          <Card className="p-12 text-center">
            <Bell className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{t('notifications.empty')}</p>
          </Card>
        )
      ) : (
        <div className="space-y-2">
          {hasMessages && (
            <div className="flex gap-2" role="group" aria-label={t('bmsg.r_filter', 'Show')}>
              <Button size="sm" variant={onlyMessages ? 'outline' : 'default'} aria-pressed={!onlyMessages} onClick={() => setOnlyMessages(false)}>{t('bmsg.r_all', 'All')}</Button>
              <Button size="sm" variant={onlyMessages ? 'default' : 'outline'} aria-pressed={onlyMessages} onClick={() => setOnlyMessages(true)}><Megaphone className="me-1 h-4 w-4" />{t('bmsg.r_messages', 'Messages from AI Support 360')}</Button>
            </div>
          )}
          {shown.map((n) => {
            const Icon = (n.type && typeIcons[n.type]) || Info;
            const isSelected = selectedIds.has(n.id);
            const handleRowClick = () => {
              if (selectMode) {
                toggleSelect(n.id);
                return;
              }
              if (!n.is_read) markAsRead(n.id);
              if (isBroadcast(n.type)) { setOpenMessage(n.id); return; }
              if (isReferralNotice(n.type)) { navigate(referralNoticeView(n).link); return; }
              if (n.link) navigate(n.link);
            };
            return (
              <Card
                key={n.id}
                className={cn(
                  'p-4 flex items-start gap-3 transition-colors cursor-pointer hover:bg-muted/30',
                  !n.is_read && 'border-primary/30 bg-primary/5',
                  selectMode && isSelected && 'ring-2 ring-primary/60'
                )}
                onClick={handleRowClick}
              >
                {selectMode && (
                  <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(n.id)}
                      aria-label={`Select notification ${n.title}`}
                    />
                  </div>
                )}
                {isReferralNotice(n.type) ? (
                  <>
                    <ReferralNoticeIcon view={referralNoticeView(n)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <ReferralNoticeContent n={n} unread={!n.is_read} onOpen={() => { if (!n.is_read) markAsRead(n.id); }} />
                        {!n.is_read && <Badge className="text-[9px] px-1.5 py-0">{t('notifications.new')}</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale })}
                      </p>
                    </div>
                  </>
                ) : (
                <>
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    !n.is_read ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={cn('text-sm', !n.is_read && 'font-semibold')}>{n.title}</p>
                    {!n.is_read && (
                      <Badge className="text-[9px] px-1.5 py-0">{t('notifications.new')}</Badge>
                    )}
                    {(n as any).delivery_status === 'failed' && (
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0 gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" /> Failed
                      </Badge>
                    )}
                    {(n as any).delivery_status === 'pending' && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">Pending</Badge>
                    )}
                    {((n as any).retry_count ?? 0) > 0 && (
                      <span className="text-[9px] text-muted-foreground">
                        {(n as any).retry_count} {((n as any).retry_count === 1) ? 'retry' : 'retries'}
                      </span>
                    )}
                  </div>
                  {n.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                  )}
                  {(n as any).delivery_status === 'failed' && (n as any).delivery_error && (
                    <p className="text-[10px] text-destructive/80 mt-1 line-clamp-1" title={(n as any).delivery_error}>
                      Error: {(n as any).delivery_error}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale })}
                  </p>
                </div>
                </>
                )}
                {!selectMode && (
                  <div className="flex items-center gap-1 shrink-0">
                    {(n as any).delivery_status === 'failed' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Retry delivery"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetry(n.id);
                        }}
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {!n.is_read && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Mark as read"
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsRead(n.id);
                        }}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(n.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <BroadcastMessageDialog notificationId={openMessage} onClose={() => setOpenMessage(null)} />
    </div>
  );
}
