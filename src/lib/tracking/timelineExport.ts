// Timeline export for the people on the ticket (the rows come only from tt_timeline, which checks the caller).
// CSV with a byte order mark (Excel reads Arabic correctly), PDF with the embedded IBM Plex Sans Arabic font and the
// word-by-word bidi layout already used for the BRD PDF.
import type { jsPDF } from 'jspdf';
import { csvCell } from '@/lib/timesheetExport';
import type { TimelineRow } from './api';
import { actorText, eventText, type Translate } from './timelineText';
import type { TrackingSettings } from '@/lib/ticketTracking';
import { C, CW, FONT, H, ML, W, Writer, plain, loadBrdFonts, type BrdPdfFonts, type JsPdfCtor } from '@/lib/brd/pdf';

export interface TimelineExportMeta { ticketTitle: string; ticketRef: string; generatedAt?: Date }

function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function timelineRows(rows: readonly TimelineRow[], t: Translate, lang: string, settings: TrackingSettings): string[][] {
  return rows.map((r) => {
    const { title, detail } = eventText(r, t, lang, settings);
    return [stamp(r.event_at), t(`tracking.source.${r.source}`), title, actorText(t, r.actor_role), detail ?? ''];
  });
}

export function timelineCsv(rows: readonly TimelineRow[], t: Translate, lang: string, settings: TrackingSettings): string {
  const head = [t('tracking.export.when'), t('tracking.export.type'), t('tracking.export.event'), t('tracking.export.by'), t('tracking.export.details')];
  return [head, ...timelineRows(rows, t, lang, settings)].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function buildTimelinePdf(JsPDF: JsPdfCtor, rows: readonly TimelineRow[], t: Translate, lang: string, settings: TrackingSettings, meta: TimelineExportMeta, fonts: BrdPdfFonts): jsPDF {
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.addFileToVFS(`${FONT}-Regular.ttf`, fonts.regular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  const base = lang.startsWith('ar') ? 'rtl' : 'ltr';
  doc.setProperties({ title: `${t('tracking.export.title')} - ${meta.ticketTitle}`, creator: 'AI Support 360' });
  const w = new Writer(doc);
  w.heading(t('tracking.export.title'), base, 2);
  w.paragraph(plain(`${meta.ticketTitle} (${meta.ticketRef})`), { base, size: 11, bold: true, color: C.text });
  w.paragraph(plain(t('tracking.export.generated', { date: stamp((meta.generatedAt ?? new Date()).toISOString()) })), { base, size: 9, color: C.muted, gapAfter: 10 });
  const head = [t('tracking.export.when'), t('tracking.export.type'), t('tracking.export.event'), t('tracking.export.by'), t('tracking.export.details')].map((x) => plain(x));
  const body = timelineRows(rows, t, lang, settings).map((r) => r.map((x) => plain(x)));
  if (body.length) w.table([0.18, 0.12, 0.3, 0.13, 0.27], head, body, base, 8.5);
  else w.paragraph(plain(t('tracking.timeline.empty')), { base, size: 10, color: C.muted });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(`${i} / ${pages}`, W / 2, H - 30, { align: 'center' });
    doc.text('AI Support 360', base === 'rtl' ? ML + CW : ML, H - 30, { align: base === 'rtl' ? 'right' : 'left' });
  }
  return doc;
}

export async function timelinePdfBlob(rows: readonly TimelineRow[], t: Translate, lang: string, settings: TrackingSettings, meta: TimelineExportMeta): Promise<Blob> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadBrdFonts()]);
  return buildTimelinePdf(jsPDF as unknown as JsPdfCtor, rows, t, lang, settings, meta, fonts).output('blob');
}
