import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const state = vi.hoisted(() => ({ isLoading: false, data: null as any }));
vi.mock('@/hooks/useBilling', () => ({ useMyPayoutDetails: () => state }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_: string, fallback: string) => fallback }) }));
import PayoutDetailsNudge from './PayoutDetailsNudge';
afterEach(() => { cleanup(); state.isLoading = false; state.data = null; });
describe('payout readiness reminder', () => {
  it('shows for a consultant without details and links to the payout editor', () => {
    state.data = { consultantId: 'c1', details: null };
    render(<MemoryRouter><PayoutDetailsNudge /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Add your payout details to receive your fees - takes 1 minute');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/consultant/profile#payout-details');
  });
  it('disappears after saving even while awaiting administrator verification', () => {
    state.data = { consultantId: 'c1', details: null };
    const view = render(<MemoryRouter><PayoutDetailsNudge /></MemoryRouter>);
    state.data = { consultantId: 'c1', details: { acknowledged_at: '2026-10-17', acknowledged_version: 'v1', verified_at: null } };
    view.rerender(<MemoryRouter><PayoutDetailsNudge /></MemoryRouter>);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('does not prompt before loading or without a consultant record', () => {
    state.isLoading = true;
    const view = render(<MemoryRouter><PayoutDetailsNudge /></MemoryRouter>);
    expect(screen.queryByRole('status')).toBeNull();
    state.isLoading = false;
    view.rerender(<MemoryRouter><PayoutDetailsNudge /></MemoryRouter>);
    expect(screen.queryByRole('status')).toBeNull();
  });
});