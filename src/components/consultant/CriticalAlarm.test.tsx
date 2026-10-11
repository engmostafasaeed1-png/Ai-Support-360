import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const state = vi.hoisted(() => ({
  alerts: { data: [] as unknown[] },
  dismiss: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  now: 0,
}));

vi.mock('@/hooks/useCriticalService', () => ({
  useCriticalMyAlerts: () => state.alerts,
  useDismissCriticalAlert: () => ({ mutate: state.dismiss, isPending: false }),
  useNow: () => state.now,
}));

vi.mock('@/lib/alarmSound', () => ({
  startAlarm: () => {
    state.start();
    return { stop: state.stop };
  },
}));

vi.mock('@/components/consultant/SubmitProposalModal', async () => {
  const React = await import('react');
  return {
    default: (props: { criticalPercent?: number | null; trigger?: unknown }) =>
      React.createElement('div', { 'data-testid': 'proposal-modal', 'data-percent': String(props.criticalPercent) }, props.trigger as never),
  };
});

import CriticalAlarm from './CriticalAlarm';

const alert = (over: Record<string, unknown> = {}) => ({
  ticket_id: 't1', title: 'Posting fails after the upgrade', areas: ['SAP FI/CO'], due_at: at(20), minutes: 30, surcharge_percent: 30, status: 'waiting',
  extensions: 0, alerted_at: at(-10), last_alerted_at: at(-10), dismissed_at: null, replied_at: null, ...over,
});

const show = () => (
  <MemoryRouter>
    <CriticalAlarm />
  </MemoryRouter>
);

beforeEach(() => {
  state.now = NOW;
  state.alerts = { data: [alert()] };
  state.dismiss.mockReset();
  state.start.mockReset();
  state.stop.mockReset();
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('CriticalAlarm', () => {
  it('shows nothing when no alert can be answered', () => {
    state.alerts = {
      data: [
        alert({ ticket_id: 'a', replied_at: at(-1) }),
        alert({ ticket_id: 'b', dismissed_at: at(-1) }),
        alert({ ticket_id: 'c', due_at: at(-2) }),
        alert({ ticket_id: 'd', status: 'missed' }),
      ],
    };
    render(show());
    expect(screen.queryByTestId('critical-alarm')).toBeNull();
    expect(state.start).not.toHaveBeenCalled();
  });

  it('opens with the countdown, the ticket and the surcharge', () => {
    render(show());
    expect(screen.getByText('Critical request')).toBeTruthy();
    expect(screen.getByTestId('critical-alarm-countdown').textContent).toBe('20:00');
    expect(screen.getByText('Posting fails after the upgrade')).toBeTruthy();
    expect(screen.getByText('SAP FI/CO')).toBeTruthy();
    expect(screen.getByText(/your hourly rate gets \+30% on this ticket/)).toBeTruthy();
  });

  it('offers the proposal form with the surcharge', () => {
    render(show());
    expect(screen.getByTestId('proposal-modal').getAttribute('data-percent')).toBe('30');
    expect(screen.getByText('Reply now')).toBeTruthy();
  });

  it('says when the client changed the terms', () => {
    state.alerts = { data: [alert({ extensions: 1, surcharge_percent: 50 })] };
    render(show());
    expect(screen.getByText('Updated critical request')).toBeTruthy();
    expect(screen.getByText(/gets \+50% on this ticket/)).toBeTruthy();
  });

  it('plays the sound while it is open and stops it when it is closed', () => {
    render(show());
    expect(state.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remind me later' }));
    expect(screen.queryByTestId('critical-alarm')).toBeNull();
    expect(state.stop).toHaveBeenCalled();
  });

  it('opens again when a reminder or a change of the client arrives', () => {
    const { rerender } = render(show());
    fireEvent.click(screen.getByRole('button', { name: 'Remind me later' }));
    expect(screen.queryByTestId('critical-alarm')).toBeNull();
    state.alerts = { data: [alert({ last_alerted_at: at(0) })] };
    rerender(show());
    expect(screen.getByTestId('critical-alarm')).toBeTruthy();
  });

  it('stops the alarm of a ticket that is not for this consultant', () => {
    render(show());
    fireEvent.click(screen.getByRole('button', { name: 'Not for me' }));
    expect(state.dismiss).toHaveBeenCalledWith('t1');
    expect(screen.queryByTestId('critical-alarm')).toBeNull();
  });

  it('keeps the choice to mute the sound', () => {
    render(show());
    fireEvent.click(screen.getByRole('button', { name: 'Sound on' }));
    expect(screen.getByRole('button', { name: 'Sound off' })).toBeTruthy();
    expect(window.localStorage.getItem('critical-alarm-muted')).toBe('1');
    expect(state.stop).toHaveBeenCalled();
  });

  it('does not play the sound for a consultant who muted it', () => {
    window.localStorage.setItem('critical-alarm-muted', '1');
    render(show());
    expect(screen.getByRole('button', { name: 'Sound off' })).toBeTruthy();
    expect(state.start).not.toHaveBeenCalled();
  });

  it('shows the request that ends first and says how many more are waiting', () => {
    state.alerts = { data: [alert({ ticket_id: 'later', title: 'Second', due_at: at(25) }), alert({ ticket_id: 'soon', title: 'First', due_at: at(5) })] };
    render(show());
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('1 more critical request is waiting')).toBeTruthy();
  });
});
