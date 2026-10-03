// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, reloadForNewVersion } from './staleChunkReload';

describe('isStaleChunkError', () => {
  it('recognises the browser messages for a missing lazy file', () => {
    expect(isStaleChunkError('Failed to fetch dynamically imported module: https://x.test/assets/Page-abc.js')).toBe(true);
    expect(isStaleChunkError('Importing a module script failed.')).toBe(true);
    expect(isStaleChunkError('error loading dynamically imported module')).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isStaleChunkError('Cannot read properties of undefined')).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('reloadForNewVersion', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('reloads once and then waits a minute', () => {
    const reload = vi.fn();
    expect(reloadForNewVersion(reload)).toBe(true);
    expect(reloadForNewVersion(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again after a minute', () => {
    const reload = vi.fn();
    sessionStorage.setItem('stale-chunk-reload-at', String(Date.now() - 61_000));
    expect(reloadForNewVersion(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
