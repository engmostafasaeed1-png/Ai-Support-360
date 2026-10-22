/**
 * "Send via" channels shared by the Refer & earn invitation dialog (Admin > Users), its test send and the bulk-messages
 * composer. The database decides per person and channel (docs/sql/notice-channels.sql); this file mirrors the rules for
 * the selector, the per-channel counts, the report and the tests. It never decides on its own.
 */
export const SEND_CHANNELS = ['in_app', 'email', 'push', 'telegram'] as const;
export type SendChannel = typeof SEND_CHANNELS[number];

export const SEND_PRESETS = {
  in_app_only: ['in_app'],
  email_only: ['email'],
  in_app_email: ['in_app', 'email'],
  all: ['in_app', 'email', 'push', 'telegram'],
} as const satisfies Record<string, readonly SendChannel[]>;
export type SendPreset = keyof typeof SEND_PRESETS;
export const PRESET_ORDER: readonly SendPreset[] = ['in_app_only', 'email_only', 'in_app_email', 'all'];
export const RECOMMENDED_PRESET: SendPreset = 'in_app_email';

/** Platform-level state of a channel for this send (not per person). */
export interface ChannelInfo { available: boolean; reason?: string | null; eligible?: number; skipped?: Record<string, number> }
export type ChannelMap = Partial<Record<SendChannel, ChannelInfo>>;

export const isSendChannel = (c: unknown): c is SendChannel => (SEND_CHANNELS as readonly string[]).includes(String(c));
export function normaliseChannels(raw: unknown): SendChannel[] {
  const set = new Set((Array.isArray(raw) ? raw : []).filter(isSendChannel));
  return SEND_CHANNELS.filter((c) => set.has(c));
}

const available = (info: ChannelMap, c: SendChannel) => info[c]?.available === true;

/** The available part of a preset (an unavailable channel is never selected silently). */
export function presetSelection(preset: SendPreset, info: ChannelMap): SendChannel[] {
  return SEND_PRESETS[preset].filter((c) => available(info, c));
}
export const presetUsable = (preset: SendPreset, info: ChannelMap) => presetSelection(preset, info).length > 0;

/** Default: In-app + E-mail (recommended); whatever of it is available, else in-app, else the first available channel. */
export function defaultSelection(info: ChannelMap): SendChannel[] {
  const rec = presetSelection(RECOMMENDED_PRESET, info);
  if (rec.length) return rec;
  const first = SEND_CHANNELS.find((c) => available(info, c));
  return first ? [first] : [];
}

/** The preset that matches the current selection exactly (available channels only), or null for a custom choice. */
export function activePreset(selection: readonly SendChannel[], info: ChannelMap): SendPreset | null {
  const key = normaliseChannels(selection).join(',');
  if (!key) return null;
  const exact = PRESET_ORDER.find((p) => SEND_PRESETS[p].every((c) => available(info, c)) && SEND_PRESETS[p].join(',') === key);
  return exact ?? PRESET_ORDER.find((p) => presetSelection(p, info).join(',') === key) ?? null;
}

export function toggleChannel(selection: readonly SendChannel[], c: SendChannel, on: boolean, info: ChannelMap): SendChannel[] {
  if (on && !available(info, c)) return normaliseChannels(selection);
  return normaliseChannels(on ? [...selection, c] : selection.filter((x) => x !== c));
}

// ---------------------------------------------------------------- per person and channel (mirror of ri_channel_plan)
export const CHANNEL_SKIP_REASONS = [
  'paused', 'push_not_enabled', 'telegram_not_connected', 'email_not_allowed', 'unsubscribed', 'already_invited', 'resend_too_soon',
] as const;
export type ChannelSkipReason = typeof CHANNEL_SKIP_REASONS[number];

export const CHANNEL_REASON_TEXT: Record<ChannelSkipReason | 'not_linked' | 'needs_update' | 'push_not_ready', string> = {
  paused: 'notifications paused by the person',
  push_not_enabled: 'push notifications not enabled',
  telegram_not_connected: 'Telegram not connected',
  not_linked: 'Telegram not connected',
  email_not_allowed: 'invitations cannot be e-mailed (needs a separate marketing e-mail service)',
  unsubscribed: 'unsubscribed from e-mails',
  already_invited: 'already invited on this channel (this version)',
  resend_too_soon: 'invited on this channel in the last 14 days',
  needs_update: 'waits for the prepared database update',
  push_not_ready: 'push notifications are not set up yet',
};

export interface ChannelPerson {
  /** Paused non-essential notifications (Feature Q) for app channels / for e-mail. */
  pausedApp?: boolean; pausedEmail?: boolean;
  pushEnabled?: boolean; telegramConnected?: boolean; emailUnsubscribed?: boolean;
  /** Earlier deliveries of THIS invitation version per channel (first sends and resends), newest time. */
  sentThisVersion?: Partial<Record<SendChannel, boolean>>;
  lastSentAt?: Partial<Record<SendChannel, string | null>>;
}
export interface ChannelRuleOptions { resend?: boolean; resendDays?: number; now?: Date; emailAllowed?: boolean }

/** Why one person does not get one channel (null = it goes out). Same order as the database. */
export function channelSkipReason(p: ChannelPerson, channel: SendChannel, o: ChannelRuleOptions = {}): ChannelSkipReason | null {
  if (channel === 'email') {
    if (!o.emailAllowed) return 'email_not_allowed';
    if (p.emailUnsubscribed) return 'unsubscribed';
    if (p.pausedEmail) return 'paused';
  } else {
    if (p.pausedApp) return 'paused';
    if (channel === 'push' && !p.pushEnabled) return 'push_not_enabled';
    if (channel === 'telegram' && !p.telegramConnected) return 'telegram_not_connected';
  }
  if (!o.resend && p.sentThisVersion?.[channel]) return 'already_invited';
  const last = p.lastSentAt?.[channel];
  if (o.resend && last) {
    const days = o.resendDays ?? 14;
    if (((o.now ?? new Date()).getTime() - new Date(last).getTime()) / 86_400_000 < days) return 'resend_too_soon';
  }
  return null;
}

// ---------------------------------------------------------------- previews per channel
export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 180;

/** Push text: subject as title, the first sentences of the message (no greeting, no web addresses) as body. */
export function pushPreview(subject: string, plainBody: string): { title: string; body: string } {
  const lines = String(plainBody ?? '').split(/\n+/).map((l) => l.trim())
    .filter((l) => l && !/^(hello|hi|dear|مرحب)/i.test(l) && !/https?:\/\//i.test(l) && !/^[-•*]\s*$/.test(l));
  let body = lines.join(' ').replace(/^\s*[-•*]\s+/, '').replace(/\s+/g, ' ').trim();
  if (body.length > PUSH_BODY_MAX) body = `${body.slice(0, PUSH_BODY_MAX - 1).trimEnd()}…`;
  return { title: String(subject ?? '').slice(0, PUSH_TITLE_MAX), body };
}

/** Per-channel line of a send report: { sent, failed, sending, skipped: {reason: n} }. */
export interface ChannelReport { sent: number; failed: number; sending: number; skipped: Record<string, number> }
export const emptyChannelReport = (): ChannelReport => ({ sent: 0, failed: 0, sending: 0, skipped: {} });
