import { format } from 'date-fns';
import type { jsPDF } from 'jspdf';
import { formatMoney, type Summary } from './timesheet';
import type { ExportRow } from './timesheetExport';
import { ARABIC_TEXT, asciiText, buildDocumentRows, exportStatus, needsPageBreak, tableColumns, tableRowHeight, TIMESHEET_DISCLAIMER, truncateLines } from './timesheetDocument';

export interface ApprovalData {
  number: string;
  status: string;
  submittedBy: string;
  submittedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  comments: string[];
}
export interface PdfData {
  ticketTitle: string;
  ticketId: string;
  clientName?: string;
  currency: string;
  vatPercent: number;
  serviceFeePercent?: number;
  processingFeePercent?: number;
  rates: string[];
  rows: ExportRow[];
  totals: Summary;
  timesheets: string[];
  approvals?: ApprovalData[];
  groupByDay?: boolean;
  documentDate?: Date;
}

// Fixed paper palette: primary navy and semantic light surfaces, independent of screen dark mode.
const PAPER = { primary: '#032A5E', white: '#FFFFFF', ink: '#142034', muted: '#576171', surface: '#F4F6F9', border: '#DDE2EA', subtotal: '#EAF2FC', approved: '#1B754C', submitted: '#8A5B12', changes: '#A84720' };
const columnWidths = (columns: string[]) => columns.includes('Time')
  ? [7, 21, 66, 24, 14, 23, 27]
  : [7, 21, 90, 14, 23, 27]; // 182 mm; freed clock width belongs to the description
const day = (value?: string | null) => value ? value.slice(0, 10) : '-';
const statusColor = (value: string) => value === 'Approved' ? PAPER.approved : value === 'Submitted' ? PAPER.submitted : value === 'Changes requested' ? PAPER.changes : PAPER.muted;
const money = (value: number, data: PdfData) => formatMoney(value, data.currency);

function metadata(data: PdfData) {
  const dates = data.rows.map(r => r.date.slice(0, 10)).sort();
  const statuses = [...new Set(data.rows.map(r => exportStatus(r.timesheet)))];
  const rates = [...new Set(data.rows.filter(r => r.rate != null).map(r => `${r.rate?.toFixed(2)} ${r.currency}`))];
  return {
    date: format(data.documentDate ?? new Date(), 'yyyy-MM-dd'),
    consultant: [...new Set(data.rows.map(r => r.consultant))].join(', ') || '-',
    period: dates.length ? `${dates[0]} - ${dates[dates.length - 1]}` : '-',
    status: statuses.length === 1 ? statuses[0] : statuses.join(' / ') || 'Draft',
    rate: rates.length === 1 ? rates[0] : rates.length > 1 ? 'Multiple rates' : 'Pending',
    number: data.approvals?.length === 1 ? data.approvals[0]?.number : undefined,
  };
}

function feeLines(data: PdfData): [string, string][] {
  return [
    ['Consultant fee', money(data.totals.subtotal, data)],
    ...(data.totals.fees > 0 ? [
      [`Platform service fee (${data.serviceFeePercent ?? 0}%)`, money(data.totals.serviceFee, data)],
      [`Payment processing fee (${data.processingFeePercent ?? 0}%)`, money(data.totals.processingFee, data)],
    ] as [string, string][] : []),
    [`VAT (${data.vatPercent}%)`, money(data.totals.vat, data)],
    ['Total client pays', money(data.totals.total, data)],
  ];
}

/** Exposed for document verification without downloading or involving live customer data. */
export function renderTimesheetPdf(doc: jsPDF, data: PdfData): jsPDF {
  const meta = metadata(data);
  const columns = tableColumns(data.rows);
  const widths = columnWidths(columns);
  const numericColumn = (index: number) => columns[index] === 'Hours' || columns[index] === 'Amount';
  let y = 0;
  const text = (value: string | string[], x: number, top: number, size = 9, color = PAPER.ink, bold = false, align: 'left' | 'right' = 'left') => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color);
    doc.text(Array.isArray(value) ? value.map(asciiText) : asciiText(value), x, top, { align, lineHeightFactor: 1.26 });
  };
  const box = (x: number, top: number, w: number, h: number, fill: string) => { doc.setFillColor(fill); doc.rect(x, top, w, h, 'F'); };
  const wrap = (value: string, width: number, size = 9) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
    return doc.splitTextToSize(asciiText(value), width) as string[];
  };
  const lines = (value: string, width: number, max = 3, size = 9) => {
    const measured = wrap(value, width, size);
    return truncateLines(measured, max, width, v => doc.getTextWidth(v));
  };
  const band = () => {
    box(0, 0, 210, 22, PAPER.primary);
    text('Timesheet', 14, 14, 18, PAPER.white, true);
    text('AI Support 360', 196, 14, 10, PAPER.white, true, 'right');
    y = 30;
  };
  const header = () => {
    box(14, y, 182, 11, PAPER.primary);
    let x = 14;
    columns.forEach((label, i) => {
      const cell = lines(label, widths[i] - 2, 2, 8);
      text(cell, numericColumn(i) ? x + widths[i] - 1 : x + 1, y + 4, 8, PAPER.white, true, numericColumn(i) ? 'right' : 'left');
      x += widths[i];
    });
    y += 11;
  };
  const newPage = (table = false) => { doc.addPage(); band(); if (table) header(); };
  const paragraph = (value: string, bold = false) => {
    for (const line of wrap(value, 178)) {
      if (needsPageBreak(y, 5)) newPage();
      text(line, 16, y + 4, 9, PAPER.ink, bold); y += 5;
    }
  };
  band();
  // Variable-height metadata retains long names, request titles and mixed statuses.
  const left = [['CONSULTANT', meta.consultant], ['CLIENT', data.clientName || '-'], ['REQUEST', `${data.ticketTitle} | ${data.ticketId}`]];
  const right = [['PERIOD', meta.period], ['STATUS', meta.status], ['HOURLY RATE', meta.rate], ['DOCUMENT DATE', meta.date], ...(meta.number ? [['TIMESHEET NO.', meta.number]] : [])];
  const infoHeight = Math.max(...[left, right].map(column => column.reduce((h, [, value]) => h + wrap(value, 82).length * 4 + 7, 0))) + 8;
  box(14, y, 182, infoHeight, PAPER.surface);
  [left, right].forEach((column, ci) => {
    let top = y + 7;
    for (const [label, value] of column) {
      text(label, 18 + ci * 91, top, 8, PAPER.muted);
      const parts = wrap(value, 82);
      if (label === 'STATUS') box(17 + ci * 91, top + 1, 85, parts.length * 4 + 3, PAPER.subtotal);
      text(parts, 18 + ci * 91, top + 5, 9, label === 'STATUS' ? statusColor(value) : PAPER.ink);
      top += parts.length * 4 + 7;
    }
  });
  y += infoHeight + 6;
  [['TOTAL HOURS', data.totals.totalHours.toFixed(2)], ['ENTRIES', String(data.rows.length)], ['HOURLY RATE', meta.rate], ['AMOUNT', money(data.totals.subtotal, data)]].forEach(([label, value], i) => {
    box(14 + i * 46, y, 44, 23, PAPER.surface);
    text(label, 17 + i * 46, y + 6, 8, PAPER.muted);
    text(lines(value, 38, 2, 12), 17 + i * 46, y + 13, 12, PAPER.primary, true);
  });
  y += 30;
  if (needsPageBreak(y, 23)) newPage();
  header();
  const documentRows = buildDocumentRows(data.rows, data.groupByDay);
  documentRows.forEach((row, index) => {
    const cells = row.cells.map((value, i) => lines(value, widths[i] - 2, 3));
    const height = tableRowHeight(cells.map(c => c.length));
    // Keep the last activity with its total instead of leaving the total on a page by itself.
    const followingTotal = documentRows[index + 1]?.kind === 'total' ? 8 : 0;
    if (needsPageBreak(y, height + followingTotal)) newPage(true);
    if (row.kind !== 'entry' || index % 2 === 1) box(14, y, 182, height, row.kind === 'entry' ? PAPER.surface : PAPER.subtotal);
    doc.setDrawColor(PAPER.border); doc.setLineWidth(row.kind === 'total' ? 0.5 : 0.15);
    doc.line(14, row.kind === 'total' ? y : y + height, 196, row.kind === 'total' ? y : y + height);
    let x = 14;
    cells.forEach((cell, i) => {
      text(cell, numericColumn(i) ? x + widths[i] - 1 : x + 1, y + 4, 9, columns[i] === 'Status' ? statusColor(row.cells[i]) : PAPER.ink, row.kind !== 'entry', numericColumn(i) ? 'right' : 'left');
      x += widths[i];
    });
    y += height;
  });
  y += 6;
  const fees = feeLines(data);
  if (needsPageBreak(y, fees.length * 6 + 6)) newPage();
  box(14, y, 182, fees.length * 6 + 6, PAPER.surface);
  fees.forEach(([label, value], i) => { text(label, 18, y + 6 + i * 6, 9, PAPER.muted); text(value, 192, y + 6 + i * 6, 9, PAPER.ink, i === fees.length - 1, 'right'); });
  y += fees.length * 6 + 12;
  paragraph(`Hours: ${data.totals.billableHours.toFixed(2)} billable | ${data.totals.nonBillableHours.toFixed(2)} not billable | ${data.totals.pendingRateHours.toFixed(2)} awaiting a rate`);
  if (data.rates.length) { paragraph('APPROVED HOURLY RATES', true); data.rates.forEach(r => paragraph(r)); y += 4; }
  // Reserve the heading with the first signature block, using measured heights for long names/IDs.
  const firstApproval = data.approvals?.[0];
  const approvalLeadHeight = firstApproval
    ? [
      `Timesheet no. ${firstApproval.number} | ${exportStatus(firstApproval.status)}`,
      `Submitted by: ${firstApproval.submittedBy} | ${day(firstApproval.submittedAt)}`,
      firstApproval.status === 'signed' ? `Approved by: ${firstApproval.approvedBy || '-'} | ${day(firstApproval.approvedAt)}` : 'Waiting for approval',
    ].reduce((height, value) => height + wrap(value, 178).length * 5, 17)
    : 25;
  if (needsPageBreak(y, approvalLeadHeight)) newPage();
  paragraph('APPROVAL', true);
  if (!data.approvals?.length) {
    if (data.timesheets.length) data.timesheets.forEach(value => paragraph(value));
    paragraph('Submitted by: -'); paragraph('Waiting for approval');
  }
  data.approvals?.forEach(approval => {
    const blockHeight = [
      `Timesheet no. ${approval.number} | ${exportStatus(approval.status)}`,
      `Submitted by: ${approval.submittedBy} | ${day(approval.submittedAt)}`,
      approval.status === 'signed' ? `Approved by: ${approval.approvedBy || '-'} | ${day(approval.approvedAt)}` : 'Waiting for approval',
    ].reduce((height, value) => height + wrap(value, 178).length * 5, 12);
    if (needsPageBreak(y, blockHeight)) newPage();
    paragraph(`Timesheet no. ${approval.number} | ${exportStatus(approval.status)}`, true);
    paragraph(`Submitted by: ${approval.submittedBy} | ${day(approval.submittedAt)}`);
    paragraph(approval.status === 'signed' ? `Approved by: ${approval.approvedBy || '-'} | ${day(approval.approvedAt)}` : 'Waiting for approval');
    approval.comments.forEach(comment => paragraph(`Client comment: ${comment}`));
    if (needsPageBreak(y, 8)) newPage();
    doc.setDrawColor(PAPER.border); doc.line(16, y + 5, 95, y + 5); y += 12;
  });
  if (data.approvals?.length && data.timesheets.length) {
    paragraph('TIMESHEET SUMMARIES', true);
    data.timesheets.forEach(value => paragraph(value));
  }
  if (!data.approvals?.length) { if (needsPageBreak(y, 8)) newPage(); doc.setDrawColor(PAPER.border); doc.line(16, y + 5, 95, y + 5); }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setDrawColor(PAPER.border); doc.line(14, 277, 196, 277);
    text(meta.date, 14, 282, 8, PAPER.muted); text(`Page ${p} of ${pages}`, 196, 282, 8, PAPER.muted, false, 'right');
    text(wrap(TIMESHEET_DISCLAIMER, 182, 7), 14, 287, 7, PAPER.muted);
  }
  return doc;
}

const html = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Browser printing preserves Arabic shaping; never pass Arabic to Helvetica. */
function printArabicTimesheet(data: PdfData, page: Window) {
  const meta = metadata(data);
  const columns = tableColumns(data.rows);
  const widths = columnWidths(columns);
  const numericColumn = (index: number) => columns[index] === 'Hours' || columns[index] === 'Amount';
  const rows = buildDocumentRows(data.rows, data.groupByDay).map(row => `<tr class="${row.kind}">${row.cells.map(cell => `<td><bdi>${html(cell).replace(/\n/g, '<br>')}</bdi></td>`).join('')}</tr>`).join('');
  const approvals = data.approvals?.map(a => `<section><h3>Timesheet no. <bdi>${html(a.number)}</bdi> - ${exportStatus(a.status)}</h3><p>Submitted by: <bdi>${html(a.submittedBy)}</bdi> - ${day(a.submittedAt)}</p><p>${a.status === 'signed' ? `Approved by: <bdi>${html(a.approvedBy || '-')}</bdi> - ${day(a.approvedAt)}` : 'Waiting for approval'}</p>${a.comments.map(c => `<p>Client comment: <bdi>${html(c)}</bdi></p>`).join('')}<hr></section>`).join('') || '<section><p>Submitted by: -</p><p>Waiting for approval</p><hr></section>';
  page.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>timesheet-${html(data.ticketId.slice(0, 8))}</title><style>
    @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font:9pt Tahoma,Arial,sans-serif;color:${PAPER.ink};margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}header{background:${PAPER.primary};color:${PAPER.white};padding:10px;display:flex;justify-content:space-between;align-items:center}h1{font-size:18pt;margin:0}h3{font-size:9pt}.info,.cards{display:grid;gap:8px;margin:12px 0}.info{grid-template-columns:1fr 1fr;background:${PAPER.surface};padding:10px}.cards{grid-template-columns:repeat(4,1fr)}.cards div{background:${PAPER.surface};padding:8px}.cards strong{display:block;font-size:14pt;margin-top:5px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:${PAPER.primary};color:${PAPER.white}}th,td{padding:1mm;border-bottom:1px solid ${PAPER.border};vertical-align:top;overflow-wrap:anywhere}tr,section{break-inside:avoid}tr:nth-child(even){background:${PAPER.surface}}tr.total,tr.subtotal{background:${PAPER.subtotal};font-weight:bold}${columns.map((_, index) => numericColumn(index) ? `td:nth-child(${index + 1}),th:nth-child(${index + 1})` : '').filter(Boolean).join(',')}{text-align:right}.fees{background:${PAPER.surface};padding:8px;margin:12px 0}.fees p{display:flex;justify-content:space-between}footer{font-size:7pt;color:${PAPER.muted};margin-top:12px}@media print{footer{position:fixed;bottom:-10mm}}
    </style></head><body><header><h1>Timesheet</h1><strong>AI Support 360</strong></header><div class="info"><div><p>Consultant: <bdi>${html(meta.consultant)}</bdi></p><p>Client: <bdi>${html(data.clientName || '-')}</bdi></p><p>Request: <bdi>${html(data.ticketTitle)} | ${html(data.ticketId)}</bdi></p></div><div><p>Period: ${meta.period}</p><p>Status: ${meta.status}</p><p>Hourly rate: ${meta.rate}</p><p>Document date: ${meta.date}</p>${meta.number ? `<p>Timesheet no. ${html(meta.number)}</p>` : ''}</div></div><div class="cards">${[['Total hours', data.totals.totalHours.toFixed(2)], ['Entries', String(data.rows.length)], ['Hourly rate', meta.rate], ['Amount', money(data.totals.subtotal, data)]].map(([k,v]) => `<div>${k}<strong>${html(v)}</strong></div>`).join('')}</div><table><colgroup>${widths.map(w => `<col style="width:${w / 182 * 100}%">`).join('')}</colgroup><thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><div class="fees">${feeLines(data).map(([k,v]) => `<p><span>${html(k)}</span><strong>${html(v)}</strong></p>`).join('')}</div><p>Hours: ${data.totals.billableHours.toFixed(2)} billable | ${data.totals.nonBillableHours.toFixed(2)} not billable | ${data.totals.pendingRateHours.toFixed(2)} awaiting a rate</p>${data.rates.map(r => `<p><bdi>${html(r)}</bdi></p>`).join('')}<h3>Approval</h3>${approvals}${data.timesheets.map(value => `<p><bdi>${html(value)}</bdi></p>`).join('')}<footer>${meta.date} | ${TIMESHEET_DISCLAIMER}</footer></body></html>`);
  page.document.close(); page.focus(); setTimeout(() => page.print(), 300);
}

export async function downloadTimesheetPdf(data: PdfData): Promise<void> {
  if (ARABIC_TEXT.test(JSON.stringify(data))) {
    const page = window.open('', '_blank');
    if (!page) throw new Error('Allow pop-ups to print this timesheet.');
    printArabicTimesheet(data, page); return;
  }
  const { jsPDF: JsPdf } = await import('jspdf');
  renderTimesheetPdf(new JsPdf({ format: 'a4', orientation: 'portrait' }), data).save(`timesheet-${data.ticketId.substring(0, 8)}.pdf`);
}
