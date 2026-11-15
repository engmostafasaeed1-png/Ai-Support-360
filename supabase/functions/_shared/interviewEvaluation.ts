import { COMPETENCIES, type Competency } from './interviewCoverage.ts';
export function validateInterviewEvaluation(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid interview evaluation');
  const row = value as Record<string, unknown>;
  for (const key of ['technical_score', 'soft_skills_score', 'overall_score']) {
    const score = row[key];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid interview score');
  }
  if (typeof row.summary !== 'string' || !row.summary.trim()) throw new Error('Missing interview summary');
  return { ...row, technical_score: Math.round(Number(row.technical_score)), soft_skills_score: Math.round(Number(row.soft_skills_score)), overall_score: Math.round(Number(row.overall_score)), summary: row.summary.trim() };
}

export function hasInterviewAnswers(messages: { role: string; content: string }[]): boolean {
  let question = false;
  let answers = 0;
  for (const message of messages) {
    if (!message.content.trim()) continue;
    if (message.role === 'assistant') question = true;
    else if (message.role === 'user' && question) { answers++; question = false; }
  }
  return answers >= 3;
}
export const RUBRIC_KEYS = ['accuracy', 'depth', 'practicality', 'clarity'] as const;
export interface QuestionScore {
  question_index: number;
  rubric: Record<typeof RUBRIC_KEYS[number], number>;
  strengths: string[];
  gaps: string[];
  ideal_answer: string;
}
export type CompetencyScores = Record<Competency, number>;
const scoreInRange = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
export function validateScorecard(value: unknown, maxQuestions = 60) {
  const r = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const competencies = r.competencies && typeof r.competencies === 'object' && COMPETENCIES.every(k => scoreInRange((r.competencies as Record<string, unknown>)[k], 100)) ? r.competencies as CompetencyScores : null;
  const questions: QuestionScore[] = [];
  const seen = new Set<number>();
  for (const raw of Array.isArray(r.questions) ? r.questions.slice(0, 60) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const q = raw as QuestionScore;
    if (!Number.isInteger(q.question_index) || q.question_index < 1 || q.question_index > maxQuestions || seen.has(q.question_index) || !q.rubric || !RUBRIC_KEYS.every(k => scoreInRange(q.rubric[k], 5)) || !Array.isArray(q.strengths) || !q.strengths.every(x => typeof x === 'string') || !Array.isArray(q.gaps) || !q.gaps.every(x => typeof x === 'string') || typeof q.ideal_answer !== 'string' || !q.ideal_answer.trim()) continue;
    seen.add(q.question_index);
    questions.push({ question_index: q.question_index, rubric: Object.fromEntries(RUBRIC_KEYS.map(k => [k, q.rubric[k]])) as QuestionScore['rubric'], strengths: q.strengths.slice(0, 6).map(x => x.slice(0, 400)), gaps: q.gaps.slice(0, 6).map(x => x.slice(0, 400)), ideal_answer: q.ideal_answer.trim().split(/\s+/u).slice(0, 120).join(' ') });
  }
  return { competencies, questions, complete: !!competencies && questions.length === maxQuestions };
}
export function radarRows(scores: CompetencyScores, label: (key: Competency) => string) {
  return COMPETENCIES.map(key => ({ key, label: label(key), score: scores[key], fullMark: 100 }));
}
