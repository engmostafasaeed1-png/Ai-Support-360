import { describe, it, expect } from 'vitest';
import { adminNextStep, pausedMessage, readTelegramAdminStatus, readTelegramStatus, telegramView } from './telegramAlerts';

describe('readTelegramStatus', () => {
  it('reads a connected link', () => {
    const s = readTelegramStatus({ linked: true, active: true, username: '@alice', linked_at: '2026-10-12T10:00:00Z', last_sent_at: null, paused_reason: null });
    expect(s).toEqual({ linked: true, active: true, username: '@alice', linked_at: '2026-10-12T10:00:00Z', last_sent_at: null, paused_reason: null });
    expect(telegramView(s)).toBe('connected');
  });

  it('reads a paused link and says why', () => {
    const s = readTelegramStatus({ linked: true, active: false, username: null, paused_reason: 'bot_blocked' });
    expect(telegramView(s)).toBe('paused');
    expect(s.paused_reason).toBe('bot_blocked');
  });

  it('treats nothing, a bad answer or an unlinked account as not connected', () => {
    expect(telegramView(readTelegramStatus({ linked: false }))).toBe('not_connected');
    expect(telegramView(readTelegramStatus(null))).toBe('not_connected');
    expect(telegramView(readTelegramStatus('x'))).toBe('not_connected');
    expect(telegramView(undefined)).toBe('not_connected');
    expect(readTelegramStatus({ linked: false, active: true }).active).toBe(false);
  });
});

describe('pausedMessage', () => {
  it('explains the usual reasons in plain words', () => {
    expect(pausedMessage('bot_blocked')).toContain('blocked or removed the bot');
    expect(pausedMessage('chat_not_found')).toContain('blocked or removed the bot');
    expect(pausedMessage('stopped')).toContain('/stop');
    expect(pausedMessage(null)).toBe('The alerts are paused.');
    expect(pausedMessage('something else')).toBe('The alerts are paused.');
  });
});

describe('readTelegramAdminStatus and adminNextStep', () => {
  const bot = { username: 'AiSupport360Bot', name: 'AI Support 360' };
  const hook = (over: Record<string, unknown> = {}) => ({ connected: false, url_matches: false, probe_status: 0, url_set: false, pending_updates: 0, last_error: null, last_error_at: null, ...over });

  it('asks for the bot when the secret is missing', () => {
    const s = readTelegramAdminStatus({ configured: false });
    expect(s.configured).toBe(false);
    expect(adminNextStep(s)).toBe('create_bot');
  });

  it('asks for a new token when Telegram does not accept it', () => {
    const s = readTelegramAdminStatus({ configured: true, bot_ok: false });
    expect(adminNextStep(s)).toBe('fix_token');
  });

  it('asks to connect the bot to the portal until the webhook points here', () => {
    const s = readTelegramAdminStatus({ configured: true, bot_ok: true, bot, webhook: hook(), links: { total: 0, active: 0 } });
    expect(s.bot_username).toBe('AiSupport360Bot');
    expect(adminNextStep(s)).toBe('connect');
  });

  it('says that the webhook function does not answer when the address is right but the probe failed', () => {
    const s = readTelegramAdminStatus({ configured: true, bot_ok: true, bot, webhook: hook({ url_matches: true, url_set: true, probe_status: 401 }), links: { total: 0, active: 0 } });
    expect(s.webhook_probe_status).toBe(401);
    expect(adminNextStep(s)).toBe('webhook_down');
  });

  it('is ready when the webhook points here and answers, and carries the numbers', () => {
    const s = readTelegramAdminStatus({
      configured: true, bot_ok: true, bot: { username: 'b', name: 'B' },
      webhook: hook({ connected: true, url_matches: true, probe_status: 200, url_set: true, pending_updates: 2, last_error: 'Wrong response from the webhook: 500', last_error_at: '2026-10-12T10:00:00Z' }),
      links: { total: 5, active: 4 }, set: { ok: true, description: null },
    });
    expect(adminNextStep(s)).toBe('ready');
    expect(s.pending_updates).toBe(2);
    expect(s.last_error).toContain('500');
    expect(s.links_total).toBe(5);
    expect(s.links_active).toBe(4);
    expect(s.set_ok).toBe(true);
  });

  it('reads a failed connection attempt and ignores junk numbers', () => {
    const s = readTelegramAdminStatus({ configured: true, bot_ok: true, webhook: { pending_updates: -3 }, links: { total: 'x' }, set: { ok: false, description: 'Bad Request: bad webhook' } });
    expect(s.set_ok).toBe(false);
    expect(s.set_error).toBe('Bad Request: bad webhook');
    expect(s.pending_updates).toBe(0);
    expect(s.links_total).toBe(0);
    expect(readTelegramAdminStatus(null).set_ok).toBeNull();
  });
});
