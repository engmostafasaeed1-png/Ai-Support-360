import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { scrollBehavior } from '@/lib/scrollUtils';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';

/** Scrolls to the `#section` of the URL after navigation (sections carry the header-height scroll margin). */
function useScrollToHash() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      else if (tries++ < 20) timer = setTimeout(attempt, 100); // lazy page still loading
    };
    attempt();
    return () => clearTimeout(timer);
  }, [pathname, hash]);
}

type Variant = 'content' | 'auth' | 'simple';

/**
 * The single public header (and footer) for every public page.
 * - content: pages that size their own top against --public-header-h (home, pricing, legal, services, for-consultants)
 * - auth: login/signup/password pages — header only, centered card below it
 * - simple (default): small pages (unsubscribe, confirmations, 404) — header, padded content, footer
 */
export default function PublicLayout({ variant = 'simple' }: { variant?: Variant }) {
  useScrollToHash();
  const fallback = (
    <div role="status" className="container mx-auto flex min-h-[40vh] max-w-3xl flex-col gap-4 px-4 py-10">
      <div aria-hidden="true" className="h-8 w-2/3 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-4 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-4 w-5/6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div aria-hidden="true" className="mt-4 h-32 w-full animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      {variant === 'content' ? (
        <div className="flex-1" style={{ paddingTop: 0 }}>
          {/* Full-height placeholder keeps the footer below the screen until the page arrives (no layout jump). */}
          <Suspense fallback={<div className="min-h-[100svh]" style={{ paddingTop: 'var(--public-header-h, 6rem)' }}>{fallback}</div>}>
            <Outlet />
          </Suspense>
        </div>
      ) : (
        <div
          className="flex flex-1 flex-col [&>*]:flex-1 [&>*]:!min-h-0"
          style={{ paddingTop: variant === 'auth' ? 'calc(var(--public-header-h, 6rem) + 1rem)' : 'var(--public-header-h, 6rem)' }}
        >
          <Suspense fallback={<div className="min-h-[100svh]">{fallback}</div>}>
            <Outlet />
          </Suspense>
        </div>
      )}
      {variant !== 'auth' && <Footer />}
    </div>
  );
}
