import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { readTelegramAdminStatus, readTelegramStatus, type TelegramAdminStatus, type TelegramStatus } from '@/lib/telegramAlerts';

// The Telegram functions are newer than the generated database types, so they are called through an untyped client.
const db = supabase as any;

const reason = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Calls one of the Telegram edge functions; a failed call becomes an error with a plain message (a "too many requests" answer says to wait). */
async function callFunction<T>(name: string, action: string, failure: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: { action } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    throw new Error(status === 429 ? 'Too many attempts. Please wait a while and try again.' : failure);
  }
  return data as T;
}

/** Consultant: the own Telegram link. `poll` refreshes it every 3 seconds while the consultant is pressing Start in Telegram. */
export function useTelegramStatus(poll = false) {
  return useQuery({
    queryKey: ['telegram-status'],
    staleTime: 5_000,
    refetchInterval: poll ? 3_000 : false,
    retry: false,
    queryFn: async (): Promise<TelegramStatus> => {
      const { data, error } = await db.rpc('telegram_my_status', {});
      if (error) throw new Error(error.message);
      return readTelegramStatus(data);
    },
  });
}

export type ConnectAnswer = { configured: boolean; url?: string; expires_in?: number; reason?: string };

/** Consultant: asks for a one-time link to the bot (the screen opens it). configured = false when the bot is not set up yet (reason says why, when it is known). */
export function useConnectTelegram() {
  return useMutation({
    mutationFn: () => callFunction<ConnectAnswer>('telegram-link', 'start', 'Telegram could not be connected. Please try again in a moment.'),
    onError: (e) => toast.error(reason(e, 'Telegram could not be connected')),
  });
}

export type TestAnswer = { configured: boolean; sent?: boolean; reason?: string | null };

/** Consultant: a test message to the connected chat. */
export function useTestTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => callFunction<TestAnswer>('telegram-link', 'test', 'The test message could not be sent. Please try again in a moment.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-status'] }),
    onError: (e) => toast.error(reason(e, 'The test message could not be sent')),
  });
}

/** Consultant: disconnects Telegram (the chat number and the user name are deleted). */
export function useDisconnectTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc('telegram_unlink', {});
      if (error) throw new Error('Telegram could not be disconnected. Please try again in a moment.');
    },
    onSuccess: () => {
      toast.success('Telegram disconnected');
      qc.invalidateQueries({ queryKey: ['telegram-status'] });
    },
    onError: (e) => toast.error(reason(e, 'Telegram could not be disconnected')),
  });
}

/** Administrator: the state of the bot, refreshed every minute. */
export function useTelegramAdminStatus() {
  return useQuery({
    queryKey: ['telegram-admin-status'],
    staleTime: 10_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<TelegramAdminStatus> =>
      readTelegramAdminStatus(await callFunction<unknown>('telegram-setup', 'status', 'The bot could not be reached. Please try again in a moment.')),
  });
}

/** Administrator: tells Telegram to send the messages of the bot to this portal. */
export function useSetTelegramWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TelegramAdminStatus> =>
      readTelegramAdminStatus(await callFunction<unknown>('telegram-setup', 'set_webhook', 'The bot could not be connected. Please try again in a moment.')),
    onSuccess: (status) => {
      qc.setQueryData(['telegram-admin-status'], status);
      if (status.set_ok === true) toast.success('The bot is connected to the portal');
      else toast.error(status.set_error ?? 'Telegram did not accept the connection');
    },
    onError: (e) => toast.error(reason(e, 'The bot could not be connected')),
  });
}
