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
