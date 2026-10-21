import { prefersReducedMotion } from './scrollUtils';

/**
 * Section reveal is an enhancement only: content renders visible, and only sections that are still below the
 * screen once the script runs are briefly faded in when they scroll into view. Off for reduced motion, print,
 * crawlers/automation and browsers without IntersectionObserver.
 */
export function revealAllowed(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win || typeof IntersectionObserver === 'undefined') return false;
  if (prefersReducedMotion(win)) return false;
  try {
    if (win.matchMedia?.('print').matches) return false;
  } catch {
    /* ignore */
  }
  const nav = win.navigator;
  if (nav?.webdriver) return false;
  if (/bot|crawl|spider|slurp|lighthouse|headlesschrome|prerender/i.test(nav?.userAgent ?? '')) return false;
  return true;
}

export function observeReveal(elements: Element[], win: Window | undefined = typeof window === 'undefined' ? undefined : window): () => void {
  if (!win || !revealAllowed(win)) return () => {};
  const vh = win.innerHeight;
  const pending = elements.filter((el) => el.getBoundingClientRect().top > vh);
  if (pending.length === 0) return () => {};
  pending.forEach((el) => el.setAttribute('data-reveal', 'pending'));
  const io = new IntersectionObserver(
    (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-reveal', 'in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  pending.forEach((el) => io.observe(el));
  return () => {
    io.disconnect();
    pending.forEach((el) => {
      if (el.getAttribute('data-reveal') === 'pending') el.removeAttribute('data-reveal');
    });
  };
}
