// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LAZY_LOAD_FAILED_MESSAGE, loadWithRetry } from './lazyWithRetry';
import { isIgnoredMessage } from './errorReporter';

vi.mock('@/lib/errorReporter', async (orig) => {
  const actual = await orig<typeof import('./errorReporter')>();
  return { ...actual, reportError: vi.fn() };
});

const Page = () => null;

describe('loadWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('retries a rejected import and then resolves', async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module')).mockResolvedValue({ default: Page });
    const p = loadWithRetry(factory, 'A', vi.fn());
    await vi.advanceTimersByTimeAsync(300);
    await expect(p).resolves.toEqual({ default: Page });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('retries a module without a default export', async () => {
    const factory = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(undefined).mockResolvedValue({ default: Page });
    const p = loadWithRetry(factory as never, 'B', vi.fn());
    await vi.advanceTimersByTimeAsync(1200);
    await expect(p).resolves.toEqual({ default: Page });
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('reloads once after the retries, then throws the friendly error within 60 seconds', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('Importing a module script failed.'));
    const reload = vi.fn();
    void loadWithRetry(factory, 'C', reload);
    await vi.advanceTimersByTimeAsync(1200);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledTimes(1);

    const second = loadWithRetry(factory, 'C', reload);
    const assertion = expect(second).rejects.toThrow(LAZY_LOAD_FAILED_MESSAGE);
    await vi.advanceTimersByTimeAsync(1200);
    await assertion;
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBoundary and chunk errors', () => {
  function Boom({ message }: { message: string }): React.ReactElement {
    throw new Error(message);
  }

  it('shows the reload screen for a chunk error and does not report it', async () => {
    const { reportError } = await import('@/lib/errorReporter');
    const { default: ErrorBoundary } = await import('@/components/ErrorBoundary');
    vi.mocked(reportError).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom message="undefined is not an object (evaluating 'e._result.default')" /></ErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('still reports any other error', async () => {
    const { reportError } = await import('@/lib/errorReporter');
    const { default: ErrorBoundary } = await import('@/components/ErrorBoundary');
    vi.mocked(reportError).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom message="toFixed is not a function" /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ level: 'fatal', message: 'toFixed is not a function' }));
  });
});

describe('noise filter', () => {
  it('ignores chunk load messages but keeps real errors', () => {
    for (const m of [
      "undefined is not an object (evaluating 'e._result.default')",
      'Loading chunk 12 failed.',
      'ChunkLoadError: x',
      'error loading dynamically imported module',
    ]) expect(isIgnoredMessage(m), m).toBe(true);
    expect(isIgnoredMessage('relation does not exist')).toBe(false);
  });
});
