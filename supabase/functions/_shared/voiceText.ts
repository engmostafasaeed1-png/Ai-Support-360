// Text tools for interview speech-to-text. Pure (no Deno or browser APIs): used by voice-transcribe, the browser,
// the offline benchmark (scripts/voice-benchmark) and tests, so accuracy is measured the same way everywhere.

const ARABIC_INDIC = /[\u0660-\u0669]/g;
const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;

/** Arabic clean-up for display and storage: digits written 0-9 (so T-codes, years and amounts match), no vowel marks
 * or stretching characters, single spaces. Latin text (SAP terms) is left untouched. */
export function normalizeArabic(text: string): string {
  return String(text ?? "")
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Comparison form of one word: lower case, no punctuation around it, Arabic letter variants unified. */
export function normToken(token: string): string {
  return normalizeArabic(token)
    .toLowerCase()
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627") // alef forms
    .replace(/\u0649/g, "\u064A") // alef maqsura -> ya
    .replace(/\u0629/g, "\u0647") // ta marbuta -> ha
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Words for comparison. Keeps "S/4HANA", "GR/IR", "F-02" whole; splits "الـentries" style joins. */
export function tokenize(text: string): string[] {
  return normalizeArabic(text)
    .replace(/([\u0600-\u06FF])([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])([\u0600-\u06FF])/g, "$1 $2")
    .replace(/([A-Za-z])-(?=[A-Za-z])/g, "$1 ")
    .split(/[\s,،.;؛:!?؟()"“”«»\[\]{}]+/)
    .map(normToken)
    .filter(Boolean);
}

export interface WordErrors { substitutions: number; deletions: number; insertions: number; reference: number }

export type AlignOp = { op: "eq" | "sub" | "del" | "ins"; ref?: string; hyp?: string; refIndex?: number; hypIndex?: number };

/** Word alignment (Levenshtein) between a reference and a hypothesis, both already tokenised. */
export function alignWords(ref: readonly string[], hyp: readonly string[]): AlignOp[] {
  const n = ref.length, m = hyp.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
  }
  const out: AlignOp[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      out.push({ op: ref[i - 1] === hyp[j - 1] ? "eq" : "sub", ref: ref[i - 1], hyp: hyp[j - 1], refIndex: i - 1, hypIndex: j - 1 });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out.push({ op: "del", ref: ref[i - 1], refIndex: i - 1 });
      i--;
    } else {
      out.push({ op: "ins", hyp: hyp[j - 1], hypIndex: j - 1 });
      j--;
    }
  }
  return out.reverse();
}

export function wordErrors(reference: string, hypothesis: string): WordErrors {
  const ref = tokenize(reference), hyp = tokenize(hypothesis);
  const e = { substitutions: 0, deletions: 0, insertions: 0, reference: ref.length };
  for (const a of alignWords(ref, hyp)) {
    if (a.op === "sub") e.substitutions++;
    else if (a.op === "del") e.deletions++;
    else if (a.op === "ins") e.insertions++;
  }
  return e;
}

/** Word error rate: (substitutions + deletions + insertions) / reference words. 0 = perfect. */
export function wer(reference: string, hypothesis: string): number {
  const e = wordErrors(reference, hypothesis);
  if (e.reference === 0) return tokenize(hypothesis).length ? 1 : 0;
  return Math.round(((e.substitutions + e.deletions + e.insertions) / e.reference) * 10000) / 10000;
}

/** Joins the next piece to the previous one, dropping words repeated because of the ~300 ms overlap. */
export function stitchOverlap(previous: string, next: string, maxWords = 5): string {
  const prevWords = String(previous ?? "").trim().split(/\s+/).filter(Boolean);
  const nextWords = String(next ?? "").trim().split(/\s+/).filter(Boolean);
  if (!prevWords.length) return nextWords.join(" ");
  for (let k = Math.min(maxWords, prevWords.length, nextWords.length); k >= 1; k--) {
    const tail = prevWords.slice(-k).map(normToken).join(" ");
    const head = nextWords.slice(0, k).map(normToken).join(" ");
    if (tail && tail === head) return nextWords.slice(k).join(" ");
  }
  return nextWords.join(" ");
}

/** Words that changed from one text to another (adjacent changes merged), e.g. what the consultant corrected. */
export function changedWords(from: string, to: string): Array<{ from: string; to: string }> {
  const a = String(from ?? "").trim().split(/\s+/).filter(Boolean);
  const b = String(to ?? "").trim().split(/\s+/).filter(Boolean);
  const ops = alignWords(a.map(normToken), b.map(normToken));
  const out: Array<{ from: string; to: string }> = [];
  let cur: { from: string[]; to: string[] } | null = null;
  const flush = () => { if (cur && (cur.from.length || cur.to.length)) out.push({ from: cur.from.join(" "), to: cur.to.join(" ") }); cur = null; };
  for (const op of ops) {
    if (op.op === "eq") { flush(); continue; }
    cur ??= { from: [], to: [] };
    if (op.refIndex != null) cur.from.push(a[op.refIndex]);
    if (op.hypIndex != null) cur.to.push(b[op.hypIndex]);
  }
  flush();
  return out.filter((c) => c.from !== c.to);
}

// ---------------------------------------------------------------------------------------------------------------
// Sound-alike keys (used to allow only corrections that sound like a glossary term)
// ---------------------------------------------------------------------------------------------------------------
const AR_TO_LATIN: Record<string, string> = {
  "\u0627": "a", "\u0623": "a", "\u0625": "i", "\u0622": "a", "\u0671": "a", "\u0628": "b", "\u062A": "t", "\u062B": "s", "\u062C": "g",
  "\u062D": "h", "\u062E": "k", "\u062F": "d", "\u0630": "z", "\u0631": "r", "\u0632": "z", "\u0633": "s", "\u0634": "sh", "\u0635": "s",
  "\u0636": "d", "\u0637": "t", "\u0638": "z", "\u0639": "a", "\u063A": "g", "\u0641": "f", "\u0642": "k", "\u0643": "k", "\u0644": "l",
  "\u0645": "m", "\u0646": "n", "\u0647": "h", "\u0629": "a", "\u0648": "o", "\u064A": "i", "\u0649": "a", "\u0621": "", "\u0624": "o",
  "\u0626": "i", "\u067E": "p", "\u06A4": "v", "\u06AF": "g",
};
const NUMBER_WORDS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "00",
};
const AR_PREFIXES = ["\u0648\u0627\u0644", "\u0628\u0627\u0644", "\u0641\u0627\u0644", "\u0643\u0627\u0644", "\u0644\u0644", "\u0627\u0644", "\u0644", "\u0628", "\u0648"];

/** Strips Arabic attached prefixes ("ال", "بال", "لـ"...) before an Arabic-script rendering of an English term. */
export function stripArabicPrefix(word: string): string[] {
  const w = normalizeArabic(word);
  const out = [w];
  for (const p of AR_PREFIXES) if (w.startsWith(p) && w.length - p.length >= 2) out.push(w.slice(p.length));
  return out;
}

/** Latin letters for a word in any script; number words become digits ("fb sixty" -> "fb60"). */
export function latinKey(text: string): string {
  const words = normalizeArabic(text).toLowerCase().split(/[\s/_-]+/).filter(Boolean);
  return words.map((w) => NUMBER_WORDS[w] ?? [...w].map((c) => AR_TO_LATIN[c] ?? c).join("")).join("").replace(/[^a-z0-9]/g, "");
}

/** Consonant skeleton ("baydi" and "badi" -> "bd"); digits kept. */
export function soundKey(text: string): string {
  const k = latinKey(text);
  if (!k) return "";
  const first = k[0];
  const rest = k.slice(1).replace(/[aeiouyw]/g, "");
  // Arabic has no p or v: "بادي" may be "padi", "فيو" may be "view".
  return (first + rest).replace(/^[aeiouyw](?=[^aeiouyw])/, "").replace(/p/g, "b").replace(/v/g, "f").replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** True when a heard word (any script, up to four words) sounds like a glossary term. */
export function soundsLike(heard: string, term: string): boolean {
  const target = latinKey(term);
  const targetSkeleton = soundKey(term);
  if (!target) return false;
  const words = heard.trim().split(/\s+/);
  const variants = stripArabicPrefix(words[0]).map((first) => [first, ...words.slice(1)].join(" "));
  for (const v of variants) {
    const k = latinKey(v);
    if (!k) continue;
    if (k === target) return true;
    const sk = soundKey(v);
    const fullRatio = levenshtein(k, target) / Math.max(k.length, target.length);
    const skelRatio = targetSkeleton && sk ? levenshtein(sk, targetSkeleton) / Math.max(sk.length, targetSkeleton.length) : 1;
    if (fullRatio <= 0.34 || (skelRatio <= 0.4 && Math.abs(k.length - target.length) <= 3)) return true;
  }
  return false;
}
