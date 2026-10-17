import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Navbar from './Navbar';

vi.mock('@/assets/brand/horizontal-tight.webp.asset.json', () => ({
  default: { url: '/logo.webp' },
}));

let resizeCallback: ResizeObserverCallback | null = null;

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb: ResizeObserverCallback) {
    resizeCallback = cb;
  }
}

describe('Navbar header height variable', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    resizeCallback = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--public-header-h');
  });

  it('publishes the real header height as --public-header-h and removes it on unmount', () => {
    const { unmount, container } = render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );
    const nav = container.querySelector('nav')!;
    Object.defineProperty(nav, 'offsetHeight', { value: 117, configurable: true });

    expect(resizeCallback).toBeTruthy();
    resizeCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);

    expect(document.documentElement.style.getPropertyValue('--public-header-h')).toBe('117px');

    unmount();
    expect(document.documentElement.style.getPropertyValue('--public-header-h')).toBe('');
  });
});
