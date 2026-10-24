// The BRD PDF: built in the browser with jsPDF (already used for invoices, timesheets and the NDA) and the embedded
// IBM Plex Sans Arabic font (Latin + Arabic glyphs, regular + bold), so the file attached to the ticket is real
// vector text in both languages. Cover with the document control block, table of contents with page numbers,
// running header (ticket reference + version), footer "Confidential - shared under the NDA of this ticket" and
// "Page x of y", tables whose rows move to the next page (header row repeated) instead of breaking badly.
// Mixed Arabic/English lines are laid out word by word in visual order (./bidi). buildBrdPdf is pure (no fetch), so
// the same code renders the sample in docs/ from node.

import type { jsPDF } from 'jspdf';
import {
  SECTION_TITLES, TBC_LABEL, changeLogRows, countTbc, visibleSections,
  type BrdContent, type BrdRequirement, type SectionKey, type VersionMeta,
} from '../../../supabase/functions/_shared/brdModel';
import { parseBrdHtml, type HtmlBlock, type Inline } from './htmlBlocks';
import { breakLines, mirrored, resolveDirs, tokenize, visualOrder, type Base, type Token } from './bidi';

export interface BrdPdfMeta {
  ticketRef: string;
  ticketTitle: string;
  /** The saved version this file shows; null = the current working draft. */
  version: number | null;
  versions: VersionMeta[];
  generatedAt?: Date;
}

export interface BrdPdfFonts { regular: string; bold: string }

// deno-lint-ignore no-explicit-any
export type JsPdfCtor = new (opts?: any) => jsPDF;
type RGB = [number, number, number];

export const W = 595.28;
export const H = 841.89;
export const ML = 56;
export const MR = 56;
export const MT = 74;
export const MB = 68;
export const CW = W - ML - MR;
export const FONT = 'BrdPlex';

export const C: Record<string, RGB> = {
  brand: [27, 37, 89], accent: [59, 130, 246], text: [30, 41, 59], muted: [100, 116, 139], border: [203, 213, 225],
  headBg: [238, 242, 255], zebra: [248, 250, 252], markBg: [254, 243, 199], markText: [146, 64, 14], white: [255, 255, 255], soft: [241, 245, 249],
};

const L = {
  en: {
    doc: 'Business Requirements Document', control: 'Document control', title: 'Title', ticket: 'Ticket', company: 'Client company',
    requester: 'Requester', date: 'Date', version: 'Version', status: 'Status', approvers: 'Approvers', draft: 'Draft', final: 'Final',
    toc: 'Contents', confidential: 'Confidential - shared under the NDA of this ticket', page: (a: number, b: number) => `Page ${a} of ${b}`,
    workingDraft: 'Working draft (not a saved version)', empty: 'No content yet.', noReq: 'No requirements yet.',
    req: ['ID', 'Requirement', 'Priority', 'Status', 'Owner', 'Acceptance criteria'],
    log: ['Version', 'Date', 'Status', 'By', 'Note'], noLog: 'No saved versions yet.',
    pri: { must: 'Must', should: 'Should', could: 'Could' },
    st: { proposed: 'Proposed', agreed: 'Agreed', in_progress: 'In progress', done: 'Done', rejected: 'Rejected' },
    generated: (d: string) => `Generated on ${d} on AI Support 360.`, tbc: (n: number) => `${n} item(s) are marked "${TBC_LABEL.en}" and still need an answer.`,
    archived: 'archived', notSet: '—',
  },
  ar: {
    doc: 'وثيقة متطلبات الأعمال', control: 'بيانات الوثيقة', title: 'العنوان', ticket: 'التذكرة', company: 'شركة العميل',
    requester: 'مقدم الطلب', date: 'التاريخ', version: 'الإصدار', status: 'الحالة', approvers: 'المعتمدون', draft: 'مسودة', final: 'نهائية',
    toc: 'المحتويات', confidential: 'سري - تتم مشاركته بموجب اتفاقية عدم الإفصاح الخاصة بهذه التذكرة', page: (a: number, b: number) => `صفحة ${a} من ${b}`,
    workingDraft: 'مسودة عمل (ليست إصداراً محفوظاً)', empty: 'لا يوجد محتوى بعد.', noReq: 'لا توجد متطلبات بعد.',
    req: ['المعرّف', 'المتطلب', 'الأولوية', 'الحالة', 'المسؤول', 'معايير القبول'],
    log: ['الإصدار', 'التاريخ', 'الحالة', 'بواسطة', 'ملاحظة'], noLog: 'لا توجد إصدارات محفوظة بعد.',
    pri: { must: 'يجب', should: 'ينبغي', could: 'يمكن' },
    st: { proposed: 'مقترح', agreed: 'متفق عليه', in_progress: 'قيد التنفيذ', done: 'منجز', rejected: 'مرفوض' },
    generated: (d: string) => `أُنشئت في ${d} على منصة AI Support 360.`, tbc: (n: number) => `${n} بند/بنود معلّمة بـ "${TBC_LABEL.ar}" وما زالت تحتاج إلى إجابة.`,
    archived: 'مؤرشف', notSet: '—',
  },
};

type Lang = 'en' | 'ar';
export const plain = (text: string, extra: Partial<Inline> = {}): Inline[] => [{ text, ...extra }];

/** Shared with other bilingual PDFs (ticket tracking timeline). */
export class Writer {
  y = MT;
  constructor(readonly doc: jsPDF) {}

  font(bold: boolean, size: number) {
    this.doc.setFont(FONT, bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
  }
  width(t: Token, size: number): number {
    this.font(t.bold, size);
    return this.doc.getTextWidth(t.text);
  }
  newPage() { this.doc.addPage(); this.y = MT; }
  room() { return H - MB - this.y; }
  ensure(h: number) { if (this.y + h > H - MB) this.newPage(); }

  /** One laid-out line: visual order, start/end/center alignment, highlighted "To be confirmed" tokens. */
  line(tokens: Token[], x: number, width: number, baseline: number, base: Base, size: number, color: RGB, align: 'start' | 'end' | 'center' = 'start') {
    if (!tokens.length) return;
    const dirs = resolveDirs(tokens, base);
    const order = visualOrder(tokens, base);
    const widths = tokens.map((t) => this.width(t, size));
    const total = widths.reduce((a, b) => a + b, 0);
    const rightAligned = (base === 'rtl') === (align === 'start');
    let cx = align === 'center' ? x + (width - total) / 2 : rightAligned ? x + width - total : x;
    for (const i of order) {
      const t = tokens[i];
      const w = widths[i];
      if (t.mark) {
        this.doc.setFillColor(...C.markBg);
        this.doc.rect(cx - 0.3, baseline - size * 0.86, w + 0.6, size * 1.18, 'F');
      }
      if (!t.space && t.text) {
        this.font(t.bold, size);
        this.doc.setTextColor(...(t.mark ? C.markText : color));
        const text = t.dir === 'N' && dirs[i] === 'R' ? mirrored(t.text, true) : t.text;
        this.doc.text(text, cx, baseline);
      }
      cx += w;
    }
  }

  paragraph(runs: Inline[], o: { base: Base; size?: number; bold?: boolean; color?: RGB; indent?: number; bullet?: string; gapBefore?: number; gapAfter?: number; x?: number; width?: number; align?: 'start' | 'end' | 'center'; keep?: number } ) {
    const size = o.size ?? 10.5;
    const lineH = size * 1.5;
    const x = o.x ?? ML;
    const width = o.width ?? CW;
    const indent = o.indent ?? 0;
    const tokens = tokenize(runs).map((t) => (o.bold ? { ...t, bold: true } : t));
    const avail = width - indent;
    const lines = breakLines(tokens, avail, (t) => this.width(t, size));
    this.y += o.gapBefore ?? 0;
    this.ensure(lineH * Math.min(lines.length, o.keep ?? 1));
    lines.forEach((ln, i) => {
      this.ensure(lineH);
      const baseline = this.y + size;
      const tx = o.base === 'rtl' ? x : x + indent;
      if (i === 0 && o.bullet) {
        const b: Token = { text: o.bullet, dir: 'L', space: false, bold: false, mark: false };
        const bw = this.width(b, size);
        const bx = o.base === 'rtl' ? x + width - indent + Math.max(2, indent - bw - 4) : x + Math.max(0, indent - bw - 4);
        this.line([b], bx, bw, baseline, 'ltr', size, o.color ?? C.text);
      }
      this.line(ln, tx, avail, baseline, o.base, size, o.color ?? C.text, o.align ?? 'start');
      this.y += lineH;
    });
    this.y += o.gapAfter ?? 5;
  }

  heading(text: string, base: Base, level: 2 | 3 | 4) {
    const size = level === 2 ? 14.5 : level === 3 ? 12 : 11;
    this.ensure(size * 1.5 * 3.2);
    this.y += level === 2 ? 6 : 4;
    if (level === 2) {
      this.doc.setFillColor(...C.accent);
      const barX = base === 'rtl' ? ML + CW - 3 : ML;
      this.doc.rect(barX, this.y + 2, 3, size * 1.2, 'F');
    }
    this.paragraph(plain(text), { base, size, bold: true, color: C.brand, indent: level === 2 ? 10 : 0, gapAfter: level === 2 ? 6 : 3 });
  }

  /** A table; rows that do not fit move to the next page with the header row repeated, tall rows continue there. */
  table(colFractions: number[], header: Inline[][] | null, rows: Inline[][][], base: Base, size = 9) {
    const pad = 4;
    const lineH = size * 1.45;
    const widths = colFractions.map((f) => f * CW);
    const xs: number[] = [];
    let acc = 0;
    for (const w of widths) { xs.push(base === 'rtl' ? ML + CW - acc - w : ML + acc); acc += w; }
    const layout = (cells: Inline[][], bold: boolean) => cells.map((runs, ci) =>
      breakLines(tokenize(runs).map((t) => (bold ? { ...t, bold: true } : t)), (widths[ci] ?? 40) - pad * 2, (t) => this.width(t, size)));
    const drawRow = (cellLines: Token[][][], kind: 'head' | 'body', zebra: boolean) => {
      const remaining = cellLines.map((l) => l.slice());
      let first = true;
      while (first || remaining.some((r) => r.length)) {
        const need = Math.max(1, ...remaining.map((r) => r.length));
        const fit = Math.floor((H - MB - this.y - pad * 2) / lineH);
        if (fit < Math.min(need, 2)) {
          this.newPage();
          if (kind === 'body' && header) drawRow(layout(header, true), 'head', false);
          continue;
        }
        const take = Math.min(need, fit);
        const rowH = take * lineH + pad * 2;
        for (let ci = 0; ci < widths.length; ci++) {
          if (kind === 'head') { this.doc.setFillColor(...C.headBg); this.doc.rect(xs[ci], this.y, widths[ci], rowH, 'F'); }
          else if (zebra) { this.doc.setFillColor(...C.zebra); this.doc.rect(xs[ci], this.y, widths[ci], rowH, 'F'); }
          this.doc.setDrawColor(...C.border);
          this.doc.setLineWidth(0.5);
          this.doc.rect(xs[ci], this.y, widths[ci], rowH, 'S');
          const chunk = (remaining[ci] ?? []).splice(0, take);
          chunk.forEach((ln, k) => this.line(ln, xs[ci] + pad, widths[ci] - pad * 2, this.y + pad + size + k * lineH, base, size, kind === 'head' ? C.brand : C.text));
        }
        this.y += rowH;
        first = false;
      }
    };
    this.ensure(lineH * 3 + pad * 4);
    if (header) drawRow(layout(header, true), 'head', false);
    rows.forEach((r, i) => drawRow(layout(r, false), 'body', i % 2 === 1));
    this.y += 8;
  }

  blocks(list: HtmlBlock[], base: Base) {
    for (const b of list) {
      if (b.kind === 'p') this.paragraph(b.runs, { base });
      else if (b.kind === 'h') this.paragraph(b.runs, { base, bold: true, size: b.level === 3 ? 11.5 : 10.8, color: C.brand, gapBefore: 3, gapAfter: 3, keep: 1 });
      else if (b.kind === 'list') b.items.forEach((item, i) => this.paragraph(item, { base, indent: 18, bullet: b.ordered ? `${i + 1}.` : '•', gapAfter: 2 }));
      else if (b.kind === 'table') {
        const cols = Math.max(1, ...b.rows.map((r) => r.cells.length));
        const head = b.rows[0]?.header ? b.rows[0] : null;
        const body = (head ? b.rows.slice(1) : b.rows).map((r) => Array.from({ length: cols }, (_, i) => r.cells[i] ?? []));
        this.table(Array(cols).fill(1 / cols), head ? Array.from({ length: cols }, (_, i) => head.cells[i] ?? []) : null, body, base);
      }
    }
    this.y += 3;
  }
}

function labels(content: BrdContent) {
  const lang: Lang = content.language === 'ar' ? 'ar' : 'en';
  const both = content.language === 'both';
  const pick = <K extends keyof typeof L.en>(k: K) => (both && typeof L.en[k] === 'string' ? `${L.en[k]} / ${L.ar[k]}` : L[lang][k]);
  return { lang, both, pick, t: L[lang] };
}

function requirementRows(reqs: BrdRequirement[], lang: Lang, both: boolean): Inline[][][] {
  const t = L[lang];
  return reqs.map((r) => [
    plain(r.id, { bold: true }),
    both && r.description_ar ? [{ text: r.description }, { text: '\n' }, { text: r.description_ar }] : plain(r.description || '—'),
    plain(both ? `${L.en.pri[r.priority]} / ${L.ar.pri[r.priority]}` : t.pri[r.priority]),
    plain(both ? `${L.en.st[r.status]} / ${L.ar.st[r.status]}` : t.st[r.status]),
    plain(r.owner || '—'),
    both && r.acceptance_ar ? [{ text: r.acceptance || '—' }, { text: '\n' }, { text: r.acceptance_ar }] : plain(r.acceptance || '—'),
  ]);
}

const sectionTitleFor = (key: SectionKey, lang: Lang, both: boolean) => (both ? `${SECTION_TITLES[key].en} / ${SECTION_TITLES[key].ar}` : SECTION_TITLES[key][lang]);

export function buildBrdPdf(JsPDF: JsPdfCtor, content: BrdContent, meta: BrdPdfMeta, fonts: BrdPdfFonts): jsPDF {
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.addFileToVFS(`${FONT}-Regular.ttf`, fonts.regular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  const { lang, both, pick, t } = labels(content);
  const base: Base = lang === 'ar' ? 'rtl' : 'ltr';
  const w = new Writer(doc);
  const generated = (meta.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const versionLabel = meta.version ? `v${meta.version}` : pick('workingDraft');
  const statusLabel = content.control.status === 'final' ? pick('final') : pick('draft');
  doc.setProperties({ title: `${content.control.title || meta.ticketTitle} — ${versionLabel}`, subject: L.en.doc, creator: 'AI Support 360', author: content.control.requester || 'AI Support 360' });

  // ---- cover
  doc.setFillColor(...C.brand);
  doc.rect(0, 0, W, 190, 'F');
  doc.setFillColor(...C.accent);
  doc.rect(0, 190, W, 4, 'F');
  w.y = 62;
  w.paragraph(plain(pick('doc')), { base, size: 21, bold: true, color: C.white, gapAfter: 6 });
  w.paragraph(plain(content.control.title || meta.ticketTitle), { base, size: 13, color: C.white, gapAfter: 4 });
  w.paragraph(plain(`#${meta.ticketRef} · ${versionLabel} · ${statusLabel}`), { base, size: 10, color: [203, 213, 225], gapAfter: 0 });
  w.y = 222;
  w.heading(pick('control'), base, 3);
  const ctl: Array<[string, string]> = [
    [pick('title'), content.control.title || meta.ticketTitle],
    [pick('ticket'), `#${meta.ticketRef} — ${meta.ticketTitle}`],
    [pick('company'), content.control.company || t.notSet],
    [pick('requester'), content.control.requester || t.notSet],
    [pick('date'), content.control.date],
    [pick('version'), versionLabel],
    [pick('status'), statusLabel],
    [pick('approvers'), content.control.approvers || t.notSet],
  ];
  w.table([0.3, 0.7], null, ctl.map(([k, v]) => [plain(k, { bold: true }), plain(v)]), base, 10);
  const tbc = content.sections.filter((s) => !s.hidden).reduce((n, s) => n + countTbc(s.html) + countTbc(s.html_ar ?? ''), 0);
  if (tbc > 0) w.paragraph([{ text: both ? `${L.en.tbc(tbc)} / ${L.ar.tbc(tbc)}` : t.tbc(tbc), mark: true }], { base, size: 9.5, gapBefore: 4 });
  w.y = Math.max(w.y + 10, H - MB - 70);
  doc.setFillColor(...C.soft);
  doc.roundedRect(ML, w.y, CW, 52, 6, 6, 'F');
  w.y += 10;
  w.paragraph(plain(pick('confidential')), { base, size: 9.5, bold: true, color: C.brand, x: ML + 10, width: CW - 20, gapAfter: 1 });
  w.paragraph(plain(both ? `${L.en.generated(generated)} / ${L.ar.generated(generated)}` : t.generated(generated)), { base, size: 8.5, color: C.muted, x: ML + 10, width: CW - 20, gapAfter: 0 });

  // ---- contents page (filled in at the end, once the page numbers are known)
  w.newPage();
  const tocPage = doc.getNumberOfPages();

  // ---- sections
  w.newPage();
  const sections = visibleSections(content);
  const starts: Array<{ number: number; key: SectionKey; page: number }> = [];
  for (const s of sections) {
    if (w.room() < 120) w.newPage();
    starts.push({ number: s.number, key: s.key, page: doc.getNumberOfPages() });
    w.heading(`${s.number}. ${sectionTitleFor(s.key, lang, both)}`, base, 2);
    if (s.key === 'change_log') {
      const rows = changeLogRows(meta.versions, lang);
      if (!rows.length) w.paragraph(plain(pick('noLog')), { base, color: C.muted });
      else w.table([0.1, 0.15, 0.12, 0.2, 0.43], t.log.map((x, i) => plain(both ? `${L.en.log[i]} / ${L.ar.log[i]}` : x)),
        rows.map((r) => [plain(r.version, { bold: true }), plain(r.date), plain(`${r.status === 'final' ? pick('final') : pick('draft')}${r.archived ? ` (${t.archived})` : ''}`), plain(r.author || '—'), plain(r.note || '—')]), base);
      continue;
    }
    const main = parseBrdHtml(s.html);
    const ar = both ? parseBrdHtml(s.html_ar ?? '') : [];
    if (!main.length && !ar.length && !(s.key === 'functional' && content.requirements.length)) {
      w.paragraph(plain(pick('empty')), { base, color: C.muted });
    }
    if (main.length) w.blocks(main, base);
    if (ar.length) {
      doc.setDrawColor(...C.border);
      doc.setLineWidth(0.5);
      w.ensure(30);
      doc.line(ML, w.y, ML + CW, w.y);
      w.y += 6;
      w.blocks(ar, 'rtl');
    }
    if (s.key === 'functional') {
      if (!content.requirements.length) w.paragraph(plain(pick('noReq')), { base, color: C.muted });
      else w.table([0.1, 0.27, 0.1, 0.11, 0.12, 0.3], t.req.map((x, i) => plain(both ? `${L.en.req[i]} / ${L.ar.req[i]}` : x)), requirementRows(content.requirements, lang, both), base, 8.6);
    }
  }

  // ---- contents
  doc.setPage(tocPage);
  w.y = MT;
  w.heading(pick('toc'), base, 2);
  for (const e of starts) {
    const size = 10.5;
    const title = tokenize(plain(`${e.number}. ${sectionTitleFor(e.key, lang, both)}`));
    const page = tokenize(plain(String(e.page)));
    const lines = breakLines(title, CW - 50, (tk) => w.width(tk, size));
    lines.forEach((ln, i) => {
      const baseline = w.y + size;
      w.line(ln, ML, CW - 50, baseline, base, size, C.text);
      if (i === lines.length - 1) w.line(page, ML, CW, baseline, base, size, C.muted, 'end');
      w.y += size * 1.6;
    });
    doc.setDrawColor(...C.soft);
    doc.line(ML, w.y - 3, ML + CW, w.y - 3);
  }

  // ---- running header and footer
  const total = doc.getNumberOfPages();
  const footerText = both ? `${L.en.confidential} · ${L.ar.confidential}` : t.confidential;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.5);
    if (p > 1) {
      const head = tokenize(plain(`BRD · #${meta.ticketRef} · ${versionLabel} · ${statusLabel}`));
      w.line(head, ML, CW, MT - 30, base, 8, C.muted, 'start');
      const ttl = (content.control.title || meta.ticketTitle).slice(0, 70);
      w.line(tokenize(plain(ttl)), ML, CW, MT - 30, base, 8, C.muted, 'end');
      doc.line(ML, MT - 22, ML + CW, MT - 22);
    }
    doc.line(ML, H - MB + 22, ML + CW, H - MB + 22);
    const ft = breakLines(tokenize(plain(footerText)), CW - 80, (tk) => w.width(tk, 7.5));
    ft.slice(0, 2).forEach((ln, i) => w.line(ln, ML, CW - 80, H - MB + 36 + i * 10, base, 7.5, C.muted, 'start'));
    w.line(tokenize(plain(L[lang].page(p, total))), ML, CW, H - MB + 36, base, 7.5, C.muted, 'end');
  }
  return doc;
}

// ---------------------------------------------------------------- browser helpers

let fontsPromise: Promise<BrdPdfFonts> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The two font files are fetched once, only when a PDF is made (about 480 KB). */
export function loadBrdFonts(): Promise<BrdPdfFonts> {
  if (!fontsPromise) {
    const get = (f: string) => fetch(`/fonts/brd/${f}`).then((r) => {
      if (!r.ok) throw new Error('font');
      return r.arrayBuffer();
    }).then(toBase64);
    fontsPromise = Promise.all([get('IBMPlexSansArabic-Regular.ttf'), get('IBMPlexSansArabic-Bold.ttf')])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch((e) => { fontsPromise = null; throw e; });
  }
  return fontsPromise;
}

export async function brdPdfBlob(content: BrdContent, meta: BrdPdfMeta): Promise<Blob> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadBrdFonts()]);
  const doc = buildBrdPdf(jsPDF as unknown as JsPdfCtor, content, meta, fonts);
  return doc.output('blob');
}
