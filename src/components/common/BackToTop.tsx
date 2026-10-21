import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { scrollBehavior, shouldShowBackToTop } from '@/lib/scrollUtils';

const PORTAL_PATH = /^\/(client|consultant|admin|super-admin)(\/|$)/;

/**
 * Floating "Back to top" after 600 px. Sits in the end column above the AI assistant (public pages)
 * or above the WhatsApp button (portals), so it never covers either; logical `end-*` flips it in Arabic.
 */
export default function BackToTop() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const inPortal = PORTAL_PATH.test(pathname);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(shouldShowBackToTop(window.scrollY));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  if (!visible) return null;

  const goTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: scrollBehavior() });
    // Keyboard users continue from the top of the page content, not from the floating button.
    const main = document.getElementById('main-content');
    if (main) {
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  };

  const label = t('a11y.backToTop', 'Back to top');
  return (
    <button
      type="button"
      onClick={goTop}
      aria-label={label}
      title={label}
      data-testid="back-to-top"
      className={cn(
        'fixed z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-card/95 text-foreground shadow-elevated backdrop-blur',
        'transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-card active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'animate-in fade-in duration-200 motion-reduce:animate-none',
        inPortal ? 'bottom-[13.5rem] end-[1.375rem] sm:bottom-[10.5rem] sm:end-[1.875rem]' : 'bottom-[9.5rem] end-[1.375rem] sm:bottom-24 sm:end-[1.875rem]',
      )}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
