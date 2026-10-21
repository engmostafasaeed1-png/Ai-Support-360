// Feature X: how a consultant's name is shown to people who may not see the full name yet.
// Pure and shared by the browser, the edge functions and the tests. The database mirrors these rules in
// public.format_consultant_name (docs/sql/consultant-name-privacy.sql), so every place agrees.

export type NameFormat = 'masked' | 'initial_family' | 'initials' | 'full';
export const NAME_FORMATS: readonly NameFormat[] = ['masked', 'initial_family', 'initials', 'full'];
export const DEFAULT_NAME_FORMAT: NameFormat = 'masked';

export const isNameFormat = (v: unknown): v is NameFormat => typeof v === 'string' && (NAME_FORMATS as readonly string[]).includes(v);

/** Titles removed before picking letters (compared without dots, lower case). */
export const NAME_TITLES = [
  'dr', 'eng', 'engr', 'prof', 'mr', 'mrs', 'ms', 'miss', 'sir', 'sheikh', 'sh',
  'م', 'د', 'أ', 'ا', 'مهندس', 'المهندس', 'دكتور', 'الدكتور', 'أستاذ', 'الأستاذ', 'استاذ', 'الاستاذ', 'الشيخ', 'شيخ',
];
/** Suffixes removed at the end ("Mostafa Saeed PhD"). */
export const NAME_SUFFIXES = ['phd', 'mba', 'pmp', 'msc', 'bsc', 'jr', 'sr'];

// Letters counted and picked: Latin (with accents), Arabic. Same ranges as the SQL.
const LETTER = /[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FC]/u;
const LETTERS = new RegExp(LETTER.source, 'gu');
// Arabic diacritics and tatweel; Latin accents are removed through NFD.
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu;
const EDGE_PUNCT = /^[\s.,;:'"`()[\]{}\-_/\\|·•،؛]+|[\s.,;:'"`()[\]{}\-_/\\|·•،؛]+$/gu;

const plain = (w: string) => w.replace(/\./g, '').toLowerCase();

/** Words of a name without titles, suffixes, diacritics, accents and edge punctuation. */
export function nameWords(name: string | null | undefined): string[] {
  const cleaned = String(name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .replace(ARABIC_MARKS, '');
  let words = cleaned.split(/[\s\u200B-\u200F]+/u).map((w) => w.replace(EDGE_PUNCT, '')).filter((w) => LETTER.test(w));
  while (words.length > 1 && NAME_TITLES.includes(plain(words[0]))) words = words.slice(1);
  while (words.length > 1 && NAME_SUFFIXES.includes(plain(words[words.length - 1]))) words = words.slice(0, -1);
  return words;
}

const firstLetter = (w: string) => (w.match(LETTER)?.[0] ?? '').toLocaleUpperCase('en');
const letterCount = (w: string) => (w.match(LETTERS) ?? []).length;
/** Stars for the hidden letters: as many as remain, at least 3 and at most 5. */
export const starsFor = (w: string) => '*'.repeat(Math.min(5, Math.max(3, letterCount(w) - 1)));

/** The name in one format. Three or more words use the first and the LAST word. Empty when there is no name. */
export function formatConsultantName(name: string | null | undefined, format: NameFormat = DEFAULT_NAME_FORMAT): string {
  const full = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (format === 'full') return full;
  const words = nameWords(full);
  if (words.length === 0) return '';
  const first = words[0];
  const F = firstLetter(first);
  if (words.length === 1) {
    if (format === 'initials') return `${F}.`;
    if (format === 'initial_family') return first;
    return `${F}${starsFor(first)}`;
  }
  const last = words[words.length - 1];
  const L = firstLetter(last);
  if (format === 'initials') return `${F}.${L}.`;
  if (format === 'initial_family') return `${F}. ${last}`;
  return `${F}. ${L}${starsFor(last)}`;
}

export interface NameViewer {
  /** Masking switch of the platform (setting consultant_name_masking_enabled, default on). */
  maskingOn?: boolean;
  /** Owner, administrator, or client of a ticket where the consultant is ready/active with an NDA signed by both. */
  unlocked?: boolean;
}

/** What a viewer sees. Unlocked viewers and a switched-off platform see the full name. */
export function publicConsultantName(name: string | null | undefined, format: unknown, viewer: NameViewer = {}): string {
  if (viewer.unlocked || viewer.maskingOn === false) return formatConsultantName(name, 'full');
  return formatConsultantName(name, isNameFormat(format) ? format : DEFAULT_NAME_FORMAT);
}

/** Masking switch from platform_settings (value true/false); anything unreadable counts as on. */
export function maskingFromSetting(value: unknown): boolean {
  return !(value === false || value === 'false');
}
