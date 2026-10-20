import { describe, expect, it, vi } from 'vitest';
import { RUN_GUARD_MS, recentRun, reminderRunBody, startReminderRun } from '../../supabase/functions/_shared/profileReminderRun';

const NOW = 1_800_000_000_000;
const row = { consultant_id: 'c1', user_id: 'u1', percent: 40, missing: ['bio'] };

describe('profile reminder run guard', () => {
  it('ignores a call within 30 minutes of the previous run without claiming', async () => {
    const claim = vi.fn(async () => [row]);
    const result = await startReminderRun({ now: NOW, lastSentAt: async () => NOW - 29 * 60_000, claim });
    expect(result.status).toBe('skipped');
    expect(claim).not.toHaveBeenCalled();
  });

  it('claims when the previous run is 30 minutes or older, or none exists', async () => {
    const claim = vi.fn(async () => [row]);
    expect((await startReminderRun({ now: NOW, lastSentAt: async () => NOW - RUN_GUARD_MS, claim })).status).toBe('claimed');
    expect((await startReminderRun({ now: NOW, lastSentAt: async () => null, claim })).status).toBe('claimed');
    expect(claim).toHaveBeenCalledTimes(2);
    expect(recentRun(NOW - 31 * 60_000, NOW)).toBe(false);
  });

  it('returns counts only, never user data or error text', async () => {
    const ok = await startReminderRun({ now: NOW, lastSentAt: async () => null, claim: async () => [row, row] });
    const body = reminderRunBody(ok);
    expect(body).toEqual({ skipped: false, claimed: 2, ok: true });
    expect(JSON.stringify(body)).not.toMatch(/u1|c1|bio/);

    const failed = await startReminderRun({ now: NOW, lastSentAt: async () => null, claim: async () => { throw new Error('secret detail'); } });
    expect(reminderRunBody(failed)).toEqual({ skipped: false, claimed: 0, ok: false });
  });
});
