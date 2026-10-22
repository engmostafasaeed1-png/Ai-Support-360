import { useTranslation } from 'react-i18next';
import { Megaphone } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import MessageBody from '@/components/messages/MessageBody';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useBroadcastMessage, useBroadcastPopups, type BroadcastMessage } from '@/hooks/useBulkMessaging';
import { markNotificationsRead } from '@/hooks/useReferralNotices';
import { useNoticeQueue } from '@/hooks/useNoticeQueue';
import NoticeModal from '@/components/notifications/NoticeModal';

/** Full text of one "Message from AI Support 360", opened from the notification centre. */
export function BroadcastMessageDialog({ notificationId, onClose }: { notificationId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useBroadcastMessage(notificationId);
  return (
    <Dialog open={!!notificationId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        {q.isLoading ? <Skeleton className="h-32" /> : q.data ? <MessageView m={q.data} /> : (
          <DialogHeader><DialogTitle>{t('bmsg.r_title', 'Message from AI Support 360')}</DialogTitle>
            <DialogDescription>{t('bmsg.r_missing', 'This message is no longer available.')}</DialogDescription></DialogHeader>
        )}
        <DialogFooter><Button onClick={onClose}>{t('bmsg.r_close', 'Close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageView({ m }: { m: BroadcastMessage }) {
  const { t } = useTranslation();
  return (
    <>
      <DialogHeader>
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary"><Megaphone className="h-3.5 w-3.5" aria-hidden />{t('bmsg.r_title', 'Message from AI Support 360')}</p>
        <DialogTitle dir={m.lang === 'ar' ? 'rtl' : 'ltr'}>{m.subject}</DialogTitle>
        <DialogDescription className="sr-only">{t('bmsg.r_title', 'Message from AI Support 360')}</DialogDescription>
      </DialogHeader>
      <MessageBody text={m.body} lang={m.lang} />
    </>
  );
}

/**
 * Pop-up messages (the administrator chose "Pop-up on next visit"): shared notice queue, so one at a time with "1 of N",
 * closing is immediate and marks the notification read in the background, and each message opens at most once per device.
 */
export function BroadcastPopup() {
  const { t } = useTranslation();
  const { signedIn } = useSessionReady();
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const q = useBroadcastPopups(signedIn && !isGuest);
  const items = q.data ?? [];
  const queue = useNoticeQueue<BroadcastMessage>({
    family: 'broadcast', items, enabled: signedIn && !isGuest, idOf: (m) => m.notification_id, kindOf: () => 'popup', ack: markNotificationsRead,
  });
  const current = queue.current;
  if (!current) return null;
  const close = () => { queue.dismiss(); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  return (
    <NoticeModal
      icon={<Megaphone className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
      title={<span dir={current.lang === 'ar' ? 'rtl' : 'ltr'}>{current.subject}</span>}
      position={queue.position} total={queue.total} onClose={close}
      onDismissAll={() => { queue.dismissAll(); qc.invalidateQueries({ queryKey: ['notifications'] }); }}
      closeLabel={t('bmsg.r_got_it', 'Got it')}
    >
      <p className="text-xs font-medium text-primary">{t('bmsg.r_title', 'Message from AI Support 360')}</p>
      <MessageBody text={current.body} lang={current.lang} />
    </NoticeModal>
  );
}
