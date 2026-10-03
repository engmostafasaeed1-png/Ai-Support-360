// Removes identifying details from text before it is stored as shared knowledge or shown to someone else.
// It is a safety net, not a promise: an administrator still reads every item before it is published.
// Pure functions (no Deno or browser APIs), so the same file is unit-tested with vitest.

export interface ScrubResult {
  text: string;
  /** What was found and replaced: email, link, ip, host, phone, number, id, custom_object, name. */
  flags: string[];
}

export interface DenyTerm {
  term: string;
  label: string;
}

// Words that are part of many company names and identify nobody.
const GENERIC_NAME_WORDS = new Set([
  'group', 'company', 'corporation', 'corp', 'limited', 'ltd', 'llc', 'inc', 'holding', 'holdings', 'international',
  'industries', 'industrial', 'trading', 'services', 'solutions', 'technologies', 'technology', 'systems', 'global',
  'enterprises', 'consulting', 'consultants', 'partners', 'test', 'demo', 'the', 'and', 'for', 'sap', 'support',
  'mail', 'email', 'www', 'smtp', 'intra', 'intranet', 'corp', 'com', 'net', 'org', 'gov', 'edu',
  'شركة', 'مؤسسة', 'مجموعة',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|local|lan|corp|internal|intranet|biz|info|edu|gov|eg|sa|ae|de|uk|us|fr|nl|in|cloud|app|dev|sap|ondemand|hana)\b/gi;
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{7,}\d(?!\w)/g;
// Customer objects start with Z or Y (ZFI_VENDOR_REPORT, ZFI01). Namespaces such as /IWFND/ are standard SAP and stay.
const CUSTOM_OBJECT_UNDERSCORE = /\b[ZY][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/g;
const CUSTOM_OBJECT_DIGITS = /\b[ZY][A-Z]{2,}[0-9]+[A-Z0-9]*\b/g;
const LONG_NUMBER = /\b\d{6,}\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A number that follows "Note", "KBA" or "OSS" (also in a list such as "Notes 2270407 and 2345678") is a public SAP reference and stays. */
function isNoteReference(whole: string, offset: number): boolean {
  const before = whole.slice(Math.max(0, offset - 16), offset);
  if (/(?:\bnotes?|\bkba|\boss)[^\d\n]{0,8}$/i.test(before)) return true;
  const longer = whole.slice(Math.max(0, offset - 120), offset);
  return /(?:\bnotes?|\bkbas?|\boss)\s*(?:no\.?|numbers?|nr\.?|#|:)?\s*(?:\d{5,8}\s*(?:,|;|\/|&|and|or)\s*)+$/i.test(longer);
}

/** The full name and each distinctive word of it, to be removed from a text. */
export function denyTermsFromNames(names: ReadonlyArray<string | null | undefined>, label: string, minWord = 4): DenyTerm[] {
  const out = new Map<string, DenyTerm>();
  const add = (term: string) => {
    const t = term.trim();
    if (t.length >= 3) out.set(t.toLowerCase(), { term: t, label });
  };
  for (const raw of names) {
    const name = (raw ?? '').trim();
    if (name.length < 3) continue;
    add(name);
    for (const word of name.split(/[^\p{L}\p{N}]+/u)) {
      if (word.length >= minWord && !GENERIC_NAME_WORDS.has(word.toLowerCase())) add(word);
    }
  }
  return [...out.values()];
}

/** From e-mail addresses: the words before the @ (people) and the words of the domain (company). */
export function denyTermsFromEmails(emails: ReadonlyArray<string | null | undefined>): DenyTerm[] {
  const people: string[] = [];
  const companies: string[] = [];
  for (const raw of emails) {
    const m = /^([^@\s]+)@([^@\s]+)$/.exec((raw ?? '').trim());
    if (!m) continue;
    for (const w of m[1].split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3) people.push(w);
    const labels = m[2].split('.').slice(0, -1);
    for (const label of labels) {
      for (const w of label.split(/[^\p{L}\p{N}]+/u)) {
        if (w.length >= 4 && !GENERIC_NAME_WORDS.has(w.toLowerCase())) companies.push(w);
      }
    }
  }
  return [...denyTermsFromNames(people, '[person]', 3), ...denyTermsFromNames(companies, '[company]', 4)];
}

export function scrubText(input: string | null | undefined, deny: ReadonlyArray<DenyTerm> = []): ScrubResult {
  let text = typeof input === 'string' ? input : '';
  const flags = new Set<string>();

  const swap = (re: RegExp, replacement: string, flag: string) => {
    text = text.replace(re, () => {
      flags.add(flag);
      return replacement;
    });
  };

  swap(EMAIL, '[email]', 'email');
  swap(URL_RE, '[link]', 'link');
  swap(UUID, '[id]', 'id');
  swap(IPV4, '[ip]', 'ip');
  swap(HOST, '[host]', 'host');

  text = text.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 9) return match;
    if (/^\d+$/.test(match)) return match; // plain digits: handled as a number below
    if (/\d{4}-\d{2}-\d{2}/.test(match) || /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(match)) return match; // a date
    if (/(?:^|[\s.-])\d(?:[\s.-]|$)/.test(match)) return match; // a list of single digits
    flags.add('phone');
    return '[phone]';
  });

  swap(CUSTOM_OBJECT_UNDERSCORE, '[custom object]', 'custom_object');
  swap(CUSTOM_OBJECT_DIGITS, '[custom object]', 'custom_object');

  text = text.replace(LONG_NUMBER, (match, offset: number, whole: string) => {
    if (isNoteReference(whole, offset)) return match;
    flags.add('number');
    return '[number]';
  });

  const terms = [...deny]
    .filter(d => d.term.trim().length >= 3)
    .sort((a, b) => b.term.length - a.term.length);
  for (const d of terms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(d.term.trim())}(?![\\p{L}\\p{N}_])`, 'giu');
    text = text.replace(re, () => {
      flags.add('name');
      return d.label;
    });
  }

  return { text, flags: [...flags].sort() };
}

/** Scrubs several texts and returns the texts in the same order with the union of the flags. */
export function scrubAll(values: ReadonlyArray<string | null | undefined>, deny: ReadonlyArray<DenyTerm> = []): { values: string[]; flags: string[] } {
  const flags = new Set<string>();
  const out = values.map(v => {
    const r = scrubText(v, deny);
    r.flags.forEach(f => flags.add(f));
    return r.text;
  });
  return { values: out, flags: [...flags].sort() };
}
