import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const start = vi.fn();
vi.mock('@/components/tour/ConsultantTour', () => ({ useConsultantTour: () => ({ start, running: false }) }));

vi.mock('@/hooks/useAssignmentPolicy', async () => {
  const m = await import('../../../supabase/functions/_shared/assignmentPolicy');
  return { useAssignmentPolicy: () => m.POLICY_DEFAULTS };
});

import QuickGuideSheet, { QUICK_GUIDE } from './QuickGuideSheet';

afterEach(() => cleanup());

describe('QuickGuideSheet', () => {
  it('opens, expands an answer and restarts the tour', () => {
    render(<MemoryRouter><QuickGuideSheet /></MemoryRouter>);
    const btn = screen.getByRole('button', { name: 'Help and guide' });
    expect(btn.getAttribute('data-tour')).toBe('help-button');
    fireEvent.click(btn);
    expect(screen.getByText('Quick guide')).toBeTruthy();
    expect(QUICK_GUIDE).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'How do I get paid?' }));
    expect(screen.getByText(/within 15 business days \(Sunday to Thursday\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'How fast must I answer an assignment request?' }));
    expect(screen.getByText(/within 24 hours \(30 minutes for Critical requests\)\. We remind you after 2 hours, 4 hours and 1 day/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Contact support/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Take the tour again/ }));
    expect(start).toHaveBeenCalled();
  });
});
