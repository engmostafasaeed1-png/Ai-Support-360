import { describe, expect, it } from 'vitest';
import { compactInterviewContext } from '../../supabase/functions/_shared/interviewContext';
describe('bounded interview history', () => {
  it('keeps twelve recent turns verbatim and bounded older context', () => {
    const turns = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `[[q: ${i}]] ${'x'.repeat(500)}` }));
    const result = compactInterviewContext(turns);
    expect(result.recent).toEqual(turns.slice(-12));
    expect(result.summary.length).toBeLessThanOrEqual(4000);
    expect(result.summary).toContain('[[q: 67]]');
  });
});