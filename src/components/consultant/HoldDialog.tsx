import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAvailabilityActions } from '@/hooks/useAvailabilityHold';
import { HOLD_MAX_AHEAD_DAYS, HOLD_MAX_DAYS_DEFAULT, HOLD_REASON_MAX, holdDate, holdProblemText, validateHold, type HoldRow } from '@/lib/availabilityRules';

const T = {
  en: {
    newTitle: 'Set on hold', changeTitle: 'Change the end of your hold',
    intro: 'While you are on hold you get no new requests, invitations or critical alerts. Your current work continues as agreed.',
    startNow: 'Start now', start: 'Starts', end: 'Ends (required)', reason: 'Reason (optional, private)',
    reasonHint: 'Only you and the administrators see it. No contact details.', max: (d: number) => `At most ${d} days; a future hold can start up to ${HOLD_MAX_AHEAD_DAYS} days ahead.`,
    next: 'Continue', back: 'Back', confirm: 'Confirm hold', confirmChange: 'Save new end', cancel: 'Cancel',
    confirmTitle: 'Please confirm',
    confirmText: (a: string, b: string) => `You will be on hold from ${a} to ${b}.`,
    c1: 'No new requests, invitations, bid invitations or critical alerts during the hold.',
    c2: 'Clients see "On hold until" on your card; requests during the hold do not count in your responsiveness.',
    c3: 'Clients of your active tickets get a short notice that the current work continues as agreed.',
    c4: 'You come back automatically at the end. You can resume early at any time.',
    done: 'Your hold is saved.', changed: 'The end of your hold is changed.',
  },
  ar: {
    newTitle: 'تفعيل التوقف المؤقت', changeTitle: 'تغيير نهاية التوقف المؤقت',
    intro: 'أثناء التوقف المؤقت لن تصلك طلبات أو دعوات أو تنبيهات عاجلة جديدة. يستمر عملك الحالي كما هو متفق عليه.',
    startNow: 'ابدأ الآن', start: 'يبدأ', end: 'ينتهي (مطلوب)', reason: 'السبب (اختياري، خاص)',
    reasonHint: 'تراه أنت والمسؤولون فقط. بدون بيانات تواصل.', max: (d: number) => `بحد أقصى ${d} يومًا؛ ويمكن أن يبدأ التوقف المستقبلي خلال ${HOLD_MAX_AHEAD_DAYS} يومًا.`,
    next: 'متابعة', back: 'رجوع', confirm: 'تأكيد التوقف المؤقت', confirmChange: 'حفظ النهاية الجديدة', cancel: 'إلغاء',
    confirmTitle: 'يرجى التأكيد',
    confirmText: (a: string, b: string) => `ستكون في وضع التوقف المؤقت من ${a} إلى ${b}.`,
    c1: 'لا طلبات أو دعوات أو دعوات عروض أو تنبيهات عاجلة جديدة أثناء التوقف.',
    c2: 'يرى العملاء "متوقف مؤقتًا حتى" على بطاقتك، والطلبات أثناء التوقف لا تُحتسب في سرعة استجابتك.',
    c3: 'يتلقى عملاء تذاكرك النشطة إشعارًا قصيرًا بأن العمل الحالي مستمر كما هو متفق عليه.',
    c4: 'تعود تلقائيًا عند النهاية، ويمكنك الاستئناف مبكرًا في أي وقت.',
    done: 'تم حفظ التوقف المؤقت.', changed: 'تم تغيير نهاية التوقف المؤقت.',
  },
};

/** "yyyy-MM-ddTHH:mm" in the browser's time zone (what <input type="datetime-local"> uses). */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const fmt = (iso: string, lang: 'en' | 'ar') => new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function HoldDialog({ open, onOpenChange, hold, maxDays = HOLD_MAX_DAYS_DEFAULT }: {
  open: boolean; onOpenChange: (v: boolean) => void; hold?: HoldRow | null; maxDays?: number;
}) {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const s = T[lang];
  const actions = useAvailabilityActions();
  const changing = !!hold;
  const [startNow, setStartNow] = useState(true);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setStartNow(!hold || Date.parse(hold.starts_at) <= now.getTime());
    setStart(toLocalInput(hold ? new Date(hold.starts_at) : now));
    setEnd(hold ? toLocalInput(new Date(hold.ends_at)) : '');
    setReason(''); setStep('form'); setTried(false);
  }, [open, hold]);

  const startsAt = changing ? hold!.starts_at : startNow ? new Date().toISOString() : fromLocalInput(start);
  const endsAt = fromLocalInput(end);
  const problems = validateHold({ startsAt, endsAt, now: Date.now(), maxDays, reason, isNew: !changing });

  const next = () => {
    setTried(true);
    if (problems.length) return;
    setStep('confirm');
  };
  const submit = async () => {
    if (!endsAt) return;
    setBusy(true);
    try {
      if (changing) await actions.changeHold(hold!.id, endsAt);
      else await actions.setHold(startNow ? null : startsAt, endsAt, reason.trim() || null);
      toast.success(changing ? s.changed : s.done);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
      setStep('form');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir={lang === 'ar' ? 'rtl' : 'ltr'} data-testid="hold-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PauseCircle className="h-5 w-5 text-primary" aria-hidden="true" />{step === 'confirm' ? s.confirmTitle : changing ? s.changeTitle : s.newTitle}</DialogTitle>
          <DialogDescription>{s.intro}</DialogDescription>
        </DialogHeader>
        {step === 'form' ? (
          <div className="space-y-3">
            {!changing && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={startNow} onCheckedChange={(v) => setStartNow(v === true)} />{s.startNow}
                </label>
                {!startNow && (
                  <div className="space-y-1">
                    <Label htmlFor="hold-start">{s.start}</Label>
                    <Input id="hold-start" type="datetime-local" value={start} min={toLocalInput(new Date())} onChange={(e) => setStart(e.target.value)} />
                  </div>
                )}
              </>
            )}
            <div className="space-y-1">
              <Label htmlFor="hold-end">{s.end}</Label>
              <Input id="hold-end" type="datetime-local" value={end} min={toLocalInput(new Date())} onChange={(e) => setEnd(e.target.value)} required aria-required="true"
                aria-invalid={tried && problems.some((p) => p.startsWith('end') || p === 'too_long')} />
              <p className="text-xs text-muted-foreground">{s.max(maxDays)}</p>
            </div>
            {!changing && (
              <div className="space-y-1">
                <Label htmlFor="hold-reason">{s.reason}</Label>
                <Textarea id="hold-reason" rows={2} maxLength={HOLD_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="hold-reason-hint" />
                <p id="hold-reason-hint" className="text-xs text-muted-foreground">{s.reasonHint}</p>
              </div>
            )}
            {tried && problems.length > 0 && (
              <ul role="alert" className="space-y-1 text-xs text-destructive" data-testid="hold-problems">
                {problems.map((p) => <li key={p}>{holdProblemText(p, lang, maxDays)}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm" data-testid="hold-confirm">
            <p className="font-semibold">{s.confirmText(fmt(startsAt!, lang), fmt(endsAt!, lang))}</p>
            <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
              <li>{s.c1}</li><li>{s.c2}</li><li>{s.c3}</li><li>{s.c4}</li>
            </ul>
            <p className="text-xs text-muted-foreground">{holdDate(endsAt!, lang)}</p>
          </div>
        )}
        <DialogFooter className="gap-2">
          {step === 'form' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{s.cancel}</Button>
              <Button onClick={next} data-testid="hold-next">{s.next}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('form')} disabled={busy}>{s.back}</Button>
              <Button onClick={() => void submit()} disabled={busy} data-testid="hold-confirm-button">
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}{changing ? s.confirmChange : s.confirm}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
