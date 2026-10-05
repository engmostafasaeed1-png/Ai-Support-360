import { describe, it, expect } from 'vitest';
import { buildCsv, csvCell, type ExportRow } from './timesheetExport';

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  date: '2026-10-02', consultant: 'Mostaf Test', category: 'Analysis', hours: 1.5, billable: true, rate: 50, amount: 75,
  currency: 'USD', timesheet: 'Approved', description: 'Analysed the posting error', ...over,
});

describe('csvCell', () => {
  it('leaves plain text and numbers as they are', () => {
    expect(csvCell('Analysis')).toBe('Analysis');
    expect(csvCell(75)).toBe('75');
    expect(csvCell(null)).toBe('');
  });
  it('quotes text with a comma, a quote or a line break', () => {
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
  });
  it('puts a quote in front of text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+49 170')).toBe("'+49 170");
    expect(csvCell('-bullet')).toBe("'-bullet");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('buildCsv', () => {
  it('writes the header and one line per entry', () => {
    const csv = buildCsv([row(), row({ billable: false, rate: null, amount: 0, description: 'Training, internal', timesheet: 'Not sent yet' })]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Consultant,Category,Hours,Billable,Rate,Amount,Currency,Timesheet,Description');
    expect(lines[1]).toBe('2026-10-02,Mostaf Test,Analysis,1.5,Yes,50,75,USD,Approved,Analysed the posting error');
    expect(lines[2]).toBe('2026-10-02,Mostaf Test,Analysis,1.5,No,,0,USD,Not sent yet,"Training, internal"');
  });
  it('writes only the header for no entries', () => {
    expect(buildCsv([]).split('\n')).toHaveLength(1);
  });
});
