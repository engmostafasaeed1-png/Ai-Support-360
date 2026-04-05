import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Bell, Check, CheckCheck, Trash2, MessageSquare, Ticket, CreditCard, UserCheck, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

const typeIcons: Record<string, typeof Bell> = {
  message: MessageSquare,
  ticket: Ticket,
  payment: CreditCard,
  approval: UserCheck,
};

export default function NotificationsPage() {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteNotification } = useNotifications();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language === 'ar' ? ar : enUS;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('notifications.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {unreadCount > 0
              ? t('notifications.unread_count', { count: unreadCount })
              : t('notifications.all_read')}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllAsRead} className="gap-1.5">
            <CheckCheck className="w-4 h-4" />
            {t('notifications.mark_all_read')}
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <Card className="p-12 text-center">
          <Bell className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">{t('notifications.empty')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => {
            const Icon = (n.type && typeIcons[n.type]) || Info;
            return (
              <Card
                key={n.id}
                className={cn(
                  'p-4 flex items-start gap-3 transition-colors cursor-pointer hover:bg-muted/30',
                  !n.is_read && 'border-primary/30 bg-primary/5'
                )}
                onClick={() => { if (!n.is_read) markAsRead(n.id); if (n.link) navigate(n.link); }}
              >
                <div className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  !n.is_read ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn('text-sm', !n.is_read && 'font-semibold')}>{n.title}</p>
                    {!n.is_read && <Badge className="text-[9px] px-1.5 py-0">{t('notifications.new')}</Badge>}
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale })}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!n.is_read && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
