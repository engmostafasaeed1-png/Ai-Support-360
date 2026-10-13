import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, CircleHelp, Inbox, LayoutList, ListChecks, MessagesSquare, CalendarClock, Receipt, Sparkles, UserCircle, Wallet,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTourProgress } from '@/hooks/useTourProgress';
import { TOUR_KEY, resumeStep, shouldAutoStart } from '@/lib/tour';
import ProductTour, { type TourStep } from './ProductTour';

interface TourContextValue { start: () => void; running: boolean }

const TourContext = createContext<TourContextValue>({ start: () => {}, running: false });

/** Starts the consultant tour again from step 0 ("Take the tour again"). Works as a no-op outside the provider. */
export const useConsultantTour = () => useContext(TourContext);

export const AUTO_START_DELAY_MS = 800;

/** The consultant tour content (English defaults, translated with t()). */
export function useConsultantTourSteps(): TourStep[] {
  const { t } = useTranslation();
  return useMemo(() => [
    { id: 'welcome', placement: 'center', icon: Sparkles, title: t('tour.c.welcome_title', 'Welcome'),
      body: t('tour.c.welcome', 'Welcome to AI Support 360. This 2-minute tour shows you where everything is.') },
    { id: 'nav', target: 'nav', placement: 'end', icon: LayoutList, title: t('tour.c.nav_title', 'Sidebar'),
      body: t('tour.c.nav', 'Everything lives here: requests, bids, sessions, earnings and your profile.') },
    { id: 'getting-started', target: 'getting-started', route: '/consultant', placement: 'bottom', icon: ListChecks, title: t('tour.c.getting_started_title', 'Getting started checklist'),
      body: t('tour.c.getting_started', 'Finish these steps to start receiving work.') },
    { id: 'nav-open-requests', target: 'nav-open-requests', placement: 'end', icon: Inbox, title: t('tour.c.open_requests_title', 'Open requests'),
      body: t('tour.c.open_requests', 'Find requests that match your SAP modules. You see the deadline, how many bids there are, and you can ask the client a question before bidding.') },
    { id: 'nav-my-bids', target: 'nav-my-bids', placement: 'end', icon: Receipt, title: t('tour.c.my_bids_title', 'My bids'),
      body: t('tour.c.my_bids', 'Track every bid. Revise or withdraw it until the client answers, and answer counter-offers here.') },
    { id: 'nav-sessions', target: 'nav-sessions', placement: 'end', icon: CalendarClock, title: t('tour.c.sessions_title', 'Sessions and schedule'),
      body: t('tour.c.sessions', 'Your booked sessions and meeting rooms. Clients can book only inside your availability.') },
    { id: 'nav-messages', target: 'nav-messages', placement: 'end', icon: MessagesSquare, title: t('tour.c.messages_title', 'Messages'),
      body: t('tour.c.messages', 'Chat with clients you are assigned to. Contact details stay inside the portal.') },
    { id: 'nav-earnings', target: 'nav-earnings', placement: 'end', icon: Wallet, title: t('tour.c.earnings_title', 'Earnings'),
      body: t('tour.c.earnings', 'See what you earned and add your bank details. They are private: only you and the administrators can see them. Payouts arrive within 15 business days after the client pays.') },
    { id: 'nav-profile', target: 'nav-profile', placement: 'end', icon: UserCircle, title: t('tour.c.profile_title', 'My profile'),
      body: t('tour.c.profile', 'Your trust score, certificates and AI interview live here. A complete profile gets more invitations.') },
    { id: 'bell', target: 'bell', placement: 'bottom', icon: Bell, title: t('tour.c.bell_title', 'Notifications'),
      body: t('tour.c.bell', 'New requests and bid answers arrive here. Turn on phone alerts (and Telegram) in Settings so you never miss a critical request.') },
    { id: 'help-button', target: 'help-button', placement: 'bottom', icon: CircleHelp, title: t('tour.c.help_title', 'Help'),
      body: t('tour.c.help', 'Open the quick guide any time, or take this tour again.') },
  ], [t]);
}

/** Nav steps whose menu item is not on the page (feature switched off / hidden) are left out on wide screens.
 *  On phones the sidebar is closed, so those steps stay and show centered. */
export function availableSteps(steps: TourStep[], doc: Document = document, width = window.innerWidth): TourStep[] {
  if (width < 768) return steps;
  return steps.filter((s) => !s.target?.startsWith('nav-') || !!doc.querySelector(`[data-tour="${s.target}"]`));
}

function useOnboardingCompleted() {
  return useQuery({
    queryKey: ['tour-onboarding-completed'],
    retry: false,
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;
        const { data } = await supabase.from('profiles').select('onboarding_completed').eq('user_id', user.id).maybeSingle();
        return !!data?.onboarding_completed;
      } catch { return false; }
    },
  });
}

/** Mounted once in the consultant layout: runs the tour on any consultant page and navigates between them. */
export function ConsultantTourProvider({ children }: { children?: ReactNode }) {
  const allSteps = useConsultantTourSteps();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { progress, isLoading, save, reset } = useTourProgress(TOUR_KEY);
  const onboarding = useOnboardingCompleted();
  const [open, setOpen] = useState(false);
  const [startAt, setStartAt] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>(allSteps);
  const current = useRef(0);
  const autoTried = useRef(false);

  const welcomeParam = searchParams.get('welcome') === 'true';

  useEffect(() => {
    if (autoTried.current || open || isLoading || onboarding.isLoading) return;
    if (!shouldAutoStart({ progress, welcomeParam, onboardingCompleted: onboarding.data === true, pathname: location.pathname })) return;
    autoTried.current = true;
    const id = window.setTimeout(() => {
      const list = availableSteps(allSteps);
      const at = resumeStep(progress, list.length);
      setSteps(list);
      setStartAt(at);
      current.current = at;
      setOpen(true);
    }, AUTO_START_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [isLoading, onboarding.isLoading, onboarding.data, progress, welcomeParam, location.pathname, open, allSteps]);

  const start = useCallback(() => {
    autoTried.current = true;
    void reset();
    if (location.pathname !== '/consultant') navigate('/consultant');
    setSteps(availableSteps(allSteps));
    setStartAt(0);
    current.current = 0;
    setOpen(true);
  }, [reset, allSteps, location.pathname, navigate]);

  const onStep = useCallback((i: number) => { current.current = i; void save(i, 'in_progress'); }, [save]);
  const onFinish = useCallback(() => { setOpen(false); void save(current.current, 'completed'); }, [save]);
  const onSkip = useCallback(() => { setOpen(false); void save(current.current, 'skipped'); }, [save]);

  const value = useMemo(() => ({ start, running: open }), [start, open]);

  return (
    <TourContext.Provider value={value}>
      {children}
      <ProductTour steps={steps} open={open} startAt={startAt} onStep={onStep} onFinish={onFinish} onSkip={onSkip} />
    </TourContext.Provider>
  );
}

export default ConsultantTourProvider;
