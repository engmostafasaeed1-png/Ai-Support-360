// Line layout for the BRD PDF: Arabic and English mixed in one line, right-to-left or left-to-right paragraphs.
// jsPDF shapes a single Arabic word correctly but its own reordering of whole mixed lines is unreliable (a line that
// starts with a number or a Latin word comes out in the wrong order, punctuation jumps), so the PDF draws word by
// word in the visual order computed here (a simplified Unicode bidi: strong letters, neutrals resolved by their
// neighbours, levels reversed from the highest). Pure and unit-tested.

import type { Inline } from './htmlBlocks';

export type Dir = 'L' | 'R' | 'N';
export type Base = 'ltr' | 'rtl';

const ARABIC = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const STRONG_L = /[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
const ARABIC_EDGE = /^([^\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*)([\s\S]*?)([^\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*)$/u;

export function hasArabic(s: string): boolean {
  return ARABIC.test(s);
}

export function wordDir(word: string): Dir {
  if (ARABIC.test(word)) return 'R';
  if (STRONG_L.test(word)) return 'L';
  return 'N';
}

export interface Token {
  text: string;
  dir: Dir;
  space: boolean;
  bold: boolean;
  mark: boolean;
  /** A forced line break (from <br>). */
  newline?: boolean;
}

const EDGE_PUNCT = /^([(\[{«"'“‘]*)([\s\S]*?)([.,:;!?)\]}»"'”’،؛؟…]*)$/u;

/**
 * Words, spaces and line breaks. Opening and closing punctuation around a word becomes its own neutral token, so it
 * lands on the correct side in right-to-left lines ("REQ-001:", "(MIRO)", "2023.").
 */
export function tokenize(runs: readonly Inline[]): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    const style = { bold: !!r.bold, mark: !!r.mark };
    const neutral = (c: string) => out.push({ text: c, dir: 'N', space: false, ...style });
    for (const part of r.text.match(/\n|[^\S\n]+|[^\s]+/g) ?? []) {
      if (part === '\n') { out.push({ text: '', dir: 'N', space: false, newline: true, ...style }); continue; }
      if (/^\s+$/.test(part)) { out.push({ text: ' ', dir: 'N', space: true, ...style }); continue; }
      const m = part.match(EDGE_PUNCT);
      const [lead, core, trail] = m ? [m[1], m[2], m[3]] : ['', part, ''];
      if (!core) { for (const c of part) neutral(c); continue; }
      for (const c of lead) neutral(c);
      if (ARABIC.test(core)) {
        const e = core.match(ARABIC_EDGE);
        const [l2, c2, t2] = e ? [e[1], e[2], e[3]] : ['', core, ''];
        if (l2) out.push({ text: l2, dir: wordDir(l2), space: false, ...style });
        if (c2) out.push({ text: c2, dir: 'R', space: false, ...style });
        if (t2) out.push({ text: t2, dir: wordDir(t2), space: false, ...style });
      } else {
        out.push({ text: core, dir: wordDir(core), space: false, ...style });
      }
      for (const c of trail) neutral(c);
    }
  }
  return out;
}

/** Neutral tokens take the direction of equal strong neighbours, otherwise the paragraph direction. */
export function resolveDirs(tokens: readonly Token[], base: Base): Array<'L' | 'R'> {
  const baseDir: 'L' | 'R' = base === 'rtl' ? 'R' : 'L';
  const dirs = tokens.map((t) => t.dir);
  const out: Array<'L' | 'R'> = new Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    if (dirs[i] !== 'N') { out[i] = dirs[i] as 'L' | 'R'; continue; }
    let j = i;
    while (j < tokens.length && dirs[j] === 'N') j++;
    let prev: 'L' | 'R' = baseDir;
    for (let k = i - 1; k >= 0; k--) if (dirs[k] !== 'N') { prev = dirs[k] as 'L' | 'R'; break; }
    const next: 'L' | 'R' = j < tokens.length ? (dirs[j] as 'L' | 'R') : baseDir;
    const d = prev === next ? prev : baseDir;
    for (let k = i; k < j; k++) out[k] = d;
    i = j - 1;
  }
  return out;
}

/** Indexes of the tokens in visual order, left to right. */
export function visualOrder(tokens: readonly Token[], base: Base): number[] {
  const dirs = resolveDirs(tokens, base);
  const baseLevel = base === 'rtl' ? 1 : 0;
  const levels = dirs.map((d) => (base === 'rtl' ? (d === 'R' ? 1 : 2) : (d === 'R' ? 1 : 0)));
  const order = tokens.map((_, i) => i);
  const max = Math.max(baseLevel, ...levels);
  for (let lvl = max; lvl >= 1; lvl--) {
    let i = 0;
    while (i < order.length) {
      if (levels[order[i]] >= lvl) {
        let j = i;
        while (j < order.length && levels[order[j]] >= lvl) j++;
        const seg = order.slice(i, j).reverse();
        order.splice(i, j - i, ...seg);
        i = j;
      } else i++;
    }
  }
  return order;
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };

/** Brackets drawn inside right-to-left text are mirrored. */
export function mirrored(text: string, rtlContext: boolean): string {
  return rtlContext ? [...text].map((c) => MIRROR[c] ?? c).join('') : text;
}

/** Greedy line breaking in logical order. `measure` returns the width of one token. */
export function breakLines(tokens: readonly Token[], width: number, measure: (t: Token) => number): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  let w = 0;
  const flush = () => {
    while (line.length && line[line.length - 1].space) line.pop();
    lines.push(line);
    line = [];
    w = 0;
  };
  for (const t of tokens) {
    if (t.newline) { flush(); continue; }
    if (t.space && line.length === 0) continue;
    const tw = measure(t);
    if (w + tw <= width || line.length === 0) {
      if (tw > width && !t.space && line.length === 0) {
        // A single word wider than the line (a long code): cut it by characters.
        let chunk = '';
        for (const c of t.text) {
          const next = { ...t, text: chunk + c };
          if (measure(next) > width && chunk) { line.push({ ...t, text: chunk }); flush(); chunk = c; } else chunk += c;
        }
        if (chunk) { line.push({ ...t, text: chunk }); w = measure({ ...t, text: chunk }); }
        continue;
      }
      line.push(t);
      w += tw;
    } else {
      flush();
      if (!t.space) { line.push(t); w = tw; }
    }
  }
  if (line.length) flush();
  return lines.length ? lines : [[]];
}
