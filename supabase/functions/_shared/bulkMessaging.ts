/**
 * Feature R: admin bulk messages ("Messages / Campaigns"). Pure rules shared by the send worker (bulk-messages-run),
 * the admin compose screen and tests. The database (docs/sql/bulk-messaging.sql) is the real gate for audience,
 * exclusions, permissions, throttling and caps; the functions here mirror it for preview and display.
 *
 * E-mail is deliberately NOT a channel: the app's e-mail service sends only one-recipient, event-triggered messages,
 * so bulk or campaign e-mail needs a dedicated marketing e-mail service.
 */

export const SITE = 'https://www.aisupport360.com';

export const CHANNELS = ['in_app', 'popup', 'push', 'telegram', 'whatsapp_manual', 'sms_manual'] as const;
export type Channel = typeof CHANNELS[number];
/** Channels stored per recipient (popup rides on the in-app notification). */
export type RecipientChannel = Exclude<Channel, 'popup'>;
export const CATEGORIES = ['service', 'marketing'] as const;
export type Category = typeof CATEGORIES[number];
export const VARIABLES = ['first_name', 'company', 'profile_completion', 'link'] as const;
export type Variable = typeof VARIABLES[number];

export const DEFAULTS = {
  inAppPerMinute: 100,
  telegramPerMinute: 240, // 4 per second; Telegram's platform limit is about 30 per second
  dailyCap: 2000,
  confirmAbove: 50,
  maxRecipients: 5000,
  maxPastedEmails: 2000,
  telegramGapMs: 150,
  pushPerMinute: 60,
  maxClaimsPerRun: 300,
} as const;

export const LIMITS = { subject: 150, body: 5000, telegram: 3900, notificationBody: 1000, templateName: 80 } as const;

/** Notification types: service messages are essential (never paused); marketing is a pausable digest. */
export const notificationType = (c: Category) => (c === 'service' ? 'admin_message' : 'admin_marketing');
export const BROADCAST_TYPES = ['admin_message', 'admin_marketing'] as const;

/** Brand images an admin may place in a message (no uploads, no outside images). */
export const BRAND_IMAGES = ['logo', 'mark', 'stacked'] as const;
export type BrandImage = typeof BRAND_IMAGES[number];

// ---------------------------------------------------------------- variables and language

export type Vars = Partial<Record<Variable, string | number | null | undefined>>;

/** Replaces {{first_name}} {{company}} {{profile_completion}} {{link}}; unknown or empty variables become a fallback. */
export function renderVariables(text: string, vars: Vars, lang: 'en' | 'ar' = 'en'): string {
  const fallback: Record<Variable, string> = lang === 'ar'
    ? { first_name: '', company: 'شركتك', profile_completion: '—', link: SITE }
    : { first_name: 'there', company: 'your company', profile_completion: '—', link: SITE };
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, name: string) => {
    if (!(VARIABLES as readonly string[]).includes(name)) return '';
    const v = vars[name as Variable];
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (!s) return fallback[name as Variable];
    return name === 'profile_completion' ? `${s.replace(/\s*%$/, '')} %` : s;
  }).replace(/(Hello|Hi|Dear|مرحبًا|مرحباً|مرحبا)[ \t]+([,،])/g, '$1$2');
}

/** The recipient's language decides the text; Arabic falls back to English when no Arabic text was written. */
export function pickText(lang: string | null | undefined, en: string, ar?: string | null): { lang: 'en' | 'ar'; text: string } {
  const wantsAr = typeof lang === 'string' && lang.toLowerCase().startsWith('ar');
  if (wantsAr && ar && ar.trim()) return { lang: 'ar', text: ar };
  return { lang: 'en', text: en };
}

export const firstName = (displayName: string | null | undefined) => (displayName ?? '').trim().split(/\s+/)[0] ?? '';

// ---------------------------------------------------------------- the limited message format
// **bold**, "- " list lines, [text](https://…) links, [[Button label|https://…]] buttons, ![alt](brand:logo) images.

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'link'; text: string; href: string };
export type Block =
  | { kind: 'p'; parts: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'button'; label: string; href: string }
  | { kind: 'image'; key: BrandImage; alt: string };

/** Only https links and links inside the site are kept; anything else stays plain text. */
export function safeHref(href: string): string | null {
  const h = String(href ?? '').trim();
  if (h.startsWith('/') && !h.startsWith('//')) return `${SITE}${h}`;
  try {
    const u = new URL(h);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}

export function parseInline(raw: string): Inline[] {
  const out: Inline[] = [];
  const line = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // images only on their own line, brand images only
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else {
      const href = safeHref(m[3]);
      out.push(href ? { kind: 'link', text: m[2], href } : { kind: 'text', text: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

export function parseMessage(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', parts: parseInline(para.join('\n')) });
    if (list.length) blocks.push({ kind: 'list', items: list });
    para = []; list = [];
  };
  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    const button = line.trim().match(/^\[\[([^|\]]{1,60})\|([^\]\s]+)\]\]$/);
    const image = line.trim().match(/^!\[([^\]]{0,120})\]\(([^)\s]+)\)$/);
    const item = line.match(/^\s*[-•*]\s+(.*)$/);
    if (!line.trim()) { flush(); continue; }
    if (button) {
      flush();
      const href = safeHref(button[2]);
      if (href) blocks.push({ kind: 'button', label: button[1].trim(), href });
      else blocks.push({ kind: 'p', parts: [{ kind: 'text', text: button[1].trim() }] });
      continue;
    }
    if (image) {
      flush();
      const key = image[2].startsWith('brand:') ? image[2].slice(6) : '';
      if ((BRAND_IMAGES as readonly string[]).includes(key)) blocks.push({ kind: 'image', key: key as BrandImage, alt: image[1] });
      continue; // any other image is dropped
    }
    if (item) { if (para.length) { blocks.push({ kind: 'p', parts: parseInline(para.join('\n')) }); para = []; } list.push(parseInline(item[1])); continue; }
    if (list.length) { blocks.push({ kind: 'list', items: list }); list = []; }
    para.push(line);
  }
  flush();
  return blocks;
}

const inlinePlain = (parts: Inline[]) => parts.map((p) => (p.kind === 'link' ? `${p.text} (${p.href})` : p.text)).join('');

/** Plain text for the bell, Telegram and the click-to-send helper. */
export function toPlainText(md: string): string {
  return parseMessage(md).map((b) => {
    if (b.kind === 'p') return inlinePlain(b.parts);
    if (b.kind === 'list') return b.items.map((i) => `• ${inlinePlain(i)}`).join('\n');
    if (b.kind === 'button') return `${b.label}: ${b.href}`;
    return '';
  }).filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------- footer (always added)

export function footerText(lang: 'en' | 'ar', category: Category): string {
  if (lang === 'ar') {
    return [
      'مرسلة من AI Support 360 (www.aisupport360.com).',
      category === 'service'
        ? 'تصلك لأن لديك حساباً لدينا وهي تخص حسابك أو خدمتنا.'
        : 'تصلك لأن لديك حساباً لدينا ولم توقف التحديثات.',
      `إيقاف الإشعارات مؤقتاً أو إلغاء الاشتراك: ${SITE}/notifications`,
      `الخصوصية: ${SITE}/privacy-policy`,
    ].join('\n');
  }
  return [
    'Sent by AI Support 360 (www.aisupport360.com).',
    category === 'service'
      ? 'You get this because you have an account with us and it concerns your account or our service.'
      : 'You get this because you have an account with us and have not turned off updates.',
    `Pause notifications or unsubscribe: ${SITE}/notifications`,
    `Privacy: ${SITE}/privacy-policy`,
  ].join('\n');
}

/** Web Push text (read by public/sw.js): subject as title, the start of the message (no greeting, no addresses) as body. */
export function pushMessage(subject: string, bodyPlain: string, url: string, tag: string, nowMs = Date.now()): string {
  const lines = String(bodyPlain ?? '').split(/\n+/).map((l) => l.trim())
    .filter((l) => l && !/^(hello|hi|dear|مرحب)/i.test(l) && !/https?:\/\//i.test(l));
  let body = lines.join(' ').replace(/^\s*[-•*]\s+/, '').replace(/\s+/g, ' ').trim();
  if (body.length > 180) body = `${body.slice(0, 179).trimEnd()}…`;
  return JSON.stringify({ v: 1, title: String(subject ?? '').slice(0, 80), body, url, tag: String(tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60), urgent: false, sent_at: nowMs });
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram: plain text plus one link, HTML-escaped (the bot sends with parse_mode HTML), within Telegram's size. */
export function telegramText(subject: string, bodyPlain: string, link: string | null, footer: string): string {
  const head = `<b>${escapeHtml(subject.slice(0, LIMITS.subject))}</b>`;
  const tail = `${link ? `\n\n${escapeHtml(link)}` : ''}\n\n${escapeHtml(footer)}`;
  const room = LIMITS.telegram - head.length - tail.length - 4;
  let body = escapeHtml(bodyPlain);
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 1))}…`;
  return `${head}\n\n${body}${tail}`;
}

// ---------------------------------------------------------------- safety checks

export type SecretKind = 'password' | 'private_key' | 'api_key' | 'token';
const SECRET_PATTERNS: Array<[SecretKind, RegExp]> = [
  ['password', /\b(password|passwd|pwd|passcode)\s*[:=]\s*\S{3,}/i],
  ['password', /(كلمة\s*(المرور|السر))\s*[:=]\s*\S{3,}/],
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['api_key', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/],
  ['api_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['api_key', /\b(gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/],
  ['api_key', /\b(api[_-]?key|secret|client[_-]?secret)\s*[:=]\s*[A-Za-z0-9_\-]{12,}/i],
  ['token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

/** Obvious secrets block sending (the database repeats this check). */
export function secretFindings(text: string): SecretKind[] {
  const s = String(text ?? '');
  return [...new Set(SECRET_PATTERNS.filter(([, re]) => re.test(s)).map(([k]) => k))];
}

export type RiskKind = 'contact_email' | 'contact_phone' | 'contact_link' | 'payment' | 'external_link';
/** Warnings only (phishing safeguard): contact details, payment instructions or links to other sites. */
export function riskWarnings(text: string): RiskKind[] {
  const s = String(text ?? '');
  const out: RiskKind[] = [];
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) out.push('contact_email');
  if (/(\+|00)?\d[\d\s().-]{7,}\d/.test(s.replace(/\{\{[^}]+\}\}/g, ''))) out.push('contact_phone');
  if (/\b(wa\.me|whatsapp\.com|t\.me|telegram\.me)\b/i.test(s)) out.push('contact_link');
  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/.test(s.replace(/\s/g, '')) || /\b(bank transfer|wire transfer|western union|moneygram|send (the )?money|pay (it )?to|account number|swift|iban|gift card|crypto|bitcoin|usdt)\b/i.test(s)
    || /(حوالة|تحويل بنكي|رقم الحساب|ادفع|أرسل المبلغ|ايبان|آيبان)/.test(s)) out.push('payment');
  const urls = s.match(/https?:\/\/[^\s)\]|]+/gi) ?? [];
  if (urls.some((u) => { try { return !/(^|\.)aisupport360\.com$/i.test(new URL(u).hostname); } catch { return true; } })) out.push('external_link');
  return out;
}

// ---------------------------------------------------------------- audience rules (mirror of bm_resolve)

export interface AudienceMember {
  user_id: string;
  deleted?: boolean;
  suspended?: boolean;
  /** Address on the e-mail suppression list (unsubscribed, bounced or complained). */
  unsubscribed?: boolean;
  /** Paused non-essential notifications (Feature Q). */
  paused?: boolean;
  telegram?: boolean;
  /** At least one active Web Push subscription (a device where the person enabled push notifications). */
  push?: boolean;
  has_phone?: boolean;
}
export type ExclusionReason = 'deleted' | 'suspended' | 'unsubscribed' | 'paused' | 'excluded_by_admin';

/** Suspended and deleted accounts never get anything; marketing also skips unsubscribed and paused people. */
export function exclusionReason(m: AudienceMember, category: Category, excludedByAdmin = false): ExclusionReason | null {
  if (m.deleted) return 'deleted';
  if (m.suspended) return 'suspended';
  if (excludedByAdmin) return 'excluded_by_admin';
  if (category === 'marketing' && m.unsubscribed) return 'unsubscribed';
  if (category === 'marketing' && m.paused) return 'paused';
  return null;
}

export type PlanStatus = 'queued' | 'manual_pending' | 'skipped';
export interface PlanRow { channel: RecipientChannel; status: PlanStatus; reason: string | null }

/** One row per chosen channel: excluded people are recorded as skipped so the report explains every gap. */
export function recipientPlan(m: AudienceMember, category: Category, channels: readonly Channel[], excludedByAdmin = false): PlanRow[] {
  const why = exclusionReason(m, category, excludedByAdmin);
  const set = new Set<RecipientChannel>();
  for (const c of channels) set.add(c === 'popup' ? 'in_app' : c);
  return [...set].map((channel) => {
    if (why) return { channel, status: 'skipped' as const, reason: why };
    if (channel === 'telegram') return m.telegram ? { channel, status: 'queued' as const, reason: null } : { channel, status: 'skipped' as const, reason: 'not_linked' };
    if (channel === 'push') return m.push ? { channel, status: 'queued' as const, reason: null } : { channel, status: 'skipped' as const, reason: 'push_not_enabled' };
    if (channel === 'whatsapp_manual' || channel === 'sms_manual') {
      return m.has_phone ? { channel, status: 'manual_pending' as const, reason: null } : { channel, status: 'skipped' as const, reason: 'no_phone' };
    }
    return { channel, status: 'queued' as const, reason: null };
  });
}

export const needsTypedConfirmation = (count: number) => count > DEFAULTS.confirmAbove;
export const confirmationOk = (typed: string, count: number) => !needsTypedConfirmation(count) || String(typed ?? '').trim() === String(count);

/** How many may still go out this minute on one channel. */
export function throttleBudget(perMinute: number, claimedLastMinute: number, maxPerRun: number = DEFAULTS.maxClaimsPerRun): number {
  const limit = Number.isFinite(perMinute) ? Math.max(1, Math.floor(perMinute)) : 1;
  return Math.max(0, Math.min(maxPerRun, limit - Math.max(0, Math.floor(claimedLastMinute || 0))));
}

/** Daily cap across all campaigns: may this many more recipients be added today? */
export const withinDailyCap = (sentToday: number, adding: number, cap: number) => sentToday + adding <= cap;

// ---------------------------------------------------------------- manual WhatsApp / SMS helper

/** Digits of an international number (8 to 15), or null. A leading 00 is treated as +. */
export function normalizePhone(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/^00/, '+');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Opens the admin's own WhatsApp with the text filled in. */
export function whatsappLink(phone: string, text: string): string | null {
  const d = normalizePhone(phone);
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null;
}

/** Opens the admin's own SMS app (the ?&body= form works on both iPhone and Android). */
export function smsLink(phone: string, text: string): string | null {
  const d = normalizePhone(phone);
  return d ? `sms:+${d}?&body=${encodeURIComponent(text)}` : null;
}

// ---------------------------------------------------------------- scheduling

/** UTC instant of a wall-clock time ("2026-10-21T09:30") in an IANA time zone. */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = String(local ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(ms));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - ms;
    } catch { return NaN; }
  };
  const first = offsetAt(guess);
  if (!Number.isFinite(first)) return null;
  const second = offsetAt(guess - first);
  return new Date(guess - second);
}

// ---------------------------------------------------------------- paid provider hook (not active)

export const PROVIDERS = ['off', 'twilio', 'whatsapp_cloud'] as const;
export type Provider = typeof PROVIDERS[number];
/** Secret names the owner adds in the project settings once a provider is chosen; never stored in code. */
export const PROVIDER_SECRETS: Record<Exclude<Provider, 'off'>, string[]> = {
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'TWILIO_WHATSAPP_FROM'],
  whatsapp_cloud: ['WHATSAPP_CLOUD_ACCESS_TOKEN', 'WHATSAPP_CLOUD_PHONE_NUMBER_ID'],
};
/** Paid sending is not implemented until the owner chooses a provider: every value answers "manual only". */
export function providerStatus(flag: unknown): { provider: Provider; automated: false } {
  const p = (PROVIDERS as readonly string[]).includes(String(flag)) ? (String(flag) as Provider) : 'off';
  return { provider: p, automated: false };
}
