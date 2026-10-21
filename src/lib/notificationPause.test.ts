import { beforeAll, describe, expect, it } from 'vitest';
import {
  LINK_TTL_SECONDS, allowedDurations, assignmentEmailCategory, buildPauseLinks, isPausedFor, notificationCategory,
  pauseEndsAt, popupHeldByPause, signPauseToken, verifyPauseToken, type PauseState,
} from '../../supabase/functions/_shared/notificationPause';
import { isHeldNow } from './notificationPause';

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const nodeCrypto = 'node:crypto';
    const { webcrypto } = await import(/* @vite-ignore */ nodeCrypto);
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const SECRET = 'a'.repeat(64);
const USER = '0f6c2a3e-1b2c-4d5e-8f90-1234567890ab';
const NOW_S = 1_800_000_000;
const NOW = NOW_S * 1000;
const week: PauseState = {
  paused_until: new Date(NOW + 7 * 86_400_000).toISOString(),
  email: true, in_app: true, categories: ['reminders', 'digests', 'activity'], hold_in_app: false,
};

describe('signed pause links', () => {
  const payload = { u: USER, d: '1w' as const, x: NOW_S + 3600, n: '0123456789abcdef' };

  it('accepts a valid token and returns user, duration and nonce', async () => {
    const r = await verifyPauseToken(SECRET, await signPauseToken(SECRET, payload), NOW_S);
    expect(r).toEqual({ ok: true, payload });
  });

  it('rejects an expired token', async () => {
    const r = await verifyPauseToken(SECRET, await signPauseToken(SECRET, { ...payload, x: NOW_S - 1 }), NOW_S);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token whose payload was changed (longer pause, other user)', async () => {
    const token = await signPauseToken(SECRET, payload);
    const [, body, sig] = token.split('.');
    const other = await signPauseToken(SECRET, { ...payload, d: '1m', u: '11111111-1111-4111-8111-111111111111' });
    const forged = `v1.${other.split('.')[1]}.${sig}`;
    expect(await verifyPauseToken(SECRET, forged, NOW_S)).toEqual({ ok: false, reason: 'signature' });
    expect(body).not.toEqual(other.split('.')[1]);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signPauseToken('b'.repeat(64), payload);
    expect(await verifyPauseToken(SECRET, token, NOW_S)).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects malformed tokens and refuses to work without a strong secret', async () => {
    expect(await verifyPauseToken(SECRET, 'v1.abc', NOW_S)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyPauseToken(SECRET, 42, NOW_S)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyPauseToken('short', 'v1.a.b', NOW_S)).toEqual({ ok: false, reason: 'invalid' });
    await expect(signPauseToken('', payload)).rejects.toThrow();
  });

  it('rejects a correctly signed token with an unknown duration', async () => {
    const token = await signPauseToken(SECRET, { ...payload, d: '1y' as never });
    expect(await verifyPauseToken(SECRET, token, NOW_S)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('builds three footer links (no own unsubscribe link) valid for 30 days, each with its own nonce and no personal data', async () => {
    const links = await buildPauseLinks(SECRET, USER, 'https://www.aisupport360.com', NOW_S, 'ar');
    const tokens = Object.values(links).map((l) => decodeURIComponent(new URL(l).searchParams.get('t') ?? ''));
    const checked = await Promise.all(tokens.map((t) => verifyPauseToken(SECRET, t, NOW_S)));
    expect(checked.map((c) => c.ok && c.payload.d)).toEqual(['3d', '1w', '1m']);
    expect(new Set(checked.map((c) => c.ok && c.payload.n)).size).toBe(3);
    expect(checked.every((c) => c.ok && c.payload.x === NOW_S + LINK_TTL_SECONDS)).toBe(true);
    expect(links.d3).toContain('&lang=ar');
    expect(links.d3).not.toContain('@');
  });
});

describe('essential notifications are never paused', () => {
  it.each([
    ['critical_request', 'Critical request'], ['payment', 'Payment received'], ['security_alert', 'New sign-in'],
    ['nda', 'NDA signed'], ['policy_reminder', 'Please confirm the policy'], ['approval', 'Account approved'],
    ['match_request', 'New assignment request'], ['admin_reminder_policy', 'Please confirm'],
  ])('%s stays essential', (type, title) => {
    const category = notificationCategory(type, title);
    expect(category).toBe('essential');
    expect(isPausedFor(week, category, 'email', NOW)).toBe(false);
    expect(isPausedFor(week, category, 'in_app', NOW)).toBe(false);
  });

  it('pauses reminders, digests and activity updates', () => {
    expect(notificationCategory('match_request', 'Reminder: assignment request waiting')).toBe('reminders');
    expect(notificationCategory('match_request', 'تذكير: طلب تعيين بانتظار ردك')).toBe('reminders');
    expect(notificationCategory('profile_reminder', 'Add your location')).toBe('reminders');
    expect(notificationCategory('admin', 'Assignment requests without reply')).toBe('digests');
    expect(notificationCategory('match_request', 'No reply from the consultant')).toBe('activity');
    expect(notificationCategory('ticket', 'Ticket updated')).toBe('activity');
    expect(isPausedFor(week, 'reminders', 'email', NOW)).toBe(true);
  });

  it('respects the chosen channel and kinds', () => {
    const emailOnly = { ...week, in_app: false, categories: ['reminders'] };
    expect(isPausedFor(emailOnly, 'reminders', 'email', NOW)).toBe(true);
    expect(isPausedFor(emailOnly, 'reminders', 'in_app', NOW)).toBe(false);
    expect(isPausedFor(emailOnly, 'reminders', 'push', NOW)).toBe(false);
    expect(isPausedFor(emailOnly, 'activity', 'email', NOW)).toBe(false);
  });

  it('does nothing when administrators switched pausing off', () => {
    expect(isPausedFor(week, 'reminders', 'email', NOW, false)).toBe(false);
  });
});

describe('pause expiry and lengths', () => {
  it('ends by itself at the end date', () => {
    const end = Date.parse(week.paused_until);
    expect(isPausedFor(week, 'activity', 'email', end - 1)).toBe(true);
    expect(isPausedFor(week, 'activity', 'email', end)).toBe(false);
  });

  it('offers 3 days / 1 week / 1 month within the admin maximum', () => {
    expect(allowedDurations(30)).toEqual(['3d', '1w', '1m']);
    expect(allowedDurations(7)).toEqual(['3d', '1w']);
    expect(allowedDurations(undefined)).toEqual(['3d', '1w', '1m']);
    expect(pauseEndsAt('1w', NOW).getTime()).toBe(NOW + 7 * 86_400_000);
    expect(pauseEndsAt('1m', NOW, 7).getTime()).toBe(NOW + 7 * 86_400_000);
  });

  it('keeps held in-app notices out of the bell until the pause ends', () => {
    const held = { held_until: week.paused_until };
    expect(isHeldNow(held, NOW)).toBe(true);
    expect(isHeldNow(held, Date.parse(week.paused_until) + 1)).toBe(false);
    expect(isHeldNow({ held_until: null }, NOW)).toBe(false);
  });
});

describe('assignment reminders are held, first requests are not', () => {
  it('sends the first request and Critical e-mails, holds 2 h / 4 h / 1 day reminders', () => {
    expect(assignmentEmailCategory('request', 'consultant', false)).toBe('essential');
    expect(['r1', 'r2', 'r3'].map((s) => assignmentEmailCategory(s, 'consultant', false))).toEqual(['reminders', 'reminders', 'reminders']);
    expect(assignmentEmailCategory('r2', 'consultant', true)).toBe('essential');
    expect(isPausedFor(week, assignmentEmailCategory('r1', 'consultant', false), 'email', NOW)).toBe(true);
    expect(isPausedFor(week, assignmentEmailCategory('request', 'consultant', false), 'email', NOW)).toBe(false);
  });

  it('pops up a new request once, but holds reminder re-pops during an in-app pause', () => {
    expect(popupHeldByPause({ reminders_sent: 0 }, week, NOW)).toBe(false);
    expect(popupHeldByPause({ reminders_sent: 2 }, week, NOW)).toBe(true);
    expect(popupHeldByPause({ reminders_sent: 2, critical: true }, week, NOW)).toBe(false);
    expect(popupHeldByPause({ reminders_sent: 2 }, { ...week, in_app: false }, NOW)).toBe(false);
    expect(popupHeldByPause({ reminders_sent: 2 }, null, NOW)).toBe(false);
  });
});
