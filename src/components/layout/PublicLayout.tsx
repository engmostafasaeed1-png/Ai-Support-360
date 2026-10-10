import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';

/**
 * The landing page header and footer around the pages that had none (sign-in, sign-up, password reset, 404 ...).
 * The header is fixed, so the page gets room for its height and fills the space between header and footer.
 */
export default function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <div className="flex flex-1 flex-col pt-[84px] sm:pt-[100px] lg:pt-[112px] xl:pt-[116px] [&>*]:flex-1 [&>*]:!min-h-0">
        <Suspense
          fallback={
            <div role="status" className="flex min-h-[40vh] items-center justify-center">
              <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="sr-only">Loading…</span>
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
      <Footer />
    </div>
  );
}
