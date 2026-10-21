import { useState } from 'react';
import { Bell, BellOff, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useNotificationPause } from '@/hooks/useNotificationPause';
import { allowedDurations, formatPauseEnd, type PauseDuration } from '@/lib/notificationPause';
import PauseNotificationsDialog, { DURATION_LABEL } from './PauseNotificationsDialog';
import { BroadcastPopup } from '@/components/messages/BroadcastMessages';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface NotificationBellProps {
  basePath: string; // e.g. '/client', '/consultant', '/admin'
}

export default function NotificationBell({ basePath }: NotificationBellProps) {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language === 'ar' ? ar : enUS;
  const recent = notifications.slice(0, 8);
  const { available, info, pause, resume } = useNotificationPause();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseFor, setPauseFor] = useState<PauseDuration>('1w');

  return (
    <>
    {/* Feature R: admin messages sent with the pop-up option show once, here in every portal. */}
    <BroadcastPopup />
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative"
          aria-label={pause ? t('npause.bell_paused', 'Notifications, paused until {{date}}', { date: formatPauseEnd(pause.paused_until, i18n.language) }) : t('notifications.title')}>
          {pause ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {unreadCount > 0 && (
            <span className="absolute top-1 end-1 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between p-3 border-b border-border/50">
          <h4 className="font-semibold text-sm">{t('notifications.title')}</h4>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button onClick={markAllAsRead} className="text-xs text-primary hover:underline">
                {t('notifications.mark_all_read')}
              </button>
            )}
            {available && (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                  <BellOff className="w-3 h-3" aria-hidden />{t('npause.pause_for', 'Pause for…')}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {pause && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('npause.paused_until', 'Paused until {{date}}', { date: formatPauseEnd(pause.paused_until, i18n.language) })}</DropdownMenuLabel>}
                  {allowedDurations(info?.max_days).map((d) => (
                    <DropdownMenuItem key={d} onSelect={() => { setPauseFor(d); setPauseOpen(true); }}>
                      {t(DURATION_LABEL[d][0], DURATION_LABEL[d][1])}
                    </DropdownMenuItem>
                  ))}
                  {pause && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => resume.mutate('bell', {
                        onSuccess: () => toast.success(t('npause.resumed_toast', 'Your notifications are back on.')),
                        onError: (e) => toast.error((e as Error).message),
                      })}>{t('npause.resume', 'Resume now')}</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {pause && (
          <p className="px-3 py-2 text-xs text-muted-foreground border-b border-border/50 bg-muted/30" role="status">
            {t('npause.paused_until', 'Paused until {{date}}', { date: formatPauseEnd(pause.paused_until, i18n.language) })}
          </p>
        )}
        <ScrollArea className="max-h-80">
          {recent.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t('notifications.empty')}
            </div>
          ) : (
            recent.map(n => (
              <button
                key={n.id}
                onClick={() => { if (!n.is_read) markAsRead(n.id); if (n.link) navigate(n.link); }}
                className={cn(
                  'w-full text-start p-3 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0',
                  !n.is_read && 'bg-primary/5'
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.is_read && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                  <div className={cn('flex-1 min-w-0', n.is_read && 'ms-4')}>
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </ScrollArea>
        <div className="p-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs gap-1.5"
            onClick={() => navigate(`${basePath}/notifications`)}
          >
            <ExternalLink className="w-3 h-3" />
            {t('notifications.view_all')}
          </Button>
        </div>
      </PopoverContent>
      <PauseNotificationsDialog open={pauseOpen} onOpenChange={setPauseOpen} initialDuration={pauseFor} source="bell" />
    </Popover>
  );
}
