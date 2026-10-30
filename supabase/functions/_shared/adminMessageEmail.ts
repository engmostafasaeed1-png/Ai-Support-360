/**
 * Admin messages by e-mail (docs/sql/admin-message-email.sql): pure helpers shared by the admin-message-email worker,
 * its template and the vitest tests. Content is only what the person already sees in-app (stored notification title
 * and text), clipped; links are only relative pages on our own site. Pure TypeScript, no Deno or browser APIs.
 */
export interface ClaimItem { id: string; title?: string | null; body?: string | null; link?: string | null; type?: string | null; kind?: string }
export interface ClaimMail { mail_key: string; recipient: string; email: string; lang?: string; digest: boolean; important?: boolean; items: ClaimItem[] }

export interface MessageItem { title: string; body: string; url: string }
export interface AdminMessageData { lang: 'en' | 'ar'; digest: boolean; items: MessageItem[]; url: string; prefsUrl: string }

export const DEFAULT_PATH = '/notifications';
export const PREFS_PATH = '/notifications/pause';
const PATH_RE = /^\/(?!\/)[A-Za-z0-9/_?=&.#%-]{0,199}$/;

/** A page on our site only ("/x/y"); anything else (full URLs, "//host", javascript:, spaces) becomes the inbox. */
export function safePortalPath(link: unknown): string {
  return typeof link === 'string' && PATH_RE.test(link.trim()) && !link.includes('..') ? link.trim() : DEFAULT_PATH;
}

/** Plain text, no control characters, at most `max` characters (whole text in-app; e-mail keeps it short). */
export function clip(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Subject-safe single line. */
export const oneLine = (text: unknown, max: number) => clip(typeof text === 'string' ? text.replace(/[\r\n\t]+/g, ' ') : '', max);

export function buildAdminMessageData(mail: ClaimMail, siteUrl: string): AdminMessageData {
  const base = siteUrl.replace(/\/+$/, '');
  const items = (mail.items ?? []).slice(0, 20).map((i) => ({
    title: oneLine(i.title, 120) || '—',
    body: clip(i.body, mail.digest ? 300 : 1000),
    url: `${base}${safePortalPath(i.link)}`,
  }));
  return {
    lang: mail.lang === 'ar' ? 'ar' : 'en',
    digest: !!mail.digest && items.length > 1,
    items,
    url: items.length === 1 ? items[0].url : `${base}${DEFAULT_PATH}`,
    prefsUrl: `${base}${PREFS_PATH}`,
  };
}

export function adminMessageSubject(d: Pick<AdminMessageData, 'lang' | 'digest' | 'items'>): string {
  const n = d.items?.length ?? 0;
  if (d.digest && n > 1) return d.lang === 'ar' ? `${n} رسائل جديدة من فريق AI Support 360` : `${n} new messages from the AI Support 360 team`;
  const t = oneLine(d.items?.[0]?.title, 90);
  return d.lang === 'ar' ? `${t || 'رسالة من الفريق'} — AI Support 360` : `${t || 'A message from the team'} — AI Support 360`;
}

/** What the worker reports back for one e-mail (ame_finish). */
export function finishFor(result: { sent: boolean; reason?: string }): { status: 'sent' | 'skipped'; reason?: string } {
  if (result.sent) return { status: 'sent' };
  return { status: 'skipped', reason: result.reason === 'notifications_disabled' ? 'email_notifications_off' : result.reason ?? 'skipped' };
}

// ------------------------------------------------------------------ layout (React createElement is injected so the
// template and the vitest tests share one layout; every text is a React child, so it is escaped).

// deno-lint-ignore no-explicit-any
type H = (type: string, props: Record<string, unknown> | null, ...children: any[]) => unknown;

export const ADMIN_MESSAGE_COPY = {
  en: {
    preview: 'A message from the AI Support 360 team',
    heading: 'A message from the AI Support 360 team',
    digest: (n: number) => `You have ${n} new messages from the team`,
    open: 'Open',
    cta: 'Reply in the portal',
    prefs: 'Notification settings',
    why: 'You receive this because an AI Support 360 administrator sent you this message in the portal. You can also read it in your notifications.',
  },
  ar: {
    preview: 'رسالة من فريق AI Support 360',
    heading: 'رسالة من فريق AI Support 360',
    digest: (n: number) => `لديك ${n} رسائل جديدة من الفريق`,
    open: 'فتح',
    cta: 'الرد عبر البوابة',
    prefs: 'إعدادات الإشعارات',
    why: 'تصلك هذه الرسالة لأن أحد مسؤولي AI Support 360 أرسلها إليك في البوابة. يمكنك أيضًا قراءتها في إشعاراتك.',
  },
} as const;

const S = {
  body: 'margin:0;background-color:#ffffff;font-family:Arial,sans-serif',
  box: 'max-width:560px;margin:0 auto;padding:32px 28px',
  brand: 'color:#1B2559;font-size:14px;font-weight:bold;margin:0',
  heading: 'color:#1B2559;font-size:22px;margin:20px 0 16px',
  card: 'background-color:#f1f5f9;padding:16px 20px;border-radius:16px;margin:0 0 12px',
  title: 'color:#1B2559;font-size:16px;font-weight:bold;margin:0 0 6px',
  text: 'color:#334155;font-size:15px;line-height:1.6;margin:0;white-space:pre-wrap',
  button: 'display:inline-block;background-color:#1B2559;color:#ffffff;padding:12px 20px;border-radius:10px;font-size:15px;text-decoration:none;margin-top:12px',
  small: 'color:#94a3b8;font-size:12px;line-height:1.5;margin:24px 0 8px',
  link: 'color:#3B82F6;font-size:12px',
};
const css = (s: string) => Object.fromEntries(s.split(';').filter(Boolean).map((p) => {
  const [k, v] = p.split(/:(.+)/);
  return [k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v.trim()];
}));

export function renderAdminMessage(h: H, d: AdminMessageData) {
  const ar = d.lang === 'ar';
  const c = ADMIN_MESSAGE_COPY[ar ? 'ar' : 'en'];
  const dir = ar ? 'rtl' : 'ltr';
  const items = d.items ?? [];
  return h('html', { lang: ar ? 'ar' : 'en', dir },
    h('head', null, h('meta', { charSet: 'utf-8' })),
    h('body', { style: css(S.body) },
      h('div', { style: { display: 'none', maxHeight: 0, overflow: 'hidden' } }, d.digest ? c.digest(items.length) : (items[0]?.title || c.preview)),
      h('div', { style: { ...css(S.box), direction: dir, textAlign: ar ? 'right' : 'left' } },
        h('p', { style: css(S.brand) }, 'AI Support 360'),
        h('h1', { style: css(S.heading) }, d.digest ? c.digest(items.length) : c.heading),
        ...items.map((it, i) => h('div', { key: i, style: css(S.card) },
          h('p', { style: css(S.title) }, it.title),
          it.body ? h('p', { style: css(S.text) }, it.body) : null,
          d.digest ? h('a', { href: it.url, style: css(S.link) }, c.open) : null)),
        h('a', { href: d.url, style: css(S.button) }, c.cta),
        h('p', { style: css(S.small) }, c.why),
        h('a', { href: d.prefsUrl, style: css(S.link) }, c.prefs))));
}

export function adminMessageText(d: AdminMessageData): string {
  const c = ADMIN_MESSAGE_COPY[d.lang === 'ar' ? 'ar' : 'en'];
  const items = (d.items ?? []).map((it) => `${it.title}\n${it.body}${d.digest ? `\n${it.url}` : ''}`).join('\n\n');
  return `${d.digest ? c.digest(d.items.length) : c.heading}\n\n${items}\n\n${c.cta}: ${d.url}\n\n${c.why}\n${c.prefs}: ${d.prefsUrl}\n`;
}
