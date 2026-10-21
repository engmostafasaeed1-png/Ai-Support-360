// Which account an admin action targets. `user_id` is the contract; `userId` and `id` are accepted as aliases
// only when they are UUIDs and `user_id` was not sent. A `user_id` that is sent but invalid is always refused,
// so a wrong id can never fall through to another key. Pure (no Deno imports) so the app's tests cover it.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BAD_USER_MESSAGE = 'This account could not be identified. Close the account panel, open it again and retry.';

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v.trim());
const given = (v: unknown) => v !== undefined && v !== null && v !== '';

export function targetUserId(body: unknown): string | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (given(b.user_id)) return isUuid(b.user_id) ? b.user_id.trim() : null;
  for (const alias of ['userId', 'id']) if (isUuid(b[alias])) return (b[alias] as string).trim();
  return null;
}
