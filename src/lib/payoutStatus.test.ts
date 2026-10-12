import { describe, expect, it } from 'vitest';
import { payoutStateFor, payoutStatusMap } from './payoutStatus';

describe('admin payout status map', () => {
  it('maps rows by consultant id and treats unknown as missing', () => {
    const m = payoutStatusMap([
      { consultant_id: 'a', state: 'verified', acknowledged: true, updated_at: null },
      { consultant_id: 'b', state: 'waiting', acknowledged: true, updated_at: null },
      { consultant_id: 'c', state: 'missing', acknowledged: false, updated_at: null },
    ]);
    expect(payoutStateFor(m, 'a')).toBe('verified');
    expect(payoutStateFor(m, 'b')).toBe('waiting');
    expect(payoutStateFor(m, 'c')).toBe('missing');
    expect(payoutStateFor(m, 'z')).toBe('missing');
    expect(payoutStatusMap(null).size).toBe(0);
  });
});
