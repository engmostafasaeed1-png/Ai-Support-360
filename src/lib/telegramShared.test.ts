import { beforeAll, describe, it, expect } from 'vitest';
import {
  buildAlertMessage, classifyUpdate, escapeHtml, maskAccountEmail, newLinkCode, parseStartCode, retryAfterSeconds, safeAreas, sendTelegram, sha256Hex,
  webhookSecretFor, webhookUrlFor, type Fetcher,
} from '../../supabase/functions/_shared/telegram';

const CODE = '0123456789abcdef0123456789abcdef';

beforeAll(async () => {
  // Node 20+ already has crypto.subtle; this only covers a runtime whose global crypto has none (for example jsdom's)
  if (!globalThis.crypto?.subtle) {
    const nodeCrypto = 'node:crypto';
    const { webcrypto } = await import(/* @vite-ignore */ nodeCrypto);
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

describe('escapeHtml and maskAccountEmail', () => {
  it('escapes the three characters that Telegram HTML reads', () => {
    expect(escapeHtml('A & B <b>x</b>')).toBe('A &amp; B &lt;b&gt;x&lt;/b&gt;');
  });

  it('shows only the first letter of the e-mail address', () => {
    expect(maskAccountEmail('mostafa@gmail.com')).toBe('m***@gmail.com');
    expect(maskAccountEmail('nonsense')).toBe('');
  });
});

describe('parseStartCode', () => {
  it('reads the code of /start and /start@bot', () => {
    expect(parseStartCode(`/start ${CODE}`)).toBe(CODE);
    expect(parseStartCode(`/start@AiSupport360Bot ${CODE}  `)).toBe(CODE);
  });

  it('refuses a missing, short, long or odd code', () => {
    expect(parseStartCode('/start')).toBeNull();
    expect(parseStartCode('/start abc')).toBeNull();
    expect(parseStartCode(`/start ${'a'.repeat(65)}`)).toBeNull();
    expect(parseStartCode(`/start ${CODE}!`)).toBeNull();
    expect(parseStartCode(`/start ${CODE} extra`)).toBeNull();
    expect(parseStartCode(`hello ${CODE}`)).toBeNull();
    expect(parseStartCode(42)).toBeNull();
  });
});

describe('crypto helpers', () => {
  it('derives the webhook secret as HMAC-SHA256 of the fixed text with the bot token as the key', async () => {
    // expected value computed outside the code under test (.NET HMACSHA256)
    const secret = await webhookSecretFor('123456:TEST-token');
    expect(secret).toBe('815f03e88b72cd734b703bd99df4e14c0d3b130812f6db98d323224a054ac1c4');
    expect(secret).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(await webhookSecretFor('123456:OTHER-token')).not.toBe(secret);
  });

  it('hashes a link code as lowercase SHA-256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(CODE)).toBe('3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9');
  });

  it('makes a fresh link code that the /start parser accepts', () => {
    const a = newLinkCode();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(newLinkCode());
    expect(parseStartCode(`/start ${a}`)).toBe(a);
  });

  it('gives the webhook an address that changes when the bot token changes', async () => {
    const a = await webhookUrlFor('123456:TEST-token', 'https://abc.supabase.co/');
    expect(a).toMatch(/^https:\/\/abc\.supabase\.co\/functions\/v1\/telegram-webhook\?k=[0-9a-f]{12}$/);
    expect(await webhookUrlFor('123456:TEST-token', 'https://abc.supabase.co')).toBe(a);
    expect(await webhookUrlFor('123456:OTHER-token', 'https://abc.supabase.co')).not.toBe(a);
  });
});

describe('classifyUpdate', () => {
  const message = (text: string, over: Record<string, unknown> = {}) => ({ message: { text, chat: { id: 1234567890123, type: 'private' }, from: { username: 'alice' }, ...over } });

  it('sees a start with a code, with the username', () => {
    expect(classifyUpdate(message(`/start ${CODE}`))).toEqual({ kind: 'start', chatId: 1234567890123, username: '@alice', code: CODE });
  });

  it('sees a start without a code and without a username', () => {
    expect(classifyUpdate(message('/start', { from: {} }))).toEqual({ kind: 'start', chatId: 1234567890123, username: null, code: null });
  });

  it('sees /stop', () => {
    expect(classifyUpdate(message('/stop'))).toEqual({ kind: 'stop', chatId: 1234567890123 });
  });

  it('sees that the user blocked or left the bot', () => {
    expect(classifyUpdate({ my_chat_member: { chat: { id: 7, type: 'private' }, new_chat_member: { status: 'kicked' } } })).toEqual({ kind: 'blocked', chatId: 7 });
    expect(classifyUpdate({ my_chat_member: { chat: { id: 7, type: 'private' }, new_chat_member: { status: 'left' } } })).toEqual({ kind: 'blocked', chatId: 7 });
    expect(classifyUpdate({ my_chat_member: { chat: { id: 7, type: 'private' }, new_chat_member: { status: 'member' } } })).toEqual({ kind: 'ignore' });
  });

  it('marks any other text of a private chat, so that the bot can say that it only sends alerts', () => {
    expect(classifyUpdate(message('hello'))).toEqual({ kind: 'other', chatId: 1234567890123 });
    expect(classifyUpdate(message('/stop now'))).toEqual({ kind: 'other', chatId: 1234567890123 });
  });

  it('ignores groups and anything else', () => {
    expect(classifyUpdate(message(`/start ${CODE}`, { chat: { id: -100, type: 'group' } }))).toEqual({ kind: 'ignore' });
    expect(classifyUpdate({ edited_message: {} })).toEqual({ kind: 'ignore' });
    expect(classifyUpdate({ update_id: 0 })).toEqual({ kind: 'ignore' });
    expect(classifyUpdate(null)).toEqual({ kind: 'ignore' });
    expect(classifyUpdate({ message: { text: '/start', chat: { id: 'x', type: 'private' } } })).toEqual({ kind: 'ignore' });
  });
});

describe('safeAreas', () => {
  it('keeps the plain names of the master list', () => {
    expect(safeAreas(['SAP FI/CO', 'SAP MM'])).toBe('SAP FI/CO, SAP MM');
    expect(safeAreas(['SAP ECC 6.0', 'BTP Development (CAP, Node.js, Java)', 'Basis - Transport Management (CTS+)']))
      .toBe('SAP ECC 6.0, BTP Development (CAP, Node.js, Java), Basis - Transport Management (CTS+)');
    expect(safeAreas(['S/4HANA Finance (FI/CO)'])).toBe('S/4HANA Finance (FI/CO)');
  });

  it('drops links, mentions, hashtags, phone numbers and bot commands', () => {
    expect(safeAreas(['evil.example/login', 'Pay now: x', '@scammer', '#x', 'a@b.com', '+201001234567', 'www.evil.com'])).toBe('SAP');
    expect(safeAreas(['SAP MM', 'evil.com/login'])).toBe('SAP MM');
    expect(safeAreas(['FI /stop', 'FI,/stop', 'FI (/start)', 'FI -/stop', '/stop'])).toBe('SAP');
  });

  it('falls back to SAP for an empty or wrong value', () => {
    expect(safeAreas(null)).toBe('SAP');
    expect(safeAreas([])).toBe('SAP');
    expect(safeAreas('SAP MM')).toBe('SAP');
  });
});

describe('buildAlertMessage', () => {
  const base = { areas: 'SAP FI/CO, SAP MM', minutes: 30, percent: 30, url: 'https://www.aisupport360.com/consultant/open-tickets?critical=t1', updated: false };

  it('says the area, the time limit and the surcharge, with a button to the request', () => {
    const m = buildAlertMessage(base);
    expect(m.text).toContain('Critical SAP request');
    expect(m.text).toContain('Area: SAP FI/CO, SAP MM');
    expect(m.text).toContain('Send a proposal in the portal within <b>30 min</b>');
    expect(m.text).toContain('<b>+30%</b>');
    expect(m.text).not.toContain('changed the terms');
    expect(m.reply_markup.inline_keyboard[0][0]).toEqual({ text: 'Open the request and reply', url: base.url });
  });

  it('says until when, and drops the surcharge sentence when there is none', () => {
    const m = buildAlertMessage({ ...base, percent: 0, until: '16:45 UTC' });
    expect(m.text).toContain('(before <b>16:45 UTC</b>)');
    expect(m.text).not.toContain('%');
    expect(m.text).not.toContain('hourly rate');
  });

  it('marks an update, escapes the area and keeps a fractional surcharge', () => {
    const m = buildAlertMessage({ ...base, updated: true, areas: 'A <b> & B', percent: 12.5, minutes: 44.6 });
    expect(m.text).toContain('Critical request updated');
    expect(m.text).toContain('The client changed the terms.');
    expect(m.text).toContain('Area: A &lt;b&gt; &amp; B');
    expect(m.text).toContain('<b>+12.5%</b>');
    expect(m.text).toContain('<b>45 min</b>');
  });
});

describe('retryAfterSeconds', () => {
  it('reads the wait that Telegram asks for', () => {
    expect(retryAfterSeconds({ parameters: { retry_after: 3 } })).toBe(3);
    expect(retryAfterSeconds({ parameters: { retry_after: 2.2 } })).toBe(3);
    expect(retryAfterSeconds({})).toBe(0);
    expect(retryAfterSeconds(null)).toBe(0);
  });
});

describe('sendTelegram', () => {
  const answer = (status: number, body: unknown): Fetcher => async () => ({ status, json: async () => body });
  const noSleep = async () => {};

  it('posts the message to the bot of the token and answers ok', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { status: 200, json: async () => ({ ok: true }) };
    };
    const res = await sendTelegram('123:ABC', 99, { text: 'Hi', reply_markup: { x: 1 } }, fetcher, noSleep);
    expect(res).toEqual({ ok: true, blocked: false });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(calls[0].body).toEqual({ chat_id: 99, text: 'Hi', parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { x: 1 } });
  });

  it('says blocked when the user stopped the bot or the chat does not exist', async () => {
    expect(await sendTelegram('t', 1, { text: 'x' }, answer(403, { ok: false, description: 'Forbidden: bot was blocked by the user' }), noSleep)).toEqual({ ok: false, blocked: true, error: 'bot_blocked' });
    expect(await sendTelegram('t', 1, { text: 'x' }, answer(400, { ok: false, description: 'Bad Request: chat not found' }), noSleep)).toEqual({ ok: false, blocked: true, error: 'chat_not_found' });
  });

  it('waits once when Telegram asks for a short pause, then sends again', async () => {
    let n = 0;
    const slept: number[] = [];
    const fetcher: Fetcher = async () => (++n === 1 ? { status: 429, json: async () => ({ ok: false, parameters: { retry_after: 2 } }) } : { status: 200, json: async () => ({ ok: true }) });
    const res = await sendTelegram('t', 1, { text: 'x' }, fetcher, async (ms) => { slept.push(ms); });
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
    expect(slept).toEqual([2000]);
  });

  it('gives up at once on a long pause and after a second 429', async () => {
    let n = 0;
    const long: Fetcher = async () => { n++; return { status: 429, json: async () => ({ ok: false, parameters: { retry_after: 30 } }) }; };
    expect(await sendTelegram('t', 1, { text: 'x' }, long, noSleep)).toEqual({ ok: false, blocked: false, error: 'rate_limited' });
    expect(n).toBe(1);
    n = 0;
    const twice: Fetcher = async () => { n++; return { status: 429, json: async () => ({ ok: false, parameters: { retry_after: 1 } }) }; };
    expect(await sendTelegram('t', 1, { text: 'x' }, twice, noSleep)).toEqual({ ok: false, blocked: false, error: 'rate_limited' });
    expect(n).toBe(2);
  });

  it('reports a network failure, a timeout and other errors without leaking the token', async () => {
    const down: Fetcher = async () => { throw new Error('connect failed https://api.telegram.org/bot123:ABC/sendMessage'); };
    const res = await sendTelegram('123:ABC', 1, { text: 'x' }, down, noSleep);
    expect(res).toEqual({ ok: false, blocked: false, error: 'network' });
    expect(JSON.stringify(res)).not.toContain('123:ABC');
    const timeout: Fetcher = async () => { throw new DOMException('The operation timed out', 'TimeoutError'); };
    expect(await sendTelegram('t', 1, { text: 'x' }, timeout, noSleep)).toEqual({ ok: false, blocked: false, error: 'network' });
    expect(await sendTelegram('t', 1, { text: 'x' }, answer(500, null), noSleep)).toEqual({ ok: false, blocked: false, error: 'http_500' });
  });
});

