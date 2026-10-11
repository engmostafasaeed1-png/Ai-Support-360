import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const state = vi.hoisted(() => ({
  list: { data: [] as unknown[], isLoading: false, isError: false },
  now: 0,
}));

vi.mock('@/hooks/useCriticalService', () => ({
  useAdminCriticalRequests: () => state.list,
  useNow: () => state.now,
}));

import CriticalRequestsLive from './CriticalRequestsLive';

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1', title: 'Posting fails after the upgrade', ticket_status: 'new', critical_status: 'waiting', due_at: at(19), surcharge_percent: 30, extensions: 0,
  consultant_assigned: false, created_at: at(-11), alerted: 6, replied: 0, ...over,
});

const show = () => (
  <MemoryRouter>
    <CriticalRequestsLive />
  </MemoryRouter>
);

beforeEach(() => {
  state.now = NOW;
  state.list = { data: [row()], isLoading: false, isError: false };
});

afterEach(() => cleanup());

describe('CriticalRequestsLive', () => {
  it('says that a critical request is waiting, with its countdown and its numbers', () => {
    render(show());
    expect(screen.getByTestId('critical-live-waiting').textContent).toContain('1 critical request is waiting for a reply right now');
    expect(screen.queryByTestId('critical-live-attention')).toBeNull();
    expect(screen.getByText('Posting fails after the upgrade').getAttribute('href')).toBe('/admin/tickets/t1');
    expect(screen.getByText('19:00 left')).toBeTruthy();
    expect(screen.getByText('Waiting for a reply')).toBeTruthy();
    expect(screen.getByText('Surcharge +30%')).toBeTruthy();
    expect(screen.getByText('6 consultants alerted')).toBeTruthy();
    expect(screen.getByText('0 replied')).toBeTruthy();
  });

  it('asks for a person when nobody could be alerted', () => {
    state.list = { data: [row({ alerted: 0 })], isLoading: false, isError: false };
    render(show());
    expect(screen.getByTestId('critical-live-attention').textContent).toContain('1 critical request needs your attention');
    expect(screen.getByText('Nobody could be alerted: contact a consultant yourself')).toBeTruthy();
  });

  it('asks for a person when the window ended without a reply', () => {
    state.list = { data: [row({ critical_status: 'missed', due_at: at(-3) })], isLoading: false, isError: false };
    render(show());
    expect(screen.queryByTestId('critical-live-waiting')).toBeNull();
    expect(screen.getByText('No reply in time')).toBeTruthy();
    expect(screen.getByText('Nobody replied in time: contact a consultant, or ask the client to give more time')).toBeTruthy();
  });

  it('shows an answered request calmly, with the number of changes', () => {
    state.list = { data: [row({ critical_status: 'answered', replied: 2, extensions: 1, due_at: at(-5) })], isLoading: false, isError: false };
    render(show());
    expect(screen.queryByTestId('critical-live-waiting')).toBeNull();
    expect(screen.queryByTestId('critical-live-attention')).toBeNull();
    expect(screen.getByText('Answered in time')).toBeTruthy();
    expect(screen.getByText('2 replied')).toBeTruthy();
    expect(screen.getByText('Changed 1 of 5 times')).toBeTruthy();
  });

  it('counts several waiting requests', () => {
    state.list = { data: [row({ id: 'a' }), row({ id: 'b', title: 'Second' })], isLoading: false, isError: false };
    render(show());
    expect(screen.getByTestId('critical-live-waiting').textContent).toContain('2 critical requests are waiting for a reply right now');
    expect(screen.getAllByTestId('critical-live-row').length).toBe(2);
  });

  it('does not say that somebody waits when a consultant is assigned or the ticket is finished', () => {
    state.list = { data: [row({ id: 'a', consultant_assigned: true }), row({ id: 'b', ticket_status: 'closed' })], isLoading: false, isError: false };
    render(show());
    expect(screen.queryByTestId('critical-live-waiting')).toBeNull();
    expect(screen.queryByText('Waiting for a reply')).toBeNull();
    expect(screen.queryByText('19:00 left')).toBeNull();
  });

  it('keeps the last list when a refresh fails', () => {
    state.list = { data: [row()], isLoading: false, isError: true };
    render(show());
    expect(screen.getAllByTestId('critical-live-row').length).toBe(1);
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('says so when there is no request yet or the list cannot be loaded', () => {
    state.list = { data: [], isLoading: false, isError: false };
    const { unmount } = render(show());
    expect(screen.getByText('No critical request yet.')).toBeTruthy();
    unmount();
    state.list = { data: [], isLoading: false, isError: true };
    render(show());
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
