import { beforeEach, describe, expect, it } from 'vitest';
import { readAnswerDraft, reviseAnswer, saveAnswerDraft, validAnswer, type InterviewReply } from './interviewReply';
describe('editable interview answers', () => {
  beforeEach(() => localStorage.clear());
  it('keeps drafts across reloads, scoped to the interview', () => {
    saveAnswerDraft('one', 'مسودة SAP\nMore details');
    expect(readAnswerDraft('one')).toBe('مسودة SAP\nMore details');
    expect(readAnswerDraft('two')).toBe('');
  });
  it('blocks empty and fewer than three trimmed characters', () => {
    expect(validAnswer('  ')).toBe(false); expect(validAnswer('ab')).toBe(false); expect(validAnswer('SAP')).toBe(true);
  });
  const history: InterviewReply[] = [{ role: 'assistant', content: 'Question?' }, { role: 'user', content: 'Old answer' }, { role: 'assistant', content: 'Pending question' }];
  it('edits the last answer and cancels its pending follow-up', () => {
    expect(reviseAnswer(history, 'Corrected')).toEqual([history[0], { role: 'user', content: 'Corrected' }]);
  });
  it('appends clarification to the same answer, not a new turn', () => {
    expect(reviseAnswer(history, 'Extra detail', true)).toEqual([history[0], { role: 'user', content: 'Old answer\n\nExtra detail' }]);
  });
});