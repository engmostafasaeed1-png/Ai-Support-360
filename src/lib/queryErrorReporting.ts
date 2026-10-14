import { logger } from '@/lib/logger';
import { hasActiveSession } from '@/lib/sessionState';

export interface ErrorInfo {
  message: string;
  code?: string;
  status?: number;
  details?: string;
}

/** Reads the useful parts of whatever a failed query or mutation threw: an Error, a Supabase error object, an edge-function error or a string. */
export function describeError(error: unknown): ErrorInfo {
  if (typeof error === 'string') return { message: error || 'Unknown error' };
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; status?: unknown; details?: unknown; context?: unknown };
    const fromContext = e.context && typeof e.context === 'object' ? (e.context as { status?: unknown }).status : undefined;
    const status = typeof e.status === 'number' ? e.status : typeof fromContext === 'number' ? fromContext : undefined;
    return {
      message: typeof e.message === 'string' && e.message ? e.message : 'Unknown error',
      code: typeof e.code === 'string' && e.code ? e.code : undefined,
      status,
      details: typeof e.details === 'string' && e.details ? e.details.slice(0, 300) : undefined,
    };
  }
  return { message: 'Unknown error' };
}

// Database codes that mean "this request was not acceptable", which the screen already tells the person:
// a bad value such as a malformed id (22xxx), a broken rule (23xxx), no permission (42501, 28xxx), a rule raised on purpose (P0001),
// no row found (PGRST116) and an expired or missing sign-in (PGRST301-303).
const EXPECTED_CODE = /^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3}|28[0-9A-Z]{3}|42501|P0001|PGRST116|PGRST30[123])$/;

// A lost connection, a cancelled request or an ended sign-in: nothing in the app to fix.
const NETWORK_OR_SESSION =
  /Failed to fetch|NetworkError|Load failed|Network request failed|Failed to send a request to the Edge Function|The operation was aborted|signal is aborted|AbortError|JWT expired|Auth session missing|not authenticated|Invalid login credentials/i;

const NOT_SIGNED_IN = /^Not signed in( yet)?$/i;
const SIGNED_OUT_REFUSAL = /(permission denied|not signed in|jwt|invalid token|row-level security)/i;

/** True when the failure is the normal answer to a bad request or a lost connection and not a problem of the app. */
export function isExpectedFailure(info: ErrorInfo): boolean {
  if (info.code && EXPECTED_CODE.test(info.code)) return true;
  if (info.status !== undefined && info.status >= 400 && info.status < 500) return true;
  return NETWORK_OR_SESSION.test(info.message);
}

/**
 * Called for every failed query and mutation. Expected failures (bad id in a link, no permission, offline, 4xx) only go to the console;
 * everything else is reported with the real message, the database code, the HTTP status and the name of the query.
 */
export function reportQueryFailure(
  what: 'Query failed' | 'Mutation failed',
  error: unknown,
  queryKey?: readonly unknown[],
): void {
  const info = describeError(error);
  // A query that ran while the session was still being restored: a normal sign-in race, never an error report.
  if (NOT_SIGNED_IN.test(info.message)) return;
  // Without a session the database refuses the call on purpose: an anonymous caller during a sign-in race, not an app error.
  if (!hasActiveSession() && SIGNED_OUT_REFUSAL.test(info.message)) return;
  const context: Record<string, unknown> = {
    code: info.code,
    status: info.status,
    details: info.details,
    query: queryKey && queryKey.length > 0 ? String(queryKey[0]).slice(0, 80) : undefined,
  };
  if (isExpectedFailure(info)) {
    logger.warn(`${what}: ${info.message}`, context);
    return;
  }
  logger.error(what, error instanceof Error ? error : new Error(info.message), context);
}
