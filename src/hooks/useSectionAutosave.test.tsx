import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changedFields, useSectionAutosave } from './useSectionAutosave';
describe('profile section saving safety', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('debounces 4 seconds after the last change, not on an interval', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ value }) => useSectionAutosave({ values: { name: value, city: 'Riyadh' }, ready: true, persist }), { initialProps: { value: 'Saved' } });
    view.rerender({ value: 'First' }); await act(() => vi.advanceTimersByTimeAsync(3000));
    view.rerender({ value: 'Last' }); await act(() => vi.advanceTimersByTimeAsync(3999)); expect(persist).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1)); expect(persist).toHaveBeenCalledExactlyOnceWith({ name: 'Last' });
  });
  it('sends dirty fields only, including intentional optional clears', () => {
    expect(changedFields({ name: 'New', city: '', bio: 'Unchanged' }, { name: 'Old', city: 'Riyadh', bio: 'Unchanged' })).toEqual({ name: 'New', city: '' });
  });
  it('never saves before data arrives or writes initial empty values on load', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ ready, name }) => useSectionAutosave({ values: { name }, ready, persist }), { initialProps: { ready: false, name: '' } });
    await act(() => vi.advanceTimersByTimeAsync(10000)); expect(persist).not.toHaveBeenCalled();
    view.rerender({ ready: true, name: 'Loaded' }); await act(() => vi.advanceTimersByTimeAsync(10000)); expect(persist).not.toHaveBeenCalled();
  });
  it('invalid required fields remain unsaved', async () => {
    const persist = vi.fn();
    const view = renderHook(({ name }) => useSectionAutosave({ values: { name }, ready: true, persist, validate: patch => patch.name === '' ? 'Required' : null }), { initialProps: { name: 'Loaded' } });
    view.rerender({ name: '' }); await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(persist).not.toHaveBeenCalled(); expect(view.result.current.dirty).toBe(true); expect(view.result.current.error).toBe('Required');
  });
  it('queues one follow-up and does not acknowledge edits made during a save', async () => {
    let finish: (() => void) | undefined;
    const persist = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const view = renderHook(({ name }) => useSectionAutosave({ values: { name }, ready: true, persist }), { initialProps: { name: 'Saved' } });
    view.rerender({ name: 'First' }); await act(() => vi.advanceTimersByTimeAsync(4000));
    view.rerender({ name: 'Second' }); await act(() => vi.advanceTimersByTimeAsync(4000)); expect(persist).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.(); await Promise.resolve(); });
    expect(persist).toHaveBeenCalledTimes(2); expect(persist).toHaveBeenLastCalledWith({ name: 'Second' });
  });
  it('never shows a manual dialog on autosave', async () => {
    const beforeManual = vi.fn(); const persist = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ name }) => useSectionAutosave({ values: { name }, ready: true, persist, beforeManual }), { initialProps: { name: 'Saved' } });
    view.rerender({ name: 'New' }); await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(beforeManual).not.toHaveBeenCalled(); expect(persist).toHaveBeenCalledTimes(1);
  });
  it('manual-only sensitive sections never autosave or flush automatically', async () => {
    const persist = vi.fn();
    const view = renderHook(({ name }) => useSectionAutosave({ values: { name }, ready: true, automatic: false, persist }), { initialProps: { name: 'Saved' } });
    view.rerender({ name: 'New' }); await act(() => vi.advanceTimersByTimeAsync(8000));
    await act(async () => { window.dispatchEvent(new Event('profile-section-change')); }); expect(persist).not.toHaveBeenCalled();
  });
});
