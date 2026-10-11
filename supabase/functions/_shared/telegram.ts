// Telegram helpers shared by the Telegram edge functions (telegram-link, telegram-webhook, telegram-setup) and by critical-request-alert.
// Only web APIs are used (fetch, crypto.subtle, TextEncoder): no Deno globals, so the pure parts are unit-tested with vitest.

export const TG_API = 'https://api.telegram.org';
export const LINK_CODE_MINUTES = 15;

export type TgResponse = { status: number; json: () => Promise<unknown> };
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<TgResponse>;

const TG_TIMEOUT_MS = 8000;
// a hung connection to Telegram must not keep the workers of an edge function waiting until the platform kills it
const defaultFetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TG_TIMEOUT_MS) });
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "m***@gmail.com": enough for a person to recognise their own account, not enough to identify someone else's. */
export function maskAccountEmail(email: string): string {
  const [local, domain] = String(email).split('@');
  return domain ? `${local.slice(0, 1)}***@${domain}` : '';
}

const toHex = (buffer: ArrayBuffer | Uint8Array): string =>
  Array.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The secret that Telegram sends back in the header X-Telegram-Bot-Api-Secret-Token: the HMAC-SHA256 of a fixed text with the bot token as the key,
 * as 64 hex characters (Telegram allows A-Z a-z 0-9 _ -). Nothing has to be stored or typed, and it changes when the bot token changes.
 */
export async function webhookSecretFor(botToken: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(botToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode('aisupport360-telegram-webhook')));
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * The address that Telegram must call. It carries a one-way fingerprint of the webhook secret, so it changes when the bot token changes and the admin card
 * notices a webhook that was registered with an old secret (Telegram never returns the secret).
 */
export async function webhookUrlFor(botToken: string, supabaseUrl: string): Promise<string> {
  const fingerprint = (await sha256Hex(await webhookSecretFor(botToken))).slice(0, 12);
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/telegram-webhook?k=${fingerprint}`;
}

/** A new one-time link code: 16 random bytes as 32 hex characters (the start parameter of a Telegram link takes A-Z a-z 0-9 _ - up to 64). */
export function newLinkCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** The code of "/start <code>" (also "/start@MyBot <code>"); null for anything else. */
export function parseStartCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const m = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text.trim());
  return m && CODE_RE.test(m[1]) ? m[1] : null;
}

export type TgEvent =
  | { kind: 'start'; chatId: number; username: string | null; code: string | null }
  | { kind: 'stop'; chatId: number }
  | { kind: 'blocked'; chatId: number }
  | { kind: 'other'; chatId: number }
  | { kind: 'ignore' };

/** What a Telegram update means for us. Only private chats count; everything else is ignored. */
// deno-lint-ignore no-explicit-any
export function classifyUpdate(update: any): TgEvent {
  const msg = update?.message;
  if (msg && msg.chat?.type === 'private' && Number.isSafeInteger(msg.chat.id) && typeof msg.text === 'string') {
    const text = msg.text.trim();
    if (/^\/stop(?:@\w+)?$/.test(text)) return { kind: 'stop', chatId: msg.chat.id };
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(text)) {
      const raw = typeof msg.from?.username === 'string' ? msg.from.username : '';
      return { kind: 'start', chatId: msg.chat.id, username: raw ? `@${raw.slice(0, 60)}` : null, code: parseStartCode(text) };
    }
    // any other text in a private chat: the bot tells the person that it only sends alerts (a chat reply is not a proposal)
    return { kind: 'other', chatId: msg.chat.id };
  }
  const member = update?.my_chat_member;
  if (member && member.chat?.type === 'private' && Number.isSafeInteger(member.chat.id)) {
    const status = member.new_chat_member?.status;
    if (status === 'kicked' || status === 'left') return { kind: 'blocked', chatId: member.chat.id };
  }
  return { kind: 'ignore' };
}

export type AlertMessage = { text: string; reply_markup: { inline_keyboard: { text: string; url: string }[][] } };

// An SAP area name as the master list writes it (src/lib/sapAreas.ts): starts with a letter or digit, then letters, digits, space and / ( ) , . + - only, 80 characters at most (the database limit).
const AREA_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 /(),.+-]{0,79}$/;
// What Telegram turns into a link, a phone call or a bot command: a dot followed by a letter (a web address; ".js" as in "Node.js" is not a domain), a plus before a digit,
// or a slash that starts a word (a command such as /stop; the slash of FI/CO follows a letter and stays).
const LINKABLE_RE = /\.(?!js\b)[A-Za-z]|\+\d|(?:^|[^A-Za-z0-9])\/[A-Za-z]/i;

/**
 * tickets.sap_modules is typed by the client and has no list check in the database, so only plain area names reach the phones: anything that could become
 * a link, a mention, a hashtag, a phone number or a bot command is dropped.
 */
export function safeAreas(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : [];
  const names = list.map((x) => String(x ?? '').trim()).filter((x) => AREA_NAME_RE.test(x) && !LINKABLE_RE.test(x));
  return names.join(', ').slice(0, 160) || 'SAP';
}

/**
 * The message for a critical request: only the SAP area, the time limit and the surcharge. The title and the description stay in the portal.
 * "Send a proposal in the portal" and not "reply": a reply in the chat does not reach the client. `areas` must come from safeAreas.
 */
export function buildAlertMessage(a: { areas: string; minutes: number; percent: number; url: string; updated: boolean; until?: string }): AlertMessage {
  const head = a.updated ? '🔔 <b>Critical request updated</b>' : '🚨 <b>Critical SAP request</b>';
  const minutes = Math.max(1, Math.round(a.minutes));
  const percent = Number(a.percent);
  const within = `<b>${minutes} min</b>${a.until ? ` (before <b>${escapeHtml(a.until)}</b>)` : ''}`;
  const lines = [head];
  if (a.updated) lines.push('The client changed the terms.');
  lines.push(`Area: ${escapeHtml(a.areas)}`);
  lines.push(
    percent > 0
      ? `Send a proposal in the portal within ${within} and your hourly rate gets <b>+${percent}%</b> on this ticket if the client accepts it.`
      : `Send a proposal in the portal within ${within}.`,
  );
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: [[{ text: 'Open the request and reply', url: a.url }]] } };
}

/** Seconds that Telegram asks us to wait (HTTP 429), 0 when it did not say. */
export function retryAfterSeconds(body: unknown): number {
  const s = Number((body as { parameters?: { retry_after?: unknown } } | null)?.parameters?.retry_after);
  return Number.isFinite(s) && s > 0 ? Math.ceil(s) : 0;
}

/** One call of the Bot API. A network failure answers { ok: false, status: 0 }; the token is never part of an error text. */
export async function tgCall(
  token: string,
  method: string,
  payload: unknown = {},
  fetcher: Fetcher = defaultFetcher,
  // deno-lint-ignore no-explicit-any
): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetcher(`${TG_API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    // deno-lint-ignore no-explicit-any
    const body: any = await res.json().catch(() => null);
    return { ok: res.status === 200 && body?.ok === true, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export type SendResult = { ok: boolean; blocked: boolean; error?: string };

/**
 * Sends one message. blocked = the user stopped or blocked the bot (or the chat does not exist): the link must be paused.
 * A "too many requests" answer is waited out once when it asks for 5 seconds or less.
 */
export async function sendTelegram(
  token: string,
  chatId: number,
  message: { text: string; reply_markup?: unknown },
  fetcher: Fetcher = defaultFetcher,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<SendResult> {
  const payload = { chat_id: chatId, text: message.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: message.reply_markup };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await tgCall(token, 'sendMessage', payload, fetcher);
    if (res.ok) return { ok: true, blocked: false };
    if (res.status === 0) return { ok: false, blocked: false, error: 'network' };
    if (res.status === 403) return { ok: false, blocked: true, error: 'bot_blocked' };
    if (res.status === 400 && /chat not found/i.test(String(res.body?.description ?? ''))) return { ok: false, blocked: true, error: 'chat_not_found' };
    if (res.status === 429) {
      const wait = retryAfterSeconds(res.body);
      if (attempt === 0 && wait > 0 && wait <= 5) {
        await sleep(wait * 1000);
        continue;
      }
      return { ok: false, blocked: false, error: 'rate_limited' };
    }
    return { ok: false, blocked: false, error: `http_${res.status}` };
  }
  return { ok: false, blocked: false, error: 'rate_limited' };
}

