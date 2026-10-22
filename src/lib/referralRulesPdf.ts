import jsPDF from 'jspdf';

export interface RulesPdfBlock { title: string; note: string | null; bullets: string[]; more: string[]; moreTitle?: string }
export interface RulesPdfData { title: string; subtitle: string; disclaimer: string; lang: 'en' | 'ar'; blocks: RulesPdfBlock[] }

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The rules as a document. English: a real PDF; Arabic: the browser's print-to-PDF (keeps Arabic shaping), like statements. */
export function downloadRulesPdf(d: RulesPdfData): void {
  if (d.lang === 'ar') { printRules(d); return; }
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();
  const maxW = w - 28;
  let y = 18;
  const line = (text: string, size: number, bold = false, indent = 0) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    for (const part of doc.splitTextToSize(text, maxW - indent) as string[]) {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.text(part, 14 + indent, y);
      y += size * 0.45;
    }
  };
  line(d.title, 16, true);
  line(d.subtitle, 9);
  y += 3;
  for (const b of d.blocks) {
    y += 2;
    line(b.title, 12, true);
    if (b.note) line(b.note, 9, false, 2);
    for (const x of b.bullets) line(`- ${x}`, 9, false, 2);
    if (b.more.length) {
      if (b.moreTitle) line(b.moreTitle, 9, true, 2);
      for (const x of b.more) line(`- ${x}`, 9, false, 4);
    }
  }
  y += 3;
  line(d.disclaimer, 8);
  doc.save('referral-programme-rules.pdf');
}

function printRules(d: RulesPdfData) {
  const page = window.open('', '_blank');
  if (!page) return;
  const blocks = d.blocks.map((b) => `<h2>${esc(b.title)}</h2>${b.note ? `<p>${esc(b.note)}</p>` : ''}<ul>${b.bullets.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${
    b.more.length ? `${b.moreTitle ? `<h3>${esc(b.moreTitle)}</h3>` : ''}<ul>${b.more.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`).join('');
  page.document.write(`<!doctype html><html lang="${d.lang}" dir="${d.lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(d.title)}</title>
<style>body{font-family:"IBM Plex Sans Arabic",Inter,system-ui,sans-serif;margin:32px;color:#1B2559;font-size:13px;line-height:1.6}h1{font-size:20px}h2{font-size:15px;margin-top:18px}h3{font-size:13px}small{color:#555}</style>
</head><body><h1>${esc(d.title)}</h1><small>${esc(d.subtitle)}</small>${blocks}<p><small>${esc(d.disclaimer)}</small></p></body></html>`);
  page.document.close();
  page.focus();
  page.print();
}
