import { afterEach, describe, expect, it, vi } from 'vitest';
import { openNewTab } from './safeUrl';

describe('openNewTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an https URL in a new tab without the noopener feature and clears the opener', () => {
    const fakeWindow = { opener: 'this window' } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow);
    expect(openNewTab('https://meet.jit.si/ai-support-360-abc')).toBe(fakeWindow);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://meet.jit.si/ai-support-360-abc', '_blank');
    expect(fakeWindow.opener).toBeNull();
  });

  it('returns null when the browser blocks the popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openNewTab('https://example.com/')).toBeNull();
  });

  it('opens nothing for a value that is not an http(s) URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    expect(openNewTab('javascript:alert(1)')).toBeNull();
    expect(openNewTab('data:text/html,hi')).toBeNull();
    expect(openNewTab('')).toBeNull();
    expect(openNewTab(null)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
