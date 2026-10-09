import jsPDF from 'jspdf';
import { format } from 'date-fns';

const fmt = (amount: number, currency: string = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

const statusLabels: Record<string, string> = {
  completed: 'Paid',
  paid: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
};

export interface InvoicePdfRecord {
  invoice?: string;
  date?: string;
  due_date?: string | null;
  status?: string;
  consultant?: string;
  payment_method?: string | null;
  ticket_title?: string | null;
  ticket_sap_module?: string | null;
  ticket_urgency?: string | null;
  description?: string | null;
  amount: number | string;
  vat?: number | string;
  currency?: string;
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

export function generateInvoicePdf(inv: InvoicePdfRecord, opts: { preview?: boolean } = {}): string | void {
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();

  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', 20, 30);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(inv.invoice || 'N/A', 20, 38);
  doc.text(`Date: ${inv.date || 'N/A'}`, 20, 44);
  if (inv.due_date) doc.text(`Due: ${format(new Date(inv.due_date), 'MMM d, yyyy')}`, 20, 50);

  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text(`Status: ${statusLabels[inv.status || 'pending'] || inv.status || 'Pending'}`, w - 60, 30);

  doc.setDrawColor(200);
  doc.line(20, 56, w - 20, 56);

  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text('Consultant', 20, 66);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.text(inv.consultant || 'N/A', 20, 72);

  if (inv.payment_method) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text('Payment Method', w / 2, 66);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text(inv.payment_method, w / 2, 72);
  }

  let yPos = 86;

  // Linked Session
  if (inv.session_id) {
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
    const sessTitle = `${(inv.session_type || 'Session').toString().replace(/_/g, ' ')}${inv.session_status ? ` · ${inv.session_status}` : ''}`;
    doc.text(sessTitle, 26, yPos + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100);
    const meta: string[] = [];
    if (inv.session_scheduled_at) meta.push(`Scheduled: ${format(new Date(inv.session_scheduled_at), 'MMM d, yyyy h:mm a')}`);
    if (inv.session_duration_minutes) meta.push(`Duration: ${inv.session_duration_minutes} min`);
    if (meta.length) doc.text(meta.join('  |  '), 26, yPos + 14);
    yPos += 32;
  }

  if (inv.ticket_title) {
    doc.setDrawColor(200);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(20, yPos - 6, w - 40, 24, 3, 3, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text('Linked Ticket', 26, yPos);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(inv.ticket_title, 26, yPos + 7);
    if (inv.ticket_sap_module) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Module: ${inv.ticket_sap_module}  |  Urgency: ${inv.ticket_urgency || 'N/A'}`, 26, yPos + 14);
    }
    yPos += 32;
  }

  if (inv.description) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text('Description', 20, yPos);
    doc.setTextColor(0);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(inv.description, w - 40);
    doc.text(lines, 20, yPos + 7);
    yPos += 7 + lines.length * 5 + 8;
  }

  doc.setDrawColor(200);
  doc.line(20, yPos, w - 20, yPos);
  yPos += 10;

  const amount = Number(inv.amount) || 0;
  const vat = Number(inv.vat || 0);
  const pct = (n: unknown) => `${Number(Number(n || 0).toFixed(2))}%`;
  const feeRows: [string, string][] =
    inv.pricing_model === 'v2' && inv.base_amount != null
      ? [
          ['Consultant fee (approved hours x hourly rate)', fmt(Number(inv.base_amount), inv.currency)],
          [`Platform service fee (${pct(inv.service_fee_percent)})`, fmt(Number(inv.service_fee_amount || 0), inv.currency)],
          [`Payment processing fee (${pct(inv.processing_fee_percent)})`, fmt(Number(inv.processing_fee_amount || 0), inv.currency)],
        ]
      : [];
  const tableData: [string, string][] = [
    ...feeRows,
    ['Subtotal', fmt(amount - vat, inv.currency)],
    [inv.pricing_model === 'v2' && inv.vat_percent != null ? `VAT (${pct(inv.vat_percent)})` : 'VAT', fmt(vat, inv.currency)],
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  tableData.forEach(([label, val]) => {
    doc.setTextColor(80);
    doc.text(label, 20, yPos);
    doc.setTextColor(0);
    doc.text(val, w - 20, yPos, { align: 'right' });
    yPos += 8;
  });

  doc.setDrawColor(200);
  doc.line(20, yPos, w - 20, yPos);
  yPos += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Total', 20, yPos);
  doc.text(fmt(amount, inv.currency), w - 20, yPos, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('This is a system-generated invoice.', 20, 280);

  if (opts.preview) {
    return doc.output('bloburl') as unknown as string;
  }
  doc.save(`${inv.invoice || 'invoice'}.pdf`);
}
