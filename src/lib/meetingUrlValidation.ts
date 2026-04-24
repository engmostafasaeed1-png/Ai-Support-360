import { detectProvider, type MeetingProvider } from '@/components/session/MeetingLinkButton';

export type ValidationCode =
  | 'empty'
  | 'not_a_url'
  | 'insecure_scheme'
  | 'unknown_domain'
  | 'meet_bad_path'
  | 'zoom_bad_path'
  | 'teams_bad_path'
  | 'jitsi_bad_path'
  | 'expired_hint'
  | 'placeholder';

export interface MeetingUrlValidation {
  ok: boolean;
  /** The detected (or attempted) provider. */
  provider: MeetingProvider;
  /** Stable machine codes describing what's wrong. Empty when ok. */
  issues: ValidationCode[];
  /** Human-readable summary suitable for translation defaults. */
  summary?: string;
  /** True when the URL looks structurally fine but may be expired/used. */
  expirationHint?: boolean;
}

const KNOWN_HOSTS: Record<Exclude<MeetingProvider, 'unknown'>, RegExp[]> = {
  meet: [/^meet\.google\.com$/i],
  zoom: [/^([a-z0-9-]+\.)?zoom\.us$/i],
  teams: [/^teams\.microsoft\.com$/i, /^teams\.live\.com$/i],
  jitsi: [/^meet\.jit\.si$/i, /jitsi/i],
};

const PLACEHOLDER_PATTERNS = [
  /\{.*\}/, // {meeting_id}
  /<.*>/, // <link>
  /example\.com/i,
  /your[-_]?meeting/i,
  /todo/i,
  /tbd/i,
];

// Provider-specific path shape checks.
const PATH_RULES: Record<Exclude<MeetingProvider, 'unknown'>, { rule: RegExp; code: ValidationCode }> = {
  // Meet codes are 3-4-3 letters, e.g. /abc-defg-hij ; lookup paths also valid.
  meet: { rule: /^\/(lookup\/[A-Za-z0-9_-]+|[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})\/?$/i, code: 'meet_bad_path' },
  // Zoom: /j/<digits> or /my/<name> or /w/<id>?pwd=
  zoom: { rule: /^\/(j|w|my|s)\/[A-Za-z0-9._-]+/i, code: 'zoom_bad_path' },
  // Teams: /l/meetup-join/...  or /meet/...
  teams: { rule: /^\/(l\/meetup-join\/|meet\/|_#\/l\/meetup-join\/)/i, code: 'teams_bad_path' },
  // Jitsi: any non-empty path segment is a room name
  jitsi: { rule: /^\/[^/?#]+/, code: 'jitsi_bad_path' },
};

/**
 * Validate a meeting URL: scheme, known provider domain, provider-specific
 * path shape, and obvious expiration / placeholder hints.
 *
 * Pure function — safe to run in render or effects.
 */
export function validateMeetingUrl(input: string | null | undefined): MeetingUrlValidation {
  const url = (input ?? '').trim();
  if (!url) {
    return { ok: false, provider: 'unknown', issues: ['empty'], summary: 'No meeting link provided.' };
  }

  if (PLACEHOLDER_PATTERNS.some((re) => re.test(url))) {
    return {
      ok: false,
      provider: detectProvider(url),
      issues: ['placeholder'],
      summary: 'The link looks like a placeholder rather than a real meeting URL.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      provider: detectProvider(url),
      issues: ['not_a_url'],
      summary: 'The meeting link is not a valid URL.',
    };
  }

  const issues: ValidationCode[] = [];

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    issues.push('insecure_scheme');
  } else if (parsed.protocol === 'http:') {
    issues.push('insecure_scheme');
  }

  const provider = detectProvider(url);
  const hostname = parsed.hostname;

  if (provider === 'unknown') {
    // Unknown host — check it isn't obviously broken (e.g. localhost).
    if (/^(localhost|127\.|0\.0\.0\.0)/i.test(hostname)) {
      issues.push('unknown_domain');
    } else {
      issues.push('unknown_domain');
    }
  } else {
    const hostOk = KNOWN_HOSTS[provider].some((re) => re.test(hostname));
    if (!hostOk) issues.push('unknown_domain');

    // Path validation
    const path = parsed.pathname || '/';
    const { rule, code } = PATH_RULES[provider];
    if (!rule.test(path)) issues.push(code);
  }

  // Expiration hints — heuristics based on common query params.
  let expirationHint = false;
  const lower = url.toLowerCase();
  const expiresAt =
    parsed.searchParams.get('expires') ||
    parsed.searchParams.get('expires_at') ||
    parsed.searchParams.get('exp');
  if (expiresAt) {
    const num = Number(expiresAt);
    const ts = Number.isFinite(num)
      ? num > 1e12
        ? num
        : num * 1000 // seconds → ms
      : Date.parse(expiresAt);
    if (Number.isFinite(ts) && ts > 0 && ts < Date.now()) {
      expirationHint = true;
      issues.push('expired_hint');
    }
  }
  if (!expirationHint && /(expired|invalid[-_]?link|not[-_]?found)/.test(lower)) {
    expirationHint = true;
    issues.push('expired_hint');
  }

  const ok = issues.length === 0;
  return {
    ok,
    provider,
    issues,
    expirationHint,
    summary: ok ? undefined : summariseIssues(issues, provider),
  };
}

function summariseIssues(issues: ValidationCode[], provider: MeetingProvider): string {
  if (issues.includes('empty')) return 'No meeting link provided.';
  if (issues.includes('placeholder')) return 'The link looks like a placeholder.';
  if (issues.includes('not_a_url')) return 'The meeting link is not a valid URL.';
  if (issues.includes('insecure_scheme')) return 'The meeting link must use https://.';
  if (issues.includes('unknown_domain')) {
    return provider === 'unknown'
      ? "We don't recognise this meeting provider's domain."
      : `The link domain doesn't match the expected ${provider} host.`;
  }
  if (issues.some((i) => i.endsWith('_bad_path'))) {
    return `The ${provider} link path looks malformed.`;
  }
  if (issues.includes('expired_hint')) return 'The meeting link appears to be expired.';
  return 'The meeting link looks invalid.';
}
