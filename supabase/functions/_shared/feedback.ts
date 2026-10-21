/**
 * Feature U — in-app feedback. Pure rules shared by the browser dialog, the feedback function and tests.
 * The database (docs/sql/feedback.sql) repeats the same limits and masking, so a bypassed browser changes nothing.
 */

export const FEEDBACK_TYPES = ['bug', 'idea', 'question', 'compliment'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_SEVERITIES = ['blocks', 'annoying', 'minor'] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];
export const FEEDBACK_STATUSES = ['new', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export const FEEDBACK_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  descMin: 10,
  descMax: 2000,
  files: 3,
  fileBytes: 5 * 1024 * 1024,
  emailMax: 254,
  userPerHour: 5,
  visitorPerHour: 3,
  minVisitorMs: 3000,
  recentErrors: 5,
} as const;

export const FEEDBACK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type FeedbackImageType = (typeof FEEDBACK_IMAGE_TYPES)[number];

/** Removes HTML tags. */
export function stripTags(text: string): string {
  return String(text ?? '').replace(/<[^>]*>/g, '');
}

/** Masks card-like digit runs (13–19 digits) and long token-like strings (32+ characters). Mirrors feedback_clean_text. */
export function maskSecrets(text: string): string {
  return String(text ?? '')
    .replace(/(\d[ -]?){12,18}\d/g, '[hidden number]')
    .replace(/[A-Za-z0-9_=+-]{32,}/g, '[hidden]');
}

/** What the database stores for free text: tags removed, secrets masked, trimmed. */
export function cleanFeedbackText(text: string): string {
  return maskSecrets(stripTags(text)).trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Page path without query string or hash; token-like segments (not ids) are replaced. */
export function cleanPath(path: string): string {
  const bare = String(path ?? '').split('#')[0].split('?')[0] || '/';
  return bare
    .split('/')
    .map((seg) => (seg.length >= 24 && !UUID.test(seg) ? ':token' : seg))
    .join('/')
    .slice(0, 300);
}

/** The ticket / request / session the user is looking at, read from the path only. */
export function activeEntityFromPath(path: string): { kind: string; id: string } | null {
  const m = cleanPath(path).match(/\/(tickets|requests|cases|sessions|assignments|invoices)\/([^/]+)/);
  if (!m || m[2] === ':token') return null;
  return { kind: m[1].replace(/s$/, ''), id: m[2].slice(0, 64) };
}

/** Error text safe to attach: e-mails and secrets masked, one line, short. */
export function scrubErrorMessage(message: string): string {
  return maskSecrets(String(message ?? ''))
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function browserFamily(ua: string): string {
  const s = String(ua ?? '');
  if (/Edg\//.test(s)) return 'Edge';
  if (/OPR\/|Opera/.test(s)) return 'Opera';
  if (/SamsungBrowser/.test(s)) return 'Samsung Internet';
  if (/Firefox\//.test(s)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(s)) return 'Chrome';
  if (/Safari\//.test(s)) return 'Safari';
  return 'Other';
}

export function osFamily(ua: string): string {
  const s = String(ua ?? '');
  if (/Android/.test(s)) return 'Android';
  if (/iPhone|iPad|iPod/.test(s)) return 'iOS';
  if (/Windows/.test(s)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(s)) return 'macOS';
  if (/CrOS/.test(s)) return 'ChromeOS';
  if (/Linux/.test(s)) return 'Linux';
  return 'Other';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FeedbackDraft {
  type: FeedbackType | '';
  severity?: FeedbackSeverity | null;
  title: string;
  description: string;
  contactEmail?: string;
  consentContact?: boolean;
}

export type FeedbackFieldError = 'required' | 'too_short' | 'too_long' | 'invalid';

/** Field errors for the dialog (and the function before it calls the database). Empty object = valid. */
export function validateFeedback(d: FeedbackDraft): Partial<Record<'type' | 'severity' | 'title' | 'description' | 'contactEmail', FeedbackFieldError>> {
  const errors: Partial<Record<'type' | 'severity' | 'title' | 'description' | 'contactEmail', FeedbackFieldError>> = {};
  if (!d.type) errors.type = 'required';
  else if (!(FEEDBACK_TYPES as readonly string[]).includes(d.type)) errors.type = 'invalid';
  if (d.type === 'bug' && d.severity && !(FEEDBACK_SEVERITIES as readonly string[]).includes(d.severity)) errors.severity = 'invalid';
  const title = stripTags(d.title ?? '').trim();
  if (!title) errors.title = 'required';
  else if (title.length < FEEDBACK_LIMITS.titleMin) errors.title = 'too_short';
  else if (title.length > FEEDBACK_LIMITS.titleMax) errors.title = 'too_long';
  const desc = stripTags(d.description ?? '').trim();
  if (!desc) errors.description = 'required';
  else if (desc.length < FEEDBACK_LIMITS.descMin) errors.description = 'too_short';
  else if (desc.length > FEEDBACK_LIMITS.descMax) errors.description = 'too_long';
  const email = (d.contactEmail ?? '').trim();
  if (email && (email.length > FEEDBACK_LIMITS.emailMax || !EMAIL.test(email))) errors.contactEmail = 'invalid';
  return errors;
}

/** Image type from the first bytes of the file (never trust the name or the browser's type). */
export function sniffImageType(bytes: Uint8Array): FeedbackImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export const IMAGE_EXT: Record<FeedbackImageType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Screens without the floating button (still reachable from a user menu where one exists). */
export function isFeedbackHiddenRoute(path: string): boolean {
  return /^\/join\//.test(path)
    || path.startsWith('/.lovable/oauth')
    || /^\/invoice\//.test(path)
    || /^\/interview\/live\//.test(path);
}

/** Server error codes from submit_feedback, mapped to what the dialog says. */
export function feedbackErrorKey(message: string): 'rate_limited' | 'disabled' | 'too_fast' | 'invalid' | 'generic' {
  const m = String(message ?? '');
  if (m.includes('rate_limited')) return 'rate_limited';
  if (m.includes('feedback_disabled')) return 'disabled';
  if (m.includes('too_fast')) return 'too_fast';
  if (/invalid_|too_many_files|file_/.test(m)) return 'invalid';
  return 'generic';
}

/** Markdown for a developer task (no e-mail address, no ids beyond the report id). */
export function feedbackTaskMarkdown(r: {
  id: string; type: string; severity?: string | null; title: string; description: string; route?: string;
  status?: string; priority?: string; created_at?: string; context?: Record<string, unknown> | null;
}): string {
  const ctx = r.context ?? {};
  const pick = (k: string) => (ctx[k] == null ? '' : String(ctx[k]));
  const errors = Array.isArray((ctx as any).errors) ? ((ctx as any).errors as unknown[]).map((e) => `- ${String(e)}`) : [];
  return [
    `## ${r.title}`,
    '',
    `- Type: ${r.type}${r.severity ? ` (${r.severity})` : ''}`,
    `- Status / priority: ${r.status ?? 'new'} / ${r.priority ?? 'normal'}`,
    `- Page: \`${r.route || '/'}\``,
    `- Browser: ${pick('browser')} on ${pick('os')} · ${pick('viewport')} · ${pick('lang')} · ${pick('theme')}`,
    `- App version: ${pick('version') || 'unknown'}`,
    r.created_at ? `- Reported: ${r.created_at}` : '',
    `- Report: ${r.id}`,
    '',
    '### Description',
    '',
    r.description,
    ...(errors.length ? ['', '### Recent errors', '', ...errors] : []),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** CSV cell that spreadsheets cannot run as a formula. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
