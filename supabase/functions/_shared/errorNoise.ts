// Reports that nobody can act on: they come from the editor preview, from search-engine crawlers or from browser / library noise.
// log-error drops them before they reach the rate limit or the table. The browser applies the same rules in src/lib/errorReporter.ts:
// keep both lists in step.

// Developer machines, the Lovable editor preview and its hot-reload test browser report edits that are not finished yet, not problems of the live site.
const IGNORED_HOSTS =
  /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|[a-z0-9-]+\.lovableproject\.com|id-preview--[a-z0-9-]+\.lovable\.app)$/i;

// Search-engine, social-preview and monitoring robots, and headless test browsers.
const CRAWLER_AGENTS =
  /googlebot|googleother|google-inspectiontool|storebot-google|adsbot-google|bingbot|bingpreview|yandex(?:bot|images)?|baiduspider|duckduckbot|slurp|facebookexternalhit|facebot|meta-webindexer|meta-externalagent|twitterbot|linkedinbot|slackbot|applebot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|bytespider|gptbot|claudebot|ccbot|headlesschrome|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|ia_archiver|crawler|spider/i;

// Browser and library noise.
// The two "Lock" messages come from the sign-in library when two requests (two tabs, a tab in the background) ask for its browser lock at the same moment; it recovers by itself.
// "Script error." is a cross-origin script (browser extension, antivirus) without any detail.
const IGNORED_MESSAGES: RegExp[] = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured/i,
  /Failed to fetch.*frankfurter/i,
  /^Script error\.?$/i,
  /Lock broken by another request with the 'steal' option/i,
  /was released because another request stole it/i,
  // Content-security-policy reports about the editor's hot-reload socket, browser extensions and antivirus scripts.
  /^\[diag:csp\].*(?:wss?:\/\/localhost|(?:chrome|moz|safari|safari-web|ms-browser)-extension:|kaspersky-labs\.com)/i,
];

export type IgnoredReason = 'host' | 'crawler' | 'message';

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isIgnoredHost(hostname: string): boolean {
  return IGNORED_HOSTS.test(hostname);
}

export function isCrawlerUserAgent(userAgent: string): boolean {
  return CRAWLER_AGENTS.test(userAgent);
}

export function isIgnoredMessage(message: string): boolean {
  return IGNORED_MESSAGES.some((rx) => rx.test(message));
}

/** Why a report is dropped, or null when it must be stored. */
const EXTENSION_SOURCE = /^(?:chrome|moz|safari|safari-web)-extension(?::\/\/|$)/i;

/** A CSP report whose sourceFile is a browser extension (sent in the report context). */
export function isExtensionCspReport(message: string, context?: unknown): boolean {
  if (!/^\[diag:csp\]/i.test(message) || !context || typeof context !== 'object') return false;
  const c = context as { sourceFile?: unknown; data?: { sourceFile?: unknown } };
  const src = typeof c.sourceFile === 'string' ? c.sourceFile : typeof c.data?.sourceFile === 'string' ? c.data.sourceFile : '';
  return EXTENSION_SOURCE.test(src);
}

export function ignoredReason(input: { message: string; url?: unknown; userAgent?: string; context?: unknown }): IgnoredReason | null {
  const host = hostOf(input.url);
  if (host && isIgnoredHost(host)) return 'host';
  if (input.userAgent && isCrawlerUserAgent(input.userAgent)) return 'crawler';
  if (isIgnoredMessage(input.message) || isExtensionCspReport(input.message, input.context)) return 'message';
  return null;
}
