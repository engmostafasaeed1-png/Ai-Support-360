import { describe, it, expect } from 'vitest';
import { safeFileName } from '../storagePath';

describe('safeFileName', () => {
  it('keeps simple names and replaces spaces', () => {
    expect(safeFileName('Report Q1 2026.pdf')).toBe('Report_Q1_2026.pdf');
    expect(safeFileName('noext')).toBe('noext');
  });

  it('drops non-ASCII characters', () => {
    expect(safeFileName('شهادة SAP.pdf')).toBe('SAP.pdf');
    expect(safeFileName('شهادة.pdf')).toBe('file.pdf');
  });

  it('never produces path separators or dot-dot segments', () => {
    const out = safeFileName('../../etc/passwd');
    expect(out).not.toMatch(/[/\\]/);
    expect(out).not.toContain('..');
  });

  it('bounds the length', () => {
    expect(safeFileName('a'.repeat(200) + '.png').length).toBeLessThanOrEqual(91);
  });
});
