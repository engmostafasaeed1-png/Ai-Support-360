import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

const sb = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: sb.rpc, functions: { invoke: sb.invoke } } }));

import {
  useConnectTelegram, useDisconnectTelegram, useSetTelegramWebhook, useTelegramAdminStatus, useTelegramStatus, useTestTelegram,
} from './useTelegram';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  sb.rpc.mockReset();
  sb.invoke.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => cleanup());

describe('useTelegramStatus', () => {
  it('reads the own link through the status function', async () => {
    sb.rpc.mockResolvedValue({ data: { linked: true, active: true, username: '@alice' }, error: null });
    const { result } = renderHook(() => useTelegramStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(sb.rpc).toHaveBeenCalledWith('telegram_my_status', {});
    expect(result.current.data).toEqual({ linked: true, active: true, username: '@alice', linked_at: null, last_sent_at: null, paused_reason: null });
  });

  it('fails when the database answers with an error', async () => {
    sb.rpc.mockResolvedValue({ data: null, error: { message: 'Not authenticated' } });
    const { result } = renderHook(() => useTelegramStatus(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useConnectTelegram', () => {
  it('asks the function for a link and answers what it said', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, url: 'https://t.me/bot?start=abc' }, error: null });
    const { result } = renderHook(() => useConnectTelegram(), { wrapper });
    const answer = await result.current.mutateAsync();
    expect(sb.invoke).toHaveBeenCalledWith('telegram-link', { body: { action: 'start' } });
    expect(answer).toEqual({ configured: true, url: 'https://t.me/bot?start=abc' });
  });

  it('turns a failed call into a plain message', async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 500 } } });
    const { result } = renderHook(() => useConnectTelegram(), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('Telegram could not be connected. Please try again in a moment.');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Telegram could not be connected. Please try again in a moment.'));
  });

  it('tells the consultant to wait when the hourly allowance is used up', async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 429 } } });
    const { result } = renderHook(() => useConnectTelegram(), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('Too many attempts. Please wait a while and try again.');
  });
});

describe('useTestTelegram', () => {
  it('asks for a test message and refreshes the status, also when the bot was blocked', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, sent: false, reason: 'bot_blocked' }, error: null });
    const refresh = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTestTelegram(), { wrapper });
    const answer = await result.current.mutateAsync();
    expect(sb.invoke).toHaveBeenCalledWith('telegram-link', { body: { action: 'test' } });
    expect(answer).toEqual({ configured: true, sent: false, reason: 'bot_blocked' });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ queryKey: ['telegram-status'] }));
  });
});

describe('useDisconnectTelegram', () => {
  it('calls the unlink function and says so', async () => {
    sb.rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useDisconnectTelegram(), { wrapper });
    await result.current.mutateAsync();
    expect(sb.rpc).toHaveBeenCalledWith('telegram_unlink', {});
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Telegram disconnected'));
  });

  it('fails with a plain message when the database refuses', async () => {
    sb.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function telegram_unlink' } });
    const { result } = renderHook(() => useDisconnectTelegram(), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('Telegram could not be disconnected. Please try again in a moment.');
  });
});

describe('useTelegramAdminStatus', () => {
  it('reads the state of the bot from the setup function', async () => {
    sb.invoke.mockResolvedValue({
      data: { configured: true, bot_ok: true, bot: { username: 'b', name: 'B' }, webhook: { connected: true, url_matches: true, probe_status: 200, url_set: true, pending_updates: 0 }, links: { total: 3, active: 2 } },
      error: null,
    });
    const { result } = renderHook(() => useTelegramAdminStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(sb.invoke).toHaveBeenCalledWith('telegram-setup', { body: { action: 'status' } });
    expect(result.current.data?.links_active).toBe(2);
    expect(result.current.data?.webhook_connected).toBe(true);
    expect(result.current.data?.webhook_probe_status).toBe(200);
  });
});

describe('useSetTelegramWebhook', () => {
  it('puts the new state into the cache and says that the bot is connected', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, bot_ok: true, bot: { username: 'b', name: 'B' }, webhook: { connected: true, url_matches: true, probe_status: 200, url_set: true }, links: {}, set: { ok: true, description: null } }, error: null });
    const { result } = renderHook(() => useSetTelegramWebhook(), { wrapper });
    const status = await result.current.mutateAsync();
    expect(sb.invoke).toHaveBeenCalledWith('telegram-setup', { body: { action: 'set_webhook' } });
    expect(status.set_ok).toBe(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The bot is connected to the portal'));
    expect(client.getQueryData(['telegram-admin-status'])).toEqual(status);
  });

  it('shows what Telegram said when it did not accept the connection', async () => {
    sb.invoke.mockResolvedValue({ data: { configured: true, bot_ok: true, bot: {}, webhook: {}, links: {}, set: { ok: false, description: 'Bad Request: bad webhook: HTTPS url must be provided' } }, error: null });
    const { result } = renderHook(() => useSetTelegramWebhook(), { wrapper });
    await result.current.mutateAsync();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Bad Request: bad webhook: HTTPS url must be provided'));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
