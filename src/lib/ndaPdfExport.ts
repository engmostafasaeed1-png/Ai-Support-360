import { format } from 'date-fns';

interface NDAExportData {
  ndaContent: string;
  signatureData: string;
  signatureType: 'draw' | 'type' | string;
  signedAt: string;
  consultantName?: string;
  clientName?: string;
}

export async function exportNDAAsPDF(data: NDAExportData) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  let y = 20;

  // Title
  doc.setFontSize(18);
  doc.setTextColor(27, 37, 89); // primary #1B2559
  doc.text('Non-Disclosure Agreement', 105, y, { align: 'center' });
  y += 10;

  // Metadata line
  doc.setFontSize(9);
  doc.setTextColor(128);
  doc.text(`Signed on ${format(new Date(data.signedAt), 'PPP')}`, 105, y, { align: 'center' });
  y += 4;
  if (data.consultantName || data.clientName) {
    doc.text(
      `${data.consultantName || 'Consultant'} → ${data.clientName || 'Client'}`,
      105, y, { align: 'center' }
    );
  }
  y += 10;

  // Separator
  doc.setDrawColor(200);
  doc.line(14, y, 196, y);
  y += 8;

  // NDA content
  doc.setFontSize(10);
  doc.setTextColor(30);
  const lines = doc.splitTextToSize(data.ndaContent, 170);
  for (const line of lines) {
    if (y > 265) { doc.addPage(); y = 20; }
    doc.text(line, 14, y);
    y += 5;
  }

  y += 10;
  if (y > 240) { doc.addPage(); y = 20; }

  // Signature section
  doc.setDrawColor(200);
  doc.line(14, y, 196, y);
  y += 8;

  doc.setFontSize(11);
  doc.setTextColor(27, 37, 89);
  doc.text('Digital Signature', 14, y);
  y += 8;

  if (data.signatureType === 'draw' && data.signatureData.startsWith('data:image')) {
    try {
      doc.addImage(data.signatureData, 'PNG', 14, y, 80, 30);
      y += 35;
    } catch {
      doc.setFontSize(10);
      doc.text('[Drawn signature — image attached]', 14, y);
      y += 8;
    }
  } else {
    doc.setFontSize(16);
    doc.setFont('times', 'italic');
    doc.text(data.signatureData, 14, y);
    y += 10;
    doc.setFont('helvetica', 'normal');
  }

  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text(`Date: ${format(new Date(data.signedAt), 'PPP p')}`, 14, y);

  const filename = `NDA_${(data.consultantName || 'Consultant').replace(/\s+/g, '_')}_${format(new Date(data.signedAt), 'yyyy-MM-dd')}.pdf`;
  doc.save(filename);
}
