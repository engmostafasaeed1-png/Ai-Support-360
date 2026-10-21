import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useNotificationPause } from '@/hooks/useNotificationPause';
import { PAUSE_DURATIONS, allowedDurations, formatPauseEnd, pauseEndsAt, type PauseDuration } from '@/lib/notificationPause';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDuration?: PauseDuration;
  source: 'settings' | 'bell';
}

export const DURATION_LABEL: Record<PauseDuration, [string, string]> = {
  '3d': ['npause.d3', '3 days'],
  '1w': ['npause.w1', '1 week'],
  '1m': ['npause.m1', '1 month'],
};

/** Feature Q pause dialog: length, channels, kinds of notice, hold in-app, and (consultants) the availability choice. */
export default function PauseNotificationsDialog({ open, onOpenChange, initialDuration = '1w', source }: Props) {
  const { t, i18n } = useTranslation();
  const { info, pause, pauseNow } = useNotificationPause();
  const allowed = useMemo(() => allowedDurations(info?.max_days), [info?.max_days]);
  const [duration, setDuration] = useState<PauseDuration>(initialDuration);
  const [email, setEmail] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [reminders, setReminders] = useState(true);
  const [activity, setActivity] = useState(true);
  const [hold, setHold] = useState(false);
  const [unavailable, setUnavailable] = useState(true);

  useEffect(() => {
    if (!open) return;
    setDuration(allowed.includes(initialDuration) ? initialDuration : (allowed[allowed.length - 1] ?? '3d'));
    setEmail(pause?.email ?? true);
    setInApp(pause?.in_app ?? true);
    setReminders(pause ? pause.categories.includes('reminders') : true);
    setActivity(pause ? pause.categories.includes('activity') : true);
    setHold(pause?.hold_in_app ?? false);
    setUnavailable(pause ? pause.mark_unavailable : true);
  }, [open, initialDuration, allowed, pause]);

  const isConsultant = !!info?.is_consultant;
  const ends = formatPauseEnd(pauseEndsAt(duration, Date.now(), info?.max_days), i18n.language);
  const categories = [...(reminders ? ['reminders', 'digests'] : []), ...(activity ? ['activity'] : [])];
  const invalid = (!email && !inApp) || categories.length === 0;

  const submit = () => {
    pauseNow.mutate(
      { duration, email, in_app: inApp, categories, hold_in_app: inApp && hold, mark_unavailable: isConsultant && unavailable, source },
      {
        onSuccess: (data) => {
          toast.success(t('npause.paused_toast', 'Notifications paused until {{date}}', { date: formatPauseEnd(data.pause?.paused_until ?? '', i18n.language) }));
          onOpenChange(false);
        },
        onError: (e) => toast.error(t('npause.save_failed', 'Your pause could not be saved.'), { description: (e as Error).message }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('npause.title', 'Pause notifications')}</DialogTitle>
          <DialogDescription>{t('npause.dialog_desc', 'Take a break from reminders and updates. The pause ends by itself and we tell you when your notifications are back.')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('npause.how_long', 'How long?')}</legend>
            <RadioGroup value={duration} onValueChange={(v) => setDuration(v as PauseDuration)} className="grid grid-cols-3 gap-2">
              {PAUSE_DURATIONS.map((d) => {
                const disabled = !allowed.includes(d);
                return (
                  <Label key={d} htmlFor={`npause-${d}`}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 text-sm ${duration === d ? 'border-primary bg-primary/5' : 'border-border'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                    <RadioGroupItem id={`npause-${d}`} value={d} disabled={disabled} />
                    {t(...DURATION_LABEL[d])}
                  </Label>
                );
              })}
            </RadioGroup>
            <p className="text-xs text-muted-foreground" aria-live="polite">{t('npause.ends_on', 'Ends on {{date}}', { date: ends })}</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('npause.what', 'What to pause')}</legend>
            <CheckRow id="npause-email" checked={email} onChange={setEmail} label={t('npause.ch_email', 'E-mails')} />
            <CheckRow id="npause-inapp" checked={inApp} onChange={setInApp} label={t('npause.ch_inapp', 'In-app pop-ups and alerts')}
              hint={t('npause.ch_inapp_hint', 'Notices are still kept quietly in the bell, without pop-ups or sound.')} />
            {inApp && (
              <div className="ms-6">
                <CheckRow id="npause-hold" checked={hold} onChange={setHold} label={t('npause.hold', 'Also hold in-app notices until the pause ends')} />
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('npause.kinds', 'Which notices')}</legend>
            <CheckRow id="npause-all" checked={reminders && activity}
              onChange={(v) => { setReminders(v); setActivity(v); }} label={t('npause.cat_all', 'All non-essential notices')} />
            <div className="ms-6 space-y-2">
              <CheckRow id="npause-rem" checked={reminders} onChange={setReminders} label={t('npause.cat_reminders', 'Reminders and digests')} />
              <CheckRow id="npause-act" checked={activity} onChange={setActivity} label={t('npause.cat_activity', 'Activity updates')} />
            </div>
            {invalid && <p className="text-xs text-destructive" role="alert">{t('npause.pick_one', 'Choose at least one channel and one kind of notice.')}</p>}
          </fieldset>

          {isConsultant && (
            <fieldset className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <CheckRow id="npause-unavail" checked={unavailable} onChange={setUnavailable}
                label={t('npause.unavailable', 'Also mark me unavailable for new requests during this period (recommended)')}
                hint={t('npause.unavailable_hint', 'Requests that arrive while you are unavailable do not count in your responsiveness statistics.')} />
              {!unavailable && (
                <p className="text-xs font-medium text-foreground" role="note">
                  {t('npause.stay_available', 'You stay available: new requests still reach you and count in your responsiveness statistics as usual.')}
                </p>
              )}
            </fieldset>
          )}

          <p className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('npause.always', 'Always delivered: security and sign-in, password reset, payments, invoices and payouts, legal and policy notices, NDA and rate confirmations, account notices, Critical alarms and the first notice of every new assignment request.')}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button className="gradient-primary border-0" onClick={submit} disabled={invalid || pauseNow.isPending}>
            {pauseNow.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
            {t('npause.confirm', 'Pause for {{d}}', { d: t(...DURATION_LABEL[duration]) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" aria-describedby={hint ? `${id}-hint` : undefined} />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-normal leading-snug">{label}</Label>
        {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
