import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MessageSquareWarning } from 'lucide-react';
import { useSessionReady } from '@/hooks/useSessionReady';
import { FEEDBACK_OPEN_EVENT, fetchFeedbackConfig, isFeedbackHiddenRoute, listenForClientErrors } from '@/lib/feedback';

// The form loads in its own chunk only when someone opens it.
const FeedbackDialog = lazy(() => import('./FeedbackDialog'));

/**
 * Feature U: the discreet "Feedback" tab on every screen (middle of the end edge, so it never meets the AI bubble,
 * WhatsApp, back-to-top, the cookie banner or the phone menu bars) and the dialog opened by it, the user menu and
 * the public footer. Hidden on the meeting hand-off, sign-in consent, printed invoices and the live interview.
 */
export default function FeedbackHost() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { ready, signedIn } = useSessionReady();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const { data: config } = useQuery({
    queryKey: ['feedback-config'],
    queryFn: fetchFeedbackConfig,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const allowed = !!config?.enabled && (signedIn || !!config?.publicEnabled);

  useEffect(() => { listenForClientErrors(); }, []);
  useEffect(() => {
    const onOpen = () => { setLoaded(true); setOpen(true); };
    window.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, []);

  if (!ready || !allowed) return null;
  const showTab = !isFeedbackHiddenRoute(pathname);
  const label = String(t('feedback.button', { defaultValue: 'Feedback' }));

  return (
    <>
      {showTab && (
        <button
          type="button"
          onClick={() => { setLoaded(true); setOpen(true); }}
          onMouseEnter={() => setLoaded(true)}
          onFocus={() => setLoaded(true)}
          aria-label={String(t('feedback.button_aria', { defaultValue: 'Send feedback or report a problem' }))}
          aria-haspopup="dialog"
          className="fixed end-0 top-1/2 z-40 -translate-y-1/2 flex items-center gap-1.5 rounded-s-xl border border-e-0 border-border/60 bg-card/95 px-2 py-2.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden sm:px-2.5"
        >
          <MessageSquareWarning aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      )}
      {loaded && (
        <Suspense fallback={null}>
          <FeedbackDialog open={open} onOpenChange={setOpen} signedIn={signedIn} />
        </Suspense>
      )}
    </>
  );
}
