import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './withTimeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('passes the answer through when it comes in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('passes an error through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError when no answer comes', async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<number>(() => {}), 5000);
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(5000);
    await assertion;
  });
});
