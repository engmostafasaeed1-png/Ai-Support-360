import { describe, expect, it } from 'vitest';
import { asciiText, buildDocumentRows, needsPageBreak, rowTotals, tableRowHeight, truncateLines } from './timesheetDocument';
import { buildCsv, csvCell, type ExportRow } from './timesheetExport';

const row = (over: Partial<ExportRow> = {}): ExportRow => ({ date: '2026-10-16', consultant: 'Mostafa', category: 'Support', description: 'Fix posting error', hours: 1.25, rate: 80, amount: 100, billable: true, currency: 'USD', timesheet: 'Approved', ...over });

describe('timesheet document model', () => {
  it('uses saved amounts, not hours multiplied by the current rate', () => {
    const rows = [row({ amount: 90 }), row({ billable: false, amount: 0 }), row({ rate: null, amount: null })];
    expect(rowTotals(rows)).toEqual({ hours: 3.75, amount: 90 });
    const model = buildDocumentRows(rows);
    expect(model[0].cells).toEqual(['1', '2026-10-16', 'Fix posting error\nSupport | Mostafa | Billable | Rate: 80.00 USD', '-', '-', '1.25', '90.00', 'Approved']);
    expect(model[2].cells[6]).toBe('Pending');
    expect(model[3].cells[5]).toBe('3.75');
    expect(model[3].cells[6]).toBe('90.00');
  });
  it('adds day subtotals only when grouping is enabled and the day has multiple entries', () => {
    const rows = [row(), row({ date: '2026-10-15' }), row({ hours: 2, amount: 160 })];
    expect(buildDocumentRows(rows).filter(r => r.kind === 'subtotal')).toHaveLength(0);
    const subtotal = buildDocumentRows(rows, true).filter(r => r.kind === 'subtotal');
    expect(subtotal).toHaveLength(1);
    expect(subtotal[0].hours).toBe(3.25);
    expect(subtotal[0].amount).toBe(260);
  });
  it('preserves existing times instead of inventing them', () => {
    expect(buildDocumentRows([row({ start: '09:00', end: '10:15' })])[0].cells.slice(3, 5)).toEqual(['09:00', '10:15']);
    expect(buildDocumentRows([row()])[0].cells.slice(3, 5)).toEqual(['-', '-']);
  });
  it('uses ISO dates and dot-decimal hours in CSV', () => {
    expect(buildCsv([row({ date: '2026-10-16T00:00:00Z' })])).toContain('2026-10-16');
    expect(buildCsv([row()])).toContain(',1.25,100.00,Approved');
  });
  it('escapes multiline text and neutralizes spreadsheet formulas in descriptions', () => {
    expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
    for (const prefix of ['=', '+', '-', '@']) expect(buildCsv([row({ description: `${prefix}danger` })])).toContain(`"'${prefix}danger`);
    expect(csvCell('He said "yes"\nnext')).toBe('"He said ""yes""\nnext"');
    expect(buildCsv([row({ description: 'إصلاح' })])).toContain('إصلاح');
  });
  it('truncates measured lines at three, with a fitting ASCII ellipsis', () => {
    expect(truncateLines(['first', 'second', '12345678', 'fourth'], 3, 8)).toEqual(['first', 'second', '12345...']);
    expect(truncateLines(['one', 'two'])).toEqual(['one', 'two']);
    expect(asciiText('Café – fix')).toBe('Cafe - fix');
  });
  it('keeps rows intact at page boundaries with 1 mm cell padding', () => {
    expect(tableRowHeight([1, 3, 2])).toBe(14);
    expect(tableRowHeight([1])).toBe(8);
    expect(needsPageBreak(256, 14)).toBe(false);
    expect(needsPageBreak(257, 14)).toBe(true);
  });
});