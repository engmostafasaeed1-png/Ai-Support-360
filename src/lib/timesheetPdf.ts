// The PDF of a timesheet: the approved rates, every activity with its duration and amount, the totals and the state of the timesheets.

import { format } from 'date-fns';
import { categoryLabel, formatDuration, formatHours, formatMoney, type Summary } from './timesheet';
import type { ExportRow } from './timesheetExport';
import { formatPercent } from './pricing';

export interface PdfData {
  ticketTitle: string;
  ticketId: string;
  currency: string;
  vatPercent: number;
  /** the percentages of the platform service fee and of the payment processing fee (no fee lines when they are missing) */
  serviceFeePercent?: number;
  processingFeePercent?: number;
  /** one text per consultant, for example "Mostaf Test: 50.00 USD per hour (approved by the client on Oct 3, 2026)" */
  rates: string[];
  rows: ExportRow[];
  totals: Summary;
  /** one text per timesheet */
  timesheets: string[];
}

export async function downloadTimesheetPdf(data: PdfData): Promise<void> {
  const { default: JsPdf } = await import('jspdf');
  const doc = new JsPdf();
  let y = 20;
  const write = (text: string, size = 9, bold = false, gap = 5, indent = 14) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const parts = doc.splitTextToSize(text, 196 - indent) as string[];
    for (const part of parts) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(part, indent, y);
      y += gap;
    }
  };

  write('Timesheet', 18, true, 9);
  write(`Ticket: ${data.ticketTitle}`, 10);
  write(`Created: ${format(new Date(), 'MMM d, yyyy HH:mm')}`, 10, false, 8);

  write('Hourly rate', 11, true, 6);
  if (data.rates.length === 0) write('No hourly rate is approved yet.');
  data.rates.forEach(r => write(r));
  y += 3;

  write('Activities', 11, true, 6);
  if (data.rows.length === 0) write('No work logged yet.');
  data.rows.forEach(r => {
    const amount = r.amount == null ? 'rate pending' : formatMoney(r.amount, r.currency);
    write(`${r.date}   ${r.consultant}   ${categoryLabel(r.category)}   ${formatDuration(r.hours)}${r.billable ? '' : ' (not billable)'}   ${amount}   [${r.timesheet}]`, 9, true, 4.5);
    if (r.description) write(r.description, 8, false, 4, 18);
    y += 1.5;
  });
  y += 3;

  write('Totals', 11, true, 6);
  write(`Hours: ${formatHours(data.totals.totalHours)} (${formatHours(data.totals.billableHours)} billable, ${formatHours(data.totals.nonBillableHours)} not billable)`);
  write(`Consultant fee (billable hours x hourly rate): ${formatMoney(data.totals.subtotal, data.currency)}`);
  if (data.totals.fees > 0) {
    write(`Platform service fee ${formatPercent(data.serviceFeePercent)}: ${formatMoney(data.totals.serviceFee, data.currency)}`);
    write(`Payment processing fee ${formatPercent(data.processingFeePercent)}: ${formatMoney(data.totals.processingFee, data.currency)}`);
  }
  write(`VAT ${String(Number(data.vatPercent) || 0)}%: ${formatMoney(data.totals.vat, data.currency)}`);
  write(`Total: ${formatMoney(data.totals.total, data.currency)}`, 10, true);

  if (data.timesheets.length > 0) {
    y += 3;
    write('Timesheets', 11, true, 6);
    data.timesheets.forEach(t => write(t));
  }
  doc.save(`timesheet-${data.ticketId.substring(0, 8)}.pdf`);
}
