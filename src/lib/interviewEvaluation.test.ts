import { describe, expect, it } from 'vitest';
import { hasInterviewAnswers, validateInterviewEvaluation, validateScorecard, radarRows } from '../../supabase/functions/_shared/interviewEvaluation';

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
describe('scorecard validation', () => {
 const competencies = {technical_depth:90,troubleshooting:80,design_tradeoff:70,integration:60,communication:50,leadership:40};
 const question = {question_index:1,rubric:{accuracy:5,depth:4,practicality:3,clarity:2},strengths:['Concrete SAP example'],gaps:['Explain the trade-off'],ideal_answer:'I inspect ACDOCA and reconcile the ledger.'};
 it('accepts the question schema and six competencies', () => { expect(validateScorecard({competencies,questions:[question]},1).complete).toBe(true); });
 it('rejects out-of-range rubric values, preserving valid partial questions', () => { const result=validateScorecard({competencies,questions:[question,{...question,question_index:2,rubric:{...question.rubric,accuracy:6}}]},2); expect(result.questions).toHaveLength(1); expect(result.complete).toBe(false); });
 it('caps stronger answers at 120 words', () => { expect(validateScorecard({questions:[{...question,ideal_answer:Array(121).fill('SAP').join(' ')}]},1).questions[0].ideal_answer.split(' ')).toHaveLength(120); });
 it('maps all six radar axes to their concrete scores in stable order', () => { expect(radarRows(competencies,k=>k).map(r=>r.score)).toEqual([90,80,70,60,50,40]); });
 it('does not accept string scores or missing competencies', () => { expect(validateScorecard({competencies:{...competencies,leadership:'100'},questions:[question]},1).competencies).toBeNull(); });
});
