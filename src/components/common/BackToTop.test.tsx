import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BackToTop from './BackToTop';

function setScrollY(y: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const renderAt = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <main id="main-content">content</main>
      <BackToTop />
    </MemoryRouter>,
  );

describe('BackToTop', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    mockReducedMotion(false);
    setScrollY(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
    document.documentElement.dir = 'ltr';
  });

  it('stays hidden until the page is scrolled past 600 px', () => {
    renderAt();
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();
    setScrollY(600);
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();
    setScrollY(601);
    expect(screen.getByRole('button', { name: 'Back to top' })).toBeInTheDocument();
    setScrollY(100);
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();
  });

  it('is a focusable button that scrolls smoothly to the top and moves focus to the page content', () => {
    renderAt();
    setScrollY(1200);
    const btn = screen.getByRole('button', { name: 'Back to top' });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' });
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });

  it('jumps without animation when reduced motion is requested', () => {
    mockReducedMotion(true);
    renderAt();
    setScrollY(1200);
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
  });

  it('uses logical end-edge placement so it mirrors in Arabic (RTL)', () => {
    document.documentElement.dir = 'rtl';
    renderAt();
    setScrollY(1200);
    const cls = screen.getByRole('button', { name: 'Back to top' }).className;
    expect(cls).toMatch(/(^|\s)end-\[/);
    expect(cls).not.toMatch(/(^|\s)(sm:)?(left|right)-/);
  });

  it('sits higher in the portals so it clears the WhatsApp and assistant buttons', () => {
    renderAt('/client/dashboard');
    setScrollY(1200);
    const cls = screen.getByRole('button', { name: 'Back to top' }).className;
    expect(cls).toContain('bottom-[13.5rem]');
    expect(cls).toContain('sm:bottom-[10.5rem]');
  });
});
