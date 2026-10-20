/** Credential-free entry guard for the hourly consultant profile reminder run (Feature B). */

export const RUN_GUARD_MS = 30 * 60_000;

export interface ReminderRunDependencies<Row> {
  /** Time of the most recent reminder claim (ms epoch), or null when none exists. */
  lastSentAt: () => Promise<number | null>;
  /** Service-role-only claim RPC (09:00 local gate, 20 h gap, 200 limit, admin flag live inside it). */
  claim: () => Promise<Row[]>;
  now: number;
}

export type ReminderRunResult<Row> =
  | { status: 'skipped'; rows: [] }
  | { status: 'claimed'; rows: Row[] }
  | { status: 'error'; rows: [] };

/** True when the previous run happened less than 30 minutes ago. */
export function recentRun(lastSentAt: number | null, now: number): boolean {
  return lastSentAt != null && now - lastSentAt >= 0 && now - lastSentAt < RUN_GUARD_MS;
}

export async function startReminderRun<Row>(deps: ReminderRunDependencies<Row>): Promise<ReminderRunResult<Row>> {
  try {
    if (recentRun(await deps.lastSentAt(), deps.now)) return { status: 'skipped', rows: [] };
    return { status: 'claimed', rows: await deps.claim() };
  } catch {
    return { status: 'error', rows: [] };
  }
}

/** Public response body: counts only, never user data or error text. */
export function reminderRunBody(result: ReminderRunResult<unknown>): { skipped: boolean; claimed: number; ok: boolean } {
  return { skipped: result.status === 'skipped', claimed: result.rows.length, ok: result.status !== 'error' };
}
