import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';
import { readScrollPosition, saveScrollPosition, scrollActionFor } from '@/lib/scrollUtils';

let nav: NavigateFunction;
function Grab() {
  nav = useNavigate();
  return null;
}

function scrollWindowTo(y: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

describe('scroll restoration on route changes', () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 10000 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const setup = () =>
    render(
      <MemoryRouter initialEntries={['/a']}>
        <ScrollToTop />
        <Grab />
      </MemoryRouter>,
    );

  it('starts a new page at the top', () => {
    setup();
    scrollWindowTo(800);
    act(() => nav('/b'));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it('keeps the position when only the query changes (tabs/filters inside a page)', () => {
    setup();
    scrollWindowTo(800);
    scrollTo.mockClear();
    act(() => nav('/a?tab=history'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('restores the earlier position on back', () => {
    vi.useFakeTimers();
    setup();
    scrollWindowTo(1234);
    act(() => nav('/b'));
    scrollWindowTo(0);
    scrollTo.mockClear();
    act(() => nav(-1));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1234 }));
  });
});

describe('scrollActionFor', () => {
  it('maps navigation types to actions', () => {
    expect(scrollActionFor({ navType: 'PUSH', pathChanged: true, hash: '', saved: 300 })).toEqual({ kind: 'top' });
    expect(scrollActionFor({ navType: 'PUSH', pathChanged: false, hash: '', saved: null })).toEqual({ kind: 'keep' });
    expect(scrollActionFor({ navType: 'POP', pathChanged: true, hash: '', saved: 300 })).toEqual({ kind: 'restore', y: 300 });
    expect(scrollActionFor({ navType: 'POP', pathChanged: true, hash: '', saved: null })).toEqual({ kind: 'top' });
    expect(scrollActionFor({ navType: 'PUSH', pathChanged: true, hash: '#faq', saved: null })).toEqual({ kind: 'hash' });
  });

  it('keeps only the newest 50 history entries', () => {
    sessionStorage.clear();
    for (let i = 0; i < 60; i++) saveScrollPosition(`k${i}`, i * 10);
    expect(readScrollPosition('k0')).toBeNull();
    expect(readScrollPosition('k9')).toBeNull();
    expect(readScrollPosition('k10')).toBe(100);
    expect(readScrollPosition('k59')).toBe(590);
  });
});
