import { useMemo, useState } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Bell, Check, CheckCheck, Trash2, MessageSquare, Ticket, CreditCard, UserCheck, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const typeIcons: Record<string, typeof Bell> = {
  message: MessageSquare,
  ticket: Ticket,
  payment: CreditCard,
  approval: UserCheck,
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
  } = useNotifications();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language === 'ar' ? ar : enUS;

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

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

      {notifications.length === 0 ? (
        <Card className="p-12 text-center">
          <Bell className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">{t('notifications.empty')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = (n.type && typeIcons[n.type]) || Info;
            const isSelected = selectedIds.has(n.id);
            const handleRowClick = () => {
              if (selectMode) {
                toggleSelect(n.id);
                return;
              }
              if (!n.is_read) markAsRead(n.id);
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
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    !n.is_read ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn('text-sm', !n.is_read && 'font-semibold')}>{n.title}</p>
                    {!n.is_read && (
                      <Badge className="text-[9px] px-1.5 py-0">{t('notifications.new')}</Badge>
                    )}
                  </div>
                  {n.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale })}
                  </p>
                </div>
                {!selectMode && (
                  <div className="flex items-center gap-1 shrink-0">
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
    </div>
  );
}
