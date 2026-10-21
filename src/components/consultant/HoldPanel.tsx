import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { currentHolds, useAvailabilityActions, useMyAvailability } from '@/hooks/useAvailabilityHold';
import { holdDate } from '@/lib/availabilityRules';
import HoldDialog from './HoldDialog';

const T = {
  en: {
    title: 'On hold', intro: 'Going away (holiday, illness, a full-time project)? Set a hold with a start and an end date instead of switching off.',
    set: 'Set on hold', resume: 'Resume now', change: 'Change end', cancel: 'Cancel this hold',
    active: (d: string) => `You are on hold until ${d}.`, next: (a: string, b: string) => `Planned hold: ${a} to ${b}.`,
    byAdmin: 'Set by an administrator.', resumed: 'Welcome back. You can receive new requests again.', cancelled: 'The planned hold is cancelled.',
  },
  ar: {
    title: 'التوقف المؤقت', intro: 'ستغيب (إجازة، مرض، مشروع بدوام كامل)؟ فعّل التوقف المؤقت بتاريخي بداية ونهاية بدلًا من الإيقاف.',
    set: 'تفعيل التوقف المؤقت', resume: 'استئناف الآن', change: 'تغيير النهاية', cancel: 'إلغاء هذا التوقف',
    active: (d: string) => `أنت متوقف مؤقتًا حتى ${d}.`, next: (a: string, b: string) => `توقف مخطط: من ${a} إلى ${b}.`,
    byAdmin: 'حدده أحد المسؤولين.', resumed: 'مرحبًا بعودتك. يمكنك استقبال الطلبات الجديدة مرة أخرى.', cancelled: 'تم إلغاء التوقف المخطط.',
  },
};

/** Current / upcoming hold with "Resume now", "Change end" and "Cancel"; hidden until the hold feature is switched on. */
export default function HoldPanel() {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const s = T[lang];
  const q = useMyAvailability();
  const actions = useAvailabilityActions();
  const [dialog, setDialog] = useState<null | 'new' | 'active' | 'next'>(null);
  const [busy, setBusy] = useState(false);
  const me = q.data;
  if (!me?.status || me.holds === null) return null;
  const { active, next } = currentHolds(me.holds);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="hold-title" className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm" data-testid="hold-panel" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h3 id="hold-title" className="flex items-center gap-2 text-base font-semibold"><PauseCircle className="h-5 w-5 text-primary" aria-hidden="true" />{s.title}</h3>
      {active ? (
        <div role="status" className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="hold-active">
          <p className="font-semibold">{s.active(holdDate(active.ends_at, lang))}</p>
          {active.set_by_admin && <p className="text-xs text-muted-foreground">{s.byAdmin}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void run(actions.resumeHold, s.resumed)} disabled={busy} data-testid="hold-resume">
              {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="me-2 h-4 w-4" aria-hidden="true" />}{s.resume}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('active')}>{s.change}</Button>
          </div>
        </div>
      ) : <p className="text-sm text-muted-foreground">{s.intro}</p>}
      {next && (
        <div className="space-y-2 rounded-xl border border-border/60 p-3 text-sm" data-testid="hold-next">
          <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{s.next(holdDate(next.starts_at, lang), holdDate(next.ends_at, lang))}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog('next')}>{s.change}</Button>
            <Button size="sm" variant="ghost" onClick={() => void run(() => actions.cancelHold(next.id), s.cancelled)} disabled={busy}>{s.cancel}</Button>
          </div>
        </div>
      )}
      {!active && <Button variant="outline" onClick={() => setDialog('new')} data-testid="hold-set">{s.set}</Button>}
      <HoldDialog open={dialog !== null} onOpenChange={(v) => { if (!v) setDialog(null); }} maxDays={me.status.hold_max_days}
        hold={dialog === 'active' ? active : dialog === 'next' ? next : null} />
    </section>
  );
}
