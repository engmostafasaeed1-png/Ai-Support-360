import { questionHash, stripPlanTags } from './interviewPlan.ts';
export const COMPETENCIES = ['technical_depth', 'troubleshooting', 'design_tradeoff', 'integration', 'communication', 'leadership'] as const;
export type Competency = typeof COMPETENCIES[number];
export interface CoverageState {
  covered: Record<Competency, 0 | 1 | 2>;
  askedQuestionHashes: string[];
  vagueStreak: number;
  followUpsUsed: number;
}
export const emptyCoverage = (): CoverageState => ({ covered: Object.fromEntries(COMPETENCIES.map(k => [k, 0])) as CoverageState['covered'], askedQuestionHashes: [], vagueStreak: 0, followUpsUsed: 0 });
export function parseCoverage(raw: unknown): CoverageState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as CoverageState;
  if (!r.covered || !COMPETENCIES.every(k => [0, 1, 2].includes(r.covered[k])) || !Array.isArray(r.askedQuestionHashes) || r.askedQuestionHashes.length > 120 || !r.askedQuestionHashes.every(h => typeof h === 'string' && /^[a-f0-9]{14}$/.test(h)) || !Number.isInteger(r.vagueStreak) || r.vagueStreak < 0 || !Number.isInteger(r.followUpsUsed) || r.followUpsUsed < 0 || r.followUpsUsed > 2) return null;
  return { covered: { ...r.covered }, askedQuestionHashes: [...r.askedQuestionHashes], vagueStreak: r.vagueStreak, followUpsUsed: r.followUpsUsed };
}
export function vagueAnswer(answer: string): boolean {
  const words = answer.trim().split(/\s+/u).filter(Boolean);
  const sap = /\b(?:SAP|[A-Z]{2,5}\d{2,4}[A-Z]?|ACDOCA|BKPF|BSEG|MARA|VBAK|BAdI|SPRO|IMG|SE\d{2}|SM\d{2}|ST\d{2}|S\/?4HANA|ECC|EHP\d|FPS\d|release|table|t-code|transaction|configuration|config\s+path)\b|\w+\s*(?:→|->|>)\s*\w+|\b20(?:1\d|2\d)\b|إصدار|جدول|مسار\s+الإعداد/iu;
  return words.length < 25 && !sap.test(answer);
}
export function competencyFor(kind: string): Competency {
  return ({ troubleshooting: 'troubleshooting', design: 'design_tradeoff', integration: 'integration', soft_skill: 'communication', leadership: 'leadership' } as Record<string, Competency>)[kind] ?? 'technical_depth';
}
export function advanceCoverage(state: CoverageState, answer: string, competency: Competency) {
  const next = parseCoverage(state) ?? emptyCoverage();
  if (vagueAnswer(answer)) {
    next.vagueStreak++;
    if (next.followUpsUsed < 2) { next.followUpsUsed++; return { state: next, action: 'probe' as const }; }
    next.followUpsUsed = 0;
    return { state: next, action: 'move_on' as const };
  }
  next.covered[competency] = Math.min(2, next.covered[competency] + 1) as 1 | 2;
  next.vagueStreak = 0; next.followUpsUsed = 0;
  return { state: next, action: 'next' as const };
}
export function rememberQuestion(state: CoverageState, question: string): CoverageState {
  return { ...state, askedQuestionHashes: [...state.askedQuestionHashes, questionHash(stripPlanTags(question))].slice(-120) };
}
export function selectFreshQuestion(modelQuestion: string, planned: readonly string[], state: CoverageState): string | null {
  const asked = new Set(state.askedQuestionHashes);
  return [modelQuestion, ...planned].find(q => q.trim() && !asked.has(questionHash(stripPlanTags(q)))) ?? null;
}
export function probeQuestion(used: number, lang: string, planNumber: number): string {
  const options = lang.startsWith('ar') ? ['ما المثال العملي المحدد الذي يوضح إجابتك؟', 'ما اسم الكائن الدقيق والخطوة التي نفذتها بنفسك؟'] : ['What concrete example demonstrates your answer?', 'Which exact object and step did you personally use?'];
  return `[[q: ${planNumber}]] ${options[Math.max(0, Math.min(1, used - 1))]}`;
}
export function rebuildCoverage(answers: readonly { question: string; answer_transcript: string | null }[]): CoverageState {
  let state = emptyCoverage();
  for (const row of answers) { state = rememberQuestion(state, row.question); state = advanceCoverage(state, row.answer_transcript ?? '', competencyFor(/troubleshoot|diagnos/i.test(row.question) ? 'troubleshooting' : 'technical')).state; }
  return state;
}
