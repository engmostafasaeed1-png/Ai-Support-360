/** Phone alerts (Web Push) in the browser: what this browser can do, and the calls to the service worker and the push service of the browser. */

export type PushSupport = 'ok' | 'ios_needs_install' | 'in_frame' | 'preview_host' | 'unsupported';

export type PushEnv = {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIos: boolean;
  isStandalone: boolean;
  inFrame: boolean;
  hostname: string;
};

/** Can this browser, on this address, receive push messages? An iPhone only can from the Home Screen, and nothing works inside the editor preview. */
export function detectPushSupport(env: PushEnv): PushSupport {
  if (env.inFrame) return 'in_frame';
  if (/^id-preview--|\.lovableproject\.com$/.test(env.hostname)) return 'preview_host';
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) return 'ok';
  if (env.isIos && !env.isStandalone) return 'ios_needs_install';
  return 'unsupported';
}

export function browserPushEnv(): PushEnv {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { hasServiceWorker: false, hasPushManager: false, hasNotification: false, isIos: false, isStandalone: false, inFrame: false, hostname: '' };
  }
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  let inFrame = false;
  try {
    inFrame = window.self !== window.top;
  } catch {
    inFrame = true;
  }
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    isIos,
    isStandalone,
    inFrame,
    hostname: window.location.hostname,
  };
}

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function pushPermission(): PushPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Must be called straight from the tap of the consultant (Safari wants the question to come from a user action). */
export async function requestPushPermission(): Promise<PushPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

/** The key of the platform as the 65 octets that the push service wants (a fresh buffer, so that it is a plain BufferSource). */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const s = base64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type PushKeys = { endpoint: string; p256dh: string; auth: string };

/** The address and the two keys of a subscription as the database function wants them (null when the browser did not give the keys). */
export function keysOfSubscription(sub: { toJSON(): unknown }): PushKeys | null {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j || typeof j.endpoint !== 'string' || !j.keys || typeof j.keys.p256dh !== 'string' || typeof j.keys.auth !== 'string') return null;
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
}

/** Was the subscription made with the key of the platform that is valid now? (After the keys are replaced every device must subscribe again.) */
export function sameApplicationKey(sub: { options?: { applicationServerKey?: ArrayBuffer | null } }, publicKey: string): boolean {
  const have = sub.options?.applicationServerKey;
  if (!have) return false;
  const a = new Uint8Array(have);
  const b = urlBase64ToUint8Array(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** An error whose text is written for the consultant (the toasts show only these; any other error shows a fixed sentence). */
export class PushUserError extends Error {}

const WORKER_URL = '/sw.js';

/** The subscription of this device, or null when there is none (or the browser cannot say). */
export async function getThisDeviceSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(WORKER_URL);
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Registers the service worker and subscribes this device (the permission must be granted already). */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscription> {
  await navigator.serviceWorker.register(WORKER_URL);
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameApplicationKey(existing, publicKey)) return existing;
  if (existing) await existing.unsubscribe();
  try {
    return await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    throw new PushUserError(
      name === 'AbortError'
        ? 'Your browser could not reach its push service. Check your internet connection and try again. In Brave, turn on "Use Google Services for Push Messaging" in Settings > Privacy and security, or use Chrome, Edge, Firefox or Safari.'
        : name === 'NotAllowedError'
          ? 'Notifications are blocked for this site in your browser.'
          : 'Phone alerts could not be turned on in this browser. Please try another browser.',
    );
  }
}

/** Removes the subscription of this device in the browser and answers its address (null when there was none). */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const sub = await getThisDeviceSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

