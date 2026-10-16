import { describe, it, expect, vi } from 'vitest';
import { buildCsv, csvCell, downloadText, type ExportRow } from './timesheetExport';

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
    expect(lines[0]).toBe('#,Date,Activity / description,Hours,Amount,Status');
    expect(csv).toContain("1,2026-10-02,\"Analysed the posting error\nAnalysis | Mostaf Test | Billable | Rate: 50.00 USD\",1.50,75.00,Approved");
    expect(csv).toContain('Analysis | Mostaf Test | Not billable | Rate: pending USD');
    expect(csv).toContain(',,TOTAL,3.00,75.00,');
  });
  it('writes zero totals for no entries', () => {
    expect(buildCsv([]).split('\n')[1]).toBe(',,TOTAL,0.00,0.00,');
  });
  it('includes a single Time column only for complete times, with aligned totals', () => {
    const csv = buildCsv([row({ start: '09:00', end: '10:30' }), row()]);
    expect(csv.split('\n')[0]).toBe('#,Date,Activity / description,Time,Hours,Amount,Status');
    expect(csv).toContain(',09:00 - 10:30,1.50,75.00,Approved');
    expect(csv).toContain('\",,1.50,75.00,Approved');
    expect(csv).toContain(',,TOTAL,,3.00,150.00,');
  });
});

describe('downloadText', () => {
  it('adds the UTF-8 BOM and retains the object URL until after the download', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const create = vi.fn((_blob: Blob | MediaSource) => 'blob:timesheet');
    const revoke = vi.fn();
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      downloadText('timesheet-test.csv', buildCsv([row({ description: 'إصلاح' })]));
      const blob = create.mock.calls[0]?.[0] as unknown as Blob;
      const reader = new FileReader();
      const bytesPromise = new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => { if (reader.result instanceof ArrayBuffer) resolve(reader.result); else reject(new Error('Missing bytes')); };
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
      await vi.advanceTimersByTimeAsync(0);
      const bytes = await bytesPromise;
      expect([...new Uint8Array(bytes).slice(0, 3)]).toEqual([239, 187, 191]);
      expect(blob.type).toBe('text/csv;charset=utf-8');
      expect(click).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30_000);
      expect(revoke).toHaveBeenCalledWith('blob:timesheet');
    } finally {
      click.mockRestore(); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; vi.useRealTimers();
    }
  });
});
