type Turn = { role: string; content: string };
const promptCache = new Map<string, { at: number; data: unknown }>();
const sessionCache = new Map<string, { at: number; entries: Map<string, { at: number; data: Promise<unknown> }> }>();
export const INTERVIEW_TURN_MODEL = 'google/gemini-3.1-flash-lite';
export const INTERVIEW_TURN_MAX_TOKENS = 150;
export const INTERVIEW_RECENT_MESSAGES = 6;
export const INTERVIEW_SUMMARY_CHAR_LIMIT = 1200;
export const INTERVIEW_COMMENT_MAX_WORDS = 15;
export const interviewQuestionMaxWords = (style: string) => style === 'scenario' ? 50 : 30;
export function interviewReplyFormat(style: string) {
  return `HARD REPLY RULE (overrides all bank, plan, template and style instructions): at most ONE comment sentence of at most ${INTERVIEW_COMMENT_MAX_WORDS} words, followed by exactly ONE question of at most ${interviewQuestionMaxWords(style)} words. ${style === 'scenario' ? 'Any scenario setup must fit inside that 50-word question; ask only one thing at a time.' : 'No multi-clause scenario setup; ask one direct question, not several requests joined together.'} Never add explanations, answer rubrics, repeated introductions or question lists. Metadata tags do not count as words. The 150-token output limit is a safety cap only, not a target. Begin visible words immediately after required metadata tags.`;
}
/** Server-only, bounded ephemeral context; call only after fresh session ownership checks. Never store answers here. */
export async function cachedInterviewSession<T>(key: string, load: () => PromiseLike<T>, ttlMs = 30 * 60 * 1000): Promise<T> {
  const now = Date.now();
  // Group profile, prompts and plan under interview + consultant, not three quota slots.
  const sessionKey = key.split(':').slice(0, 2).join(':');
  for (const [id, session] of sessionCache) {
    if (now - session.at >= 30 * 60 * 1000) sessionCache.delete(id);
  }
  let session = sessionCache.get(sessionKey);
  const hit = session?.entries.get(key);
  if (hit && now - hit.at < ttlMs) return hit.data as Promise<T>;
  if (!session) {
    if (sessionCache.size >= 20) sessionCache.delete(sessionCache.keys().next().value ?? '');
    session = { at: now, entries: new Map() };
    sessionCache.set(sessionKey, session);
  }
  const data = Promise.resolve(load());
  session.entries.set(key, { at: now, data });
  try { return await data; } catch (error) { if (session.entries.get(key)?.data === data) session.entries.delete(key); throw error; }
}
export function invalidateInterviewSessionEntry(key: string): void {
  sessionCache.get(key.split(':').slice(0, 2).join(':'))?.entries.delete(key);
}
/** Only admin-authored static prompt material; never cache candidate profiles or answers. */
export async function cachedInterviewPrompt<T>(key: string, load: () => PromiseLike<T>): Promise<T> {
  const hit = promptCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.data as T;
  const result = await load();
  if (promptCache.size >= 40) promptCache.clear();
  promptCache.set(key, { at: Date.now(), data: result });
  return result;
}
/** Compact older context without a second AI call; preserve plan tags and recent verbatim replies. */
export function compactInterviewContext(turns: Turn[], previousSummary = '') {
  const recent = turns.slice(-INTERVIEW_RECENT_MESSAGES);
  const older = turns.slice(0, -INTERVIEW_RECENT_MESSAGES);
  const summary = [previousSummary, ...older.map(m => `${m.role}: ${m.content.slice(0, 180)}`)].filter(Boolean).join('\n').slice(-INTERVIEW_SUMMARY_CHAR_LIMIT);
  return { recent, summary };
}