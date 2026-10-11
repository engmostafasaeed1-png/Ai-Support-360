import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  browserPushEnv, detectPushSupport, getThisDeviceSubscription, keysOfSubscription, pushPermission, requestPushPermission, sameApplicationKey,
  PushUserError, subscribeThisDevice, unsubscribeThisDevice, urlBase64ToUint8Array, type PushEnv,
} from './webPush';

const KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const KEY_BYTES = urlBase64ToUint8Array(KEY);
const bufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const env = (over: Partial<PushEnv> = {}): PushEnv => ({
  hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIos: false, isStandalone: false, inFrame: false, hostname: 'www.aisupport360.com', ...over,
});

describe('detectPushSupport', () => {
  it('is ok in a browser with a service worker, push and notifications', () => {
    expect(detectPushSupport(env())).toBe('ok');
    expect(detectPushSupport(env({ isIos: true, isStandalone: true }))).toBe('ok');
  });

  it('asks an iPhone to add the portal to the Home Screen first', () => {
    expect(detectPushSupport(env({ isIos: true, hasPushManager: false }))).toBe('ios_needs_install');
    expect(detectPushSupport(env({ isIos: true, hasPushManager: false, hasNotification: false }))).toBe('ios_needs_install');
  });

  it('refuses a frame and the editor preview before anything else', () => {
    expect(detectPushSupport(env({ inFrame: true }))).toBe('in_frame');
    expect(detectPushSupport(env({ hostname: 'id-preview--2b30b1db-ed1c-4d7b-8706-596c66fe5232.lovable.app' }))).toBe('preview_host');
    expect(detectPushSupport(env({ hostname: '2b30b1db.lovableproject.com' }))).toBe('preview_host');
    expect(detectPushSupport(env({ hostname: 'ai-support-360.lovable.app' }))).toBe('ok');
  });

  it('says unsupported for a browser without push', () => {
    expect(detectPushSupport(env({ hasPushManager: false }))).toBe('unsupported');
    expect(detectPushSupport(env({ hasServiceWorker: false }))).toBe('unsupported');
  });
});

describe('browser environment', () => {
  it('reads the page it runs in', () => {
    const e = browserPushEnv();
    expect(e.hostname).toBe(window.location.hostname);
    expect(e.inFrame).toBe(false);
    expect(typeof e.hasServiceWorker).toBe('boolean');
  });

  it('knows the permission of the notifications', async () => {
    const original = (globalThis as { Notification?: unknown }).Notification;
    (globalThis as { Notification?: unknown }).Notification = { permission: 'denied', requestPermission: vi.fn(async () => 'granted') };
    expect(pushPermission()).toBe('denied');
    expect(await requestPushPermission()).toBe('granted');
    (globalThis as { Notification?: unknown }).Notification = original;
  });
});

describe('keys', () => {
  it('turns the key of the platform into its 65 octets', () => {
    expect(KEY_BYTES.length).toBe(65);
    expect(KEY_BYTES[0]).toBe(4);
  });

  it('reads the address and the two keys of a subscription', () => {
    expect(keysOfSubscription({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'P', auth: 'A' } }) })).toEqual({ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'P', auth: 'A' });
    expect(keysOfSubscription({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x' }) })).toBeNull();
    expect(keysOfSubscription({ toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }) })).toBeNull();
    expect(keysOfSubscription({ toJSON: () => null })).toBeNull();
  });

  it('compares the key of a subscription with the key of the platform', () => {
    expect(sameApplicationKey({ options: { applicationServerKey: bufferOf(KEY_BYTES) } }, KEY)).toBe(true);
    const other = new Uint8Array(KEY_BYTES);
    other[10] ^= 1;
    expect(sameApplicationKey({ options: { applicationServerKey: bufferOf(other) } }, KEY)).toBe(false);
    expect(sameApplicationKey({ options: { applicationServerKey: bufferOf(KEY_BYTES.slice(0, 64)) } }, KEY)).toBe(false);
    expect(sameApplicationKey({ options: {} }, KEY)).toBe(false);
    expect(sameApplicationKey({}, KEY)).toBe(false);
  });
});

describe('the device', () => {
  const setServiceWorker = (value: unknown) => Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
  afterEach(() => {
    // jsdom has no service worker: remove what a test added
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  const fakeSubscription = (key: Uint8Array | null, endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => ({
    endpoint,
    options: { applicationServerKey: key ? bufferOf(key) : null },
    unsubscribe: vi.fn(async () => true),
  });

  it('answers null when the browser has no service worker or no registration', async () => {
    expect(await getThisDeviceSubscription()).toBeNull();
    setServiceWorker({ getRegistration: vi.fn(async () => undefined) });
    expect(await getThisDeviceSubscription()).toBeNull();
  });

  it('registers the worker, waits until it is ready and subscribes with the key of the platform', async () => {
    const subscription = fakeSubscription(KEY_BYTES);
    const pushManager = { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async (_options: unknown) => subscription) };
    const register = vi.fn(async () => ({}));
    setServiceWorker({ register, ready: Promise.resolve({ pushManager }) });
    expect(await subscribeThisDevice(KEY)).toBe(subscription);
    expect(register).toHaveBeenCalledWith('/sw.js');
    const arg = pushManager.subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(arg.userVisibleOnly).toBe(true);
    expect(Array.from(arg.applicationServerKey)).toEqual(Array.from(KEY_BYTES));
  });

  it('keeps a subscription that was made with the same key', async () => {
    const existing = fakeSubscription(KEY_BYTES);
    const pushManager = { getSubscription: vi.fn(async () => existing), subscribe: vi.fn() };
    setServiceWorker({ register: vi.fn(async () => ({})), ready: Promise.resolve({ pushManager }) });
    expect(await subscribeThisDevice(KEY)).toBe(existing);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it('replaces a subscription that was made with an older key', async () => {
    const stale = fakeSubscription(new Uint8Array(65).fill(4));
    const fresh = fakeSubscription(KEY_BYTES);
    const pushManager = { getSubscription: vi.fn(async () => stale), subscribe: vi.fn(async () => fresh) };
    setServiceWorker({ register: vi.fn(async () => ({})), ready: Promise.resolve({ pushManager }) });
    expect(await subscribeThisDevice(KEY)).toBe(fresh);
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('turns a refusal of the push service into a sentence the consultant can act on', async () => {
    const abort = Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' });
    const pushManager = { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async (_options: unknown) => { throw abort; }) };
    setServiceWorker({ register: vi.fn(async () => ({})), ready: Promise.resolve({ pushManager }) });
    await expect(subscribeThisDevice(KEY)).rejects.toThrow(/could not reach its push service/);
    await expect(subscribeThisDevice(KEY)).rejects.toBeInstanceOf(PushUserError);
    pushManager.subscribe.mockImplementation(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); });
    await expect(subscribeThisDevice(KEY)).rejects.toThrow('Notifications are blocked for this site in your browser.');
    pushManager.subscribe.mockImplementation(async () => { throw new Error('boom'); });
    await expect(subscribeThisDevice(KEY)).rejects.toThrow(/could not be turned on in this browser/);
  });

  it('turns the subscription off and answers its address', async () => {
    const sub = fakeSubscription(KEY_BYTES, 'https://fcm.googleapis.com/fcm/send/xyz');
    setServiceWorker({ getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: async () => sub } })) });
    expect(await unsubscribeThisDevice()).toBe('https://fcm.googleapis.com/fcm/send/xyz');
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    setServiceWorker({ getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: async () => null } })) });
    expect(await unsubscribeThisDevice()).toBeNull();
  });
});

