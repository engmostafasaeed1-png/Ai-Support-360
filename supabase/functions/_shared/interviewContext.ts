type Turn = { role: string; content: string };
const promptCache = new Map<string, { at: number; data: unknown }>();
const sessionCache = new Map<string, { at: number; data: Promise<unknown> }>();
export const INTERVIEW_TURN_MODEL = 'google/gemini-3.1-flash-lite';
export const INTERVIEW_TURN_MAX_TOKENS = 150;
export const INTERVIEW_RECENT_MESSAGES = 6;
export const INTERVIEW_SUMMARY_CHAR_LIMIT = 1200;
/** Server-only, bounded ephemeral context; call only after fresh session ownership checks. Never store answers here. */
export async function cachedInterviewSession<T>(key: string, load: () => PromiseLike<T>, ttlMs = 30 * 60 * 1000): Promise<T> {
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as Promise<T>;
  if (sessionCache.size >= 20) sessionCache.delete(sessionCache.keys().next().value ?? '');
  const data = Promise.resolve(load());
  sessionCache.set(key, { at: Date.now(), data });
  try { return await data; } catch (error) { sessionCache.delete(key); throw error; }
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