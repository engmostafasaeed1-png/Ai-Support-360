// SAP Note / KBA references, search words and links to SAP websites.
// Nothing here copies SAP content: it finds note NUMBERS that our own reviewed knowledge cites, replaces numbers nobody verified,
// and builds links that open SAP's own sites. Pure functions (no Deno or browser APIs), so the same file is unit-tested with vitest.

const KEYWORD = String.raw`(?:SAP\s+)?(?:Notes?|KBAs?|OSS(?:\s+Notes?)?)`;
const NUMBER = String.raw`\d{5,8}`;
const SEPARATOR = String.raw`\s*(?:,|;|/|&|\band\b|\bor\b)\s*`;
// "SAP Note 2270407", "Notes 2270407 and 2345678", "KBA #3012345", "SAP Note no. 1234567"; a number of 9 or more digits is not a note number
const REFERENCE = String.raw`\b${KEYWORD}\s*(?:no\.?|numbers?|nr\.?|#|:)?\s*(${NUMBER}(?:${SEPARATOR}${NUMBER})*)(?!\d)`;

export const MAX_NOTES = 5;

/** The note numbers a text cites, in the order they appear, without duplicates. */
export function extractNoteNumbers(text: string | null | undefined, max = 8): string[] {
  const out: string[] = [];
  if (!text) return out;
  for (const m of text.matchAll(new RegExp(REFERENCE, 'gi'))) {
    for (const n of m[1].match(/\d{5,8}/g) ?? []) {
      if (!out.includes(n)) out.push(n);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Keeps a note reference only when its number is verified (it appears in a reviewed source). Other numbers are replaced by words. */
export function redactUnverifiedNotes(text: string, allowed: ReadonlySet<string>): string {
  return text.replace(new RegExp(REFERENCE, 'gi'), (whole: string, run: string) => {
    const numbers = run.match(/\d{5,8}/g) ?? [];
    const kept = numbers.filter((n) => allowed.has(n));
    if (kept.length === 0) return 'a related SAP Note';
    if (kept.length === numbers.length) return whole;
    return whole.replace(run, kept.join(', '));
  });
}

/** The address of a note in SAP for Me (it asks for the reader's own SAP login). */
export function noteUrl(number: string): string | null {
  return /^\d{5,8}$/.test(number) ? `https://me.sap.com/notes/${number}` : null;
}

// Words that say nothing about the problem (and the labels of the draft ticket text).
const STOP = new Set([
  'the', 'and', 'for', 'with', 'not', 'cannot', 'cant', 'can', 'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'there', 'their', 'them', 'then', 'than', 'from', 'into', 'onto', 'over', 'under', 'after', 'before', 'about', 'above',
  'below', 'between', 'while', 'also', 'just', 'only', 'very', 'much', 'many', 'some', 'any', 'all', 'our', 'your', 'you', 'are', 'was',
  'were', 'been', 'being', 'has', 'have', 'had', 'does', 'did', 'doing', 'done', 'will', 'would', 'could', 'should', 'shall', 'may', 'might',
  'must', 'need', 'needs', 'needed', 'want', 'wants', 'please', 'thanks', 'thank', 'hello', 'dear', 'team', 'issue', 'issues', 'problem',
  'problems', 'error', 'errors', 'fail', 'fails', 'failed', 'failing', 'failure', 'unable', 'getting', 'get', 'got', 'use', 'used', 'using',
  'try', 'tried', 'trying', 'see', 'seen', 'show', 'shows', 'shown', 'system', 'user', 'users', 'client', 'customer', 'sap', 'test', 'ticket',
  'request', 'help', 'support', 'today', 'now', 'still', 'again', 'same', 'new', 'old', 'one', 'two', 'three', 'first', 'second', 'last',
  'each', 'every', 'both', 'either', 'other', 'another', 'such', 'like', 'able', 'possible', 'works', 'working', 'work', 'run', 'running',
  'make', 'makes', 'made', 'way', 'because',
  // labels of the draft ticket text and the placeholders left by the scrub
  'title', 'areas', 'description', 'details', 'more', 'company', 'person', 'email', 'link', 'host', 'phone', 'number', 'custom', 'object',
]);

const isCode = (t: string) => /\p{L}/u.test(t) && /\d/.test(t) && t.length <= 12;

/** Up to `max` search words from a (scrubbed) text: codes such as FB60 or M7018 first, then the other words in the order they appear. */
export function pickSearchTerms(text: string | null | undefined, max = 5): string[] {
  const tokens = (text ?? '')
    .replace(/\[[a-z ]{2,20}\]/g, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length >= 3 && t.length <= 30 && !STOP.has(t) && !/^\d+$/.test(t));
  const unique = [...new Set(tokens)];
  return [...unique.filter(isCode), ...unique.filter((t) => !isCode(t))].slice(0, max);
}

/**
 * Makes search words from whatever the model returned safe to use: lowercase letters, digits and underscores only,
 * no stop words, no word that belongs to a name we have to protect (`blocked`), no duplicates.
 */
export function cleanSearchTerms(raw: unknown, blocked: ReadonlySet<string> = new Set(), max = 5): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== 'string') continue;
    const t = item.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
    if (t.length < 2 || t.length > 30 || STOP.has(t) || blocked.has(t) || /^\d+$/.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** The words of the names we have to protect (people, company, systems), to keep them out of any search. */
export function blockedWords(deny: ReadonlyArray<{ term: string }>): Set<string> {
  const out = new Set<string>();
  for (const d of deny) {
    for (const w of d.term.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) if (w.length >= 2) out.add(w);
  }
  return out;
}

/** SAP Community's own search page with the given words (it ranks the answers; the reader opens it in the browser). */
export function communitySearchUrl(terms: readonly string[]): string | null {
  const t = terms.filter((x) => /^[\p{L}\p{N}_]{2,30}$/u.test(x)).slice(0, 5);
  if (t.length === 0) return null;
  return `https://community.sap.com/t5/forums/searchpage/tab/message?q=${encodeURIComponent(t.join(' '))}`;
}
