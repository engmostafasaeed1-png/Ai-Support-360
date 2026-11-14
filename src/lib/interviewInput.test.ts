import { describe, expect, it } from 'vitest';
import { validInterviewMessage } from '../../supabase/functions/_shared/interviewInput';
describe('interview transcript replay', () => {
  it('accepts the 4077-character interviewer reply that blocked this session', () => {
    expect(validInterviewMessage('a'.repeat(4077))).toBe(true);
  });
  it('retains a bounded 16000-character input limit', () => {
    expect(validInterviewMessage('a'.repeat(16000))).toBe(true);
    expect(validInterviewMessage('a'.repeat(16001))).toBe(false);
  });
});