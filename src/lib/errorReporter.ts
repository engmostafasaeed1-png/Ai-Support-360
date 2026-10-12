/**
 * Sends an error report to the `log-error` edge function so admins are
 * notified and can take action. Fire-and-forget; never throws.
 *
 * Reports nobody can act on (editor preview, search-engine crawlers, browser / library noise) are dropped here and
 * again in the edge function (supabase/functions/_shared/errorNoise.ts): keep both lists in step.
 */
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-error`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// In-memory dedupe so a render loop doesn't spam the endpoint.
const recent = new Map<string, number>();
const DEDUPE_MS = 30_000;

interface ReportInput {
  level?: 'warn' | 'error' | 'fatal';
  source?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

// Developer machines, the Lovable editor preview and its hot-reload test browser report edits that are not finished yet, not problems of the live site.
const IGNORED_HOSTS =
  /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|[a-z0-9-]+\.lovableproject\.com|id-preview--[a-z0-9-]+\.lovable\.app)$/i;

// Search-engine, social-preview and monitoring robots, and headless test browsers.
const CRAWLER_AGENTS =
  /googlebot|googleother|google-inspectiontool|storebot-google|adsbot-google|bingbot|bingpreview|yandex(?:bot|images)?|baiduspider|duckduckbot|slurp|facebookexternalhit|facebot|meta-webindexer|meta-externalagent|twitterbot|linkedinbot|slackbot|applebot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|bytespider|gptbot|claudebot|ccbot|headlesschrome|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|ia_archiver|crawler|spider/i;

// Browser and library noise.
// The "Lock" and "LockManager" messages come from the sign-in library when two requests (two tabs, a tab in the background) ask for the same
// browser lock at the same moment — the browser's own Navigator LockManager race. It recovers by itself, so nothing can be acted on.
// "Script error." is a cross-origin script (browser extension, antivirus) without any detail.
const IGNORED_MESSAGES: RegExp[] = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured/i,
  /Failed to fetch.*frankfurter/i,
  /^Script error\.?$/i,
  /Lock broken by another request/i,
  /Lock was stolen by another request/i,
  /LockManager lock/i,
  /Acquiring an exclusive Navigator LockManager lock/i,
  /was released because another request stole it/i,
  // Content-security-policy reports about the editor's hot-reload socket, browser extensions and antivirus scripts.
  /^\[diag:csp\].*(?:wss?:\/\/localhost|(?:chrome|moz|safari|safari-web|ms-browser)-extension:|kaspersky-labs\.com)/i,
];

export function isIgnoredHost(hostname: string): boolean {
  return IGNORED_HOSTS.test(hostname);
}

export function isCrawlerUserAgent(userAgent: string): boolean {
  return CRAWLER_AGENTS.test(userAgent);
}

export function isIgnoredMessage(message: string): boolean {
  return IGNORED_MESSAGES.some((rx) => rx.test(message));
}

/** Removes secrets / personal data from free text before it leaves the browser. */
function redact(text: string | undefined): string | undefined {
  if (!text) return text;
  return text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/([?&#](?:access_token|refresh_token|token|code|key|apikey|secret|password)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
}

/** Path without query/hash; bearer tokens embedded in known routes are masked. */
function safePath(pathname: string): string {
  return pathname.replace(/^\/demo\/confirmation\/[^/]+/, '/demo/confirmation/:token');
}

export function reportError(input: ReportInput): void {
  try {
    if (!input?.message) return;
    if (typeof window !== 'undefined' && isIgnoredHost(window.location.hostname)) return;
    if (typeof navigator !== 'undefined' && isCrawlerUserAgent(navigator.userAgent)) return;
    if (isIgnoredMessage(input.message)) return;

    const key = `${input.message}::${(input.stack || '').slice(0, 120)}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(key, now);
    if (recent.size > 200) {
      const firstKey = recent.keys().next().value;
      if (firstKey) recent.delete(firstKey);
    }

    const body = JSON.stringify({
      level: input.level ?? 'error',
      source: input.source ?? 'client',
      message: redact(input.message),
      stack: redact(input.stack),
      url: typeof window !== 'undefined' ? window.location.origin + safePath(window.location.pathname) : undefined,
      route: typeof window !== 'undefined' ? safePath(window.location.pathname) : undefined,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      context: input.context,
    });

    // Try to attach the user's JWT if available (so user_id is recorded server-side).
    let token: string | null = null;
    try {
      const raw = localStorage.getItem('sb-' + (import.meta.env.VITE_SUPABASE_PROJECT_ID || '') + '-auth-token');
      if (raw) {
        const parsed = JSON.parse(raw);
        token = parsed?.access_token ?? null;
      }
    } catch {
      /* ignore */
    }

    void fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${token || ANON_KEY}`,
      },
      body,
      keepalive: true,
    }).catch(() => {
      /* never let reporting break the app */
    });
  } catch {
    /* swallow */
  }
}

/** The text of a rejected promise: an Error, a string, or an object with a message (Supabase errors, DOMException). */
function reasonToMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object' && typeof (reason as { message?: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  return 'Unhandled promise rejection';
}

let installed = false;
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    const err = event.error as Error | undefined;
    reportError({
      level: 'error',
      source: 'window.onerror',
      message: err?.message || event.message || 'Unknown error',
      stack: err?.stack,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportError({
      level: 'error',
      source: 'unhandledrejection',
      message: reasonToMessage(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
