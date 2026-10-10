import { format } from 'date-fns';
import { toast } from 'sonner';

/** Neutralize spreadsheet formula injection: prefix cells starting with = + - @ tab or CR with a quote. */
export function neutralizeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

const NO_DATA = 'There is no data to export for the selected period.';

export function exportToCSV(data: Record<string, any>[], filename: string) {
  if (data.length === 0) {
    toast.info(NO_DATA);
    return;
  }
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const str = neutralizeCsvCell(row[h]);
        return str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ),
  ];
  // The byte order mark tells Excel that the file is UTF-8, so Arabic and other non-Latin text is read correctly.
  const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type PdfSection = { heading: string; data: Record<string, string | number>[] };

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Arabic needs letter shaping and a right-to-left layout, which the PDF library of the portal cannot do.
 * A report with Arabic text opens as a printable page instead: the browser shapes the letters and prints the page to PDF.
 */
function printReport(title: string, sections: PdfSection[]) {
  const w = window.open('', '_blank');
  if (!w) {
    toast.error('Allow pop-ups for this site to export the report, then try again.');
    return;
  }
  const body = sections.map(section => {
    if (section.data.length === 0) return `<h2>${escapeHtml(section.heading)}</h2><p class="empty">-</p>`;
    const headers = Object.keys(section.data[0]);
    const head = headers.map(h => `<th><bdi>${escapeHtml(h)}</bdi></th>`).join('');
    const rows = section.data
      .map(row => `<tr>${headers.map(h => `<td><bdi>${escapeHtml(row[h])}</bdi></td>`).join('')}</tr>`)
      .join('');
    return `<h2>${escapeHtml(section.heading)}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  const style =
    'body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;padding:24px;color:#111}' +
    'h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}' +
    '.meta{color:#666;font-size:12px;margin:0 0 12px}.empty{color:#666;font-size:12px}' +
    'table{border-collapse:collapse;width:100%}th,td{border:1px solid #d4d4d8;padding:5px 8px;font-size:12px;text-align:start}' +
    'th{background:#f4f4f5}';
  w.document.open();
  w.document.write(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${style}</style></head>` +
    `<body><h1><bdi>${escapeHtml(title)}</bdi></h1><p class="meta"><bdi>${escapeHtml(format(new Date(), 'PPP'))}</bdi></p>${body}</body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function exportToPDF(title: string, sections: PdfSection[]) {
  if (sections.every(s => s.data.length === 0)) {
    toast.info(NO_DATA);
    return;
  }
  if (ARABIC.test(JSON.stringify([title, sections]))) {
    printReport(title, sections);
    return;
  }
  // Dynamic import jsPDF
  import('jspdf').then(({ jsPDF }) => {
    const doc = new jsPDF();
    let y = 20;

    doc.setFontSize(18);
    doc.text(title, 14, y);
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(128);
    doc.text(`Generated on ${format(new Date(), 'PPP')}`, 14, y);
    y += 12;

    sections.forEach(section => {
      if (y > 260) { doc.addPage(); y = 20; }

      doc.setFontSize(13);
      doc.setTextColor(0);
      doc.text(section.heading, 14, y);
      y += 8;

      if (section.data.length > 0) {
        const headers = Object.keys(section.data[0]);
        const colWidth = (180) / headers.length;

        // Header row
        doc.setFontSize(8);
        doc.setTextColor(100);
        headers.forEach((h, i) => {
          doc.text(h, 14 + i * colWidth, y);
        });
        y += 5;
        doc.setDrawColor(200);
        doc.line(14, y, 195, y);
        y += 3;

        // Data rows
        doc.setTextColor(0);
        section.data.forEach(row => {
          if (y > 275) { doc.addPage(); y = 20; }
          headers.forEach((h, i) => {
            doc.text(String(row[h] ?? ''), 14 + i * colWidth, y);
          });
          y += 5;
        });
        y += 8;
      }
    });

    doc.save(`${title.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  });
}
