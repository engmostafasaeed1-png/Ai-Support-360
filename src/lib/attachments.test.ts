import { describe, it, expect } from 'vitest';
import { validateAttachment, checkAttachments, MAX_ATTACHMENT_BYTES } from './attachments';

const file = (name: string, type: string, size = 100) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateAttachment', () => {
  it('accepts a PDF', () => {
    expect(validateAttachment(file('a.pdf', 'application/pdf'))).toBeNull();
  });
  it('refuses an executable', () => {
    expect(validateAttachment(file('setup.exe', 'application/octet-stream'))).toMatch(/not allowed/);
  });
  it('refuses a file over 10 MB and accepts exactly 10 MB', () => {
    expect(validateAttachment(file('big.pdf', 'application/pdf', MAX_ATTACHMENT_BYTES + 1))).toMatch(/too large/);
    expect(validateAttachment(file('ok.pdf', 'application/pdf', MAX_ATTACHMENT_BYTES))).toBeNull();
  });
  it('says the size in bytes when the file is only just above the limit', () => {
    expect(validateAttachment(file('big.pdf', 'application/pdf', MAX_ATTACHMENT_BYTES + 1))).toBe(
      'big.pdf: 10,485,761 bytes is too large (the limit is 10 MB = 10,485,760 bytes).',
    );
    expect(validateAttachment(file('huge.pdf', 'application/pdf', 15 * 1048576))).toBe('huge.pdf: 15.0 MB is too large (the limit is 10 MB).');
  });
  it('accepts a log file that has no type', () => {
    expect(validateAttachment(file('app.log', ''))).toBeNull();
  });
  it('refuses an empty file and an unknown type', () => {
    expect(validateAttachment(file('empty.txt', 'text/plain', 0))).toMatch(/empty/);
    expect(validateAttachment(file('a.zip', 'application/zip'))).toMatch(/not allowed/);
  });
});

describe('checkAttachments', () => {
  it('splits accepted and refused files', () => {
    const r = checkAttachments([file('a.pdf', 'application/pdf'), file('b.exe', 'application/x-msdownload')]);
    expect(r.accepted).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
  });
});
