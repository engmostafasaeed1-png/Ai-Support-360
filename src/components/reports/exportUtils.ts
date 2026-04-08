import { format } from 'date-fns';

export function exportToCSV(data: Record<string, any>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        const str = val === null || val === undefined ? '' : String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ),
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToPDF(title: string, sections: { heading: string; data: Record<string, string | number>[] }[]) {
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
