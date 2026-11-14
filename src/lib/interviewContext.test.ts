import { describe, expect, it } from 'vitest';
import { compactInterviewContext, cachedInterviewSession, INTERVIEW_TURN_MAX_TOKENS } from '../../supabase/functions/_shared/interviewContext';
describe('bounded interview history', () => {
  it('keeps six recent messages verbatim and a short running summary', () => {
    const turns = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `[[q: ${i}]] ${'x'.repeat(500)}` }));
    const result = compactInterviewContext(turns);
    expect(result.recent).toEqual(turns.slice(-6));
    expect(result.summary.length).toBeLessThanOrEqual(1200);
    expect(result.summary).toContain('[[q: 73]]');
  });
  it('preserves previous summary when receiving only six recent messages', () => {
    expect(compactInterviewContext([{ role: 'user', content: 'Latest answer' }], 'Earlier SAP context').summary).toBe('Earlier SAP context');
  });
  it('caps live replies at 150 output tokens', () => { expect(INTERVIEW_TURN_MAX_TOKENS).toBe(150); });
  it('loads SAP context once per session without mixing sessions', async () => {
    let calls = 0;
    const load = async () => ({ area: ++calls === 1 ? 'FI' : 'MM' });
    expect(await cachedInterviewSession('session-a', load)).toEqual({ area: 'FI' });
    expect(await cachedInterviewSession('session-a', load)).toEqual({ area: 'FI' });
    expect(await cachedInterviewSession('session-b', load)).toEqual({ area: 'MM' });
    expect(calls).toBe(2);
  });
});