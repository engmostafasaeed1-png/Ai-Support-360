import { logger } from './logger';
import { supabase } from '@/integrations/supabase/client';

/** Provider-related events worth tracking in analytics over time. */
const TRACKED_EVENTS = new Set([
  'open_attempt',
  'opened',
  'popup_blocked',
  'invalid_url',
  'fast_close',
  'fallback_shown',
  'fallback_selected',
  'framed',
  'load_failed',
]);

function safeHost(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function persistProviderEvent(
  event: string,
  data: Record<string, unknown>,
  level: 'info' | 'warn' | 'error'
) {
  if (!TRACKED_EVENTS.has(event)) return;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return; // Anonymous — skip persistence; buffer still has it.

    const reason = (data.reason as string | undefined) ?? event;
    const provider = (data.provider as string | undefined) ?? 'unknown';
    const sessionId = (data.sessionId as string | undefined) ?? null;
    const url = data.url ?? data.src ?? null;

    // Strip noisy / large fields from metadata.
    const { provider: _p, sessionId: _s, url: _u, src: _src, userAgent: _ua, ...rest } = data;

    await supabase.from('meeting_join_events').insert({
      user_id: userId,
      session_id: sessionId,
      provider,
      event,
      reason,
      url_host: safeHost(url),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      metadata: { ...rest, level },
    });
  } catch {
    /* never let analytics break the user's flow */
  }
}


/**
 * Buffered diagnostic log for CSP violations and meeting provider load errors.
 * Stored in sessionStorage so it survives a tab reload but not across sessions.
 * Use `getDiagnosticsBuffer()` to retrieve entries when filing a bug report.
 */
const BUFFER_KEY = '__diag_buffer_v1';
const MAX_ENTRIES = 100;

export interface DiagnosticEntry {
  ts: string;
  category: 'csp' | 'provider' | 'media';
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

function readBuffer(): DiagnosticEntry[] {
  try {
    if (typeof sessionStorage === 'undefined') return [];
    const raw = sessionStorage.getItem(BUFFER_KEY);
    return raw ? (JSON.parse(raw) as DiagnosticEntry[]) : [];
  } catch {
    return [];
  }
}

function writeBuffer(entries: DiagnosticEntry[]) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* quota or disabled — ignore */
  }
}

export function recordDiagnostic(entry: Omit<DiagnosticEntry, 'ts'>) {
  const full: DiagnosticEntry = { ...entry, ts: new Date().toISOString() };
  const buf = readBuffer();
  buf.push(full);
  writeBuffer(buf);

  const tag = `[diag:${entry.category}]`;
  const payload = { ...entry.data };
  // Only a blocked resource of the site itself is a reportable error. Meeting-provider and camera / microphone events
  // (a blocked popup, a window closed quickly, ...) depend on the visitor's browser: they are stored in meeting_join_events, not in the error list.
  if (entry.level === 'error' && entry.category === 'csp') logger.error(`${tag} ${entry.message}`, undefined, payload);
  else if (entry.level === 'info') logger.info(`${tag} ${entry.message}`, payload);
  else logger.warn(`${tag} ${entry.message}`, payload);
}

export function getDiagnosticsBuffer(): DiagnosticEntry[] {
  return readBuffer();
}

export function clearDiagnosticsBuffer() {
  try {
    sessionStorage.removeItem(BUFFER_KEY);
  } catch {
    /* ignore */
  }
}

// Violations that the site did not cause: the editor preview's hot-reload socket, browser extensions and antivirus scripts.
const FOREIGN_CSP_SOURCE =
  /^(?:wss?|https?):\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)|^(?:chrome|moz|safari|safari-web|ms-browser)-extension:|kaspersky-labs\.com/i;

// A browser extension's own script: a full extension URL or the bare scheme name some browsers report.
const EXTENSION_SOURCE = /^(?:chrome|moz|safari|safari-web)-extension(?::\/\/|$)/i;
const KEYWORD_BLOCKED = /^(?:blob|data|inline|eval)$/i;

export function isForeignCspViolation(evt: Pick<SecurityPolicyViolationEvent, 'blockedURI' | 'sourceFile' | 'sample'>): boolean {
  const source = evt.sourceFile || '';
  if (EXTENSION_SOURCE.test(source)) return true;
  // blob:/data:/inline/eval with no sample, raised from an extension.
  if (KEYWORD_BLOCKED.test(evt.blockedURI || '') && !evt.sample && /-extension/i.test(source)) return true;
  return FOREIGN_CSP_SOURCE.test(evt.blockedURI || '') || FOREIGN_CSP_SOURCE.test(source);
}

let cspListenerAttached = false;

/**
 * Install a global listener for CSP violations and unhandled fetch/script errors
 * that commonly stem from CSP / X-Frame-Options blocks for embedded providers.
 *
 * Safe to call multiple times — only attaches once.
 */
export function installCspViolationLogger() {
  if (typeof document === 'undefined' || cspListenerAttached) return;
  cspListenerAttached = true;

  document.addEventListener('securitypolicyviolation', (e) => {
    const evt = e as SecurityPolicyViolationEvent;
    if (isForeignCspViolation(evt)) return;
    recordDiagnostic({
      category: 'csp',
      level: 'error',
      message: `CSP violation: ${evt.violatedDirective} blocked ${evt.blockedURI || '<inline>'}`,
      data: {
        blockedURI: evt.blockedURI,
        violatedDirective: evt.violatedDirective,
        effectiveDirective: evt.effectiveDirective,
        originalPolicy: evt.originalPolicy?.slice(0, 500),
        documentURI: evt.documentURI,
        sourceFile: evt.sourceFile,
        lineNumber: evt.lineNumber,
        columnNumber: evt.columnNumber,
        statusCode: evt.statusCode,
        sample: evt.sample,
        disposition: evt.disposition,
        referrer: evt.referrer,
      },
    });
  });

  // Iframe load errors (e.g., X-Frame-Options denial for Meet).
  window.addEventListener(
    'error',
    (e) => {
      const target = e.target as Element | null;
      if (target && target.tagName === 'IFRAME') {
        const src = (target as HTMLIFrameElement).src;
        if (/meet\.google\.com|teams\.(microsoft|live)\.com|zoom\.us|jit\.si/i.test(src || '')) {
          const provider = /meet\.google\.com/i.test(src) ? 'meet'
            : /teams\.(microsoft|live)\.com/i.test(src) ? 'teams'
            : /zoom\.us/i.test(src) ? 'zoom'
            : /jit\.si/i.test(src) ? 'jitsi' : 'unknown';
          logProviderEvent(
            'load_failed',
            { provider, url: src, tag: 'iframe' },
            'error'
          );
        }
      }
    },
    true // capture phase: iframe error events don't bubble
  );
}

/**
 * Log a meeting-provider lifecycle event (open attempt, blocked popup, fast-close, success).
 * Keeps a uniform shape so we can grep the diagnostics buffer.
 */
export function logProviderEvent(
  event:
    | 'open_attempt'
    | 'opened'
    | 'popup_blocked'
    | 'invalid_url'
    | 'fast_close'
    | 'fallback_shown'
    | 'fallback_selected'
    | 'framed'
    | 'load_failed'
    | 'preflight_open'
    | 'preflight_proceed'
    | 'preflight_error',
  data: Record<string, unknown>,
  level: DiagnosticEntry['level'] = 'info'
) {
  recordDiagnostic({
    category: event.startsWith('preflight') ? 'media' : 'provider',
    level,
    message: `provider:${event}`,
    data: { ...data, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined },
  });
  // Fire-and-forget: persist tracked events to Supabase for analytics.
  void persistProviderEvent(event, data, level);
}
