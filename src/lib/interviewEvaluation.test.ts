import { describe, expect, it } from 'vitest';
import { hasInterviewAnswers, validateInterviewEvaluation } from '../../supabase/functions/_shared/interviewEvaluation';

describe('interview evaluation validation', () => {
  it('requires three answered interviewer turns', () => {
    const pair = [{ role: 'assistant', content: 'SAP question' }, { role: 'user', content: 'My answer' }];
    expect(hasInterviewAnswers([...pair, ...pair])).toBe(false);
    expect(hasInterviewAnswers([...pair, ...pair, ...pair])).toBe(true);
    expect(hasInterviewAnswers(Array(3).fill({ role: 'user', content: 'Answer without a question' }))).toBe(false);
  });
  it('does not count empty answers', () => {
    expect(hasInterviewAnswers(Array(3).fill([{ role: 'assistant', content: 'Question' }, { role: 'user', content: '  ' }]).flat())).toBe(false);
  });
  it('accepts assessed scores and rounds them for persistence', () => {
    expect(validateInterviewEvaluation({ technical_score: 85.4, soft_skills_score: 70.2, overall_score: 80.6, summary: 'Assessment' }).overall_score).toBe(81);
  });
  it.each([undefined, NaN, -1, 101, '85'])('rejects an invalid score %s instead of awarding a fallback badge', score => {
    expect(() => validateInterviewEvaluation({ technical_score: 85, soft_skills_score: 70, overall_score: score, summary: 'Assessment' })).toThrow();
  });
  it('rejects missing assessment summaries', () => {
    expect(() => validateInterviewEvaluation({ technical_score: 85, soft_skills_score: 70, overall_score: 80, summary: ' ' })).toThrow();
  });
});