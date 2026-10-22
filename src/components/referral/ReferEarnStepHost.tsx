import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { usePublicReferralSettings } from '@/hooks/useReferralProgram';
import { referStepState, setReferStepState, type ReferStepState } from '@/lib/referrals';
import ReferEarnStep from './ReferEarnStep';

function useReferStep() {
  const { isGuest } = useGuestMode();
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<ReferStepState>('done');
  useEffect(() => {
    if (isGuest) return;
    let live = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      const id = data.session?.user?.id ?? null;
      setUserId(id);
      setState(referStepState(id));
    });
    return () => { live = false; };
  }, [isGuest]);
  const set = (s: Exclude<ReferStepState, 'new'>) => { setReferStepState(userId, s); setState(s); };
  return { state, set };
}

/** Profile / onboarding flow: the optional "Refer & earn" step, shown once until "Got it" or "Maybe later". */
export function ReferEarnOnboardingStep() {
  const { available, settings } = usePublicReferralSettings();
  const { state, set } = useReferStep();
  if (!available || !settings.enabled || state !== 'new') return null;
  return <ReferEarnStep onDone={() => set('done')} onLater={() => set('later')} />;
}

/** Dashboard: after "Maybe later", a small card that reopens the step. */
export function ReferEarnLaterCard() {
  const { t } = useTranslation();
  const { available, settings } = usePublicReferralSettings();
  const { state, set } = useReferStep();
  const [open, setOpen] = useState(false);
  if (!available || !settings.enabled || state !== 'later') return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm">
        <Gift className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t('refz.later_title', 'Refer & earn: bring colleagues, earn together')}</p>
          <p className="text-xs text-muted-foreground">{t('refz.later_body', 'Your personal code is ready. See how it works when you have a minute.')}</p>
        </div>
        <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setOpen(true)}>{t('refz.later_open', 'See how it works')}</Button>
      </div>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-0">
            <DialogHeader className="sr-only"><DialogTitle>{t('refz.title', 'Refer & earn')}</DialogTitle><DialogDescription>{t('refz.step_headline', 'Bring colleagues, earn together')}</DialogDescription></DialogHeader>
            <ReferEarnStep onDone={() => { set('done'); setOpen(false); }} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
