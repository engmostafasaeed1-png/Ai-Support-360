// Parses the BRD's small allowlisted HTML (p, br, h3, h4, ul, ol, li, strong/b, em/i, u, mark, table rows/cells)
// into blocks for the PDF, the Word/Markdown exports and the diff. No DOM needed (also runs in node for the sample
// PDF); unknown tags are ignored and their text kept.

import { decodeEntities } from '../../../supabase/functions/_shared/brdModel';

export interface Inline { text: string; bold?: boolean; italic?: boolean; mark?: boolean }
export type HtmlBlock =
  | { kind: 'p'; runs: Inline[] }
  | { kind: 'h'; level: 3 | 4; runs: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; rows: Array<{ header: boolean; cells: Inline[][] }> };

const TOKEN = /<\s*(\/?)\s*([a-z0-9]+)([^>]*)>|([^<]+)/gi;

export function parseBrdHtml(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  const style = { bold: 0, italic: 0, mark: 0 };
  let current: Inline[] | null = null; // the runs being filled
  let para: HtmlBlock | null = null;
  let list: Extract<HtmlBlock, { kind: 'list' }> | null = null;
  let table: Extract<HtmlBlock, { kind: 'table' }> | null = null;
  let row: { header: boolean; cells: Inline[][] } | null = null;

  const push = (text: string) => {
    if (!text) return;
    if (!current) {
      para = { kind: 'p', runs: [] };
      blocks.push(para);
      current = para.runs;
    }
    const last = current[current.length - 1];
    const s = { bold: style.bold > 0, italic: style.italic > 0, mark: style.mark > 0 };
    if (last && !!last.bold === s.bold && !!last.italic === s.italic && !!last.mark === s.mark) last.text += text;
    else current.push({ text, ...(s.bold && { bold: true }), ...(s.italic && { italic: true }), ...(s.mark && { mark: true }) });
  };
  const closePara = () => { if (!list && !table) { current = null; para = null; } };

  for (const m of String(html ?? '').matchAll(TOKEN)) {
    const [, slash, rawTag, , text] = m;
    if (text !== undefined) {
      const t = decodeEntities(text).replace(/[\r\n\t]+/g, ' ');
      if (!current && !t.trim()) continue;
      if (table && !row) continue;
      if (list && !current) continue;
      push(t);
      continue;
    }
    const tag = rawTag.toLowerCase();
    const closing = slash === '/';
    switch (tag) {
      case 'strong': case 'b': style.bold += closing ? -1 : 1; style.bold = Math.max(0, style.bold); break;
      case 'em': case 'i': case 'u': style.italic += closing ? -1 : 1; style.italic = Math.max(0, style.italic); break;
      case 'mark': style.mark += closing ? -1 : 1; style.mark = Math.max(0, style.mark); break;
      case 'br': if (current) push('\n'); break;
      case 'p': case 'div':
        if (list || table) break;
        closePara();
        if (!closing) { para = { kind: 'p', runs: [] }; blocks.push(para); current = para.runs; }
        break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        if (list || table) break;
        closePara();
        if (!closing) { para = { kind: 'h', level: tag === 'h3' || tag === 'h1' || tag === 'h2' ? 3 : 4, runs: [] }; blocks.push(para); current = para.runs; }
        break;
      case 'ul': case 'ol':
        if (table) break;
        if (!closing) {
          if (!list) { current = null; list = { kind: 'list', ordered: tag === 'ol', items: [] }; blocks.push(list); }
        } else { list = null; current = null; }
        break;
      case 'li':
        if (!list) { closePara(); list = { kind: 'list', ordered: false, items: [] }; blocks.push(list); }
        if (!closing) { const item: Inline[] = []; list.items.push(item); current = item; } else current = null;
        break;
      case 'table':
        if (!closing) { current = null; list = null; table = { kind: 'table', rows: [] }; blocks.push(table); }
        else { table = null; row = null; current = null; }
        break;
      case 'tr':
        if (!table) break;
        if (!closing) { row = { header: false, cells: [] }; table.rows.push(row); } else row = null;
        current = null;
        break;
      case 'td': case 'th':
        if (!table || !row) break;
        if (!closing) { const cell: Inline[] = []; row.cells.push(cell); if (tag === 'th') row.header = true; current = cell; } else current = null;
        break;
      default:
        break;
    }
  }
  const trimRuns = (runs: Inline[]) => {
    while (runs.length && !runs[0].text.replace(/\n/g, '').trim() && !runs[0].mark) runs.shift();
    while (runs.length && !runs[runs.length - 1].text.replace(/\n/g, '').trim() && !runs[runs.length - 1].mark) runs.pop();
    if (runs[0]) runs[0].text = runs[0].text.replace(/^\s+/, '');
    if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
    return runs;
  };
  return blocks
    .map((b) => {
      if (b.kind === 'p' || b.kind === 'h') return { ...b, runs: trimRuns(b.runs) };
      if (b.kind === 'list') return { ...b, items: b.items.map(trimRuns).filter((i) => i.length) };
      return { ...b, rows: b.rows.map((r) => ({ ...r, cells: r.cells.map(trimRuns) })).filter((r) => r.cells.length) };
    })
    .filter((b) => (b.kind === 'p' || b.kind === 'h' ? b.runs.length > 0 : b.kind === 'list' ? b.items.length > 0 : b.rows.length > 0));
}

export const runsText = (runs: readonly Inline[]) => runs.map((r) => r.text).join('');
