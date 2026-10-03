// SAP Note numbers that a client says were already tried. Only the numbers are kept: a note opens in SAP for Me,
// where every person signs in with their own account. Nothing of SAP's is copied and no SAP login is ever asked for.

export const MAX_NOTES_TRIED = 8;

const NUMBER = /^\d{5,8}$/;
const FILLER = /^(sap|note|notes|kba|kbas|oss|no|nr|number|numbers|and|or)$/i;

/** What comes back from the server or the database: valid, distinct numbers only, at most MAX_NOTES_TRIED. */
export function cleanNoteList(value: unknown): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(value) ? value : []) {
    if (typeof v === 'string' && NUMBER.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_NOTES_TRIED) break;
  }
  return out;
}

export interface AddResult {
  /** The list after adding. */
  notes: string[];
  /** The numbers that were new. */
  added: string[];
  /** Pieces of the text that are not note numbers (a number of the wrong length, a word). */
  ignored: string[];
  /** True when a valid number did not fit because the list is full. */
  full: boolean;
}

/** Adds the note numbers found in a typed or pasted text ("SAP Note 2270407, 3012345 and KBA 3100000") to a list. */
export function addNoteNumbers(current: readonly string[], input: string): AddResult {
  const notes = cleanNoteList(current);
  const added: string[] = [];
  const ignored: string[] = [];
  let full = false;
  for (const raw of input.split(/[\s,;/&]+/)) {
    const token = raw.replace(/^[#(]+/, '').replace(/[.:);]+$/, '');
    if (!token || FILLER.test(token)) continue;
    if (NUMBER.test(token)) {
      if (notes.includes(token)) continue;
      if (notes.length >= MAX_NOTES_TRIED) {
        full = true;
        continue;
      }
      notes.push(token);
      added.push(token);
    } else if (!ignored.includes(token)) {
      ignored.push(token);
    }
  }
  return { notes, added, ignored, full };
}

// "SAP Note 2270407", "Notes 2270407 and 3012345", "KBA #3012345": the same wording that the edge functions look for
const NOTE_KEYWORD = String.raw`(?:SAP\s+)?(?:Notes?|KBAs?|OSS(?:\s+Notes?)?)`;
const NOTE_RUN = String.raw`\d{5,8}(?:\s*(?:,|;|/|&|\band\b|\bor\b)\s*\d{5,8})*`;
const NOTE_REFERENCE = new RegExp(String.raw`(\b${NOTE_KEYWORD}\s*(?:no\.?|numbers?|nr\.?|#|:)?\s*)(${NOTE_RUN})(?!\d)`, 'gi');

/**
 * Turns the numbers of the SAP Note references in a text into markdown links to SAP for Me, where each reader signs in with their own SAP login.
 * A reference that is already the text of a link is left alone.
 */
export function linkSapNotes(markdown: string): string {
  return markdown.replace(NOTE_REFERENCE, (whole: string, lead: string, run: string, offset: number, text: string) => {
    if (text.startsWith(']', offset + whole.length)) return whole;
    return lead + run.replace(/\d{5,8}/g, (n) => `[${n}](https://me.sap.com/notes/${n})`);
  });
}
