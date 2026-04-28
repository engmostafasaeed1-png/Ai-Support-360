/**
 * Sends an error report to the `log-error` edge function so admins are
 * notified and can take action. Fire-and-forget; never throws.
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

function shouldSkip(message: string): boolean {
  // Avoid noise from extension/CSP/network we can't act on
  return (
    /ResizeObserver loop/i.test(message) ||
    /Non-Error promise rejection captured/i.test(message) ||
    /Failed to fetch.*frankfurter/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) === false && false
  );
}

export function reportError(input: ReportInput): void {
  try {
    if (!input?.message) return;
    if (shouldSkip(input.message)) return;

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
      message: input.message,
      stack: input.stack,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
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
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled promise rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    reportError({
      level: 'error',
      source: 'unhandledrejection',
      message,
      stack,
    });
  });
}
