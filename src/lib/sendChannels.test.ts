import { describe, expect, it } from 'vitest';
import {
  activePreset, channelSkipReason, defaultSelection, presetSelection, pushPreview, toggleChannel, type ChannelMap,
} from './sendChannels';
import { inviteChannelInfo, inviteChannelReport, inviteReach } from './referralInvitations';

const all: ChannelMap = { in_app: { available: true }, email: { available: true }, push: { available: true }, telegram: { available: true } };
const noEmail: ChannelMap = { ...all, email: { available: false, reason: 'email_not_allowed' } };

describe('"Send via" presets', () => {
  it('default is In-app + E-mail (recommended)', () => {
    expect(defaultSelection(all)).toEqual(['in_app', 'email']);
    expect(activePreset(['in_app', 'email'], all)).toBe('in_app_email');
  });
  it('an unavailable channel is never selected silently: without e-mail the default is in-app only', () => {
    expect(defaultSelection(noEmail)).toEqual(['in_app']);
    expect(presetSelection('email_only', noEmail)).toEqual([]);
    expect(presetSelection('all', noEmail)).toEqual(['in_app', 'push', 'telegram']);
    expect(toggleChannel(['in_app'], 'email', true, noEmail)).toEqual(['in_app']);
  });
  it('a custom choice matches no preset', () => {
    expect(activePreset(['in_app', 'telegram'], all)).toBeNull();
    expect(activePreset(['in_app', 'push', 'telegram'], noEmail)).toBe('all');
  });
});

describe('per person and channel (mirror of the database)', () => {
  const p = { pushEnabled: true, telegramConnected: false };
  it('each channel is skipped with its own reason', () => {
    expect(channelSkipReason(p, 'in_app')).toBeNull();
    expect(channelSkipReason(p, 'push')).toBeNull();
    expect(channelSkipReason(p, 'telegram')).toBe('telegram_not_connected');
    expect(channelSkipReason({ pushEnabled: false }, 'push')).toBe('push_not_enabled');
    expect(channelSkipReason(p, 'email')).toBe('email_not_allowed');
    expect(channelSkipReason({ ...p, pausedApp: true }, 'in_app')).toBe('paused');
    expect(channelSkipReason({ ...p, pausedApp: true }, 'push')).toBe('paused');
  });
  it('dedupe is per channel: invited in-app today can still get push, never in-app twice without resend', () => {
    const invited = { ...p, sentThisVersion: { in_app: true }, lastSentAt: { in_app: '2026-10-20T10:00:00Z' } };
    expect(channelSkipReason(invited, 'in_app')).toBe('already_invited');
    expect(channelSkipReason(invited, 'push')).toBeNull();
  });
  it('a resend on a channel waits 14 days on that channel', () => {
    const invited = { ...p, sentThisVersion: { in_app: true }, lastSentAt: { in_app: '2026-10-20T10:00:00Z' } };
    expect(channelSkipReason(invited, 'in_app', { resend: true, now: new Date('2026-10-30T10:00:00Z') })).toBe('resend_too_soon');
    expect(channelSkipReason(invited, 'in_app', { resend: true, now: new Date('2026-11-04T10:00:00Z') })).toBeNull();
  });
});

describe('channel previews and reports', () => {
  it('push text has no greeting and no web address and is short', () => {
    const r = pushPreview('Invitation: Refer & earn', `Hello Sara,\n\nYou are invited.\n\nOpen: https://www.aisupport360.com/x\n\n${'x'.repeat(300)}`);
    expect(r.title).toBe('Invitation: Refer & earn');
    expect(r.body.startsWith('You are invited.')).toBe(true);
    expect(r.body).not.toMatch(/https?:|Hello/);
    expect(r.body.length).toBeLessThanOrEqual(180);
  });
  it('before the database update only in-app and Telegram are available (push waits, e-mail never)', () => {
    const info = inviteChannelInfo({ eligible: 31, telegram_linked: 0 });
    expect(info.in_app).toEqual({ available: true, eligible: 31 });
    expect(info.email?.available).toBe(false);
    expect(info.push?.reason).toBe('needs_update');
    expect(info.telegram?.available).toBe(false);
  });
  it('the reach of a choice comes from the per-combination counts', () => {
    expect(inviteReach({ eligible: 3, by_channel: {} }, ['in_app', 'push'], { 'in_app,push': 4 })).toBe(4);
  });
  it('the result report reads per channel, also for older runs', () => {
    expect(inviteChannelReport({ sent: 5, failed: 1, sending: 0, telegram_sent: 2, channels: ['in_app', 'telegram'] })).toEqual({
      in_app: { sent: 5, failed: 1, sending: 0, skipped: {} }, telegram: { sent: 2, failed: 0, sending: 0, skipped: {} },
    });
    expect(inviteChannelReport({ by_channel: { email: { skipped: { email_not_allowed: 3 } } } }).email).toEqual({ sent: 0, failed: 0, sending: 0, skipped: { email_not_allowed: 3 } });
  });
});
