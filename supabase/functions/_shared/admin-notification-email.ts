export const MAX_ATTEMPTS = 5;
export const ADMIN_HOURLY_LIMIT = 30;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function safeAdminLink(link?: string | null): string | undefined {
  if (!link || (!link.startsWith('/') && !link.startsWith('https://www.aisupport360.com/'))) return;
  try {
    const url = new URL(link, 'https://www.aisupport360.com');
    if (url.origin !== 'https://www.aisupport360.com' || url.username || url.password) return;
    return url.href;
  } catch { return; }
}
export function adminSubject(title: string): string {
  return `[AI Support 360 admin] ${title.replace(/[\r\n]/g, ' ')}`;
}
export function canAttempt(attempts: number): boolean { return attempts >= 0 && attempts < MAX_ATTEMPTS; }
export function rememberNotification(seen: Map<string, number>, id: string, now: number): boolean {
  for (const [key, time] of seen) if (now - time >= 600_000) seen.delete(key);
  if (seen.has(id)) return false;
  if (seen.size >= 500) {
    const first = seen.keys().next().value;
    if (first) seen.delete(first);
  }
  seen.set(id, now);
  return true;
}
export interface AdminMailClaim { id: string; user_id: string; title: string; body: string | null; link: string | null; attempt: number }
export interface AdminMailDependencies {
  claim: () => Promise<AdminMailClaim | null>;
  send: (row: AdminMailClaim) => Promise<{ sent: boolean; reason?: string }>;
  finish: (row: AdminMailClaim, handled: boolean, error: string | null) => Promise<void>;
  wait: (ms: number) => Promise<void>;
}
/** One event, one recipient; bounded retries reuse the same managed idempotency key. */
export async function deliverAdminNotification(deps: AdminMailDependencies): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const row = await deps.claim();
    if (!row) return;
    let result: { sent: boolean; reason?: string };
    try { result = await deps.send(row); }
    catch (error) {
      const failure = error as { code?: string; status?: number; retryAfterSeconds?: number };
      await deps.finish(row, false, failure.code || 'email send failed');
      if (row.attempt >= MAX_ATTEMPTS || failure.code === 'domain_not_verified' || failure.code === 'emails_disabled') return;
      const delay = failure.status === 429 ? (failure.retryAfterSeconds ?? 60) * 1000 : 1000 * 2 ** i;
      await deps.wait(delay);
      continue;
    }
    // Suppression and disabled switches are terminal, never retried or counted as sent.
    await deps.finish(row, true, result.sent ? null : result.reason || 'recipient_suppressed');
    return;
  }
}