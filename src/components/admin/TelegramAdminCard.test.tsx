import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  status: { data: undefined as unknown, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  setWebhook: vi.fn(),
}));

vi.mock('@/hooks/useTelegram', () => ({
  useTelegramAdminStatus: () => state.status,
  useSetTelegramWebhook: () => ({ mutate: state.setWebhook, isPending: false }),
}));

import TelegramAdminCard from './TelegramAdminCard';

const admin = (over: Record<string, unknown> = {}) => ({
  configured: true, bot_ok: true, bot_username: 'AiSupport360Bot', bot_name: 'AI Support 360', webhook_connected: false, webhook_url_matches: false, webhook_probe_status: 0,
  webhook_url_set: false, pending_updates: 0, last_error: null, last_error_at: null, links_total: 0, links_active: 0, set_ok: null, set_error: null, ...over,
});
const ready = (over: Record<string, unknown> = {}) => admin({ webhook_connected: true, webhook_url_matches: true, webhook_probe_status: 200, webhook_url_set: true, ...over });

const load = (data: unknown, over: Record<string, unknown> = {}) => {
  state.status = { data, isLoading: false, isError: false, isFetching: false, refetch: state.status.refetch, ...over };
};

beforeEach(() => {
  state.status.refetch.mockReset();
  state.setWebhook.mockReset();
  load(admin());
});

afterEach(() => cleanup());

describe('TelegramAdminCard', () => {
  it('lists the steps to create the bot when the secret is missing', () => {
    load(admin({ configured: false, bot_ok: false }));
    render(<TelegramAdminCard />);
    expect(screen.getByTestId('telegram-step-create').textContent).toContain('TELEGRAM_BOT_TOKEN');
    expect(screen.queryByRole('button', { name: /Connect the bot to the portal/ })).toBeNull();
  });

  it('says that the token is not accepted', () => {
    load(admin({ bot_ok: false }));
    render(<TelegramAdminCard />);
    expect(screen.getByTestId('telegram-step-fix')).toBeTruthy();
  });

  it('offers the one-click connection of the bot to the portal', () => {
    render(<TelegramAdminCard />);
    expect(screen.getByText('@AiSupport360Bot')).toBeTruthy();
    expect(screen.getByText('Not connected to the portal yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Connect the bot to the portal/ }));
    expect(state.setWebhook).toHaveBeenCalledTimes(1);
  });

  it('shows a working bot with the numbers of connected consultants', () => {
    load(ready({ links_total: 5, links_active: 4, pending_updates: 2 }));
    render(<TelegramAdminCard />);
    expect(screen.getByText('Connected to the portal')).toBeTruthy();
    expect(screen.queryByTestId('telegram-step-down')).toBeNull();
    expect(screen.getByText('4 consultants connected')).toBeTruthy();
    expect(screen.getByText('1 paused')).toBeTruthy();
    expect(screen.getByText('2 messages waiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Connect again/ })).toBeTruthy();
  });

  it('does not show green when the webhook function does not answer', () => {
    load(admin({ webhook_url_matches: true, webhook_url_set: true, webhook_probe_status: 401 }));
    render(<TelegramAdminCard />);
    expect(screen.getByTestId('telegram-step-down').textContent).toContain('HTTP 401');
    expect(screen.queryByText('Connected to the portal')).toBeNull();
    expect(screen.getByText('Connected, but not answering')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect the bot to the portal/ })).toBeNull();
  });

  it('says that there was no answer at all when the probe could not reach the function', () => {
    load(admin({ webhook_url_matches: true, webhook_url_set: true, webhook_probe_status: 0 }));
    render(<TelegramAdminCard />);
    expect(screen.getByTestId('telegram-step-down').textContent).toContain('no answer');
  });

  it('shows the last error that Telegram reported', () => {
    load(ready({ last_error: 'Wrong response from the webhook: 500' }));
    render(<TelegramAdminCard />);
    expect(screen.getByText('Telegram reported an error: Wrong response from the webhook: 500')).toBeTruthy();
  });

  it('keeps the last known state of the bot when a refresh fails', () => {
    load(ready(), { isError: true });
    render(<TelegramAdminCard />);
    expect(screen.getByText('Connected to the portal')).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('refreshes on demand and says so when the state cannot be loaded at all', () => {
    render(<TelegramAdminCard />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(state.status.refetch).toHaveBeenCalled();
    cleanup();
    load(undefined, { isError: true });
    render(<TelegramAdminCard />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
