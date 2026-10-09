import jsPDF from 'jspdf';
import { format } from 'date-fns';

const fmt = (amount: number, currency: string = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

export interface ReceiptPdfRecord {
  invoice?: string;
  date?: string;
  paid_at?: string | null;
  consultant?: string;
  payment_method?: string | null;
  transaction_id?: string | null;
  amount: number | string;
  vat?: number | string;
  currency?: string;
  ticket_id?: string | null;
  ticket_title?: string | null;
  ticket_sap_module?: string | null;
  session_id?: string | null;
  session_type?: string | null;
  session_status?: string | null;
  session_scheduled_at?: string | null;
  session_duration_minutes?: number | null;
  pricing_model?: string | null;
  base_amount?: number | string | null;
  service_fee_percent?: number | string | null;
  service_fee_amount?: number | string | null;
  processing_fee_percent?: number | string | null;
  processing_fee_amount?: number | string | null;
  vat_percent?: number | string | null;
}

export function generateReceiptPdf(rec: ReceiptPdfRecord, opts: { preview?: boolean } = {}): string | void {
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('PAYMENT RECEIPT', 20, 30);

  // PAID stamp
  doc.setDrawColor(34, 139, 34);
  doc.setTextColor(34, 139, 34);
  doc.setLineWidth(1.2);
  doc.roundedRect(w - 60, 20, 40, 14, 2, 2, 'S');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('PAID', w - 40, 30, { align: 'center' });
  doc.setLineWidth(0.2);
  doc.setTextColor(0);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`Receipt for: ${rec.invoice || 'N/A'}`, 20, 38);
  doc.text(`Issued: ${rec.date || format(new Date(), 'MMM d, yyyy')}`, 20, 44);
  if (rec.paid_at) doc.text(`Paid on: ${format(new Date(rec.paid_at), 'MMM d, yyyy h:mm a')}`, 20, 50);

  doc.setDrawColor(200);
  doc.line(20, 56, w - 20, 56);

  // Consultant + Method
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text('Consultant', 20, 66);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.text(rec.consultant || 'N/A', 20, 72);

  if (rec.payment_method) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text('Payment Method', w / 2, 66);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text(rec.payment_method, w / 2, 72);
  }

  let yPos = 86;

  if (rec.transaction_id) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text('Transaction ID', 20, yPos);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(rec.transaction_id, 20, yPos + 6);
    yPos += 16;
  }

  // Linked Session
  if (rec.session_id) {
    doc.setDrawColor(200);
    doc.setFillColor(238, 245, 255);
    doc.roundedRect(20, yPos - 6, w - 40, 24, 3, 3, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text('Linked Session', 26, yPos);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const title = `${(rec.session_type || 'Session').toString().replace(/_/g, ' ')}${rec.session_status ? ` · ${rec.session_status}` : ''}`;
    doc.text(title, 26, yPos + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100);
    const meta: string[] = [];
    if (rec.session_scheduled_at) meta.push(`Scheduled: ${format(new Date(rec.session_scheduled_at), 'MMM d, yyyy h:mm a')}`);
    if (rec.session_duration_minutes) meta.push(`Duration: ${rec.session_duration_minutes} min`);
    meta.push(`Session ID: ${rec.session_id.slice(0, 8)}`);
    doc.text(meta.join('  |  '), 26, yPos + 14);
    yPos += 32;
  }

  // Linked Ticket / Invoice ref
  if (rec.ticket_title || rec.invoice) {
    doc.setDrawColor(200);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(20, yPos - 6, w - 40, 24, 3, 3, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text('Linked Invoice & Ticket', 26, yPos);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${rec.invoice || 'N/A'}${rec.ticket_title ? ` — ${rec.ticket_title}` : ''}`, 26, yPos + 7);
    if (rec.ticket_sap_module) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Module: ${rec.ticket_sap_module}`, 26, yPos + 14);
    }
    yPos += 32;
  }

  doc.setDrawColor(200);
  doc.line(20, yPos, w - 20, yPos);
  yPos += 10;

  const amount = Number(rec.amount) || 0;
  const vat = Number(rec.vat || 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  if (rec.pricing_model === 'v2' && rec.base_amount != null) {
    const pct = (n: unknown) => `${Number(Number(n || 0).toFixed(2))}%`;
    const feeRows: [string, number][] = [
      ['Consultant fee', Number(rec.base_amount)],
      [`Platform service fee (${pct(rec.service_fee_percent)})`, Number(rec.service_fee_amount || 0)],
      [`Payment processing fee (${pct(rec.processing_fee_percent)})`, Number(rec.processing_fee_amount || 0)],
    ];
    for (const [label, value] of feeRows) {
      doc.text(label, 20, yPos);
      doc.setTextColor(0);
      doc.text(fmt(value, rec.currency), w - 20, yPos, { align: 'right' });
      doc.setTextColor(80);
      yPos += 8;
    }
  }
  doc.text('Subtotal', 20, yPos);
  doc.setTextColor(0);
  doc.text(fmt(amount - vat, rec.currency), w - 20, yPos, { align: 'right' });
  yPos += 8;

  doc.setTextColor(80);
  doc.text(rec.pricing_model === 'v2' && rec.vat_percent != null ? `VAT (${Number(Number(rec.vat_percent).toFixed(2))}%)` : 'VAT', 20, yPos);
  doc.setTextColor(0);
  doc.text(fmt(vat, rec.currency), w - 20, yPos, { align: 'right' });
  yPos += 8;

  doc.setDrawColor(200);
  doc.line(20, yPos, w - 20, yPos);
  yPos += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Amount Paid', 20, yPos);
  doc.setTextColor(34, 139, 34);
  doc.text(fmt(amount, rec.currency), w - 20, yPos, { align: 'right' });
  doc.setTextColor(0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('This receipt confirms payment was successfully received. Keep for your records.', 20, 280);

  if (opts.preview) {
    return doc.output('bloburl') as unknown as string;
  }
  doc.save(`receipt-${rec.invoice || 'payment'}.pdf`);
}
