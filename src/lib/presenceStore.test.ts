import { describe, it, expect, vi, beforeEach } from 'vitest';
import { presenceStore } from './presenceStore';

beforeEach(() => {
  presenceStore.set(null);
});

describe('presenceStore', () => {
  it('does not know who is present at the start', () => {
    expect(presenceStore.get()).toBeNull();
  });

  it('keeps what it was given', () => {
    presenceStore.set(new Set(['c-1', 'c-2']));
    expect(Array.from(presenceStore.get() ?? []).sort()).toEqual(['c-1', 'c-2']);
  });

  it('tells the readers when something changed', () => {
    const listener = vi.fn();
    const stop = presenceStore.subscribe(listener);
    presenceStore.set(new Set(['c-1']));
    presenceStore.set(new Set(['c-1', 'c-2']));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not tell the readers when the same consultants are given again', () => {
    presenceStore.set(new Set(['c-1', 'c-2']));
    const listener = vi.fn();
    const stop = presenceStore.subscribe(listener);
    presenceStore.set(new Set(['c-2', 'c-1']));
    presenceStore.set(presenceStore.get());
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('tells the difference between nobody is present and it is not known', () => {
    const listener = vi.fn();
    const stop = presenceStore.subscribe(listener);
    presenceStore.set(new Set());
    expect(presenceStore.get()?.size).toBe(0);
    presenceStore.set(null);
    expect(presenceStore.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops telling a reader that has unsubscribed', () => {
    const listener = vi.fn();
    const stop = presenceStore.subscribe(listener);
    stop();
    presenceStore.set(new Set(['c-1']));
    expect(listener).not.toHaveBeenCalled();
  });
});
