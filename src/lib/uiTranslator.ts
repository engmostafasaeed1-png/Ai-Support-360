/**
 * Replaces the English text that is written directly in the screens by the text of another language.
 * The texts come from the table ui_translations (source = the English text as shown, target = the translation).
 * A source with {0}, {1} ... is a pattern: the parts of the shown text at those places are kept (names, numbers, titles)
 * and are translated themselves when they are in the table.
 * Dates (Oct 12, 2026), times (10:00 AM) and relative times (about 2 hours ago) are translated by rules.
 */

export type UiDictionary = Record<string, string>;

interface Pattern {
  re: RegExp;
  order: number[];
  target: string;
  anchor: string;
  weight: number;
}

export interface CompiledDictionary {
  exact: Map<string, string>;
  patterns: Pattern[];
}

const LATIN = /[A-Za-z]/;
const PLACEHOLDER = /\{(\d+)\}/g;
// A placeholder of a source can be typed: {n0} matches only a number (12, 3.5, 1,000.00, 45%, $62K, +966 56 979 7197) and {d0} only a date or a day
// (Oct 22, 2026, Mon, 12:30), so that a pattern like "{n0} active" or "Due {d0}" does not translate the words of a ticket title typed by a user.
const TYPED_PLACEHOLDER = /^\{([nd]?)(\d+)\}$/;
const PLACEHOLDER_REGEX: Record<string, string> = {
  '': '(.+?)',
  n: '([+-]?\\$?\\d[\\d.,:/% -]*[KkMm]?)',
  d: '((?:\\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\\n]{0,40}?)',
};

export const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileDictionary(dictionary: UiDictionary): CompiledDictionary {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [rawKey, target] of Object.entries(dictionary)) {
    const key = normalizeText(rawKey);
    if (!key || !target) continue;
    if (!/\{[nd]?\d+\}/.test(key)) {
      exact.set(key, target);
      continue;
    }
    const order: number[] = [];
    let source = '';
    let weight = 0;
    let anchor = '';
    for (const part of key.split(/(\{[nd]?\d+\})/)) {
      const placeholder = TYPED_PLACEHOLDER.exec(part);
      if (placeholder) {
        source += PLACEHOLDER_REGEX[placeholder[1]];
        order.push(Number(placeholder[2]));
      } else if (part) {
        source += escapeRegExp(part);
        weight += part.length;
        if (part.length > anchor.length) anchor = part;
      }
    }
    patterns.push({ re: new RegExp(`^${source}$`, 's'), order, target, anchor, weight });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  return { exact, patterns };
}

const MONTHS: Record<string, string> = {
  jan: 'يناير', feb: 'فبراير', mar: 'مارس', apr: 'أبريل', may: 'مايو', jun: 'يونيو',
  jul: 'يوليو', aug: 'أغسطس', sep: 'سبتمبر', oct: 'أكتوبر', nov: 'نوفمبر', dec: 'ديسمبر',
};
const WEEKDAYS: Record<string, string> = {
  sun: 'الأحد', mon: 'الإثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت',
};
const MONTH_PATTERN = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const monthName = (month: string): string => MONTHS[month.slice(0, 3).toLowerCase()] ?? month;

/** Dates and times written in English: 12 أكتوبر 2026, الإثنين، 12 أكتوبر · 10:00 ص. Returns null when the text holds none. */
export function translateDates(text: string): string | null {
  if (text.length > 160 || !/\d/.test(text)) return null;
  let out = text;
  out = out.replace(new RegExp(`\\b${MONTH_PATTERN}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:, (\\d{4}))?\\b`, 'g'),
    (_all: string, month: string, day: string, year?: string) => `${day} ${monthName(month)}${year ? ` ${year}` : ''}`);
  out = out.replace(new RegExp(`\\b(\\d{1,2}) ${MONTH_PATTERN}\\b`, 'g'),
    (_all: string, day: string, month: string) => `${day} ${monthName(month)}`);
  out = out.replace(new RegExp(`\\b${MONTH_PATTERN} (\\d{4})\\b`, 'g'),
    (_all: string, month: string, year: string) => `${monthName(month)} ${year}`);
  out = out.replace(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:[a-z]*day)?\b(,?)/g,
    (_all: string, day: string, comma: string) => `${WEEKDAYS[day.toLowerCase()] ?? day}${comma ? '،' : ''}`);
  out = out.replace(/(\d{1,2}:\d{2}(?::\d{2})?)\s?(AM|PM)\b/g,
    (_all: string, time: string, half: string) => `${time} ${half === 'AM' ? 'ص' : 'م'}`);
  return out === text ? null : out;
}

const UNIT_FORMS: Record<string, [string, string, string, string]> = {
  second: ['ثانية', 'ثانيتين', 'ثوانٍ', 'ثانية'],
  minute: ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'],
  hour: ['ساعة', 'ساعتين', 'ساعات', 'ساعة'],
  day: ['يوم', 'يومين', 'أيام', 'يومًا'],
  week: ['أسبوع', 'أسبوعين', 'أسابيع', 'أسبوعًا'],
  month: ['شهر', 'شهرين', 'أشهر', 'شهرًا'],
  year: ['سنة', 'سنتين', 'سنوات', 'سنة'],
};
const QUALIFIERS: Record<string, string> = { 'about ': 'حوالي ', 'over ': 'أكثر من ', 'almost ': 'قرابة ', 'less than ': 'أقل من ' };

function countPhrase(count: number, unit: string): string {
  const forms = UNIT_FORMS[unit];
  if (count === 1) return forms[0];
  if (count === 2) return forms[1];
  return `${count} ${count <= 10 ? forms[2] : forms[3]}`;
}

/** "about 2 hours ago", "in 1 day", "less than a minute ago". Returns null for any other text. */
export function translateRelativeTime(text: string): string | null {
  const m = /^(in )?(about |over |almost |less than )?(a|an|\d+) (second|minute|hour|day|week|month|year)s?( ago)?$/.exec(text);
  if (!m || (!m[1] && !m[5])) return null;
  const count = m[3] === 'a' || m[3] === 'an' ? 1 : Number(m[3]);
  const qualifier = m[2] ? QUALIFIERS[m[2]] : '';
  return `${m[1] ? 'خلال' : 'منذ'} ${qualifier}${countPhrase(count, m[4])}`;
}

/** The translation of one text (spaces already tidied), or null when there is none. */
export function translateText(raw: string, dict: CompiledDictionary, depth = 0): string | null {
  const text = normalizeText(raw);
  if (!text || !LATIN.test(text)) return null;
  const hit = dict.exact.get(text);
  if (hit !== undefined) return hit;
  // a list of messages joined with "; " (for example the report of a file import): translated when every message is known
  if (depth < 2 && text.length < 800 && text.includes('; ')) {
    const parts = text.split('; ').map((part) => translateText(part, dict, depth + 1));
    if (parts.length > 1 && parts.every((part) => part !== null)) return parts.join('؛ ');
  }
  for (const pattern of dict.patterns) {
    if (pattern.anchor && !text.includes(pattern.anchor)) continue;
    const match = pattern.re.exec(text);
    if (!match) continue;
    const parts = new Map<number, string>();
    pattern.order.forEach((placeholder, index) => {
      const piece = match[index + 1];
      parts.set(placeholder, depth < 2 ? (translateText(piece, dict, depth + 1) ?? piece) : piece);
    });
    return pattern.target.replace(PLACEHOLDER, (_all: string, n: string) => parts.get(Number(n)) ?? '');
  }
  return translateRelativeTime(text) ?? translateDates(text);
}

/** Like translateText, for the value of a text node or an attribute: the spaces around the text are kept. */
export function translateValue(value: string, dict: CompiledDictionary): string | null {
  const core = translateText(value, dict);
  if (core === null) return null;
  const lead = /^\s*/.exec(value)?.[0] ?? '';
  const trail = /\s*$/.exec(value)?.[0] ?? '';
  return `${lead}${core}${trail}`;
}

/** The title of a page is "Page · Portal — Brand": every part is translated, the brand stays. */
export function translateTitle(title: string, dict: CompiledDictionary): string | null {
  const whole = translateText(title, dict);
  if (whole !== null) return whole;
  let changed = false;
  const parts = title.split(' — ').map((segment) => segment.split(' · ').map((piece) => {
    const next = translateText(piece, dict);
    if (next === null) return piece;
    changed = true;
    return next;
  }).join(' · '));
  return changed ? parts.join(' — ') : null;
}

const SKIP_TEXT = 'script,style,noscript,textarea,code,pre,kbd,samp,[contenteditable=""],[contenteditable="true"],[data-no-translate],[translate="no"],.notranslate';
const SKIP_ATTRIBUTE = '[data-no-translate],[translate="no"],.notranslate';
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'];

interface Written {
  original: string;
  written: string;
}

export interface UiTranslatorHandle {
  setDictionary: (dictionary: UiDictionary) => void;
  stop: () => void;
}

/** Translates everything that is on the page now and everything that appears later, until stop() is called (then the English text comes back). */
export function startUiTranslator(initial: UiDictionary, doc: Document = document): UiTranslatorHandle {
  let dict = compileDictionary(initial);
  const texts = new Map<Text, Written>();
  const attributes = new Map<Element, Map<string, Written>>();
  let title: Written | null = null;

  const translateTextNode = (node: Text): void => {
    const value = node.nodeValue;
    if (!value || value.length > 1500 || !LATIN.test(value)) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_TEXT)) return;
    const next = translateValue(value, dict);
    if (next === null || next === value) return;
    texts.set(node, { original: value, written: next });
    node.nodeValue = next;
  };

  const translateAttribute = (element: Element, name: string): void => {
    const value = element.getAttribute(name);
    if (!value || value.length > 600 || !LATIN.test(value) || element.closest(SKIP_ATTRIBUTE)) return;
    const next = translateValue(value, dict);
    if (next === null || next === value) return;
    let written = attributes.get(element);
    if (!written) {
      written = new Map<string, Written>();
      attributes.set(element, written);
    }
    written.set(name, { original: value, written: next });
    element.setAttribute(name, next);
  };

  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      translateTextNode(node as Text);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    for (const name of ATTRIBUTES) translateAttribute(element, name);
    if (element.matches(SKIP_TEXT)) return;
    for (let child = element.firstChild; child; child = child.nextSibling) walk(child);
  };

  const translateDocumentTitle = (): void => {
    const current = doc.title;
    if (!current || !LATIN.test(current) || (title && title.written === current)) return;
    const next = translateTitle(current, dict);
    if (next === null || next === current) return;
    title = { original: current, written: next };
    doc.title = next;
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((added) => walk(added));
      } else if (mutation.type === 'characterData') {
        if (mutation.target.nodeType === 3) translateTextNode(mutation.target as Text);
      } else if (mutation.attributeName) {
        translateAttribute(mutation.target as Element, mutation.attributeName);
      }
    }
  });
  const headObserver = new MutationObserver(() => translateDocumentTitle());

  walk(doc.body);
  translateDocumentTitle();
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  headObserver.observe(doc.head, { childList: true, subtree: true, characterData: true });

  return {
    setDictionary(next: UiDictionary) {
      dict = compileDictionary(next);
      walk(doc.body);
      translateDocumentTitle();
    },
    stop() {
      observer.disconnect();
      headObserver.disconnect();
      texts.forEach((record, node) => {
        if (node.isConnected && node.nodeValue === record.written) node.nodeValue = record.original;
      });
      attributes.forEach((names, element) => {
        names.forEach((record, name) => {
          if (element.isConnected && element.getAttribute(name) === record.written) element.setAttribute(name, record.original);
        });
      });
      if (title && doc.title === title.written) doc.title = title.original;
      texts.clear();
      attributes.clear();
      title = null;
    },
  };
}
