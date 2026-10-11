import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  config: { data: undefined as unknown, isLoading: false, isError: false },
  device: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  enable: vi.fn(),
  disable: vi.fn(),
  test: vi.fn(),
  permission: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: state.toastSuccess, error: state.toastError } }));
vi.mock('@/hooks/usePush', () => ({
  usePushConfig: () => state.config,
  usePushDevice: () => state.device,
  useEnablePush: () => ({ mutateAsync: state.enable, isPending: false }),
  useDisablePush: () => ({ mutate: state.disable, isPending: false }),
  useTestPush: () => ({ mutateAsync: state.test, isPending: false }),
}));
vi.mock('@/lib/webPush', () => ({ requestPushPermission: () => state.permission() }));

import PushAlertsCard from './PushAlertsCard';

const dev = (over: Record<string, unknown> = {}) => ({ support: 'ok', permission: 'default', subscribed: false, keyMismatch: false, registered: false, devices: 0, ...over });
const configured = { data: { configured: true, public_key: 'PUB' }, isLoading: false, isError: false };

beforeEach(() => {
  state.config = configured;
  state.device = { data: dev(), isLoading: false, isError: false, refetch: vi.fn() };
  state.enable.mockReset();
  state.disable.mockReset();
  state.test.mockReset();
  state.permission.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
});
afterEach(() => cleanup());

describe('PushAlertsCard', () => {
  it('explains what it is, who gets it and what is stored', () => {
    render(<PushAlertsCard />);
    expect(screen.getByText('Phone alerts')).toBeTruthy();
    expect(screen.getByText(/only while your account is verified and "New case alerts" is switched on/)).toBeTruthy();
    expect(screen.getByTestId('push-privacy-note').textContent).toContain('encrypted');
    expect(screen.getByRole('button', { name: /Enable phone alerts/ })).toBeTruthy();
  });

  it('asks for the permission first and then subscribes with the key of the platform', async () => {
    const order: string[] = [];
    state.permission.mockImplementation(async () => { order.push('permission'); return 'granted'; });
    state.enable.mockImplementation(async () => { order.push('enable'); });
    render(<PushAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Enable phone alerts/ }));
    await waitFor(() => expect(state.enable).toHaveBeenCalledWith('PUB'));
    expect(order).toEqual(['permission', 'enable']);
  });

  it('does not subscribe when the permission is not given', async () => {
    state.permission.mockResolvedValue('denied');
    render(<PushAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Enable phone alerts/ }));
    await waitFor(() => expect(state.device.refetch).toHaveBeenCalled());
    expect(state.enable).not.toHaveBeenCalled();
  });

  it('explains how to unblock notifications when they are blocked', () => {
    state.device = { ...state.device, data: dev({ permission: 'denied' }) };
    render(<PushAlertsCard />);
    expect(screen.getByTestId('push-denied')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enable phone alerts/ })).toBeNull();
  });

  it.each([
    ['ios_needs_install', /Add to Home Screen/],
    ['in_frame', /own browser tab/],
    ['preview_host', /real website/],
    ['unsupported', /does not support push/],
  ])('says why it cannot work: %s', (support: string, text: RegExp) => {
    state.device = { ...state.device, data: dev({ support }) };
    render(<PushAlertsCard />);
    expect(screen.getByTestId('push-unsupported').textContent).toMatch(text);
    expect(screen.queryByRole('button', { name: /Enable phone alerts/ })).toBeNull();
  });

  it('says it is not available before the administrator created the keys', () => {
    state.config = { data: { configured: false, public_key: null }, isLoading: false, isError: false };
    render(<PushAlertsCard />);
    expect(screen.getByTestId('push-not-configured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enable phone alerts/ })).toBeNull();
  });

  it('shows the on state with test and turn off', async () => {
    state.device = { ...state.device, data: dev({ permission: 'granted', subscribed: true, registered: true, devices: 2 }) };
    state.test.mockResolvedValue({ configured: true, devices: 2, sent: 2 });
    render(<PushAlertsCard />);
    expect(screen.getByTestId('push-on')).toBeTruthy();
    expect(screen.getByText('2 devices in total')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send me a test alert/ }));
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Turn off on this device/ }));
    expect(state.disable).toHaveBeenCalledTimes(1);
  });

  it('tells when the test could not be delivered', async () => {
    state.device = { ...state.device, data: dev({ permission: 'granted', subscribed: true, registered: true, devices: 1 }) };
    state.test.mockResolvedValue({ configured: true, devices: 1, sent: 0 });
    render(<PushAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Send me a test alert/ }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith(expect.stringContaining('could not be delivered')));
  });

  it('tells when the test reached only some of the devices', async () => {
    state.device = { ...state.device, data: dev({ permission: 'granted', subscribed: true, registered: true, devices: 2 }) };
    state.test.mockResolvedValue({ configured: true, devices: 2, sent: 1, failed: 1 });
    render(<PushAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Send me a test alert/ }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith(expect.stringContaining('only some of your devices')));
    expect(state.toastSuccess).not.toHaveBeenCalled();
  });

  it('says what happened when the question of the browser is closed without an answer', async () => {
    state.permission.mockResolvedValue('default');
    render(<PushAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Enable phone alerts/ }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Notifications were not allowed. Press the button again and choose Allow.'));
    expect(state.enable).not.toHaveBeenCalled();
  });

  it('asks to turn it on again when the key changed or the server lost the device', () => {
    state.device = { ...state.device, data: dev({ permission: 'granted', subscribed: true, registered: false }) };
    render(<PushAlertsCard />);
    expect(screen.getByTestId('push-repair')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Enable phone alerts/ })).toBeTruthy();
    expect(screen.queryByTestId('push-on')).toBeNull();
  });

  it('shows an error line when the state cannot be read', () => {
    state.device = { ...state.device, data: undefined, isError: true };
    render(<PushAlertsCard />);
    expect(screen.getByText(/could not be checked/)).toBeTruthy();
  });
});

