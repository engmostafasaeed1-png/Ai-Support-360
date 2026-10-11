import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Handler = (event: Record<string, unknown>) => void;

const ORIGIN = 'https://www.aisupport360.com';
const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

/** Runs public/sw.js against a fake worker scope and returns the handlers it registered. */
function loadWorker() {
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => [] as unknown[]), openWindow: vi.fn(async () => undefined) },
    registration: { showNotification: vi.fn(async () => undefined) },
    addEventListener: (name: string, fn: Handler) => { handlers[name] = fn; },
  };
  new Function('self', source)(self);
  return { self, handlers };
}

const pushEvent = (payload: unknown, bad = false) => {
  const waits: Promise<unknown>[] = [];
  return {
    event: {
      data: bad ? { json: () => { throw new Error('not json'); } } : payload === null ? null : { json: () => payload },
      waitUntil: (p: Promise<unknown>) => { waits.push(p); },
    },
    done: () => Promise.all(waits),
  };
};

let w: ReturnType<typeof loadWorker>;
beforeEach(() => { w = loadWorker(); });

describe('service worker for phone alerts', () => {
  it('registers only the handlers it needs: no fetch handler, so it can never serve an old app', () => {
    expect(Object.keys(w.handlers).sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
    expect(source).not.toMatch(/caches\./);
    expect(source).not.toMatch(/'fetch'/);
  });

  it('takes over at once', async () => {
    w.handlers.install({});
    expect(w.self.skipWaiting).toHaveBeenCalled();
    const waits: Promise<unknown>[] = [];
    w.handlers.activate({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('shows the notification of the message and keeps an urgent one on the screen', async () => {
    const { event, done } = pushEvent({ title: 'Critical request', body: 'SAP FI is down', url: '/consultant/open-tickets/42', tag: 't-42', urgent: true, sent_at: 1700000000000 });
    w.handlers.push(event);
    await done();
    const [title, options] = w.self.registration.showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(title).toBe('Critical request');
    expect(options).toMatchObject({ body: 'SAP FI is down', tag: 't-42', requireInteraction: true, renotify: true, timestamp: 1700000000000, data: { url: '/consultant/open-tickets/42' } });
  });

  it('always shows a notification, also for a message that is empty or broken', async () => {
    for (const make of [() => pushEvent(null), () => pushEvent(undefined, true), () => pushEvent('text')]) {
      w.self.registration.showNotification.mockClear();
      const { event, done } = make();
      w.handlers.push(event);
      await done();
      expect(w.self.registration.showNotification).toHaveBeenCalledTimes(1);
      expect((w.self.registration.showNotification.mock.calls[0] as unknown[])[0]).toBe('AI Support 360');
    }
  });

  it('never sends the consultant to another site', async () => {
    for (const url of ['https://evil.example/phish', '//evil.example/x', 'javascript:alert(1)']) {
      w.self.registration.showNotification.mockClear();
      const { event, done } = pushEvent({ title: 'x', url });
      w.handlers.push(event);
      await done();
      const options = (w.self.registration.showNotification.mock.calls[0] as unknown[])[1] as { data: { url: string } };
      expect(options.data.url.startsWith('/')).toBe(true);
      expect(options.data.url.startsWith('//')).toBe(false);
    }
  });

  it('keeps the path of an address written for another host of the same portal, always opened on this origin', async () => {
    const { event, done } = pushEvent({ title: 'x', url: 'https://www.other-host.example/consultant/open-tickets?critical=42' });
    w.handlers.push(event);
    await done();
    const options = (w.self.registration.showNotification.mock.calls[0] as unknown[])[1] as { data: { url: string } };
    expect(options.data.url).toBe('/consultant/open-tickets?critical=42');
  });

  it('limits the length of the texts', async () => {
    const { event, done } = pushEvent({ title: 'T'.repeat(500), body: 'B'.repeat(2000), tag: 'g'.repeat(500) });
    w.handlers.push(event);
    await done();
    const [title, options] = w.self.registration.showNotification.mock.calls[0] as unknown as [string, { body: string; tag: string }];
    expect(title.length).toBe(80);
    expect(options.body.length).toBe(300);
    expect(options.tag.length).toBe(80);
  });

  it('focuses and opens the portal window when the notification is tapped', async () => {
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    w.self.clients.matchAll.mockResolvedValue([{ url: 'https://other.example/', focus: vi.fn(), navigate: vi.fn() }, { url: `${ORIGIN}/consultant`, focus, navigate }]);
    const close = vi.fn();
    const waits: Promise<unknown>[] = [];
    w.handlers.notificationclick({ notification: { close, data: { url: '/consultant/open-tickets/42' } }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/consultant/open-tickets/42`);
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window when the portal is not open', async () => {
    const waits: Promise<unknown>[] = [];
    w.handlers.notificationclick({ notification: { close: vi.fn(), data: { url: '/consultant/open-tickets' } }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(w.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/consultant/open-tickets`);
  });
});

