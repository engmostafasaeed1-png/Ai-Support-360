import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ publicOn: true }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o && 'points' in o ? `${o.points} pts` : k), i18n: { language: 'en' } }),
}));
vi.mock('@/hooks/useRealtimeConsultants', () => ({
  useRealtimeConsultants: () => ({
    isLoading: false,
    consultants: [
      { id: 'a', name: 'Alia', specialty: 'FI', avatar: 'A' },
      { id: 'b', name: 'Badr', specialty: 'MM', avatar: 'B' },
      { id: 'c', name: 'Carim', specialty: 'SD', avatar: 'C' },
    ],
  }),
}));
vi.mock('@/hooks/useResponsiveness', () => ({
  usePublicResponsiveness: () => ({
    publicOn: state.publicOn,
    reviewWeight: 15,
    byId: new Map([
      ['a', { level: 'needs_improvement', median_minutes: 900, response_rate: 40, stars: null }],
      ['b', { level: 'excellent', median_minutes: 20, response_rate: 98, stars: null }],
    ]),
    levels: null,
  }),
}));

import ConsultantResponsivenessPage from './ConsultantResponsivenessPage';

const renderPage = () => render(<MemoryRouter><ConsultantResponsivenessPage /></MemoryRouter>);

describe('ConsultantResponsivenessPage', () => {
  beforeEach(() => { state.publicOn = true; });

  it('lists consultants best responsiveness first with their ranking effect; no data counts as New (neutral)', () => {
    renderPage();
    const rows = screen.getAllByTestId('resp-row');
    expect(rows.map((r) => r.getAttribute('data-level'))).toEqual(['excellent', 'needs_improvement', 'new']);
    expect(rows[0].textContent).toContain('+1.2 pts');
    expect(rows[1].textContent).toContain('\u22121.5 pts');
    expect(rows[2].textContent).toContain('client_resp.neutral');
  });

  it('filters by level', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: /Excellent/ })[0]);
    expect(screen.getAllByTestId('resp-row').map((r) => r.getAttribute('data-level'))).toEqual(['excellent']);
  });

  it('shows nothing about consultants while responsiveness is private', () => {
    state.publicOn = false;
    renderPage();
    expect(screen.queryAllByTestId('resp-row')).toHaveLength(0);
    expect(screen.getByText('client_resp.off_title')).toBeTruthy();
  });
});
