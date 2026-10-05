import { format } from 'date-fns';

interface NDAExportData {
  ndaContent: string;
  signatureData: string;
  signatureType: 'draw' | 'type' | string;
  signedAt: string;
  consultantName?: string;
  clientName?: string;
  agreementId?: string;
  revokedAt?: string | null;
  clientSignatureData?: string | null;
  clientSignatureType?: string | null;
  clientSignerName?: string | null;
  clientSignedAt?: string | null;
}

/**
 * Builds the NDA PDF with an official signature block: the consultant's
 * signature (drawn image or typed name in script), printed full name, role,
 * date and agreement reference. Unsigned previews show empty signature lines.
 */
export async function exportNDAAsPDF(data: NDAExportData) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  const signed = !!data.signatureData;
  let y = 20;

  doc.setFontSize(18);
  doc.setTextColor(27, 37, 89);
  doc.text('Non-Disclosure Agreement', 105, y, { align: 'center' });
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(128);
  doc.text(
    signed ? `Signed on ${format(new Date(data.signedAt), 'PPP')}` : 'Draft — not yet signed',
    105, y, { align: 'center' },
  );
  y += 5;
  doc.text(`${data.consultantName || 'Consultant'} → ${data.clientName || 'Client'}`, 105, y, { align: 'center' });
  y += 8;
  doc.setDrawColor(200);
  doc.line(14, y, 196, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(30);
  for (const line of doc.splitTextToSize(data.ndaContent || '', 180)) {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(line, 14, y);
    y += 5;
  }

  // Signature block (kept together on one page)
  y += 10;
  if (y > 200) { doc.addPage(); y = 20; }
  doc.setDrawColor(27, 37, 89);
  doc.setLineWidth(0.4);
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(27, 37, 89);
  doc.text('SIGNATURES', 14, y);
  y += 8;

  const colL = 14;
  const colR = 110;
  doc.setFontSize(9);
  doc.text('CONSULTANT (Receiving Party)', colL, y);
  doc.text('CLIENT (Disclosing Party)', colR, y);
  y += 4;

  // Signature area
  const sigTop = y;
  if (signed && data.signatureType === 'draw' && data.signatureData.startsWith('data:image')) {
    try { doc.addImage(data.signatureData, 'PNG', colL, sigTop, 70, 21); } catch { /* ignore */ }
  } else if (signed) {
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(22);
    doc.setTextColor(20, 30, 80);
    doc.text(data.signatureData, colL + 2, sigTop + 15);
  }
  const cSigned = !!data.clientSignatureData;
  if (cSigned && data.clientSignatureType === 'draw' && data.clientSignatureData!.startsWith('data:image')) {
    try { doc.addImage(data.clientSignatureData!, 'PNG', colR, sigTop, 70, 21); } catch { /* ignore */ }
  } else if (cSigned) {
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(22);
    doc.setTextColor(20, 30, 80);
    doc.text(data.clientSignatureData!, colR + 2, sigTop + 15);
  }
  y = sigTop + 24;
  doc.setDrawColor(120);
  doc.setLineWidth(0.3);
  doc.line(colL, y, colL + 80, y);
  doc.line(colR, y, colR + 80, y);
  y += 5;

  const row = (label: string, left: string, right: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(label, colL, y);
    doc.text(label, colR, y);
    doc.setFontSize(10);
    doc.setTextColor(30);
    doc.text(left, colL + 18, y);
    doc.text(right, colR + 18, y);
    y += 6;
  };
  row('Name:', data.consultantName || '________________', data.clientSignerName || data.clientName || '________________');
  row('Role:', 'Consultant', data.clientName && data.clientSignerName ? `Client — ${data.clientName}` : 'Client');
  row('Date:', signed ? format(new Date(data.signedAt), 'PPP p') : '________________',
    cSigned && data.clientSignedAt ? format(new Date(data.clientSignedAt), 'PPP p') : 'Awaiting client signature');
  row('Method:', signed ? (data.signatureType === 'draw' ? 'Hand-drawn e-signature' : 'Typed e-signature') : '—',
    cSigned ? (data.clientSignatureType === 'draw' ? 'Hand-drawn e-signature' : 'Typed e-signature') : '—');

  y += 4;
  doc.setFontSize(7.5);
  doc.setTextColor(128);
  const footer = [
    data.agreementId ? `Agreement ID: ${data.agreementId}` : null,
    signed ? `Electronically signed on AI Support Now by ${cSigned ? 'both parties' : 'the consultant'}. Each signer agreed to the terms above before signing.` : null,
    data.revokedAt ? `Revoked on ${format(new Date(data.revokedAt), 'PPP')}` : null,
  ].filter(Boolean) as string[];
  for (const f of footer) { doc.text(f, colL, y); y += 4; }

  const filename = `NDA_${(data.consultantName || 'Consultant').replace(/\s+/g, '_')}_${format(new Date(data.signedAt), 'yyyy-MM-dd')}.pdf`;
  doc.save(filename);
}
