/**
 * Plain-language text for an error that came from the database, an edge function or the network.
 *
 * A person who only pressed Save should not read "new row violates row-level security policy for table ..." or
 * "Edge Function returned a non-2xx status code". Raw technical texts are replaced; a short readable message that our own
 * database rules or edge functions raise on purpose is kept as it is.
 */

const NETWORK_TEXT =
  /failed to fetch|networkerror|network error|network request failed|load failed|fetch failed|failed to send a request to the edge function|err_internet_disconnected|err_network/i;
const TECHNICAL_TEXT =
  /violates|constraint|sqlstate|postgres|pgrst|relation "|column "|schema "|syntax error|jsonb|uuid|undefined|is not a function|cannot read|deadlock|statement timeout|pg_[a-z]|supabase|typeerror|referenceerror|syntaxerror/i;

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

function nameOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/** True when the request got no answer at all (offline, blocked, too slow): the server may or may not have saved it. */
export function isNetworkError(error: unknown): boolean {
  const name = nameOf(error);
  return name === 'FunctionsFetchError' || name === 'TimeoutError' || NETWORK_TEXT.test(messageOf(error));
}

export function friendlyErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = messageOf(error).trim();
  const name = nameOf(error);
  if (isNetworkError(error)) return 'We could not reach the server. Please check your connection and try again.';
  if (name === 'FunctionsHttpError' || name === 'FunctionsRelayError' || /non-2xx status code/i.test(raw)) {
    return 'The service could not finish this request. Please try again in a moment.';
  }
  if (/row-level security|permission denied/i.test(raw)) return 'You do not have permission to do this.';
  if (/duplicate key value/i.test(raw)) return 'This already exists.';
  if (/foreign key constraint/i.test(raw)) return 'This is still in use by other records, so it cannot be changed this way.';
  if (/null value in column|violates not-null/i.test(raw)) return 'A required value is missing. Please check the form.';
  if (/violates check constraint/i.test(raw)) return 'One of the values is not allowed. Please check what you entered.';
  if (/invalid input syntax/i.test(raw)) return 'One of the values has the wrong format. Please check what you entered.';
  if (/jwt expired|invalid jwt|not authenticated|refresh token/i.test(raw)) return 'Your session has ended. Please sign in again.';
  if (/rate limit|too many requests/i.test(raw)) return 'Too many requests. Please wait a moment and try again.';
  if (!raw || raw.length > 200 || TECHNICAL_TEXT.test(raw)) return fallback;
  return raw;
}

/** The text to show for a failed edge function call: the reason the function gave ({ error: "..." }), else a plain-language text. */
export async function functionErrorMessage(error: unknown, data?: unknown, fallback?: string): Promise<string> {
  const fromData = (data as { error?: unknown } | null | undefined)?.error;
  if (typeof fromData === 'string' && fromData.trim()) return friendlyErrorMessage(fromData, fallback);
  const context = (error as { context?: unknown } | null | undefined)?.context as
    | { clone?: () => { json?: () => Promise<unknown> }; json?: () => Promise<unknown> }
    | undefined;
  try {
    const body = (await (context?.clone ? context.clone().json?.() : context?.json?.())) as
      | { error?: unknown; message?: unknown }
      | undefined;
    const reason = body?.error ?? body?.message;
    if (typeof reason === 'string' && reason.trim()) return friendlyErrorMessage(reason, fallback);
  } catch {
    /* the body is not JSON: use the plain-language text below */
  }
  return friendlyErrorMessage(error, fallback);
}
