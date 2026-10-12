import { describe, expect, it } from 'vitest';
import { PAYOUT_DISCLAIMER_POINTS, PAYOUT_DISCLAIMER_VERSION, payoutCardState, payoutReady } from './payoutDisclaimer';

describe('payout disclaimer', () => {
  it('has version v1 and exactly five points', () => {
    expect(PAYOUT_DISCLAIMER_VERSION).toBe('v1');
    expect(PAYOUT_DISCLAIMER_POINTS).toHaveLength(5);
    expect(PAYOUT_DISCLAIMER_POINTS[1]).toContain('15 business days (Sunday to Thursday)');
  });

  it('derives the card state', () => {
    expect(payoutCardState(null)).toBe('missing');
    expect(payoutCardState({ acknowledged_at: null })).toBe('confirm');
    expect(payoutCardState({ acknowledged_at: '2026-10-01', acknowledged_version: 'v0' })).toBe('confirm');
    expect(payoutCardState({ acknowledged_at: '2026-10-01', acknowledged_version: 'v1' })).toBe('waiting');
    expect(payoutCardState({ acknowledged_at: '2026-10-01', acknowledged_version: 'v1', verified_at: '2026-10-02' })).toBe('verified');
    expect(payoutReady({ acknowledged_at: '2026-10-01', acknowledged_version: 'v1' })).toBe(true);
    expect(payoutReady({ acknowledged_at: null })).toBe(false);
  });
});
