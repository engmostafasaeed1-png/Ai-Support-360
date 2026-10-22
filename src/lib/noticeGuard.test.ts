import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetNoticeGuard, acknowledgeInBackground, flushPendingAcks, isDismissed, markDismissed, markShown, pendingAcks, wasShown,
} from './noticeGuard';

beforeEach(() => { localStorage.clear(); __resetNoticeGuard(); });
afterEach(() => { vi.useRealTimers(); });

describe('notice device guard', () => {
  it('a notice counts as shown on this device as soon as it opened', () => {
    expect(wasShown('referral', 'a')).toBe(false);
    markShown('referral', ['a']);
    expect(wasShown('referral', 'a')).toBe(true);
    expect(isDismissed('referral', 'a')).toBe(false);
  });

  it('a dismissed notice stays dismissed after a reload (stored in localStorage) and per family', () => {
    markDismissed('referral', ['a']);
    __resetNoticeGuard(); // memory gone, as after a reload
    expect(isDismissed('referral', 'a')).toBe(true);
    expect(isDismissed('responsiveness', 'a')).toBe(false);
  });

  it('works without storage (blocked): memory keeps it closed for this visit', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    markDismissed('broadcast', ['x']);
    expect(isDismissed('broadcast', 'x')).toBe(true);
    spy.mockRestore();
  });

  it('the server acknowledgement is retried after 2 s, 10 s and 30 s, then stays pending for the next visit', async () => {
    vi.useFakeTimers();
    const ack = vi.fn(async () => { throw new Error('offline'); });
    markDismissed('referral', ['n1']);
    acknowledgeInBackground('referral', ['n1'], ack);
    await vi.advanceTimersByTimeAsync(0);
    expect(ack).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ack).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ack).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ack).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ack).toHaveBeenCalledTimes(4);
    expect(pendingAcks('referral')).toEqual(['n1']);

    const ok = vi.fn(async () => {});
    flushPendingAcks('referral', ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(ok).toHaveBeenCalledWith(['n1']);
    expect(pendingAcks('referral')).toEqual([]);
    expect(isDismissed('referral', 'n1')).toBe(true);
  });
});
