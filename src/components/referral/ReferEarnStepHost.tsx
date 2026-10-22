import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { usePublicReferralSettings } from '@/hooks/useReferralProgram';
import { useTourProgress } from '@/hooks/useTourProgress';
import {
  REFERRAL_INTRO_EVENT, REFERRAL_INTRO_TOUR_KEY, referStepState, setReferStepState, shouldShowReferralIntro, type ReferStepState,
} from '@/lib/referrals';
import ReferEarnStep from './ReferEarnStep';

/** Re-opens the introduction (menu page, help sheet). */
export const openReferralIntro = () => window.dispatchEvent(new Event(REFERRAL_INTRO_EVENT));

/** Shared "seen" state: stored per account on the server (tour progress), with a browser copy for "Maybe later". */
function useReferStep() {
  const { isGuest } = useGuestMode();
  const { available, settings } = usePublicReferralSettings();
  const live = available && settings.enabled;
  const { progress, isLoading, save } = useTourProgress(REFERRAL_INTRO_TOUR_KEY, live && !isGuest);
  const [userId, setUserId] = useState<string | null>(null);
  const [local, setLocal] = useState<ReferStepState>('done');
  useEffect(() => {
    if (isGuest) return;
    let on = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!on) return;
      const id = data.session?.user?.id ?? null;
      setUserId(id);
      setLocal(referStepState(id));
    });
    return () => { on = false; };
  }, [isGuest]);
  const seenOnServer = !!progress && (!!progress.completed_at || !!progress.skipped_at);
  const show = shouldShowReferralIntro({ live, isGuest, progressLoaded: !!userId && !isLoading, seenOnServer, localState: local });
  const set = (s: Exclude<ReferStepState, 'new'>) => {
    setReferStepState(userId, s);
    setLocal(s);
    void save(0, s === 'done' ? 'completed' : 'skipped');
  };
  return { live, isGuest, show, local, seenOnServer, set };
}

/** Profile / onboarding flow: the optional "Refer & earn" step, shown once until "Got it" or "Maybe later". */
export function ReferEarnOnboardingStep() {
  const { show, set } = useReferStep();
  if (!show) return null;
  return <ReferEarnStep onDone={() => set('done')} onLater={() => set('later')} />;
}

function IntroDialog({ onClose, onDone, onLater }: { onClose: () => void; onDone: () => void; onLater?: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only"><DialogTitle>{t('refz.title', 'Refer & earn')}</DialogTitle><DialogDescription>{t('refz.step_headline', 'Bring colleagues, earn together')}</DialogDescription></DialogHeader>
        <ReferEarnStep onDone={onDone} onLater={onLater} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Consultant layout: one-time introduction pop-up on the next sign-in for EVERY consultant (existing ones too), dismissible
 * and stored per account; re-openable through openReferralIntro(). Waits until no other dialog is open.
 */
export function ReferralIntroPopup() {
  const { live, isGuest, show, set } = useReferStep();
  const { pathname } = useLocation();
  const [open, setOpen] = useState<'auto' | 'manual' | null>(null);

  useEffect(() => {
    const onOpen = () => setOpen('manual');
    window.addEventListener(REFERRAL_INTRO_EVENT, onOpen);
    return () => window.removeEventListener(REFERRAL_INTRO_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!show || open || pathname.startsWith('/consultant/profile')) return;
    const id = window.setTimeout(() => {
      if (!document.querySelector('[role="dialog"]')) setOpen('auto');
    }, 3000);
    return () => window.clearTimeout(id);
  }, [show, open, pathname]);

  if (!live || isGuest || !open) return null;
  // Closing the automatic pop-up counts as "Maybe later" (shown once); a manual re-open changes nothing.
  return (
    <IntroDialog
      onClose={() => { if (open === 'auto') set('later'); setOpen(null); }}
      onDone={() => { if (open === 'auto') set('done'); setOpen(null); }}
      onLater={open === 'auto' ? () => { set('later'); setOpen(null); } : undefined}
    />
  );
}

/** Dashboard: after "Maybe later", a small card that reopens the introduction. */
export function ReferEarnLaterCard() {
  const { t } = useTranslation();
  const { live, local, seenOnServer, set } = useReferStep();
  const [open, setOpen] = useState(false);
  if (!live || (local !== 'later' && !(seenOnServer && local === 'new'))) return null;
  if (local === 'done') return null;
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
      {open && <IntroDialog onClose={() => setOpen(false)} onDone={() => { set('done'); setOpen(false); }} />}
    </>
  );
}
