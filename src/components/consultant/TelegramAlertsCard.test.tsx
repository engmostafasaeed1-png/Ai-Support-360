import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  status: { data: undefined as unknown, isLoading: false, isError: false },
  polled: [] as boolean[],
  connect: vi.fn(),
  test: vi.fn(),
  disconnect: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: state.toastSuccess, error: state.toastError } }));
vi.mock('@/hooks/useTelegram', () => ({
  useTelegramStatus: (poll: boolean) => {
    state.polled.push(poll);
    return state.status;
  },
  useConnectTelegram: () => ({ mutateAsync: state.connect, isPending: false }),
  useTestTelegram: () => ({ mutateAsync: state.test, isPending: false }),
  useDisconnectTelegram: () => ({ mutate: state.disconnect, isPending: false }),
}));

import TelegramAlertsCard from './TelegramAlertsCard';

const status = (over: Record<string, unknown> = {}) => ({ linked: false, active: false, username: null, linked_at: null, last_sent_at: null, paused_reason: null, ...over });
const connected = () => ({ data: status({ linked: true, active: true, username: '@alice' }), isLoading: false, isError: false });
const LINK = 'https://t.me/AiSupport360Bot?start=abc';

beforeEach(() => {
  state.status = { data: status(), isLoading: false, isError: false };
  state.polled = [];
  state.connect.mockReset();
  state.test.mockReset();
  state.disconnect.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TelegramAlertsCard', () => {
  it('offers to connect, says what is sent, who gets it and what is stored', () => {
    render(<TelegramAlertsCard />);
    expect(screen.getByText('Telegram alerts')).toBeTruthy();
    expect(screen.getByText(/the title and the description stay in the portal/)).toBeTruthy();
    expect(screen.getByText(/only while your account is verified and "New case alerts" is switched on/)).toBeTruthy();
    expect(screen.getByTestId('telegram-privacy-note').textContent).toContain('a service of a third party');
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy-policy');
    expect(screen.getByRole('button', { name: /Connect Telegram/ })).toBeTruthy();
  });

  it('opens the link of the bot and waits for the Start, polling the status', async () => {
    state.connect.mockResolvedValue({ configured: true, url: LINK });
    render(<TelegramAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Connect Telegram/ }));
    await waitFor(() => expect(screen.getByTestId('telegram-waiting')).toBeTruthy());
    expect(window.open).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer');
    expect(screen.getByRole('link', { name: /Open Telegram/ }).getAttribute('href')).toBe(LINK);
    expect(state.polled[state.polled.length - 1]).toBe(true);
    expect(screen.queryByRole('button', { name: /Connect Telegram/ })).toBeNull();
  });

  it('stops waiting and says so once when the chat gets linked', async () => {
    state.connect.mockResolvedValue({ configured: true, url: LINK });
    const { rerender } = render(<TelegramAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Connect Telegram/ }));
    await waitFor(() => expect(screen.getByTestId('telegram-waiting')).toBeTruthy());
    state.status = connected();
    rerender(<TelegramAlertsCard />);
    expect(screen.getByTestId('telegram-connected')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('telegram-waiting')).toBeNull());
    expect(state.toastSuccess).toHaveBeenCalledWith('Telegram is connected');
    expect(state.toastSuccess).toHaveBeenCalledTimes(1);
    expect(state.polled[state.polled.length - 1]).toBe(false);
  });

  it('stops waiting after 15 minutes and offers the button again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    state.connect.mockResolvedValue({ configured: true, url: LINK });
    render(<TelegramAlertsCard />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Connect Telegram/ })); });
    expect(screen.getByTestId('telegram-waiting')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(15 * 60 * 1000 + 1); });
    expect(screen.queryByTestId('telegram-waiting')).toBeNull();
    expect(screen.getByRole('button', { name: /Connect Telegram/ })).toBeTruthy();
  });

  it('keeps the button and shows nothing new when the link could not be made', async () => {
    state.connect.mockRejectedValue(new Error('Telegram could not be connected. Please try again in a moment.'));
    render(<TelegramAlertsCard />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Connect Telegram/ })); });
    expect(screen.queryByTestId('telegram-waiting')).toBeNull();
    expect(screen.getByRole('button', { name: /Connect Telegram/ })).toBeTruthy();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('says that Telegram is not available when the administrator has not connected the bot', async () => {
    state.connect.mockResolvedValue({ configured: false, reason: 'webhook_missing' });
    render(<TelegramAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Connect Telegram/ }));
    await waitFor(() => expect(screen.getByTestId('telegram-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('telegram-unreachable')).toBeNull();
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Connect Telegram/ })).toBeTruthy();
  });

  it('says that Telegram could not be reached when it is down, not that the administrator did something wrong', async () => {
    state.connect.mockResolvedValue({ configured: false, reason: 'bot_unreachable' });
    render(<TelegramAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Connect Telegram/ }));
    await waitFor(() => expect(screen.getByTestId('telegram-unreachable')).toBeTruthy());
    expect(screen.queryByTestId('telegram-unavailable')).toBeNull();
  });

  it('shows the connected state with the user name, the checklist, a test and a disconnect', async () => {
    state.status = connected();
    state.test.mockResolvedValue({ configured: true, sent: true });
    render(<TelegramAlertsCard />);
    expect(screen.getByTestId('telegram-connected')).toBeTruthy();
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.getByText('Do not mute the chat with the bot.')).toBeTruthy();
    expect(screen.getByText(/Do Not Disturb and Focus modes silence Telegram/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect Telegram/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Send a test message/ }));
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith('Test message sent: check Telegram'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(state.disconnect).toHaveBeenCalled();
  });

  it('tells the consultant when the test message did not arrive because the bot was blocked', async () => {
    state.status = connected();
    state.test.mockResolvedValue({ configured: true, sent: false, reason: 'bot_blocked' });
    render(<TelegramAlertsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Send a test message/ }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Telegram says that you blocked the bot. Press Reconnect.'));
  });

  it('shows a paused link with the reason, a reconnect button and a disconnect that deletes the stored data', () => {
    state.status = { data: status({ linked: true, active: false, username: '@alice', paused_reason: 'stopped' }), isLoading: false, isError: false };
    render(<TelegramAlertsCard />);
    expect(screen.getByTestId('telegram-paused').textContent).toContain('You sent /stop to the bot');
    expect(screen.getByRole('button', { name: /Reconnect Telegram/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(state.disconnect).toHaveBeenCalled();
  });

  it('keeps the last known state when a refresh fails', () => {
    state.status = { ...connected(), isError: true };
    render(<TelegramAlertsCard />);
    expect(screen.getByTestId('telegram-connected')).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('says so when the status cannot be loaded at all', () => {
    state.status = { data: undefined, isLoading: false, isError: true };
    render(<TelegramAlertsCard />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
