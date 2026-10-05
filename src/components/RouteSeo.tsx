import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

const BASE_URL = 'https://www.aisupport360.com';
const BRAND = 'AI Support Now';

type Meta = { title: string; description: string; noindex?: boolean };

const DEFAULT: Meta = {
  title: `AI Support Now — Expert On-Demand Support`,
  description:
    'AI-powered enterprise support platform. Connect with verified experts for S/4HANA, BTP, SuccessFactors, and 20+ modules. Bilingual Arabic & English.',
};

const ROUTES: Record<string, Meta> = {
  '/': DEFAULT,
  '/pricing': {
    title: `Support Plans & Pricing — ${BRAND}`,
    description:
      'Compare SAP support plans: pay-per-session, monthly retainers and enterprise coverage with verified S/4HANA, BTP and SuccessFactors experts.',
  },
  '/services/s4hana-support': {
    title: `SAP S/4HANA Support Services — ${BRAND}`,
    description:
      'On-demand and retainer SAP S/4HANA support: incident resolution, performance tuning, Fiori troubleshooting, and migration follow-up by verified experts.',
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
    description: 'Join as a client or SAP consultant and get matched with verified SAP experts in minutes.',
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
    const label = parts.reverse().join(' · ');
    return { title: `${label} — ${BRAND}`, description: `${label} in your ${BRAND} workspace.`, noindex: true };
  }
  return { ...DEFAULT, noindex: true };
}

export default function RouteSeo() {
  const { pathname } = useLocation();
  const meta = resolve(pathname);
  const url = `${BASE_URL}${pathname === '/' ? '/' : pathname}`;
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
      {meta.noindex && <meta name="robots" content="noindex, follow" />}
    </Helmet>
  );
}
