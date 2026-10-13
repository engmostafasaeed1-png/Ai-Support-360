import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

const BASE_URL = 'https://www.aisupport360.com';
const BRAND = 'AI Support 360';

type Meta = { title: string; description: string; noindex?: boolean };

const DEFAULT: Meta = {
  title: `AI Support 360 — Expert On-Demand Support`,
  description:
    'AI-powered enterprise support platform. Connect with verified experts for S/4HANA, BTP, SuccessFactors, and 20+ modules. Bilingual Arabic & English.',
};

const ROUTES: Record<string, Meta> = {
  '/': DEFAULT,
  '/pricing': {
    title: `Support Plans & Pricing — ${BRAND}`,
    description:
      'SAP support priced on the hours you approve: you accept the hourly rate and each timesheet, and invoices show platform fees and VAT.',
  },
  '/services/s4hana-support': {
    title: `SAP S/4HANA Support Services — ${BRAND}`,
    description:
      'On-demand SAP S/4HANA support: incident resolution, performance tuning, Fiori troubleshooting, and migration follow-up by verified experts.',
  },
  '/services/btp-support': {
    title: `SAP BTP & Integration Support — ${BRAND}`,
    description:
      'Expert SAP BTP and Cloud Integration (CPI) support: iFlow monitoring, extension development, API management, and cross-system connectivity.',
  },
  '/login': {
    title: `Sign in — ${BRAND}`,
    description: 'Sign in to your SAP support portal to manage tickets, sessions and consultants.',
  },
  '/signup': {
    title: `Create your account — ${BRAND}`,
    description: 'Join as a client or SAP consultant and get matched with verified SAP experts.',
  },
  '/forgot-password': {
    title: `Reset your password — ${BRAND}`,
    description: 'Request a secure link to reset your SAP support portal password.',
    noindex: true,
  },
  '/reset-password': {
    title: `Choose a new password — ${BRAND}`,
    description: 'Set a new password for your SAP support portal account.',
    noindex: true,
  },
  '/unsubscribe': {
    title: `Email preferences — ${BRAND}`,
    description: 'Manage or unsubscribe from SAP support portal emails.',
    noindex: true,
  },
};

function resolve(pathname: string): Meta {
  if (ROUTES[pathname]) return ROUTES[pathname];
  const legal: Record<string, string> = {
    '/privacy-policy': 'Privacy Policy', '/terms-and-conditions': 'Terms & Conditions', '/refund-policy': 'Refund Policy',
    '/subscription-and-cancellation': 'Subscription & Cancellation Policy', '/service-delivery': 'Service Delivery & Activation Policy',
    '/cookie-policy': 'Cookie Policy', '/acceptable-use': 'Acceptable Use Policy',
  };
  // Kept out of search results until the owner fills in the placeholders.
  if (legal[pathname]) return { title: `${legal[pathname]} — ${BRAND}`, description: `${legal[pathname]} for ${BRAND}.`, noindex: true };
  if (pathname.startsWith('/join/'))
    return { title: `Join your support session — ${BRAND}`, description: DEFAULT.description, noindex: true };
  if (pathname.startsWith('/demo/confirmation/'))
    return { title: `Demo request status — ${BRAND}`, description: DEFAULT.description, noindex: true };
  if (pathname.startsWith('/interview/respond/'))
    return { title: `Consultant interview — ${BRAND}`, description: `Answer your consultant interview questions on ${BRAND}.`, noindex: true };
  const parts = pathname.split('/').filter(Boolean)
    .filter((p) => !/^[0-9a-f-]{16,}$/i.test(p) && !p.startsWith('.'))
    .map((p) => p.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  if (parts.length) {
    const portalRoots = ['Client', 'Consultant', 'Admin', 'Super Admin'];
    const label = parts.length === 1 && portalRoots.includes(parts[0]) ? `Dashboard · ${parts[0]}` : parts.reverse().join(' · ');
    return { title: `${label} — ${BRAND}`, description: `${label} in your ${BRAND} workspace.`, noindex: true };
  }
  return { ...DEFAULT, noindex: true };
}

const APP_ROUTES = ['/admin', '/client', '/consultant', '/super-admin', '/invoice', '/interview'];

/** Signed-in application areas: kept out of search engines entirely. */
export function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export default function RouteSeo() {
  const { pathname } = useLocation();
  const meta = resolve(pathname);
  const url = `${BASE_URL}${pathname === '/' ? '/' : pathname}`;
  // react-helmet-async changes the title on the next animation frame, which a tab in the background never runs: set it directly as well
  useEffect(() => {
    document.title = meta.title;
  }, [meta.title]);
  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={url} />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
      {isAppRoute(pathname)
        ? <meta name="robots" content="noindex,nofollow" />
        : meta.noindex && <meta name="robots" content="noindex, follow" />}
    </Helmet>
  );
}
