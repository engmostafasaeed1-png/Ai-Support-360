import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PublicLayout from './PublicLayout';

vi.mock('@/assets/brand/horizontal-tight.webp.asset.json', () => ({ default: { url: '/logo.webp' } }));
vi.mock('@/components/landing/Footer', () => ({ default: () => <footer>footer</footer> }));

const renderAt = (path: string, variant?: 'content' | 'auth') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PublicLayout variant={variant} />}>
          <Route path="*" element={<p>page body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('PublicLayout', () => {
  it('renders exactly one banner and the routed page', () => {
    renderAt('/privacy-policy', 'content');
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('header menu links resolve to home sections from a non-home route', () => {
    renderAt('/privacy-policy', 'content');
    const main = within(screen.getByRole('navigation', { name: 'Main' }));
    const hrefs = main.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/#categories', '/#consultants', '/#pricing', '/#faq', '/for-consultants']);
  });

  it('marks the current page and hides the footer on auth pages', () => {
    renderAt('/for-consultants', 'content');
    const main = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(main.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href'))).toEqual(['/for-consultants']);
  });

  it('auth variant shows the header but no footer', () => {
    renderAt('/login', 'auth');
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.queryByText('footer')).toBeNull();
  });
});
