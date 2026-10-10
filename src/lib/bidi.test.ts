import { describe, it, expect } from 'vitest';
import { isolateDates } from './bidi';

describe('isolateDates', () => {
  it('puts an isolate around a date', () => {
    const out = isolateDates('due 2026-10-09 please');
    expect(out).toContain('2026-10-09');
    expect(out.length).toBe('due 2026-10-09 please'.length + 2);
  });
  it('leaves text without a date as it is', () => {
    expect(isolateDates('no date here')).toBe('no date here');
  });
  it('accepts an empty value', () => {
    expect(isolateDates(null)).toBe('');
    expect(isolateDates(undefined)).toBe('');
  });
});
