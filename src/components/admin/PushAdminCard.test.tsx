import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  status: { data: undefined as unknown, isLoading: false, isFetching: false, refetch: vi.fn() },
  generate: vi.fn(),
}));

vi.mock('@/hooks/usePush', () => ({
  usePushAdminStatus: () => state.status,
  useGeneratePushKeys: () => ({ mutate: state.generate, isPending: false }),
}));

import PushAdminCard from './PushAdminCard';

const s = (over: Record<string, unknown> = {}) => ({ configured: false, created: false, devices: 0, consultants: 0, failed_24h: 0, ...over });
const load = (data: unknown, over: Record<string, unknown> = {}) => {
  state.status = { data, isLoading: false, isFetching: false, refetch: state.status.refetch, ...over };
};

beforeEach(() => {
  state.status.refetch.mockReset();
  state.generate.mockReset();
  load(s());
});
afterEach(() => cleanup());

describe('PushAdminCard', () => {
  it('offers one button to create the keys', () => {
    render(<PushAdminCard />);
    expect(screen.getByTestId('push-keys-missing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Create the keys for phone alerts/ }));
    expect(state.generate).toHaveBeenCalledTimes(1);
  });

  it('shows the counts once the keys exist and no button to create them again', () => {
    load(s({ configured: true, devices: 2, consultants: 1 }));
    render(<PushAdminCard />);
    expect(screen.getByTestId('push-keys-ready')).toBeTruthy();
    expect(screen.getByText('2 devices turned on')).toBeTruthy();
    expect(screen.getByText('1 consultant')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create the keys/ })).toBeNull();
    expect(screen.queryByText(/failed alert/)).toBeNull();
  });

  it('shows failed alerts of the last 24 hours', () => {
    load(s({ configured: true, devices: 1, consultants: 1, failed_24h: 3 }));
    render(<PushAdminCard />);
    expect(screen.getByText('3 devices with a failed alert in the last 24 hours')).toBeTruthy();
    expect(screen.getByText('1 device turned on')).toBeTruthy();
  });

  it('says when the status could not be loaded, and refreshes on request', () => {
    load(undefined);
    const { rerender } = render(<PushAdminCard />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    load(s());
    rerender(<PushAdminCard />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(state.status.refetch).toHaveBeenCalled();
  });
});

