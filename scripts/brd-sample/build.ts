// Renders the sample BRDs into docs/ with the same PDF code the app uses:  bun scripts/brd-sample/build.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { buildBrdPdf } from '../../src/lib/brd/pdf';
import { sampleBrd, sampleVersions } from './sample';

const fonts = {
  regular: readFileSync('public/fonts/brd/IBMPlexSansArabic-Regular.ttf').toString('base64'),
  bold: readFileSync('public/fonts/brd/IBMPlexSansArabic-Bold.ttf').toString('base64'),
};
for (const lang of ['en', 'ar'] as const) {
  const content = { ...sampleBrd(lang), control: { ...sampleBrd(lang).control, status: 'final' as const } };
  // deno-lint-ignore no-explicit-any
  const doc = buildBrdPdf(jsPDF as any, content, {
    ticketRef: 'SAMPLE01',
    ticketTitle: lang === 'ar' ? 'حجب فواتير MIRO بعد الترقية' : 'MIRO invoices blocked after upgrade',
    version: 3, versions: sampleVersions, generatedAt: new Date('2026-10-24T12:00:00Z'),
  }, fonts);
  const out = `docs/brd-sample${lang === 'ar' ? '-ar' : ''}.pdf`;
  writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
  console.log('wrote', out, doc.getNumberOfPages(), 'pages');
}
