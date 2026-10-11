import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PageErrorBoundary from './PageErrorBoundary';

vi.mock('@/lib/errorReporter', () => ({ reportError: vi.fn() }));

function Page({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom');
  return <p>the other page</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageErrorBoundary', () => {
  it('shows the error in the page area only, keeps the menu, and clears it on the next page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={['/a']}>
        <nav>
          <Link to="/b">menu link</Link>
        </nav>
        <PageErrorBoundary homePath="/client">
          <Routes>
            <Route path="/a" element={<Page explode />} />
            <Route path="/b" element={<Page explode={false} />} />
          </Routes>
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('page-error')).toBeTruthy();
    expect(screen.getByText('This page could not be shown')).toBeTruthy();
    expect(screen.getByText('menu link')).toBeTruthy();
    expect(screen.getByText('Go to dashboard').getAttribute('href')).toBe('/client');
    fireEvent.click(screen.getByText('menu link'));
    expect(screen.queryByTestId('page-error')).toBeNull();
    expect(screen.getByText('the other page')).toBeTruthy();
  });
});
