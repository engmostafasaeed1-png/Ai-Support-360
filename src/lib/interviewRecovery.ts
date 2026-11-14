/** Only transient HTTP failures receive one delayed retry. Terminal errors never do. */
export async function fetchInterviewTurn(run: () => Promise<Response>, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<Response> {
  const response = await run();
  if (response.status !== 429 && response.status < 500) return response;
  const body = await response.clone().json().catch(() => null);
  if (body?.retryable === false || body?.props?.retryable === false) return response;
  const seconds = Number(response.headers.get('Retry-After'));
  const date = Date.parse(response.headers.get('Retry-After') || '');
  const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.isFinite(date) ? Math.max(3000, date - Date.now()) : 3000 + Math.random() * 1000;
  // A long provider wait is left for an explicit later request, never retried early.
  if (delay > 60000) return response;
  await response.body?.cancel();
  await wait(delay);
  return run();
}