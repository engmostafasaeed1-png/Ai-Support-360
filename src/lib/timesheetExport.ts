// The files of a timesheet: the CSV text and the download of a text file.
// A cell that starts with = + - @ would be run as a formula by a spreadsheet program: a quote is put in front of it.

import { buildDocumentRows, tableColumns } from './timesheetDocument';

export interface ExportRow {
  date: string;
  consultant: string;
  category: string;
  hours: number;
  billable: boolean;
  rate: number | null;
  amount: number | null;
  currency: string;
  timesheet: string;
  description: string;
  start?: string;
  end?: string;
}

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: ExportRow[]): string {
  const lines = buildDocumentRows(rows).map(r => r.cells.map(csvCell).join(','));
  return [tableColumns(rows).join(','), ...lines].join('\n');
}

/** Starts the download of a text file (with a byte order mark so that a spreadsheet program reads the letters right). */
export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const blob = new Blob([String.fromCharCode(0xfeff) + text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
