import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ plain: vi.fn(), create: vi.fn(), fire: vi.fn() }));

vi.mock('canvas-confetti', () => ({
  default: Object.assign(mocks.plain, { create: mocks.create }),
}));

const load = async () => (await import('./confetti')).fireConfetti;

beforeEach(() => {
  vi.resetModules();
  mocks.plain.mockReset();
  mocks.create.mockReset();
  mocks.fire.mockReset();
  mocks.create.mockReturnValue(mocks.fire);
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fireConfetti', () => {
  it('draws with an instance that does not use a web worker (the content security policy refuses workers made from a blob address)', async () => {
    const fireConfetti = await load();
    fireConfetti();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][1]).toEqual({ resize: true, useWorker: false });
    expect(mocks.fire).toHaveBeenCalled();
  });

  it('does not use the default instance of the library', async () => {
    const fireConfetti = await load();
    fireConfetti();
    expect(mocks.plain).not.toHaveBeenCalled();
  });

  it('makes the instance once, however often it is used', async () => {
    const fireConfetti = await load();
    fireConfetti();
    fireConfetti();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
