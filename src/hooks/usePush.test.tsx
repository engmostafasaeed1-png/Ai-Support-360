import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

const sb = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
const web = vi.hoisted(() => ({
  support: 'ok', permission: 'granted', sub: null as unknown, same: true,
  subscribe: vi.fn(), unsubscribe: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: sb.rpc, functions: { invoke: sb.invoke } } }));
vi.mock('@/lib/webPush', () => ({
  PushUserError: class PushUserError extends Error {},
  browserPushEnv: () => ({}),
  detectPushSupport: () => web.support,
  pushPermission: () => web.permission,
  getThisDeviceSubscription: async () => web.sub,
  sameApplicationKey: () => web.same,
  keysOfSubscription: (s: { keys?: unknown; endpoint?: string }) => (s && s.keys ? { endpoint: s.endpoint, ...(s.keys as object) } : null),
  subscribeThisDevice: (key: string) => web.subscribe(key),
  unsubscribeThisDevice: () => web.unsubscribe(),
}));

import {
  readPushAdminStatus, releasePushOnSignOut, useDisablePush, useEnablePush, useGeneratePushKeys, usePushAdminStatus, usePushConfig, usePushDevice, useTestPush,
} from './usePush';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  sb.rpc.mockReset();
  sb.invoke.mockReset();
  web.support = 'ok';
  web.permission = 'granted';
  web.sub = null;
  web.same = true;
  web.subscribe.mockReset();
  web.unsubscribe.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => cleanup());

describe('usePushConfig', () => {
  it('reads the public key of the platform', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, public_key: 'PUB' }, error: null });
    const { result } = renderHook(() => usePushConfig(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(sb.invoke).toHaveBeenCalledWith('push-config', { body: { action: 'config' } });
    expect(result.current.data).toEqual({ configured: true, public_key: 'PUB' });
  });

  it('is not configured without a key', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: false }, error: null });
    const { result } = renderHook(() => usePushConfig(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toEqual({ configured: false, public_key: null });
  });

  it('fails when the function fails', async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: 'x', context: { status: 500 } } });
    const { result } = renderHook(() => usePushConfig(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('usePushDevice', () => {
  it('has no subscription and asks the database without an address', async () => {
    sb.rpc.mockResolvedValue({ data: { this_device: false, devices: 2 }, error: null });
    const { result } = renderHook(() => usePushDevice('PUB'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(sb.rpc).toHaveBeenCalledWith('push_my_status', { _endpoint: null });
    expect(result.current.data).toEqual({ support: 'ok', permission: 'granted', subscribed: false, keyMismatch: false, registered: false, devices: 2 });
  });

  it('knows a registered device and a key that no longer fits', async () => {
    web.sub = { endpoint: 'https://fcm.googleapis.com/x' };
    web.same = false;
    sb.rpc.mockResolvedValue({ data: { this_device: true, devices: 1 }, error: null });
    const { result } = renderHook(() => usePushDevice('PUB'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(sb.rpc).toHaveBeenCalledWith('push_my_status', { _endpoint: 'https://fcm.googleapis.com/x' });
    expect(result.current.data).toMatchObject({ subscribed: true, keyMismatch: true, registered: true });
  });

  it('does not read the browser subscription when push is not supported', async () => {
    web.support = 'ios_needs_install';
    web.sub = { endpoint: 'https://x' };
    sb.rpc.mockResolvedValue({ data: { this_device: false, devices: 0 }, error: null });
    const { result } = renderHook(() => usePushDevice('PUB'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.subscribed).toBe(false);
    expect(result.current.data?.support).toBe('ios_needs_install');
  });

  it('fails when the database answers with an error', async () => {
    sb.rpc.mockResolvedValue({ data: null, error: { message: 'Not authenticated' } });
    const { result } = renderHook(() => usePushDevice('PUB'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useEnablePush', () => {
  it('subscribes the browser and stores the address and the two keys', async () => {
    web.subscribe.mockResolvedValue({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'P', auth: 'A' } });
    sb.rpc.mockResolvedValue({ data: { devices: 1 }, error: null });
    const { result } = renderHook(() => useEnablePush(), { wrapper });
    await result.current.mutateAsync('PUB');
    expect(web.subscribe).toHaveBeenCalledWith('PUB');
    expect(sb.rpc).toHaveBeenCalledWith('push_subscribe', expect.objectContaining({ _endpoint: 'https://fcm.googleapis.com/x', _p256dh: 'P', _auth: 'A' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Phone alerts are on for this device'));
  });

  it('says so when the browser gives no keys', async () => {
    web.subscribe.mockResolvedValue({ endpoint: 'https://x' });
    const { result } = renderHook(() => useEnablePush(), { wrapper });
    await expect(result.current.mutateAsync('PUB')).rejects.toThrow(/did not give the keys/);
    expect(sb.rpc).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('shows a fixed sentence instead of the technical text of the database', async () => {
    web.subscribe.mockResolvedValue({ endpoint: 'https://x', keys: { p256dh: 'P', auth: 'A' } });
    sb.rpc.mockResolvedValue({ data: null, error: { message: 'Only consultants can turn on phone alerts' } });
    const { result } = renderHook(() => useEnablePush(), { wrapper });
    await expect(result.current.mutateAsync('PUB')).rejects.toThrow('Only consultants can turn on phone alerts');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Phone alerts could not be turned on'));
  });

  it('says to wait when the database refuses for too many attempts', async () => {
    web.subscribe.mockResolvedValue({ endpoint: 'https://x', keys: { p256dh: 'P', auth: 'A' } });
    sb.rpc.mockResolvedValue({ data: null, error: { message: 'Too many attempts. Please wait a while and try again.', code: '54000' } });
    const { result } = renderHook(() => useEnablePush(), { wrapper });
    await expect(result.current.mutateAsync('PUB')).rejects.toThrow('Too many attempts');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many attempts. Please wait a while and try again.'));
  });

  it('shows the sentence the browser helper wrote for the consultant', async () => {
    const { PushUserError } = await import('@/lib/webPush');
    web.subscribe.mockRejectedValue(new PushUserError('Notifications are blocked for this site in your browser.'));
    const { result } = renderHook(() => useEnablePush(), { wrapper });
    await expect(result.current.mutateAsync('PUB')).rejects.toThrow('Notifications are blocked');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Notifications are blocked for this site in your browser.'));
  });
});

describe('useDisablePush', () => {
  it('removes the subscription in the browser and in the database', async () => {
    web.unsubscribe.mockResolvedValue('https://fcm.googleapis.com/x');
    sb.rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useDisablePush(), { wrapper });
    await result.current.mutateAsync();
    expect(sb.rpc).toHaveBeenCalledWith('push_unsubscribe', { _endpoint: 'https://fcm.googleapis.com/x' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Phone alerts are off for this device'));
  });

  it('does not call the database when there was no subscription', async () => {
    web.unsubscribe.mockResolvedValue(null);
    const { result } = renderHook(() => useDisablePush(), { wrapper });
    await result.current.mutateAsync();
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it('turns a database failure into a plain message', async () => {
    web.unsubscribe.mockResolvedValue('https://x');
    sb.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useDisablePush(), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('Phone alerts could not be turned off. Please try again in a moment.');
  });
});

describe('useTestPush', () => {
  it('asks the function for a test alert', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, devices: 1, sent: 1, failed: 0 }, error: null });
    const { result } = renderHook(() => useTestPush(), { wrapper });
    expect(await result.current.mutateAsync()).toEqual({ configured: true, devices: 1, sent: 1, failed: 0 });
    expect(sb.invoke).toHaveBeenCalledWith('push-config', { body: { action: 'test' } });
  });

  it('says to wait after too many requests', async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: 'x', context: { status: 429 } } });
    const { result } = renderHook(() => useTestPush(), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('Too many attempts. Please wait a while and try again.');
  });
});

describe('administrator', () => {
  it('cleans the numbers of the status', () => {
    expect(readPushAdminStatus({ configured: true, created: false, devices: 3.7, consultants: -1, failed_24h: 'x' })).toEqual({ configured: true, created: false, devices: 3, consultants: 0, failed_24h: 0 });
    expect(readPushAdminStatus(null)).toEqual({ configured: false, created: false, devices: 0, consultants: 0, failed_24h: 0 });
  });

  it('reads the status through the setup function', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, devices: 2, consultants: 1, failed_24h: 0 }, error: null });
    const { result } = renderHook(() => usePushAdminStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(sb.invoke).toHaveBeenCalledWith('push-setup', { body: { action: 'status' } });
    expect(result.current.data?.devices).toBe(2);
  });

  it('creates the keys and says whether they were new', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, created: true }, error: null });
    const { result } = renderHook(() => useGeneratePushKeys(), { wrapper });
    await result.current.mutateAsync();
    expect(sb.invoke).toHaveBeenCalledWith('push-setup', { body: { action: 'generate' } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The keys for phone alerts are created'));
    expect(client.getQueryData(['push-admin-status'])).toMatchObject({ configured: true, created: true });
  });

  it('says when the keys existed already', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, created: false }, error: null });
    const { result } = renderHook(() => useGeneratePushKeys(), { wrapper });
    await result.current.mutateAsync();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The keys already existed'));
  });
});

describe('releasePushOnSignOut', () => {
  it('removes this device before the sign-out', async () => {
    web.unsubscribe.mockResolvedValue('https://fcm.googleapis.com/x');
    sb.rpc.mockResolvedValue({ data: null, error: null });
    await releasePushOnSignOut();
    expect(sb.rpc).toHaveBeenCalledWith('push_unsubscribe', { _endpoint: 'https://fcm.googleapis.com/x' });
  });

  it('does nothing when the device had no subscription', async () => {
    web.unsubscribe.mockResolvedValue(null);
    await releasePushOnSignOut();
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it('never fails the sign-out', async () => {
    web.unsubscribe.mockRejectedValue(new Error('no service worker'));
    await expect(releasePushOnSignOut()).resolves.toBeUndefined();
    web.unsubscribe.mockResolvedValue('https://x');
    sb.rpc.mockRejectedValue(new Error('offline'));
    await expect(releasePushOnSignOut()).resolves.toBeUndefined();
  });
});

