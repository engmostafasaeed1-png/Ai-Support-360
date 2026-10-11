/** What a consultant sees of the own Telegram link (the chat id never reaches the browser). */
export type TelegramStatus = {
  linked: boolean;
  active: boolean;
  username: string | null;
  linked_at: string | null;
  last_sent_at: string | null;
  paused_reason: string | null;
};

export type TelegramView = 'not_connected' | 'connected' | 'paused';

/** The state of the bot as the administrator sees it (answer of the function telegram-setup). */
export type TelegramAdminStatus = {
  configured: boolean;
  bot_ok: boolean;
  bot_username: string;
  bot_name: string;
  webhook_connected: boolean;
  webhook_url_matches: boolean;
  webhook_probe_status: number;
  webhook_url_set: boolean;
  pending_updates: number;
  last_error: string | null;
  last_error_at: string | null;
  links_total: number;
  links_active: number;
  set_ok: boolean | null;
  set_error: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

export function readTelegramStatus(raw: unknown): TelegramStatus {
  const r = obj(raw);
  return {
    linked: r.linked === true,
    active: r.linked === true && r.active === true,
    username: str(r.username),
    linked_at: str(r.linked_at),
    last_sent_at: str(r.last_sent_at),
    paused_reason: str(r.paused_reason),
  };
}

export function telegramView(status: TelegramStatus | null | undefined): TelegramView {
  if (!status || !status.linked) return 'not_connected';
  return status.active ? 'connected' : 'paused';
}

/** Why the alerts are paused, in words the consultant understands. */
export function pausedMessage(reason: string | null | undefined): string {
  if (reason === 'bot_blocked' || reason === 'chat_not_found') return 'You blocked or removed the bot in Telegram, so the alerts are paused.';
  if (reason === 'stopped') return 'You sent /stop to the bot, so the alerts are paused.';
  return 'The alerts are paused.';
}

export function readTelegramAdminStatus(raw: unknown): TelegramAdminStatus {
  const r = obj(raw);
  const bot = obj(r.bot);
  const hook = obj(r.webhook);
  const links = obj(r.links);
  const set = r.set && typeof r.set === 'object' ? obj(r.set) : null;
  return {
    configured: r.configured === true,
    bot_ok: r.configured === true && r.bot_ok === true,
    bot_username: str(bot.username) ?? '',
    bot_name: str(bot.name) ?? '',
    webhook_connected: hook.connected === true,
    webhook_url_matches: hook.url_matches === true,
    webhook_probe_status: num(hook.probe_status),
    webhook_url_set: hook.url_set === true,
    pending_updates: num(hook.pending_updates),
    last_error: str(hook.last_error),
    last_error_at: str(hook.last_error_at),
    links_total: num(links.total),
    links_active: num(links.active),
    set_ok: set ? set.ok === true : null,
    set_error: set ? str(set.description) : null,
  };
}

/** What is left to do for the administrator: create the bot, fix the token, connect the bot to the portal, repair the webhook function, or nothing. */
export function adminNextStep(s: TelegramAdminStatus): 'create_bot' | 'fix_token' | 'connect' | 'webhook_down' | 'ready' {
  if (!s.configured) return 'create_bot';
  if (!s.bot_ok) return 'fix_token';
  if (!s.webhook_url_matches) return 'connect';
  return s.webhook_connected ? 'ready' : 'webhook_down';
}
