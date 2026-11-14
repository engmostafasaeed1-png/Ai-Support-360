type Turn = { role: string; content: string };
const promptCache = new Map<string, { at: number; data: unknown }>();
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
export function compactInterviewContext(turns: Turn[]) {
  const recent = turns.slice(-12);
  const older = turns.slice(0, -12);
  const summary = older.map(m => `${m.role}: ${m.content.slice(0, 220)}`).join('\n').slice(-4000);
  return { recent, summary };
}