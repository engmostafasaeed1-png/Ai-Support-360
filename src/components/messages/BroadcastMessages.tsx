import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Megaphone } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import MessageBody from '@/components/messages/MessageBody';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { markNotificationRead, useBroadcastMessage, useBroadcastPopups, type BroadcastMessage } from '@/hooks/useBulkMessaging';

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

/** Shows unread pop-up messages once (one at a time); closing marks the notification as read. */
export function BroadcastPopup() {
  const { t } = useTranslation();
  const { signedIn } = useSessionReady();
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const q = useBroadcastPopups(signedIn && !isGuest);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const current = (q.data ?? []).find((m) => !closed.has(m.notification_id)) ?? null;
  const dismiss = async () => {
    if (!current) return;
    setClosed((s) => new Set(s).add(current.notification_id));
    await markNotificationRead(current.notification_id).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  if (!current) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <MessageView m={current} />
        <DialogFooter><Button onClick={dismiss}>{t('bmsg.r_got_it', 'Got it')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
