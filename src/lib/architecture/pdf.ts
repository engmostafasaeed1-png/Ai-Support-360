// Architecture document PDF: the BRD PDF engine (Writer, embedded IBM Plex Sans Arabic, word-by-word bidi, tables
// that continue on the next page) with a cover, details block, requirement links per section, diagrams as pictures
// and the version history. buildArchPdf is pure; archPdfBlob prepares the pictures in the browser.
import type { jsPDF } from 'jspdf';
import { C, CW, FONT, H, MB, ML, W, Writer, plain, loadBrdFonts, type BrdPdfFonts, type JsPdfCtor } from '@/lib/brd/pdf';
import { parseBrdHtml } from '@/lib/brd/htmlBlocks';
import { SECTION_TITLES, TYPE_TITLES, type ArchContent, type ArchMeta } from '../../../supabase/functions/_shared/archModel';
import { layoutGraph, layoutToSvg, parseMermaid } from './mermaid';
import { assetUrl, type ArchAsset, type ArchVersionRow } from './api';

export interface PdfPicture { dataUrl: string; format: 'PNG' | 'JPEG'; w: number; h: number }
export interface ArchPdfMeta {
  ref: string; meta: ArchMeta; version: number | null; versions: ArchVersionRow[]; generatedAt?: Date;
  pictures: Record<string, PdfPicture | undefined>;
  systems: Array<{ name: string; sid: string; role: string; product: string; release: string }>;
}

const L = {
  en: {
    doc: 'Solution architecture', details: 'Document details', type: 'Type', status: 'Status', owner: 'Owner', area: 'SAP area',
    module: 'Module', release: 'Version / release', conf: 'Confidentiality', version: 'Version', workingDraft: 'Working draft (not a saved version)',
    private: 'Private to the company', shared: 'Shared with assigned consultants of the linked tickets', reqs: 'Requirements', empty: 'No content yet.',
    systems: 'SAP systems referred to', sysCols: ['System', 'SID', 'Role', 'Product', 'Release'], history: 'Version history',
    histCols: ['Version', 'Date', 'Status', 'By', 'Note'], confidential: 'Confidential', page: (a: number, b: number) => `Page ${a} of ${b}`,
    missingPicture: '[picture not available]',
    st: { draft: 'Draft', in_review: 'In review', approved: 'Approved', superseded: 'Superseded', archived: 'Archived' } as Record<string, string>,
  },
  ar: {
    doc: 'بنية الحل', details: 'بيانات الوثيقة', type: 'النوع', status: 'الحالة', owner: 'المسؤول', area: 'مجال SAP',
    module: 'الوحدة', release: 'الإصدار', conf: 'السرية', version: 'الإصدار', workingDraft: 'مسودة عمل (ليست إصداراً محفوظاً)',
    private: 'خاصة بالشركة', shared: 'مشاركة مع المستشارين المعيّنين على التذاكر المرتبطة', reqs: 'المتطلبات', empty: 'لا يوجد محتوى بعد.',
    systems: 'أنظمة SAP المشار إليها', sysCols: ['النظام', 'SID', 'الدور', 'المنتج', 'الإصدار'], history: 'سجل الإصدارات',
    histCols: ['الإصدار', 'التاريخ', 'الحالة', 'بواسطة', 'ملاحظة'], confidential: 'سري', page: (a: number, b: number) => `صفحة ${a} من ${b}`,
    missingPicture: '[الصورة غير متاحة]',
    st: { draft: 'مسودة', in_review: 'قيد المراجعة', approved: 'معتمدة', superseded: 'مستبدلة', archived: 'مؤرشفة' } as Record<string, string>,
  },
};

export function buildArchPdf(JsPDF: JsPdfCtor, content: ArchContent, m: ArchPdfMeta, fonts: BrdPdfFonts): jsPDF {
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.addFileToVFS(`${FONT}-Regular.ttf`, fonts.regular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  const lang = content.language === 'ar' ? 'ar' : 'en';
  const t = L[lang];
  const base = lang === 'ar' ? 'rtl' : 'ltr';
  const w = new Writer(doc);
  const versionLabel = m.version ? `v${m.version}` : t.workingDraft;
  doc.setProperties({ title: `${m.meta.title} — ${versionLabel}`, subject: TYPE_TITLES[m.meta.type].en, creator: 'AI Support 360' });

  doc.setFillColor(...C.brand);
  doc.rect(0, 0, W, 180, 'F');
  doc.setFillColor(...C.accent);
  doc.rect(0, 180, W, 4, 'F');
  w.y = 58;
  w.paragraph(plain(TYPE_TITLES[m.meta.type][lang]), { base, size: 20, bold: true, color: C.white, gapAfter: 6 });
  w.paragraph(plain(m.meta.title), { base, size: 13, color: C.white, gapAfter: 4 });
  w.paragraph(plain(`${m.ref} · ${versionLabel} · ${t.st[m.meta.status] ?? m.meta.status}`), { base, size: 10, color: [203, 213, 225], gapAfter: 0 });
  w.y = 212;
  w.heading(t.details, base, 3);
  const rows: Array<[string, string]> = [
    [t.type, TYPE_TITLES[m.meta.type][lang]], [t.status, t.st[m.meta.status] ?? m.meta.status], [t.owner, m.meta.owner_name || '—'],
    [t.area, m.meta.sap_area || '—'], [t.module, m.meta.sap_module || '—'], [t.release, m.meta.sap_version || '—'],
    [t.conf, m.meta.confidentiality === 'shared' ? t.shared : t.private], [t.version, versionLabel],
  ];
  w.table([0.3, 0.7], null, rows.map(([a, b]) => [plain(a, { bold: true }), plain(b)]), base, 9.5);
  if (m.systems.length) {
    w.heading(t.systems, base, 4);
    w.table([0.26, 0.1, 0.12, 0.28, 0.24], t.sysCols.map((x) => plain(x)), m.systems.map((s) => [plain(s.name), plain(s.sid || '—'), plain(s.role), plain(s.product || '—'), plain(s.release || '—')]), base, 8.5);
  }

  let n = 0;
  for (const s of content.sections) {
    if (s.hidden) continue;
    n++;
    w.heading(`${n}. ${SECTION_TITLES[s.key][lang]}`, base, 2);
    const blocks = parseBrdHtml(s.html);
    if (blocks.length) w.blocks(blocks, base);
    else if (!s.diagrams.length) w.paragraph(plain(t.empty), { base, color: C.muted, size: 9.5 });
    for (const d of s.diagrams) {
      const pic = m.pictures[d.id];
      if (pic) {
        const maxW = CW;
        const maxH = H - MB - 140;
        const scale = Math.min(1, maxW / pic.w, maxH / pic.h);
        const iw = pic.w * scale;
        const ih = pic.h * scale;
        w.ensure(ih + 24);
        const x = base === 'rtl' ? ML + CW - iw : ML;
        doc.addImage(pic.dataUrl, pic.format, x, w.y, iw, ih);
        w.y += ih + 4;
      } else {
        w.paragraph(plain(t.missingPicture), { base, color: C.muted, size: 9 });
      }
      if (d.caption) w.paragraph(plain(d.caption, { italic: true }), { base, size: 9, color: C.muted, gapAfter: 8 });
    }
    if (s.trace.length) {
      w.paragraph(plain(`${t.reqs}: ${s.trace.map((r) => `${r.ticket_ref} ${r.req_id}`).join(', ')}`), { base, size: 9, color: C.muted, gapAfter: 8 });
    }
  }

  w.heading(t.history, base, 2);
  const hist = [...m.versions].sort((a, b) => b.version - a.version).map((v) => [
    plain(`v${v.version}`), plain(v.created_at.slice(0, 10)), plain(t.st[v.status] ?? v.status), plain(v.author || '—'), plain(v.change_note || '—'),
  ]);
  if (hist.length) w.table([0.1, 0.16, 0.16, 0.2, 0.38], t.histCols.map((x) => plain(x)), hist, base, 8.5);
  else w.paragraph(plain('—'), { base, color: C.muted });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(t.page(i, pages), W / 2, H - 30, { align: 'center' });
    doc.text(`${t.confidential} · AI Support 360`, base === 'rtl' ? ML + CW : ML, H - 30, { align: base === 'rtl' ? 'right' : 'left' });
  }
  return doc;
}

// ---------------------------------------------------------------- browser helpers

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** Any picture (SVG included) drawn on a white canvas and returned as PNG, at most 1600 px wide. */
export async function rasterize(src: string, fallbackW = 800, fallbackH = 500): Promise<PdfPicture> {
  const img = await loadImage(src);
  const w0 = img.naturalWidth || fallbackW;
  const h0 = img.naturalHeight || fallbackH;
  const scale = Math.min(2, 1600 / w0);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * scale);
  canvas.height = Math.round(h0 * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), format: 'PNG', w: w0, h: h0 };
}

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function archPictures(content: ArchContent, assets: readonly ArchAsset[]): Promise<Record<string, PdfPicture | undefined>> {
  const out: Record<string, PdfPicture | undefined> = {};
  for (const s of content.sections) {
    if (s.hidden) continue;
    for (const d of s.diagrams) {
      try {
        if (d.kind === 'mermaid') {
          const l = layoutGraph(parseMermaid(d.source));
          out[d.id] = await rasterize(svgDataUrl(layoutToSvg(l)), l.width, l.height);
        } else {
          const a = assets.find((x) => x.id === d.asset_id);
          const url = a ? await assetUrl(a.path) : null;
          if (!url) continue;
          const blob = await (await fetch(url)).blob();
          const local = URL.createObjectURL(blob);
          try { out[d.id] = await rasterize(local); } finally { URL.revokeObjectURL(local); }
        }
      } catch { out[d.id] = undefined; }
    }
  }
  return out;
}

export async function archPdfBlob(content: ArchContent, meta: Omit<ArchPdfMeta, 'pictures'>, assets: readonly ArchAsset[]): Promise<Blob> {
  const [{ jsPDF }, fonts, pictures] = await Promise.all([import('jspdf'), loadBrdFonts(), archPictures(content, assets)]);
  return buildArchPdf(jsPDF as unknown as JsPdfCtor, content, { ...meta, pictures }, fonts).output('blob');
}
