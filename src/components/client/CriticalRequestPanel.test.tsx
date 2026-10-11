import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const state = vi.hoisted(() => ({
  view: { data: undefined as unknown },
  mutate: vi.fn(),
  notify: vi.fn(),
  now: 0,
}));

vi.mock('@/hooks/useCriticalService', () => ({
  useCriticalView: () => state.view,
  useNow: () => state.now,
  useExtendCritical: () => ({ mutate: state.mutate, isPending: false }),
  notifyCriticalByEmail: state.notify,
}));

import CriticalRequestPanel from './CriticalRequestPanel';

const critical = (over: Record<string, unknown> = {}) => ({
  critical_response: true, status: 'waiting', due_at: at(19), committed_at: at(-11), minutes: 30, surcharge_percent: 30, first_reply_at: null,
  extensions: 0, max_minutes: 240, max_surcharge_percent: 100, can_extend: true, alerted_count: 6, reply_count: 0, in_time_consultants: [],
  my_reply_at: null, events: [], ...over,
});

beforeEach(() => {
  state.now = NOW;
  state.view = { data: critical() };
  state.mutate.mockReset();
  state.notify.mockReset();
});

afterEach(() => cleanup());

describe('CriticalRequestPanel', () => {
  it('shows nothing for a ticket that is not a critical request', () => {
    state.view = { data: { critical_response: false } };
    const { container } = render(<CriticalRequestPanel ticketId="t1" role="client" />);
    expect(container.firstChild).toBeNull();
  });

  it('counts down while the consultants have time to reply', () => {
    render(<CriticalRequestPanel ticketId="t1" role="client" />);
    expect(screen.getByText('Waiting for a reply')).toBeTruthy();
    expect(screen.getByTestId('critical-countdown').textContent).toBe('19:00 left');
    expect(screen.getByText('6 consultants alerted')).toBeTruthy();
    expect(screen.getByText('0 replied')).toBeTruthy();
    expect(screen.getByText(/earn \+30% on their hourly rate if you accept them/)).toBeTruthy();
  });

  it('e-mails the consultants that were not e-mailed yet, once', () => {
    const { rerender } = render(<CriticalRequestPanel ticketId="t1" role="client" />);
    rerender(<CriticalRequestPanel ticketId="t1" role="client" />);
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify).toHaveBeenCalledWith('t1');
  });

  it('says that the request was answered in time', () => {
    state.view = { data: critical({ status: 'answered', first_reply_at: at(-5), reply_count: 2 }) };
    render(<CriticalRequestPanel ticketId="t1" role="client" />);
    expect(screen.getByText('Answered in time')).toBeTruthy();
    expect(screen.getByText('2 replied')).toBeTruthy();
    expect(screen.getByText(/Open "Bids & Proposals" to choose a consultant/)).toBeTruthy();
  });

  it('says that nobody replied in time and that there is no surcharge', () => {
    state.view = { data: critical({ status: 'missed', due_at: at(-3), can_extend: true }) };
    render(<CriticalRequestPanel ticketId="t1" role="client" />);
    expect(screen.getByText('No reply in time')).toBeTruthy();
    expect(screen.getByText(/no surcharge applies/)).toBeTruthy();
    expect(screen.queryByTestId('critical-countdown')).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it('lets the owner extend the time or raise the surcharge', () => {
    render(<CriticalRequestPanel ticketId="t1" role="client" />);
    fireEvent.click(screen.getByTestId('critical-extend-button'));
    expect(screen.getByText('Extend the time or raise the surcharge')).toBeTruthy();
  });

  it('does not offer the change when the database says it is not possible', () => {
    state.view = { data: critical({ can_extend: false }) };
    render(<CriticalRequestPanel ticketId="t1" role="client" />);
    expect(screen.queryByTestId('critical-extend-button')).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it('lists the changes of the client', () => {
    state.view = {
      data: critical({
        extensions: 1,
        events: [{ kind: 'boosted', at: at(-4), old_due_at: at(19), new_due_at: at(19), old_percent: 30, new_percent: 50 }],
      }),
    };
    render(<CriticalRequestPanel ticketId="t1" role="client" />);
    expect(screen.getByText('Surcharge raised to 50%')).toBeTruthy();
    expect(screen.getByText('Changed 1 of 5 times')).toBeTruthy();
  });

  it('shows a consultant the window and whether the own reply counts', () => {
    state.view = { data: critical({ my_reply_at: at(-6), can_extend: false }) };
    render(<CriticalRequestPanel ticketId="t1" role="consultant" />);
    expect(screen.getByText(/Reply with a proposal within 19:00/)).toBeTruthy();
    expect(screen.getByText(/in time: \+30% applies if the client accepts you/)).toBeTruthy();
    expect(screen.queryByTestId('critical-extend-button')).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it('tells a consultant that a late reply gets no surcharge', () => {
    state.view = { data: critical({ status: 'missed', due_at: at(-10), my_reply_at: at(-2), can_extend: false }) };
    render(<CriticalRequestPanel ticketId="t1" role="consultant" />);
    expect(screen.getByText(/The reply window of this critical request has ended/)).toBeTruthy();
    expect(screen.getByText(/after the window: no surcharge/)).toBeTruthy();
  });
});
