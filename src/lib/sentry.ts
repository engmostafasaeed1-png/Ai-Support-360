import * as Sentry from '@sentry/react';

/**
 * Initialise Sentry only when a DSN is configured. Otherwise this is a no-op,
 * so local development and previews don't send any events.
 *
 * To enable: add VITE_SENTRY_DSN to your environment (e.g. Lovable Cloud secrets
 * surfaced as a Vite env variable, or a GitHub Actions build secret).
 */
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export const sentryEnabled = Boolean(dsn);

/** Strip query string / hash and mask route tokens before anything is sent to Sentry. */
function scrubUrl(u?: string): string | undefined {
  if (!u) return u;
  return u.split('?')[0].split('#')[0].replace(/\/demo\/confirmation\/[^/]+/, '/demo/confirmation/:token');
}

export function initSentry() {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Performance + replay are opt-in; keep the bundle lean by default.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [],
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        if (event.request.url) event.request.url = scrubUrl(event.request.url);
        delete event.request.cookies;
        delete event.request.query_string;
        delete event.request.headers;
      }
      if (event.user) event.user = { id: event.user.id };
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      const data = breadcrumb.data as Record<string, unknown> | undefined;
      if (data && typeof data.url === 'string') data.url = scrubUrl(data.url);
      return breadcrumb;
    },
    // Don't spam Sentry during local dev unless dev explicitly opted in.
    enabled: import.meta.env.PROD || import.meta.env.VITE_SENTRY_FORCE === 'true',
  });
}

export function setSentryUser(user: { id: string; email?: string; role?: string } | null) {
  if (!sentryEnabled) return;
  // Only the opaque user id is sent — never e-mail address or role.
  Sentry.setUser(user ? { id: user.id } : null);
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (!sentryEnabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export { Sentry };
