import { beforeEach, describe, expect, it } from 'vitest';
import { isStaleChunkError, reloadForNewVersion, reloadJustStarted } from './staleChunkReload';

describe('stale chunk errors', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("also knows the error that follows a prevented failed load (reading 'default')", () => {
    expect(isStaleChunkError("Cannot read properties of undefined (reading 'default')")).toBe(true);
    expect(isStaleChunkError('Failed to fetch dynamically imported module: https://example.com/assets/a.js')).toBe(true);
    expect(isStaleChunkError("Cannot read properties of undefined (reading 'name')")).toBe(false);
  });

  it('knows that a reload was just started', () => {
    expect(reloadJustStarted()).toBe(false);
    let reloads = 0;
    expect(reloadForNewVersion(() => { reloads += 1; })).toBe(true);
    expect(reloads).toBe(1);
    expect(reloadJustStarted()).toBe(true);
    expect(reloadForNewVersion(() => { reloads += 1; })).toBe(false);
    expect(reloads).toBe(1);
  });
});
