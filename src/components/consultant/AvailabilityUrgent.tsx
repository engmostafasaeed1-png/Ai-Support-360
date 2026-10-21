import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { currentHolds, useMyAvailability, type MyAvailability } from '@/hooks/useAvailabilityHold';
import { availabilityGrace, hasWeeklyAvailability, holdDate } from '@/lib/availabilityRules';
import { focusProfileItem } from '@/lib/profileSubmission';

const T = {
  en: {
    title: 'Please add your weekly availability - needed for requests',
    why: 'Clients and matching rely on it. Requests outside your availability are not counted against you.',
    grace: (d: string) => `Add it by ${d}: after that, consultants without weekly availability are not offered new requests or critical alerts.`,
    blocked: 'You are not offered new requests or critical alerts until you add it. Your sign-in and current work are not affected.',
    button: 'Add my availability', later: 'Later',
  },
  ar: {
    title: 'يرجى إضافة توفرك الأسبوعي - مطلوب لاستقبال الطلبات',
    why: 'يعتمد عليه العملاء والمطابقة. الطلبات خارج أوقات توفرك لا تُحتسب ضدك.',
    grace: (d: string) => `أضفه قبل ${d}: بعد ذلك لن تُعرض طلبات جديدة أو تنبيهات عاجلة على المستشارين بدون توفر أسبوعي.`,
    blocked: 'لن تُعرض عليك طلبات جديدة أو تنبيهات عاجلة حتى تضيفه. لا يتأثر تسجيل دخولك ولا عملك الحالي.',
    button: 'أضف توفري', later: 'لاحقًا',
  },
};

/** Missing, required and not on hold: the urgent notice applies (works before the database update too: then no deadline). */
export function availabilityUrgentState(me: MyAvailability | null | undefined, now = Date.now()) {
  if (!me || hasWeeklyAvailability(me.weekly)) return null;
  if (me.status && !me.status.required) return null;
  if (currentHolds(me.holds, now).active || me.status?.on_hold) return null;
  return availabilityGrace({ missing: true, required: true, graceStartedAt: me.status?.grace_started_at ?? null, signedUpAt: me.createdAt, graceDays: me.status?.grace_days ?? null, now });
}

function useGoToAvailability() {
  const navigate = useNavigate();
  const loc = useLocation();
  return () => {
    if (loc.pathname === '/consultant/profile') focusProfileItem('availability');
    else {
      navigate('/consultant/profile#availability');
      window.setTimeout(() => focusProfileItem('availability'), 600);
    }
  };
}

function Message({ lang, grace }: { lang: 'en' | 'ar'; grace: NonNullable<ReturnType<typeof availabilityUrgentState>> }) {
  const s = T[lang];
  return (
    <>
      <span className="block">{s.why}</span>
      {grace.state === 'blocked' ? <span className="block font-medium">{s.blocked}</span>
        : grace.state === 'grace' && grace.deadline ? <span className="block">{s.grace(holdDate(new Date(grace.deadline).toISOString(), lang))}</span> : null}
    </>
  );
}

/** Banner on the dashboard and the profile until weekly availability is saved. */
export default function AvailabilityUrgentBanner({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const { isGuest } = useGuestMode();
  const q = useMyAvailability();
  const go = useGoToAvailability();
  const grace = availabilityUrgentState(q.data);
  if (isGuest || !grace) return null;
  const blocked = grace.state === 'blocked';
  return (
    <div role={blocked ? 'alert' : 'status'} data-testid="availability-urgent-banner" dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${blocked ? 'border-destructive/40 bg-destructive/10' : 'border-warning/50 bg-warning/10'} ${compact ? 'p-3' : ''}`}>
      <AlertTriangle aria-hidden="true" className={`h-6 w-6 shrink-0 ${blocked ? 'text-destructive' : 'text-warning'}`} />
      <div className="flex-1 space-y-1 text-sm text-foreground">
        <p className="font-semibold">{T[lang].title}</p>
        <p className="text-muted-foreground"><Message lang={lang} grace={grace} /></p>
      </div>
      <Button size="lg" className="gradient-primary gap-2 text-primary-foreground" onClick={go} data-testid="availability-urgent-add">
        <CalendarPlus className="h-5 w-5" aria-hidden="true" />{T[lang].button}
      </Button>
    </div>
  );
}

/** Pop-up once per sign-in session (mounted in the consultant layout), with the big "Add my availability" button. */
export function AvailabilityGate() {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const { isGuest } = useGuestMode();
  const q = useMyAvailability();
  const go = useGoToAvailability();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const handled = useRef(false);
  const grace = availabilityUrgentState(q.data);
  useEffect(() => {
    if (isGuest || !grace || handled.current || !q.data || loc.pathname === '/consultant/profile') return;
    handled.current = true;
    const key = `availability_prompt_shown:${q.data.userId}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* still show once */ }
    setOpen(true);
  }, [isGuest, grace, q.data, loc.pathname]);
  if (!grace) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" dir={lang === 'ar' ? 'rtl' : 'ltr'} data-testid="availability-gate">
        <DialogHeader>
          <DialogTitle>{T[lang].title}</DialogTitle>
          <DialogDescription asChild><div className="space-y-2 text-sm"><Message lang={lang} grace={grace} /></div></DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>{T[lang].later}</Button>
          <Button size="lg" className="gradient-primary gap-2 text-primary-foreground" onClick={() => { setOpen(false); go(); }}>
            <CalendarPlus className="h-5 w-5" aria-hidden="true" />{T[lang].button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
