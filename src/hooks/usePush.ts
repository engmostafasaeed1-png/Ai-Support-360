import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  PushUserError, browserPushEnv, detectPushSupport, getThisDeviceSubscription, keysOfSubscription, pushPermission, sameApplicationKey, subscribeThisDevice, unsubscribeThisDevice,
  type PushPermission, type PushSupport,
} from '@/lib/webPush';

// The push functions are newer than the generated database types, so they are called through an untyped client.
const db = supabase as any;

// Only texts written for the consultant are shown; browser and database error texts are technical English and are replaced by the fixed sentence of each action.
const reason = (e: unknown, fallback: string) => (e instanceof PushUserError && e.message ? e.message : fallback);

/** Calls one of the push edge functions; a failed call becomes an error with a plain message (a "too many requests" answer says to wait). */
async function callFunction<T>(name: string, action: string, failure: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: { action } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    throw new PushUserError(status === 429 ? 'Too many attempts. Please wait a while and try again.' : failure);
  }
  return data as T;
}

export type PushConfig = { configured: boolean; public_key: string | null };

/** The public key of the platform (nothing secret); configured = false until the administrator has created the keys. */
export function usePushConfig() {
  return useQuery({
    queryKey: ['push-config'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<PushConfig> => {
      const a = await callFunction<{ configured?: boolean; public_key?: string }>('push-config', 'config', 'Phone alerts could not be checked. Please reload the page.');
      return { configured: a?.configured === true && typeof a.public_key === 'string', public_key: typeof a?.public_key === 'string' ? a.public_key : null };
    },
  });
}

export type PushDeviceState = {
  support: PushSupport;
  permission: PushPermission;
  /** this browser holds a push subscription */
  subscribed: boolean;
  /** the subscription was made with an older key of the platform */
  keyMismatch: boolean;
  /** the server knows this device and it is active */
  registered: boolean;
  /** devices of the consultant that get phone alerts */
  devices: number;
};

/** What this device can do and has done: refreshed when the settings page opens and after every change. */
export function usePushDevice(publicKey: string | null | undefined) {
  return useQuery({
    queryKey: ['push-device', publicKey ?? null],
    staleTime: 5_000,
    retry: false,
    queryFn: async (): Promise<PushDeviceState> => {
      const support = detectPushSupport(browserPushEnv());
      const permission = pushPermission();
      const sub = support === 'ok' ? await getThisDeviceSubscription() : null;
      const { data, error } = await db.rpc('push_my_status', { _endpoint: sub ? sub.endpoint : null });
      if (error) throw new Error(error.message);
      return {
        support,
        permission,
        subscribed: !!sub,
        keyMismatch: !!sub && !!publicKey && !sameApplicationKey(sub, publicKey),
        registered: data?.this_device === true,
        devices: typeof data?.devices === 'number' ? data.devices : 0,
      };
    },
  });
}

/** Turns phone alerts on for this device. The permission has been granted already (the card asks for it straight from the tap). */
export function useEnablePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (publicKey: string) => {
      const sub = await subscribeThisDevice(publicKey);
      const keys = keysOfSubscription(sub);
      if (!keys) throw new PushUserError('This browser did not give the keys for push messages. Please try another browser.');
      const { error } = await db.rpc('push_subscribe', { _endpoint: keys.endpoint, _p256dh: keys.p256dh, _auth: keys.auth, _user_agent: navigator.userAgent.slice(0, 300) });
      if (error) throw error.code === '54000' ? new PushUserError('Too many attempts. Please wait a while and try again.') : new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Phone alerts are on for this device');
      qc.invalidateQueries({ queryKey: ['push-device'] });
    },
    onError: (e) => toast.error(reason(e, 'Phone alerts could not be turned on')),
  });
}

/** Turns phone alerts off for this device (the subscription is removed in the browser and in the database). */
export function useDisablePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) {
        const { error } = await db.rpc('push_unsubscribe', { _endpoint: endpoint });
        if (error) throw new PushUserError('Phone alerts could not be turned off. Please try again in a moment.');
      }
    },
    onSuccess: () => {
      toast.success('Phone alerts are off for this device');
      qc.invalidateQueries({ queryKey: ['push-device'] });
    },
    onError: (e) => toast.error(reason(e, 'Phone alerts could not be turned off')),
  });
}

export type PushTestAnswer = { configured: boolean; devices?: number; sent?: number; failed?: number };

/** A test message to every device of the consultant. */
export function useTestPush() {
  return useMutation({
    mutationFn: () => callFunction<PushTestAnswer>('push-config', 'test', 'The test alert could not be sent. Please try again in a moment.'),
    onError: (e) => toast.error(reason(e, 'The test alert could not be sent')),
  });
}

export type PushAdminStatus = { configured: boolean; created: boolean; devices: number; consultants: number; failed_24h: number };

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function readPushAdminStatus(raw: unknown): PushAdminStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { configured: r.configured === true, created: r.created === true, devices: count(r.devices), consultants: count(r.consultants), failed_24h: count(r.failed_24h) };
}

/** Administrator: are the keys created, and how many devices get phone alerts (refreshed every minute). */
export function usePushAdminStatus() {
  return useQuery({
    queryKey: ['push-admin-status'],
    staleTime: 10_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<PushAdminStatus> => readPushAdminStatus(await callFunction<unknown>('push-setup', 'status', 'The state of the phone alerts could not be loaded. Please try again in a moment.')),
  });
}

/** Administrator: creates the keys of the platform once. */
export function useGeneratePushKeys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PushAdminStatus> => readPushAdminStatus(await callFunction<unknown>('push-setup', 'generate', 'The keys could not be created. Please try again in a moment.')),
    onSuccess: (status) => {
      qc.setQueryData(['push-admin-status'], status);
      qc.invalidateQueries({ queryKey: ['push-config'] });
      toast.success(status.created ? 'The keys for phone alerts are created' : 'The keys already existed');
    },
    onError: (e) => toast.error(reason(e, 'The keys could not be created')),
  });
}

/** Called just before the person signs out: phone alerts belong to the signed-in account, so this device is taken off (never blocks the sign-out, 3 seconds at most). */
export async function releasePushOnSignOut(): Promise<void> {
  const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))]);
  try {
    const endpoint = await within(unsubscribeThisDevice());
    if (endpoint) await within(Promise.resolve(db.rpc('push_unsubscribe', { _endpoint: endpoint })));
  } catch {
    // signing out must never fail because of phone alerts
  }
}

