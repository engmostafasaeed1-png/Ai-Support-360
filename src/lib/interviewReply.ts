export type InterviewReply = { role: 'user' | 'assistant'; content: string };
export const MIN_ANSWER_CHARS = 3;
export const validAnswer = (text: string) => text.trim().length >= MIN_ANSWER_CHARS;
export function reviseAnswer(history: InterviewReply[], text: string, append = false): InterviewReply[] {
  let index = history.length - 1;
  while (index >= 0 && history[index].role !== 'user') index--;
  if (index < 0) return [...history, { role: 'user', content: text.trim() }];
  return [...history.slice(0, index), { role: 'user', content: append ? `${history[index].content}\n\n${text.trim()}` : text.trim() }];
}
export const draftKey = (interviewId: string) => `interview-answer-draft:${interviewId}`;
export function readAnswerDraft(id: string): string {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(id)) || 'null');
    return saved && typeof saved.text === 'string' && Date.now() - saved.at < 86400000 ? saved.text.slice(0, 16000) : '';
  } catch { return ''; }
}
export function saveAnswerDraft(id: string, text: string) {
  try { if (text) localStorage.setItem(draftKey(id), JSON.stringify({ text: text.slice(0, 16000), at: Date.now() })); else localStorage.removeItem(draftKey(id)); } catch { /* Storage unavailable: keep the in-memory draft. */ }
}