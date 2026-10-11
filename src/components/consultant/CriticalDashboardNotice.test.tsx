import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const state = vi.hoisted(() => ({
  alerts: { data: [] as unknown[] },
  read: vi.fn(),
  dismiss: vi.fn(),
  now: 0,
}));

vi.mock('@/hooks/useCriticalService', () => ({
  useCriticalMyAlerts: (options: unknown) => {
    state.read(options);
    return state.alerts;
  },
  useDismissCriticalAlert: () => ({ mutate: state.dismiss, isPending: false }),
  useNow: () => state.now,
}));

vi.mock('@/components/consultant/SubmitProposalModal', async () => {
  const React = await import('react');
  return {
    default: (props: { ticketId: string; criticalPercent?: number | null; trigger?: unknown }) =>
      React.createElement('div', { 'data-testid': 'proposal-modal', 'data-ticket': props.ticketId, 'data-percent': String(props.criticalPercent) }, props.trigger as never),
  };
});

import CriticalDashboardNotice from './CriticalDashboardNotice';

const alert = (over: Record<string, unknown> = {}) => ({
  ticket_id: 't1', title: 'Posting fails after the upgrade', areas: ['SAP FI/CO'], due_at: at(20), minutes: 30, surcharge_percent: 30, status: 'waiting',
  extensions: 0, alerted_at: at(-10), last_alerted_at: at(-10), dismissed_at: null, replied_at: null, ...over,
});

const show = () => (
  <MemoryRouter>
    <CriticalDashboardNotice />
  </MemoryRouter>
);

beforeEach(() => {
  state.now = NOW;
  state.alerts = { data: [alert()] };
  state.read.mockReset();
  state.dismiss.mockReset();
});

afterEach(() => cleanup());

describe('CriticalDashboardNotice', () => {
  it('shows nothing when no critical request can be answered', () => {
    state.alerts = {
      data: [
        alert({ ticket_id: 'a', replied_at: at(-1) }),
        alert({ ticket_id: 'b', dismissed_at: at(-1) }),
        alert({ ticket_id: 'c', due_at: at(-2) }),
        alert({ ticket_id: 'd', status: 'missed' }),
      ],
    };
    const { container } = render(show());
    expect(container.firstChild).toBeNull();
  });

  it('shows the request with its countdown, the areas and the surcharge', () => {
    render(show());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('1 critical request is waiting for your reply')).toBeTruthy();
    expect(screen.getByText('Posting fails after the upgrade')).toBeTruthy();
    expect(screen.getByText('SAP FI/CO')).toBeTruthy();
    expect(screen.getByText('+30% for you')).toBeTruthy();
    expect(screen.getByText('20:00 left')).toBeTruthy();
  });

  it('lists several requests, the one that ends first on top', () => {
    state.alerts = { data: [alert({ ticket_id: 'later', title: 'Second', due_at: at(25) }), alert({ ticket_id: 'soon', title: 'First', due_at: at(5) })] };
    render(show());
    expect(screen.getByText('2 critical requests are waiting for your reply')).toBeTruthy();
    const items = screen.getAllByTestId('critical-dashboard-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('First');
    expect(items[1].textContent).toContain('Second');
  });

  it('offers the proposal form with the surcharge and a link to the ticket', () => {
    render(show());
    const modal = screen.getByTestId('proposal-modal');
    expect(modal.getAttribute('data-ticket')).toBe('t1');
    expect(modal.getAttribute('data-percent')).toBe('30');
    expect(screen.getByText('Reply now')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the ticket' }).getAttribute('href')).toBe('/consultant/tickets/t1');
  });

  it('stops the alarm of a request that is not for this consultant', () => {
    render(show());
    fireEvent.click(screen.getByRole('button', { name: 'Not for me' }));
    expect(state.dismiss).toHaveBeenCalledWith('t1');
  });

  it('does not open a second realtime channel: the alarm in the layout has it', () => {
    render(show());
    expect(state.read).toHaveBeenCalledWith({ realtime: false });
  });
});
