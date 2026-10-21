import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellOff, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNotificationPause } from '@/hooks/useNotificationPause';
import { allowedDurations, formatPauseEnd, type PauseDuration } from '@/lib/notificationPause';
import PauseNotificationsDialog, { DURATION_LABEL } from './PauseNotificationsDialog';

/** Feature Q card for every role's notification preferences: status, end date, Pause for… and Resume now. */
export default function NotificationPauseCard({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { loading, available, notInstalled, info, pause, resume } = useNotificationPause();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<PauseDuration>('1w');

  if (loading) return null;
  const openWith = (d: PauseDuration) => { setInitial(d); setOpen(true); };
  const doResume = () => resume.mutate('settings', {
    onSuccess: () => toast.success(t('npause.resumed_toast', 'Your notifications are back on.')),
    onError: (e) => toast.error(t('npause.save_failed', 'Your pause could not be saved.'), { description: (e as Error).message }),
  });

  const channels = pause ? [pause.email && t('npause.ch_email', 'E-mails'), pause.in_app && t('npause.ch_inapp', 'In-app pop-ups and alerts')].filter(Boolean).join(' · ') : '';

  return (
    <Card className={`border-border/40 ${className ?? ''}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><BellOff className="h-4 w-4" aria-hidden /> {t('npause.title', 'Pause notifications')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {notInstalled || (!available && !info) ? (
          <p className="text-sm text-muted-foreground">{t('npause.not_ready', 'Pausing notifications will be available after the next platform update.')}</p>
        ) : !available ? (
          <p className="text-sm text-muted-foreground">{t('npause.disabled', 'Pausing notifications is currently switched off.')}</p>
        ) : pause ? (
          <div className="space-y-3" aria-live="polite">
            <p className="text-sm font-medium">{t('npause.paused_until', 'Paused until {{date}}', { date: formatPauseEnd(pause.paused_until, i18n.language) })}</p>
            <p className="text-xs text-muted-foreground">{channels}{pause.mark_unavailable ? ` · ${t('npause.marked_unavailable', 'Marked unavailable for new requests')}` : ''}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={doResume} disabled={resume.isPending}>
                {resume.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('npause.resume', 'Resume now')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => openWith(pause.duration)}>{t('npause.change', 'Change')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('npause.card_hint', 'Too many reminders? Pause e-mails and pop-ups for a while. Important messages such as security, payments and Critical alarms always arrive.')}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('npause.pause_for', 'Pause for…')}>
              {allowedDurations(info?.max_days).map((d) => (
                <Button key={d} size="sm" variant="outline" onClick={() => openWith(d)}>{t(DURATION_LABEL[d][0], DURATION_LABEL[d][1])}</Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <PauseNotificationsDialog open={open} onOpenChange={setOpen} initialDuration={initial} source="settings" />
    </Card>
  );
}
